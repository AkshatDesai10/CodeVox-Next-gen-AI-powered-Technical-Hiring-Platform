"""Unified LiveKit interview session — conversational through closing in one room."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from interview_agent_session import (
    build_unified_state,
    connect_interview_room,
    run_unified_agent_session,
)
# pyrefly: ignore [missing-import]
from livekit import rtc
from recording import (
    SessionRecorder,
    _is_recording_enabled,
    _start_agent_audio_egress,
    _wire_remote_track_events,
    stage_id_from_room,
)
logger = logging.getLogger("conversation-engine")


@dataclass
class IntroResult:
    done: bool
    depth_score: int = 0
    chat_history: list[dict[str, Any]] = field(default_factory=list)
    audit: dict[str, Any] | None = None


@dataclass
class UnifiedInterviewResult:
    done: bool
    depth_score: int = 0
    chat_history: list[dict[str, Any]] = field(default_factory=list)
    audit: dict[str, Any] | None = None


async def run_unified_interview(
    room_name: str,
    tech_stack: str,
    candidate_token: str,
    *,
    resume_skills: list[str] | None = None,
    candidate_name: str | None = None,
    candidate_id: str | None = None,
    job_profile_context: dict | None = None,
    rubric_criteria: list[dict] | None = None,
    take_home_verification_enabled: bool = False,
    take_home_payload: dict | None = None,
    take_home_weight_pct: float = 0.0,
    project_interview_payload: dict | None = None,
    language_preference: str | None = None,
    round_config: dict | None = None,
) -> UnifiedInterviewResult:
    room: rtc.Room | None = None
    recorder: SessionRecorder | None = None
    state = build_unified_state(
        candidate_token,
        tech_stack,
        resume_skills=resume_skills,
        candidate_name=candidate_name,
        job_profile_context=job_profile_context,
        rubric_criteria=rubric_criteria,
        take_home_verification_enabled=take_home_verification_enabled,
        take_home_payload=take_home_payload,
        take_home_weight_pct=take_home_weight_pct,
        project_interview_payload=project_interview_payload,
        interview_language=language_preference,
        round_config=round_config,
    )

    try:
        room = await connect_interview_room(room_name)

        # --- Track recording setup ---
        if _is_recording_enabled():
            recorder = SessionRecorder(
                room_name,
                candidate_token,
                stage_id=stage_id_from_room(room_name, candidate_token) or "intro_verbal",
                candidate_name=candidate_name,
                candidate_id=candidate_id,
            )
            _wire_remote_track_events(recorder, room)
            await _start_agent_audio_egress(recorder, room)

        await run_unified_agent_session(room, state)
        room = None
        history = state.engine.history_payload()
        return UnifiedInterviewResult(
            done=state.intro_completed and not state.candidate_left,
            depth_score=state.intro_depth_score,
            chat_history=history,
            audit=state.intro_audit_payload,
        )
    except Exception:
        logger.exception("Unified interview failed token=%s", candidate_token)
        return UnifiedInterviewResult(done=False)
    finally:
        if recorder is not None:
            try:
                await recorder.stop_all()
            except Exception:
                logger.exception("Recorder cleanup failed token=%s", candidate_token)
        if room is not None:
            await room.disconnect()


async def run_intro_conversation(
    room_name: str,
    tech_stack: str,
    candidate_token: str,
    *,
    resume_skills: list[str] | None = None,
    candidate_name: str | None = None,
) -> IntroResult:
    result = await run_unified_interview(
        room_name,
        tech_stack,
        candidate_token,
        resume_skills=resume_skills,
        candidate_name=candidate_name,
    )
    return IntroResult(
        done=result.done,
        depth_score=result.depth_score,
        chat_history=result.chat_history,
        audit=result.audit,
    )


async def run_hr_conversation(
    room_name: str,
    tech_stack: str,
    candidate_token: str,
    *,
    resume_skills: list[str] | None = None,
    candidate_name: str | None = None,
) -> bool:
    logger.warning(
        "run_hr_conversation is deprecated — HR closing is merged into unified interview token=%s",
        candidate_token,
    )
    return False


@dataclass
class VivaInterviewResult:
    done: bool
    final_grade: str | None = None
    rubric_scores: dict | None = None
    chat_history: list[dict[str, Any]] = field(default_factory=list)
    audit: dict[str, Any] | None = None


async def run_viva_interview(
    room_name: str,
    viva_token: str,
    *,
    viva_profile: dict | None = None,
    question_mode: str = "hybrid",
    language_preference: str | None = None,
    panel_mode: str = "ai_sole",
    candidate_name: str | None = None,
    question_bank: list[dict] | None = None,
    sarvam_llm_model: str | None = None,
    max_turns: int | None = None,
    resume_snapshot: dict | None = None,
    reconnect_grace_sec: int | None = None,
    rubric_criteria: list[dict] | None = None,
) -> VivaInterviewResult:
    from viva_agent_session import (
        build_viva_state,
        connect_viva_room,
        run_viva_agent_session,
    )

    profile = viva_profile or {}
    room: rtc.Room | None = None
    recorder: SessionRecorder | None = None
    state = build_viva_state(
        viva_token,
        course_code=str(profile.get("course_code", "GENERAL")),
        question_mode=question_mode,
        language_preference=language_preference,
        student_name=candidate_name,
        project_title=profile.get("project_title"),
        project_summary=profile.get("project_summary"),
        thesis_ref=profile.get("thesis_ref"),
        syllabus_ref=profile.get("syllabus_ref"),
        panel_mode=panel_mode,
        question_bank=question_bank,
        sarvam_llm_model=sarvam_llm_model,
        max_turns=max_turns,
        resume_snapshot=resume_snapshot,
        reconnect_grace_sec=reconnect_grace_sec,
        rubric_criteria=rubric_criteria,
        take_home_verification_enabled=profile.get("take_home_verification_enabled", False),
        take_home_payload=profile.get("take_home_payload"),
    )

    try:
        room = await connect_viva_room(room_name)

        # --- Track recording setup ---
        if _is_recording_enabled():
            recorder = SessionRecorder(room_name, viva_token)
            _wire_remote_track_events(recorder, room)
            await _start_agent_audio_egress(recorder, room)

        await run_viva_agent_session(room, state)
        room = None
        return VivaInterviewResult(
            done=state.oral_completed and not state.candidate_left,
            final_grade=state.final_grade,
            rubric_scores=state.rubric_scores,
            chat_history=state.engine.history_payload(),
            audit=state.oral_audit_payload,
        )
    except Exception:
        logger.exception("Viva interview failed token=%s", viva_token)
        return VivaInterviewResult(done=False)
    finally:
        if recorder is not None:
            try:
                await recorder.stop_all()
            except Exception:
                logger.exception("Recorder cleanup failed token=%s", viva_token)
        if room is not None:
            await room.disconnect()


