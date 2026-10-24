"""Viva agent session bootstrap and LiveKit connection."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging

import aiohttp
from livekit import rtc
from livekit.agents import Agent, AgentSession, AgentStateChangedEvent
from livekit.agents.utils import http_context
from livekit.agents.voice import room_io
from livekit.agents.voice.events import CloseEvent
from llm_engine import LlmEngine
from livekit_speaker import (
    CANDIDATE_WAIT_SECONDS,
    _agent_token,
    _livekit_config,
    _wait_for_primary_participant,
)
from media_factory import build_media_from_runtime
from sarvam_media import sarvam_stt_sample_rate, sarvam_tts_sample_rate
from sarvam_stt_resilient import build_session_conn_options, long_lived_http_session
from prompts_viva import VIVA_EXAMINER_SYSTEM_PROMPT
from question_sources.viva import VIVA_MAX_TURNS, VivaQuestionBankEntry, VivaQuestionSource
from session_audit import SessionAuditLedger
from session_config.types import load_runtime_config
from llm_call_ledger import LlmCallLedger
from viva_llm_sync import build_viva_llm_client
from viva_orchestrator_llm import VivaOrchestratorLLM
from viva_phase_coordinator import run_viva_phase_coordinator
from viva_runtime_registry import register_viva_state, unregister_viva_state
from viva_session_state import VivaSessionState

logger = logging.getLogger("viva-agent-session")


def build_viva_agent_session() -> AgentSession:
    kwargs: dict = {
        "turn_handling": {
            "turn_detection": "stt",
            "endpointing": {"min_delay": 0.65, "max_delay": 5.0},
            "interruption": {"enabled": False},
            "preemptive_generation": {"enabled": False},
        },
        "vad": None,
    }
    conn_options = build_session_conn_options()
    if conn_options is not None:
        kwargs["conn_options"] = conn_options
    return AgentSession(**kwargs)


class VivaInterviewAgent(Agent):
    def __init__(
        self,
        state: VivaSessionState,
        *,
        http_session: aiohttp.ClientSession | None = None,
    ) -> None:
        stt, tts = build_media_from_runtime(state.runtime, http_session=http_session)
        super().__init__(
            instructions=VIVA_EXAMINER_SYSTEM_PROMPT,
            stt=stt,
            tts=tts,
            llm=VivaOrchestratorLLM(state),
            vad=None,
        )
        self._state = state

    async def on_enter(self) -> None:
        session = self._state.session
        if session is None:
            return
        session.input.set_audio_enabled(False)
        try:
            handle = session.generate_reply(allow_interruptions=False)
            await handle.wait_for_playout()
            logger.info("Viva opening greeting playout complete token=%s", self._state.viva_token)
        except Exception as exc:
            logger.error(
                "Viva opening greeting failed token=%s: %s",
                self._state.viva_token,
                exc,
            )
        finally:
            session.input.set_audio_enabled(True)


def _primary_participant_identity(room: rtc.Room) -> str | None:
    for participant in room.remote_participants.values():
        if participant.identity.startswith("student-"):
            return participant.identity
    return None


def _wire_viva_session_events(
    session: AgentSession,
    state: VivaSessionState,
    room: rtc.Room,
) -> None:
    async def _finalize_after_grace() -> None:
        await asyncio.sleep(state.reconnect_grace_sec)
        if not state.candidate_left:
            return
        logger.info("Viva reconnect grace expired token=%s", state.viva_token)
        state.completion_event.set()

    def _schedule_disconnect_grace() -> None:
        if state.paused:
            return
        state.candidate_left = True
        if state.disconnect_timer and not state.disconnect_timer.done():
            return
        state.disconnect_timer = asyncio.create_task(_finalize_after_grace())

    async def _confirm_student_left(identity: str) -> None:
        await asyncio.sleep(3.0)
        if any(
            p.identity == identity
            for p in room.remote_participants.values()
        ):
            return
        logger.info("Student left viva room: %s", identity)
        _schedule_disconnect_grace()

    @session.on("agent_state_changed")
    def on_agent_state(ev: AgentStateChangedEvent) -> None:
        if ev.new_state == "speaking":
            session.input.set_audio_enabled(False)
        elif ev.new_state in ("listening", "thinking"):
            session.input.set_audio_enabled(True)

    @session.on("close")
    def on_close(ev: CloseEvent) -> None:
        if ev.reason and "participant disconnected" in str(ev.reason).lower():
            _schedule_disconnect_grace()

    @room.on("participant_connected")
    def on_participant_connected(participant: rtc.RemoteParticipant) -> None:
        if participant.identity.startswith("student-"):
            state.candidate_left = False
            if state.disconnect_timer and not state.disconnect_timer.done():
                state.disconnect_timer.cancel()
                state.disconnect_timer = None

    @room.on("participant_disconnected")
    def on_participant_disconnected(participant: rtc.RemoteParticipant) -> None:
        if not participant.identity.startswith("student-"):
            return
        task = state.disconnect_debounce_task
        if task is not None and not task.done():
            task.cancel()
        state.disconnect_debounce_task = asyncio.create_task(
            _confirm_student_left(participant.identity),
        )

    @room.on("active_speakers_changed")
    def on_active_speakers(speakers: list[rtc.Participant]) -> None:
        state.examiner_speaking = any(
            p.identity.startswith("examiner-") for p in speakers
        )

    @room.on("data_received")
    def on_data_received(data: rtc.DataPacket) -> None:
        try:
            payload = json.loads(data.data.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return
        if payload.get("type") in ("end_viva", "end_interview"):
            logger.info("Student requested viva end token=%s", state.viva_token)
            state.candidate_left = True
            state.completion_event.set()


async def connect_viva_room(room_name: str) -> rtc.Room:
    url, _, _ = _livekit_config()
    token = _agent_token(room_name, display_name="Viva Examiner")
    room = rtc.Room()
    await room.connect(url, token)
    if not await _wait_for_primary_participant(room, CANDIDATE_WAIT_SECONDS):
        await room.disconnect()
        raise RuntimeError("Timed out waiting for student to join viva room")
    return room


def build_viva_state(
    viva_token: str,
    *,
    course_code: str,
    question_mode: str,
    language_preference: str | None = None,
    student_name: str | None = None,
    project_title: str | None = None,
    project_summary: str | None = None,
    thesis_ref: str | None = None,
    syllabus_ref: str | None = None,
    panel_mode: str = "ai_sole",
    question_bank: list[dict] | None = None,
    sarvam_llm_model: str | None = None,
    max_turns: int | None = None,
    resume_snapshot: dict | None = None,
    reconnect_grace_sec: int | None = None,
    rubric_criteria: list[dict] | None = None,
    take_home_verification_enabled: bool = False,
    take_home_payload: dict | None = None,
) -> VivaSessionState:
    runtime = load_runtime_config(
        "student_viva",
        language_preference=language_preference,
        sarvam_llm_model=sarvam_llm_model,
    )
    bank = [
        VivaQuestionBankEntry(
            id=str(entry.get("id", idx)),
            topic=str(entry.get("topic", course_code)),
            prompt_text=str(entry.get("prompt_text", "")),
            follow_up_hints=list(entry.get("follow_up_hints") or []),
            difficulty=str(entry.get("difficulty", "medium")),
            weight=int(entry.get("weight", 10)),
        )
        for idx, entry in enumerate(question_bank or [])
        if entry.get("prompt_text")
    ]
    source = VivaQuestionSource(
        course_code=course_code,
        question_mode=question_mode,
        project_title=project_title,
        thesis_ref=thesis_ref,
        syllabus_ref=syllabus_ref,
        bank=bank,
        max_turns=max_turns or VIVA_MAX_TURNS,
    )
    intended_model = (
        sarvam_llm_model
        or runtime.llm.sarvam_model
        or "sarvam-105b-conversations"
    )
    llm_ledger = LlmCallLedger(intended_llm_model=intended_model)
    llm_client = build_viva_llm_client(llm_ledger, sarvam_llm_model=intended_model)
    engine = LlmEngine(
        course_code,
        "intro_verbal",
        candidate_name=student_name,
        sarvam_llm_model=intended_model,
        llm_client=llm_client,
    )
    if resume_snapshot:
        history = resume_snapshot.get("chat_history") or []
        if isinstance(history, list):
            from provider_resilience import sanitize_messages

            engine.chat_history = sanitize_messages(
                [
                    {"role": str(m.get("role", "user")), "content": str(m.get("content", ""))}
                    for m in history
                    if isinstance(m, dict)
                ],
            )
        source.restore_snapshot(resume_snapshot)
        opening = resume_snapshot.get("opening_reply")
    else:
        opening = None

    state = VivaSessionState(
        viva_token=viva_token,
        course_code=course_code,
        question_mode=question_mode,
        engine=engine,
        question_source=source,
        runtime=runtime,
        student_name=student_name,
        project_title=project_title,
        project_summary=project_summary,
        syllabus_ref=syllabus_ref,
        panel_mode=panel_mode,
        rubric_criteria=list(rubric_criteria or []),
        audit=SessionAuditLedger(
            viva_token,
            course_code,
            file_prefix="viva_",
        ),
        opening_reply=str(opening) if opening else None,
        reconnect_grace_sec=int(reconnect_grace_sec or 90),
        active_language=language_preference,
        llm_ledger=llm_ledger,
        take_home_verification_enabled=take_home_verification_enabled,
        take_home_payload=take_home_payload,
    )
    return state


async def run_viva_agent_session(room: rtc.Room, state: VivaSessionState) -> None:
    async with long_lived_http_session() as http_session, http_context.open():
        agent = VivaInterviewAgent(state, http_session=http_session)
        session = build_viva_agent_session()
        state.session = session
        _wire_viva_session_events(session, state, room)

        student_id = _primary_participant_identity(room) or ""
        stt_sample_rate = sarvam_stt_sample_rate()
        tts_sample_rate = sarvam_tts_sample_rate()
        room_options = room_io.RoomOptions(
            participant_identity=student_id,
            close_on_disconnect=False,
            audio_input=room_io.AudioInputOptions(
                sample_rate=stt_sample_rate,
                auto_gain_control=False,
            ),
            audio_output=room_io.AudioOutputOptions(sample_rate=tts_sample_rate),
        )

        coordinator_task: asyncio.Task | None = None
        language_task: asyncio.Task | None = None
        try:
            state.http_session = http_session
            register_viva_state(state.viva_token, state)
            from viva_language import run_viva_language_watchdog

            coordinator_task = asyncio.create_task(
                run_viva_phase_coordinator(state, session),
            )
            language_task = asyncio.create_task(
                run_viva_language_watchdog(state, http_session=http_session),
            )
            await session.start(agent=agent, room=room, room_options=room_options)
            await state.completion_event.wait()
        finally:
            unregister_viva_state(state.viva_token)
            if language_task is not None:
                language_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await language_task
            if coordinator_task is not None:
                with contextlib.suppress(asyncio.CancelledError):
                    await coordinator_task
            await session.aclose()
            await room.disconnect()
            logger.info("Viva agent disconnected token=%s", state.viva_token)
