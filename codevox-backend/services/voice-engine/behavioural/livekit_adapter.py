"""LiveKit Agent + LLM adapter for BehaviouralOrchestrator."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from dataclasses import dataclass, field
from typing import Any

import aiohttp
from livekit import rtc
from livekit.agents import Agent, AgentSession, llm, utils
from livekit.agents.llm.llm import ChatChunk, ChoiceDelta, LLM, LLMStream
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS, NOT_GIVEN, APIConnectOptions, NotGivenOr
from livekit.agents.utils import http_context
from livekit.agents.voice import room_io

from behavioural.orchestrator import BehaviouralOrchestrator
from behavioural.schemas import BehaviouralRoundConfig
from behavioural.trace import emit_behavioural
from interview_agent_session import (
    _build_candidate_media,
    _candidate_identity,
    _wire_session_events,
    build_agent_session,
    connect_interview_room,
)
from media_factory import build_media_from_runtime
from provider_resilience import ResilientLlmClient, build_provider_chain
from sarvam_media import sarvam_stt_sample_rate, sarvam_tts_sample_rate
from sarvam_stt_resilient import long_lived_http_session
from handoff import post_complete, post_voice_chat_sync
from recording import (
    SessionRecorder,
    _is_recording_enabled,
    _start_agent_audio_egress,
    _wire_remote_track_events,
    stage_id_from_room,
)
logger = logging.getLogger("behavioural.livekit")


@dataclass
class BehaviouralSessionState:
    candidate_token: str
    orch: BehaviouralOrchestrator
    completion_event: asyncio.Event = field(default_factory=asyncio.Event)
    speaking_done: asyncio.Event = field(default_factory=asyncio.Event)
    session: AgentSession | None = None
    chat_history: list[dict[str, Any]] = field(default_factory=list)
    opening_sent: bool = False
    fixed_tts_reply: str | None = None
    candidate_left: bool = False
    ended_by: str | None = None
    finishing: bool = False
    # Compat fields used by _wire_session_events / room helpers
    interview_language: str = "en-IN"
    phase: str = "hr_verbal"
    tech_stack: str = "behavioural"
    intro_completed: bool = False
    intro_depth_score: int = 0
    intro_audit_payload: dict[str, Any] | None = None


def _last_user_message(chat_ctx: llm.ChatContext):
    for item in reversed(chat_ctx.items):
        if getattr(item, "role", None) == "user":
            return item
    return None


class BehaviouralOrchestratorLLM(LLM):
    def __init__(self, state: BehaviouralSessionState) -> None:
        super().__init__()
        self._state = state

    @property
    def model(self) -> str:
        return "behavioural-orchestrator"

    @property
    def provider(self) -> str:
        return "custom"

    def chat(
        self,
        *,
        chat_ctx: llm.ChatContext,
        tools: list[llm.Tool] | None = None,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
        parallel_tool_calls: NotGivenOr[bool] = NOT_GIVEN,
        tool_choice: NotGivenOr[llm.ToolChoice] = NOT_GIVEN,
        extra_kwargs: NotGivenOr[dict[str, Any]] = NOT_GIVEN,
    ) -> LLMStream:
        return BehaviouralOrchestratorLLMStream(
            self,
            chat_ctx=chat_ctx,
            tools=tools or [],
            conn_options=conn_options,
        )


class BehaviouralOrchestratorLLMStream(LLMStream):
    async def _run(self) -> None:
        state = self._llm._state
        if state.fixed_tts_reply:
            reply = state.fixed_tts_reply
            state.fixed_tts_reply = None
            self._event_ch.send_nowait(
                ChatChunk(
                    id=utils.shortuuid("chunk_"),
                    delta=ChoiceDelta(role="assistant", content=reply),
                ),
            )
            return

        user_msg = _last_user_message(self._chat_ctx)
        user_text = (user_msg.text_content or "").strip() if user_msg else ""
        confidence = 1.0
        if user_msg and getattr(user_msg, "transcript_confidence", None) is not None:
            confidence = float(user_msg.transcript_confidence)

        if not state.opening_sent:
            step = await state.orch.get_opening_utterance()
            state.opening_sent = True
            reply = step.speak or "Hello, welcome to your behavioural interview."
            state.chat_history.append({"role": "assistant", "content": reply})
            self._event_ch.send_nowait(
                ChatChunk(
                    id=utils.shortuuid("chunk_"),
                    delta=ChoiceDelta(role="assistant", content=reply),
                ),
            )
            # Push opening into Nest/viewport so LIVE TRANSCRIPT is not empty
            try:
                await post_voice_chat_sync(
                    state.candidate_token,
                    chat_history=state.chat_history,
                    phase="hr_verbal",
                )
            except Exception:
                logger.warning("post_voice_chat_sync opening failed", exc_info=True)
            if step.complete:
                await _finish_after_tts(state)
            return

        if not user_text:
            return

        state.chat_history.append({"role": "user", "content": user_text})
        emit_behavioural(
            "livekit_user_transcript",
            {"text": user_text, "stt_confidence": confidence},
        )
        step = await state.orch.handle_answer(user_text, confidence)
        reply = step.speak or ""
        if reply:
            state.chat_history.append({"role": "assistant", "content": reply})
            self._event_ch.send_nowait(
                ChatChunk(
                    id=utils.shortuuid("chunk_"),
                    delta=ChoiceDelta(role="assistant", content=reply),
                ),
            )
        try:
            await post_voice_chat_sync(
                state.candidate_token,
                chat_history=state.chat_history,
                phase="hr_verbal",
                user_text=user_text,
                stt_confidence=confidence,
            )
        except Exception:
            logger.warning("post_voice_chat_sync failed", exc_info=True)

        if step.complete:
            # Closing ChatChunk is already queued — wait for TTS before Nest complete
            # so FE does not redirect mid thank-you.
            await _finish_after_tts(state)


async def _finish_after_tts(state: BehaviouralSessionState) -> None:
    """Let thank-you TTS play before post_complete / completion_event."""
    if state.finishing:
        return
    state.finishing = True
    state.speaking_done.clear()
    # Give TTS a moment to enter "speaking", then wait until listening again.
    await asyncio.sleep(0.4)
    try:
        await asyncio.wait_for(state.speaking_done.wait(), timeout=18.0)
    except asyncio.TimeoutError:
        logger.warning(
            "Behavioural closing TTS wait timed out token=%s — finishing anyway",
            state.candidate_token,
        )
        await asyncio.sleep(2.0)
    await _finish(state)


async def _finish(state: BehaviouralSessionState) -> None:
    if state.intro_completed:
        state.completion_event.set()
        return
    state.intro_completed = True
    report = state.orch.generate_final_report()
    state.intro_audit_payload = report
    emit_behavioural(
        "livekit_post_complete",
        {
            "candidate_token": state.candidate_token,
            "platform_decision": report.get("platform_decision"),
            "final_outcome": report.get("final_outcome"),
            "weighted_competency_score": report.get("weighted_competency_score"),
            "hr_voice_audit": report,
            "chat_history": state.chat_history,
        },
    )
    try:
        await post_complete(
            state.candidate_token,
            stage3_chat_history=state.chat_history,
            final_decision=str(report.get("platform_decision") or "UNDER_REVIEW"),
            hr_voice_audit=report,
            ended_by=state.ended_by,
        )
        emit_behavioural(
            "livekit_post_complete_ok",
            {"candidate_token": state.candidate_token},
        )
    except Exception as exc:
        logger.warning("post_complete behavioural failed", exc_info=True)
        emit_behavioural(
            "livekit_post_complete_failed",
            {"candidate_token": state.candidate_token, "error": str(exc)},
        )
    state.completion_event.set()


class BehaviouralInterviewAgent(Agent):
    def __init__(
        self,
        state: BehaviouralSessionState,
        *,
        http_session: aiohttp.ClientSession | None = None,
    ) -> None:
        stt, tts = _build_candidate_media(
            http_session=http_session,
            language_preference=state.interview_language,
        )
        super().__init__(
            instructions=(
                "You are an HR behavioural interviewer. Speak the orchestrator reply only. "
                "Do not invent questions beyond what the orchestrator provides."
            ),
            stt=stt,
            tts=tts,
            llm=BehaviouralOrchestratorLLM(state),
        )
        self._state = state


@dataclass
class BehaviouralInterviewResult:
    done: bool
    chat_history: list[dict[str, Any]] = field(default_factory=list)
    audit: dict[str, Any] | None = None


async def run_behavioural_interview(
    room_name: str,
    candidate_token: str,
    *,
    round_config: dict[str, Any] | None = None,
    rubric_criteria: list[dict] | None = None,
    job_profile_context: dict | None = None,
    candidate_name: str | None = None,
    candidate_id: str | None = None,
    language_preference: str | None = None,
) -> BehaviouralInterviewResult:
    cfg = BehaviouralRoundConfig.from_payload(round_config, rubric_criteria)
    if not cfg.competencies and not cfg.screening_questions:
        logger.error("Empty behavioural config token=%s", candidate_token)
        emit_behavioural(
            "livekit_empty_config",
            {"candidate_token": candidate_token, "round_config": round_config},
        )
        return BehaviouralInterviewResult(done=False)

    emit_behavioural(
        "livekit_session_start",
        {
            "candidate_token": candidate_token,
            "room_name": room_name,
            "candidate_name": candidate_name,
            "round_config": round_config,
            "rubric_criteria": rubric_criteria,
            "job_profile_context": job_profile_context,
        },
    )

    ctx = job_profile_context or {}
    orch = BehaviouralOrchestrator(
        config=cfg,
        job_title=str(ctx.get("title") or "") or None,
        resume_projects=str(ctx.get("resume_projects") or "") or None,
        client=ResilientLlmClient(build_provider_chain()),
    )
    from prompts import normalize_interview_language

    spoken = normalize_interview_language(language_preference)
    orch.interview_language = spoken
    state = BehaviouralSessionState(
        candidate_token=candidate_token,
        orch=orch,
        interview_language=spoken,
    )
    room: rtc.Room | None = None
    recorder: SessionRecorder | None = None
    try:
        room = await connect_interview_room(room_name)

        # --- Track recording setup ---
        if _is_recording_enabled():
            recorder = SessionRecorder(
                room_name,
                candidate_token,
                stage_id=stage_id_from_room(room_name, candidate_token) or "hr_verbal",
                candidate_name=candidate_name,
                candidate_id=candidate_id,
            )
            _wire_remote_track_events(recorder, room)
            await _start_agent_audio_egress(recorder, room)

        async with long_lived_http_session() as http_session, http_context.open():
            agent = BehaviouralInterviewAgent(state, http_session=http_session)
            session = build_agent_session()
            state.session = session

            @session.on("agent_state_changed")
            def _on_agent_state(ev) -> None:
                # Avoid STT picking up the agent's own TTS; signal when thank-you finished.
                try:
                    new_state = getattr(ev, "new_state", None)
                    if new_state == "speaking":
                        session.input.set_audio_enabled(False)
                        state.speaking_done.clear()
                    elif new_state == "listening":
                        session.input.set_audio_enabled(True)
                        state.speaking_done.set()
                except Exception:
                    logger.debug("agent_state audio toggle failed", exc_info=True)

            @session.on("close")
            def _on_close(ev) -> None:
                logger.warning(
                    "Behavioural AgentSession closed token=%s reason=%s",
                    candidate_token,
                    getattr(ev, "reason", None),
                )
                state.completion_event.set()

            @room.on("participant_disconnected")
            def _on_participant_disconnected(participant: rtc.RemoteParticipant) -> None:
                if str(participant.identity).startswith("candidate-"):
                    logger.info(
                        "Behavioural candidate disconnected (session kept) token=%s",
                        candidate_token,
                    )

            @room.on("data_received")
            def _on_data_received(data_packet: rtc.DataPacket) -> None:
                try:
                    import json

                    payload = json.loads(data_packet.data.decode("utf-8"))
                    if payload.get("type") != "end_interview":
                        return
                    if state.intro_completed or state.completion_event.is_set():
                        return
                    if payload.get("reason") == "candidate_ended_interview":
                        state.ended_by = "candidate"

                    async def _intentional_end() -> None:
                        await _finish(state)

                    asyncio.create_task(_intentional_end())
                except Exception:
                    logger.debug("behavioural end packet ignored", exc_info=True)

            candidate_id = _candidate_identity(room)
            stt_sample_rate = sarvam_stt_sample_rate()
            tts_sample_rate = sarvam_tts_sample_rate()
            kwargs = {}
            if candidate_id:
                kwargs["participant_identity"] = candidate_id
            room_options = room_io.RoomOptions(
                close_on_disconnect=False,
                audio_input=room_io.AudioInputOptions(
                    sample_rate=stt_sample_rate,
                    auto_gain_control=False,
                ),
                audio_output=room_io.AudioOutputOptions(sample_rate=tts_sample_rate),
                **kwargs,
            )
            try:
                await session.start(agent=agent, room=room, room_options=room_options)
                from livekit_speaker import wait_for_candidate_screen_share

                await wait_for_candidate_screen_share(room)
                # Trigger opening generation
                state.fixed_tts_reply = None
                await session.generate_reply(user_input="")
                await asyncio.wait_for(
                    state.completion_event.wait(),
                    timeout=cfg.interview_limits.max_duration_minutes * 60 + 180,
                )
            finally:
                await session.aclose()
                await room.disconnect()
                room = None
        return BehaviouralInterviewResult(
            done=state.intro_completed,
            chat_history=state.chat_history,
            audit=state.intro_audit_payload or orch.generate_final_report(),
        )
    except Exception:
        logger.exception("Behavioural LiveKit session failed token=%s", candidate_token)
        return BehaviouralInterviewResult(
            done=False,
            chat_history=state.chat_history,
            audit=orch.final_report,
        )
    finally:
        if recorder is not None:
            try:
                await recorder.stop_all()
            except Exception:
                logger.exception("Recorder cleanup failed token=%s", candidate_token)
        if room is not None:
            await room.disconnect()

