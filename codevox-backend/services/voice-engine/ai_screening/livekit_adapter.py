"""LiveKit session runner for AI Screening (neutral interviewer, no rubrics)."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

from livekit import rtc
from livekit.agents import Agent, AgentSession, llm
from livekit.agents.llm.llm import ChatChunk, ChoiceDelta, LLM, LLMStream
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS, NOT_GIVEN, APIConnectOptions, NotGivenOr
from livekit.agents.utils import http_context
from livekit.agents.voice import room_io

from ai_screening.orchestrator import ScreeningOrchestrator
from ai_screening.schemas import ScreeningRoundConfig
from handoff import post_screening_complete, post_voice_chat_sync
from interview_agent_session import (
    _build_candidate_media,
    _candidate_identity,
    build_agent_session,
    connect_interview_room,
)
from livekit_speaker import wait_for_candidate_screen_share
from provider_resilience import ResilientLlmClient, build_provider_chain
from sarvam_media import sarvam_stt_sample_rate, sarvam_tts_sample_rate
from sarvam_stt_resilient import long_lived_http_session
from recording import (
    SessionRecorder,
    _is_recording_enabled,
    _start_agent_audio_egress,
    _wire_remote_track_events,
    stage_id_from_room,
)
logger = logging.getLogger("ai_screening.livekit")


@dataclass
class ScreeningSessionState:
    candidate_token: str
    orch: ScreeningOrchestrator
    completion_event: asyncio.Event = field(default_factory=asyncio.Event)
    speaking_done: asyncio.Event = field(default_factory=asyncio.Event)
    # Set when LiveKit closes the AgentSession before the interview is finished.
    unexpected_close: asyncio.Event = field(default_factory=asyncio.Event)
    # Ignore the close event fired by our own session.aclose().
    suppress_close: bool = False
    session: AgentSession | None = None
    opening_sent: bool = False
    finishing: bool = False
    candidate_left: bool = False
    ended_by: str | None = None
    done: bool = False
    # Compat with shared wiring helpers
    interview_language: str = "en-IN"
    phase: str = "ai_screening"
    tech_stack: str = "screening"
    intro_completed: bool = False


class ScreeningOrchestratorLLM(LLM):
    def __init__(self, state: ScreeningSessionState) -> None:
        super().__init__()
        self._state = state

    @property
    def model(self) -> str:
        return "ai-screening-orchestrator"

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
        return ScreeningOrchestratorLLMStream(
            self,
            chat_ctx=chat_ctx,
            tools=tools or [],
            conn_options=conn_options,
        )


class ScreeningOrchestratorLLMStream(LLMStream):
    async def _run(self) -> None:
        state = self._llm._state
        orch = state.orch

        if not state.opening_sent:
            turn = orch.opening()
            state.opening_sent = True
        else:
            user_text = ""
            for item in reversed(self.chat_ctx.items):
                if getattr(item, "role", None) == "user":
                    user_text = str(getattr(item, "text_content", None) or getattr(item, "content", "") or "")
                    break
            turn = await orch.process_candidate_answer(user_text)

        reply = turn.spoken_reply
        chunk = ChatChunk(
            id="screening-1",
            delta=ChoiceDelta(role="assistant", content=reply),
        )
        self._event_ch.send_nowait(chunk)

        try:
            await post_voice_chat_sync(
                state.candidate_token,
                chat_history=orch.chat_history,
                phase="ai_screening",
            )
        except Exception:
            logger.debug("screening chat sync failed", exc_info=True)

        if turn.done and not state.finishing:
            state.finishing = True
            state.done = True
            state.intro_completed = True
            asyncio.create_task(self._finish())

    async def _finish(self) -> None:
        state = self._llm._state
        orch = state.orch
        
        # Give the agent a moment to transition to 'speaking' state
        for _ in range(25):
            await asyncio.sleep(0.2)
            if not state.speaking_done.is_set():
                break

        # Wait for the agent to finish speaking the closing message
        await state.speaking_done.wait()
        await asyncio.sleep(1.0)

        try:
            await post_screening_complete(
                state.candidate_token,
                transcript=orch.chat_history,
                conversation_state=orch.state.to_dict(),
                round_config={
                    "maxQuestions": orch.config.max_questions,
                    "maxTimeMinutes": orch.config.max_time_minutes,
                    "topics": [
                        {
                            "id": t.id,
                            "label": t.label,
                            "enabled": t.enabled,
                        }
                        for t in orch.config.topics
                    ],
                    "screeningRequirements": [
                        {
                            "id": r.id,
                            "question": r.question,
                            "expectedAnswer": r.expected_answer,
                            "predefined": r.predefined,
                        }
                        for r in orch.config.screening_requirements
                    ],
                },
                job_profile_context=orch.job_profile_context,
            )
        except Exception:
            logger.exception("post_screening_complete failed token=%s", state.candidate_token)
        finally:
            state.completion_event.set()


class ScreeningInterviewAgent(Agent):
    def __init__(self, state: ScreeningSessionState, *, http_session=None) -> None:
        stt, tts = _build_candidate_media(
            http_session=http_session,
            language_preference=state.interview_language,
        )
        super().__init__(
            instructions="You are a neutral AI Screening interviewer.",
            stt=stt,
            llm=ScreeningOrchestratorLLM(state),
            tts=tts,
        )
        self._state = state


@dataclass
class ScreeningInterviewResult:
    done: bool
    chat_history: list[dict[str, Any]] = field(default_factory=list)
    conversation_state: dict[str, Any] | None = None


async def run_ai_screening_interview(
    room_name: str,
    candidate_token: str,
    *,
    round_config: dict[str, Any] | None = None,
    job_profile_context: dict | None = None,
    candidate_name: str | None = None,
    candidate_id: str | None = None,
    resume_skills: list[str] | None = None,
    language_preference: str | None = None,
) -> ScreeningInterviewResult:
    cfg = ScreeningRoundConfig.from_payload(round_config)
    raw_cfg = round_config or {}
    raw_reqs = raw_cfg.get("screeningRequirements") or raw_cfg.get("screening_requirements")
    configured = cfg.configured_requirements()
    logger.info(
        "AI Screening payload token=%s maxQuestions=%s requirements_in_payload=%s configured_with_expected_answer=%s ids=%s",
        candidate_token,
        raw_cfg.get("maxQuestions") or raw_cfg.get("max_questions"),
        len(raw_reqs) if isinstance(raw_reqs, list) else 0,
        len(configured),
        [r.id for r in configured],
    )
    if not cfg.enabled_topics():
        logger.error("AI Screening has zero enabled topics token=%s", candidate_token)
        return ScreeningInterviewResult(done=False)

    orch = ScreeningOrchestrator(
        config=cfg,
        client=ResilientLlmClient(build_provider_chain()),
        job_profile_context=job_profile_context,
        candidate_name=candidate_name,
        resume_skills=resume_skills,
    )
    from prompts import normalize_interview_language

    spoken = normalize_interview_language(language_preference)
    orch.interview_language = spoken
    state = ScreeningSessionState(
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
                stage_id=stage_id_from_room(room_name, candidate_token) or "ai_screening",
                candidate_name=candidate_name,
                candidate_id=candidate_id,
            )
            _wire_remote_track_events(recorder, room)
            await _start_agent_audio_egress(recorder, room)

        async with long_lived_http_session() as http_session, http_context.open():
            @room.on("participant_disconnected")
            def _on_participant_disconnected(participant: rtc.RemoteParticipant) -> None:
                if str(participant.identity).startswith("candidate-"):
                    logger.info(
                        "AI Screening candidate disconnected (session kept) token=%s",
                        candidate_token,
                    )

            @room.on("data_received")
            def _on_data_received(data_packet: rtc.DataPacket) -> None:
                try:
                    import json

                    payload = json.loads(data_packet.data.decode("utf-8"))
                    if payload.get("type") != "end_interview":
                        return
                    if state.finishing:
                        return
                    if payload.get("reason") == "candidate_ended_interview":
                        state.ended_by = "candidate"
                    state.finishing = True
                    state.done = True
                    state.intro_completed = True
                    from prompts import speak_line

                    closing = speak_line(
                        "Thank you for your time. You can now continue to the next rounds for the recruitment.",
                        state.interview_language,
                    )
                    orch.chat_history.append({"role": "assistant", "content": closing})

                    async def _intentional_end() -> None:
                        try:
                            await post_screening_complete(
                                state.candidate_token,
                                transcript=orch.chat_history,
                                conversation_state=orch.state.to_dict(),
                                ended_by=state.ended_by,
                                round_config={
                                    "maxQuestions": orch.config.max_questions,
                                    "maxTimeMinutes": orch.config.max_time_minutes,
                                    "topics": [
                                        {"id": t.id, "label": t.label, "enabled": t.enabled}
                                        for t in orch.config.topics
                                    ],
                                    "screeningRequirements": [
                                        {
                                            "id": r.id,
                                            "question": r.question,
                                            "expectedAnswer": r.expected_answer,
                                            "predefined": r.predefined,
                                        }
                                        for r in orch.config.screening_requirements
                                    ],
                                    "intentionalEarlyEnd": True,
                                },
                                job_profile_context=orch.job_profile_context,
                            )
                        except Exception:
                            logger.exception(
                                "post_screening_complete (early end) failed token=%s",
                                state.candidate_token,
                            )
                        finally:
                            state.completion_event.set()

                    asyncio.create_task(_intentional_end())
                except Exception:
                    logger.debug("screening data packet ignored", exc_info=True)

            candidate_id = _candidate_identity(room)
            kwargs = {}
            if candidate_id:
                kwargs["participant_identity"] = candidate_id
            room_options = room_io.RoomOptions(
                close_on_disconnect=False,
                audio_input=room_io.AudioInputOptions(
                    sample_rate=sarvam_stt_sample_rate(),
                    auto_gain_control=False,
                ),
                audio_output=room_io.AudioOutputOptions(sample_rate=sarvam_tts_sample_rate()),
                **kwargs,
            )
            # A LiveKit AgentSession close (speech error, brief disconnect) must not
            # end the interview. Stay in the room and start the session again.
            deadline = asyncio.get_running_loop().time() + cfg.max_time_minutes * 60 + 180
            quick_failures = 0
            while not state.completion_event.is_set():
                remaining = deadline - asyncio.get_running_loop().time()
                if remaining <= 0:
                    logger.warning(
                        "AI Screening time budget ended with session still open token=%s",
                        candidate_token,
                    )
                    break

                state.unexpected_close.clear()
                agent = ScreeningInterviewAgent(state, http_session=http_session)
                session = build_agent_session()
                state.session = session

                @session.on("agent_state_changed")
                def _on_agent_state(ev, session=session) -> None:
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
                    reason = getattr(ev, "reason", None)
                    error = getattr(ev, "error", None)
                    logger.warning(
                        "AI Screening AgentSession closed token=%s reason=%s error=%s done=%s",
                        candidate_token,
                        reason,
                        error,
                        state.done,
                    )
                    if state.suppress_close:
                        return
                    if state.done or state.finishing:
                        state.completion_event.set()
                        return
                    state.unexpected_close.set()

                started = asyncio.get_running_loop().time()
                try:
                    await session.start(agent=agent, room=room, room_options=room_options)
                    if not state.opening_sent:
                        await wait_for_candidate_screen_share(room)
                        await session.generate_reply(user_input="")
                    restart_task = asyncio.create_task(state.unexpected_close.wait())
                    done_task = asyncio.create_task(state.completion_event.wait())
                    await asyncio.wait(
                        {restart_task, done_task},
                        timeout=max(1.0, deadline - asyncio.get_running_loop().time()),
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    for task in (restart_task, done_task):
                        if not task.done():
                            task.cancel()
                except Exception:
                    logger.exception(
                        "AI Screening session dropped token=%s; keeping the room open",
                        candidate_token,
                    )
                    state.unexpected_close.set()
                finally:
                    state.suppress_close = True
                    try:
                        await session.aclose()
                    except Exception:
                        logger.debug("session aclose failed", exc_info=True)
                    state.suppress_close = False

                if state.completion_event.is_set() or state.done:
                    break
                if asyncio.get_running_loop().time() - started < 8:
                    quick_failures += 1
                else:
                    quick_failures = 0
                if quick_failures >= 5:
                    logger.error(
                        "AI Screening stopped restarting after repeated session closes token=%s",
                        candidate_token,
                    )
                    break
                logger.warning(
                    "AI Screening session closed early; restarting in the same room token=%s",
                    candidate_token,
                )
                await asyncio.sleep(1)

            if room is not None:
                await room.disconnect()
                room = None

        return ScreeningInterviewResult(
            done=state.done or state.intro_completed,
            chat_history=orch.chat_history,
            conversation_state=orch.state.to_dict(),
        )
    except Exception:
        logger.exception("AI Screening LiveKit session failed token=%s", candidate_token)
        return ScreeningInterviewResult(done=False, chat_history=orch.chat_history)
    finally:
        if recorder is not None:
            try:
                await recorder.stop_all()
            except Exception:
                logger.exception("Recorder cleanup failed token=%s", candidate_token)
        if room is not None:
            await room.disconnect()
