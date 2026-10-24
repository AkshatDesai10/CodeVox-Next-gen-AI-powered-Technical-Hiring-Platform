"""Embedded LiveKit AgentSession bootstrap for voice interviews."""

from __future__ import annotations

import asyncio
import contextlib
import inspect
import logging
from typing import Literal

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
    _wait_for_candidate,
    wait_for_candidate_screen_share,
)
from orchestrator_llm import (
    HR_MAX_TURNS,
    HR_MIN_TURNS,
    HrInterviewLLM,
    INTRO_MAX_TURNS,
    INTRO_MIN_TURNS,
    InterviewSessionState,
    IntroOrchestratorLLM,
    agent_instructions,
)
from resume_tech_stack import extract_resume_tech_stack, is_entry_level_interview
from media_factory import build_media_from_runtime
from sarvam_media import sarvam_stt_sample_rate, sarvam_tts_sample_rate
from sarvam_stt_resilient import build_session_conn_options, long_lived_http_session
from question_sources.hr import HrQuestionSource
from session_audit import SessionAuditLedger
from session_config.types import load_runtime_config
from tech_pool_manager import TechPoolManager
from topic_orchestrator import TopicOrchestrator
from unified_phase_coordinator import run_unified_phase_coordinator, wire_room_media_events
from vad_turn import candidate_audio_enabled, interview_turn_handling, interview_vad_options

logger = logging.getLogger("interview-agent-session")

Phase = Literal["intro_verbal", "hr_verbal", "unified"]

_CANDIDATE_RUNTIME = load_runtime_config("candidate_interview")


def _build_candidate_media(
    *,
    http_session: aiohttp.ClientSession | None = None,
    tech_stack: str | None = None,
    resume_skills: list[str] | None = None,
    language_preference: str | None = None,
) -> tuple:
    runtime = _CANDIDATE_RUNTIME
    if tech_stack or resume_skills or language_preference:
        runtime = load_runtime_config(
            "candidate_interview",
            tech_stack=tech_stack,
            resume_skills=resume_skills,
            language_preference=language_preference,
        )
    return build_media_from_runtime(runtime, http_session=http_session)


_CACHED_VAD = None
_VAD_LOAD_ATTEMPTED = False


def _supported_vad_kwargs(load, options: dict[str, float]) -> dict[str, float]:
    try:
        params = inspect.signature(load).parameters
    except (TypeError, ValueError):
        return options
    if any(param.kind == inspect.Parameter.VAR_KEYWORD for param in params.values()):
        return options
    return {key: value for key, value in options.items() if key in params}


def _interview_vad():
    """Load Silero once. A bare load() is not used: its short silence ends speech early."""
    global _CACHED_VAD, _VAD_LOAD_ATTEMPTED
    if _VAD_LOAD_ATTEMPTED:
        return _CACHED_VAD
    _VAD_LOAD_ATTEMPTED = True
    try:
        from livekit.plugins import silero

        options = _supported_vad_kwargs(silero.VAD.load, interview_vad_options())
        _CACHED_VAD = silero.VAD.load(**options)
    except Exception as exc:
        logger.warning("Silero VAD unavailable (%s); endpointing timeout still applies", exc)
        _CACHED_VAD = None
    return _CACHED_VAD


def build_agent_session(*, allow_interruptions: bool = False) -> AgentSession:
    kwargs: dict = {
        "vad": _interview_vad(),
        # min_delay stays 3.0. It starts only after VAD reports real silence.
        # A Sarvam final transcript does not end the turn while VAD still hears speech;
        # those chunks stay in the same user transcript until the 3s silence completes.
        "turn_handling": interview_turn_handling(allow_interruptions=allow_interruptions),
    }
    conn_options = build_session_conn_options()
    if conn_options is not None:
        kwargs["conn_options"] = conn_options
    return AgentSession(**kwargs)


class IntroInterviewAgent(Agent):
    def __init__(
        self,
        state: InterviewSessionState,
        *,
        http_session: aiohttp.ClientSession | None = None,
    ) -> None:
        stt, tts = _build_candidate_media(
            http_session=http_session,
            tech_stack=state.tech_stack,
            resume_skills=state.resume_skills,
            language_preference=state.interview_language,
        )
        super().__init__(
            instructions=agent_instructions("intro_verbal", state.tech_stack),
            stt=stt,
            tts=tts,
            llm=IntroOrchestratorLLM(state),
            vad=_interview_vad(),
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
        finally:
            session.input.set_audio_enabled(True)
        from assessment_state_machine import AssessmentSessionPhase

        if self._state.assessment.phase == AssessmentSessionPhase.CLOSING:
            if self._state.closing_delivered:
                self._state.completion_event.set()


class UnifiedInterviewAgent(Agent):
    def __init__(
        self,
        state: InterviewSessionState,
        *,
        http_session: aiohttp.ClientSession | None = None,
    ) -> None:
        stt, tts = _build_candidate_media(
            http_session=http_session,
            tech_stack=state.tech_stack,
            resume_skills=state.resume_skills,
            language_preference=state.interview_language,
        )
        super().__init__(
            instructions=agent_instructions("intro_verbal", state.tech_stack),
            stt=stt,
            tts=tts,
            llm=IntroOrchestratorLLM(state),
            vad=_interview_vad(),
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
        finally:
            session.input.set_audio_enabled(True)


class HrInterviewAgent(Agent):
    def __init__(
        self,
        state: InterviewSessionState,
        *,
        http_session: aiohttp.ClientSession | None = None,
    ) -> None:
        stt, tts = _build_candidate_media(
            http_session=http_session,
            tech_stack=state.tech_stack,
            resume_skills=state.resume_skills,
            language_preference=state.interview_language,
        )
        super().__init__(
            instructions=agent_instructions("hr_verbal", state.tech_stack),
            stt=stt,
            tts=tts,
            llm=HrInterviewLLM(state),
            vad=_interview_vad(),
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
        finally:
            session.input.set_audio_enabled(True)
        if self._state.pending_shutdown:
            self._state.completion_event.set()


def _candidate_identity(room: rtc.Room) -> str | None:
    for participant in room.remote_participants.values():
        if participant.identity.startswith("candidate-"):
            return participant.identity
    return None


def _wire_session_events(
    session: AgentSession,
    state: InterviewSessionState,
    room: rtc.Room,
) -> None:
    @session.on("agent_state_changed")
    def on_agent_state(ev: AgentStateChangedEvent) -> None:
        enabled = candidate_audio_enabled(ev.new_state, session.user_state)
        if enabled is not None:
            session.input.set_audio_enabled(enabled)
        from assessment_state_machine import AssessmentSessionPhase

        if (
            state.pending_shutdown
            and ev.new_state == "listening"
            and state.assessment.phase == AssessmentSessionPhase.CLOSING
            and state.closing_delivered
            and not getattr(state, "finalization_in_progress", False)
        ):
            state.completion_event.set()

    @session.on("close")
    def on_close(ev: CloseEvent) -> None:
        error = getattr(ev, "error", None)
        reason = getattr(ev, "reason", None)
        logger.warning(
            "AgentSession closed token=%s reason=%s error=%s",
            state.candidate_token,
            reason,
            error,
        )
        if getattr(state, "finalization_in_progress", False):
            return
        state.completion_event.set()

    def _rebind_candidate_audio(participant: rtc.RemoteParticipant) -> None:
        if not participant.identity.startswith("candidate-"):
            return
        if hasattr(session, "room_io") and session.room_io:
            try:
                room_io = session.room_io
                room_io.unset_participant()
                room_io.set_participant(participant.identity)
                if hasattr(room_io, "_audio_input") and room_io._audio_input:
                    audio_in = room_io._audio_input
                    for pub in participant.track_publications.values():
                        if pub.track and pub.kind == rtc.TrackKind.KIND_AUDIO:
                            audio_in._on_track_available(pub.track, pub, participant)
                logger.info(
                    "Re-linked room_io audio stream to candidate token=%s identity=%s",
                    state.candidate_token,
                    participant.identity,
                )
            except Exception as exc:
                logger.warning(
                    "Failed to rebind candidate audio token=%s identity=%s: %s",
                    state.candidate_token,
                    participant.identity,
                    exc,
                )

    @room.on("participant_connected")
    def on_participant_connected(participant: rtc.RemoteParticipant) -> None:
        if participant.identity.startswith("candidate-"):
            logger.info(
                "Candidate reconnected (re-binding audio) token=%s identity=%s",
                state.candidate_token,
                participant.identity,
            )
            _rebind_candidate_audio(participant)

    @room.on("track_published")
    def on_track_published(
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> None:
        if publication.kind == rtc.TrackKind.KIND_AUDIO:
            _rebind_candidate_audio(participant)

    @room.on("track_subscribed")
    def on_track_subscribed(
        track: rtc.Track,
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> None:
        if publication.kind == rtc.TrackKind.KIND_AUDIO:
            _rebind_candidate_audio(participant)

    @room.on("participant_disconnected")
    def on_participant_disconnected(participant: rtc.RemoteParticipant) -> None:
        # Refresh / network drop must not finalize. Only an explicit end_interview
        # data packet (candidate clicked End) sets end_interview_event.
        if participant.identity.startswith("candidate-"):
            logger.info(
                "Candidate temporarily disconnected (session kept) token=%s identity=%s",
                state.candidate_token,
                participant.identity,
            )


async def connect_interview_room(room_name: str) -> rtc.Room:
    url, _, _ = _livekit_config()
    room = rtc.Room()
    await room.connect(url, _agent_token(room_name))
    logger.info("Agent joined room=%s", room_name)
    if not await _wait_for_candidate(room, CANDIDATE_WAIT_SECONDS):
        await room.disconnect()
        raise RuntimeError("Candidate never joined LiveKit room")
    await asyncio.sleep(1.0)
    return room


async def run_unified_agent_session(
    room: rtc.Room,
    state: InterviewSessionState,
) -> None:
    async with long_lived_http_session() as http_session, http_context.open():
        agent = UnifiedInterviewAgent(state, http_session=http_session)
        coordinator_task: asyncio.Task | None = None
        allow_interruptions = bool(getattr(state, "project_interview_payload", None))
        session = build_agent_session(allow_interruptions=allow_interruptions)
        state.session = session
        _wire_session_events(session, state, room)
        wire_room_media_events(room, state)

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
            **kwargs
        )

        try:
            # Every candidate round that shares a screen (Verbal, Defend, and the
            # same gate used by Screening and Build) stays silent until the track
            # is published. The browser share dialog must finish first.
            await wait_for_candidate_screen_share(room)
            coordinator_task = asyncio.create_task(
                run_unified_phase_coordinator(state, session),
            )
            await session.start(agent=agent, room=room, room_options=room_options)
            await state.completion_event.wait()
        finally:
            if coordinator_task is not None:
                coordinator_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await coordinator_task
            await session.aclose()
            await room.disconnect()
            logger.info("Unified agent disconnected")


async def run_intro_agent_session(
    room: rtc.Room,
    state: InterviewSessionState,
) -> None:
    async with long_lived_http_session() as http_session, http_context.open():
        agent = IntroInterviewAgent(state, http_session=http_session)
        await _run_agent_session_inner(room, agent, state)


async def run_hr_agent_session(
    room: rtc.Room,
    state: InterviewSessionState,
) -> None:
    async with long_lived_http_session() as http_session, http_context.open():
        agent = HrInterviewAgent(state, http_session=http_session)
        await _run_agent_session_inner(room, agent, state)


async def _run_agent_session_inner(
    room: rtc.Room,
    agent: Agent,
    state: InterviewSessionState,
) -> None:
    session = build_agent_session()
    state.session = session
    _wire_session_events(session, state, room)

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
        **kwargs
    )

    try:
        await session.start(agent=agent, room=room, room_options=room_options)
        await state.completion_event.wait()
    finally:
        await session.aclose()
        await room.disconnect()
        logger.info("Agent disconnected")


def _profile_band(job_profile_context: dict | None, entry_level: bool) -> tuple[str, str, bool]:
    from candidate_knowledge import canonical_seniority_band

    profile_seniority = ""
    if isinstance(job_profile_context, dict):
        profile_seniority = str(job_profile_context.get("seniority_level") or "")
    band = canonical_seniority_band(profile_seniority, entry_level=entry_level)
    return band, profile_seniority, entry_level or band == "JUNIOR"


def build_intro_state(
    candidate_token: str,
    tech_stack: str,
    *,
    resume_skills: list[str] | None = None,
    candidate_name: str | None = None,
    job_profile_context: dict | None = None,
    rubric_criteria: list[dict] | None = None,
    interview_language: str | None = None,
) -> InterviewSessionState:
    entry_level = is_entry_level_interview(candidate_token)
    band, profile_seniority, entry_level = _profile_band(job_profile_context, entry_level)
    skills = extract_resume_tech_stack(
        resume_skills,
        fallback_stack=tech_stack,
        entry_level=entry_level,
        candidate_token=candidate_token,
    )
    primary = skills[0] if skills else (tech_stack or "the role")
    tech_pool = TechPoolManager(skills)
    orchestrator = TopicOrchestrator(
        primary,
        INTRO_MIN_TURNS,
        INTRO_MAX_TURNS,
        tech_pool=tech_pool,
        entry_level=entry_level,
    )
    orchestrator.lock_seniority(band)
    logger.info(
        "Verbal seniority band=%s profile=%s token=%s",
        band,
        profile_seniority or "(none)",
        candidate_token,
    )
    state = InterviewSessionState(
        candidate_token=candidate_token,
        tech_stack=primary,
        phase="intro_verbal",
        engine=LlmEngine(
            primary,
            "intro_verbal",
            resume_skills=skills,
            candidate_name=candidate_name,
            entry_level=entry_level,
            job_profile_context=job_profile_context,
            interview_language=interview_language,
            candidate_token=candidate_token,
        ),
        resume_skills=skills,
        candidate_name=candidate_name,
        orchestrator=orchestrator,
        question_source=HrQuestionSource(orchestrator),
        audit=SessionAuditLedger(candidate_token, primary, resume_skills=skills),
    )
    state.knowledge_state.current_difficulty = band  # type: ignore[assignment]
    state.rubric_criteria = rubric_criteria or []
    from prompts import normalize_interview_language

    state.interview_language = normalize_interview_language(interview_language)
    state.engine.interview_language = state.interview_language
    return state


def build_unified_state(
    candidate_token: str,
    tech_stack: str,
    *,
    resume_skills: list[str] | None = None,
    candidate_name: str | None = None,
    job_profile_context: dict | None = None,
    rubric_criteria: list[dict] | None = None,
    take_home_verification_enabled: bool = False,
    take_home_payload: dict | None = None,
    take_home_weight_pct: float = 0.0,
    project_interview_payload: dict | None = None,
    interview_language: str | None = None,
    round_config: dict | None = None,
) -> InterviewSessionState:
    if project_interview_payload:
        return _build_project_defense_state(
            candidate_token,
            tech_stack,
            resume_skills=resume_skills,
            candidate_name=candidate_name,
            job_profile_context=job_profile_context,
            rubric_criteria=rubric_criteria,
            payload=project_interview_payload,
            interview_language=interview_language,
        )
    state = build_intro_state(
        candidate_token,
        tech_stack,
        resume_skills=resume_skills,
        candidate_name=candidate_name,
        job_profile_context=job_profile_context,
        rubric_criteria=rubric_criteria,
        interview_language=interview_language,
    )
    state.phase = "unified"
    state.assessment.resume_skills = list(state.resume_skills)
    state.take_home_verification_enabled = bool(take_home_verification_enabled) and bool(
        take_home_payload
    )
    state.take_home_payload = take_home_payload if state.take_home_verification_enabled else None
    # Default 20% must match Nest/Frontend DEFAULT_TAKE_HOME_VERIFICATION_WEIGHT_PCT.
    DEFAULT_TH_WEIGHT = 20.0
    weight = DEFAULT_TH_WEIGHT if state.take_home_verification_enabled else 0.0
    if take_home_weight_pct is not None:
        try:
            weight = float(take_home_weight_pct)
        except (TypeError, ValueError):
            pass
    if state.take_home_payload and isinstance(state.take_home_payload, dict):
        if "take_home_weight_pct" in state.take_home_payload:
            try:
                weight = float(state.take_home_payload.get("take_home_weight_pct"))
            except (TypeError, ValueError):
                pass
        else:
            state.take_home_payload["take_home_weight_pct"] = weight
    state.take_home_weight_pct = max(0.0, min(100.0, float(weight)))
    state.take_home_phase_active = False
    state.round_config = round_config if isinstance(round_config, dict) else None
    raw_limit = (state.round_config or {}).get("verbal_duration_limit_minutes")
    if isinstance(raw_limit, (int, float)) and not isinstance(raw_limit, bool) and raw_limit > 0:
        minutes = max(10, min(int(state.knowledge_state.hard_ceiling_mins), int(raw_limit)))
        state.knowledge_state.hard_ceiling_mins = minutes
        state.knowledge_state.target_duration_mins = minutes
    logger.info(
        "Unified state built token=%s take_home_verification_enabled=%s weight_pct=%s report_loaded=%s",
        candidate_token,
        state.take_home_verification_enabled,
        state.take_home_weight_pct,
        bool(state.take_home_payload),
    )
    return state


def _build_project_defense_state(
    candidate_token: str,
    tech_stack: str,
    *,
    resume_skills: list[str] | None,
    candidate_name: str | None,
    job_profile_context: dict | None,
    rubric_criteria: list[dict] | None,
    payload: dict,
    interview_language: str | None = None,
) -> InterviewSessionState:
    """Build & Defend: the whole session is the project-defense phase (no resume/rubric walk)."""
    from question_sources.project_defense import ProjectDefenseSource

    state = build_intro_state(
        candidate_token,
        tech_stack,
        resume_skills=resume_skills,
        candidate_name=candidate_name,
        job_profile_context=job_profile_context,
        rubric_criteria=rubric_criteria,
        interview_language=interview_language,
    )
    state.phase = "unified"
    state.assessment.resume_skills = list(state.resume_skills)
    try:
        weight = float(payload.get("interview_weight_pct", 100))
    except (TypeError, ValueError):
        weight = 100.0
    weight = max(0.0, min(100.0, weight))
    state.take_home_verification_enabled = True
    state.take_home_payload = {**payload, "take_home_weight_pct": weight}
    state.take_home_weight_pct = weight
    state.take_home_phase_active = True
    state.project_interview_payload = payload
    state.question_source = ProjectDefenseSource.from_payload(  # type: ignore[assignment]
        state.take_home_payload,
        rubric_criteria=state.rubric_criteria,
        candidate_name=candidate_name,
    )
    state.question_source.interview_language = state.interview_language  # type: ignore[attr-defined]
    logger.info(
        "Project defense state built token=%s questions=%s weight_pct=%s rubric_count=%s",
        candidate_token,
        state.question_source.max_primary_questions,
        weight,
        len(state.rubric_criteria),
    )
    return state


def build_hr_state(
    candidate_token: str,
    tech_stack: str,
    *,
    resume_skills: list[str] | None = None,
    candidate_name: str | None = None,
    job_profile_context: dict | None = None,
) -> InterviewSessionState:
    entry_level = is_entry_level_interview(candidate_token)
    band, _profile_seniority, entry_level = _profile_band(job_profile_context, entry_level)
    skills = extract_resume_tech_stack(
        resume_skills,
        fallback_stack=tech_stack,
        entry_level=entry_level,
        candidate_token=candidate_token,
    )
    primary = skills[0] if skills else (tech_stack or "the role")
    tech_pool = TechPoolManager(skills)
    orchestrator = TopicOrchestrator(
        primary,
        HR_MIN_TURNS,
        HR_MAX_TURNS,
        tech_pool=tech_pool,
        entry_level=entry_level,
    )
    orchestrator.lock_seniority(band)
    state = InterviewSessionState(
        candidate_token=candidate_token,
        tech_stack=primary,
        phase="hr_verbal",
        engine=LlmEngine(
            primary,
            "hr_verbal",
            resume_skills=skills,
            candidate_name=candidate_name,
            entry_level=entry_level,
            job_profile_context=job_profile_context,
            candidate_token=candidate_token,
        ),
        resume_skills=skills,
        candidate_name=candidate_name,
        orchestrator=orchestrator,
        question_source=HrQuestionSource(orchestrator),
        audit=SessionAuditLedger(candidate_token, primary, resume_skills=skills),
    )
    state.knowledge_state.current_difficulty = band  # type: ignore[assignment]
    return state
