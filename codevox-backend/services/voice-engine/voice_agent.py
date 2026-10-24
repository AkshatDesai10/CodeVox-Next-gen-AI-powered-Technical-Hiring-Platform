"""Voice agent entrypoint — validates keys and dispatches by session_type.

Recording integration: when RECORDING_MODE=track, a SessionRecorder is created
and wired to room events so that each track (user audio, agent audio, screen
share, screen share audio) gets its own lightweight Track Egress.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

from livekit import rtc

from conversation_engine import run_unified_interview
from llm_engine import validate_voice_keys
from recording import SessionRecorder, _is_recording_enabled

logger = logging.getLogger("voice-agent")


# ---------------------------------------------------------------------------
# Main entrypoint
# ---------------------------------------------------------------------------


async def run_voice_agent(payload: dict[str, Any]) -> None:
    validate_voice_keys()

    session_type = str(payload.get("session_type", "candidate_interview")).strip()
    token = str(payload.get("token", ""))
    room_name = str(payload.get("room_name", ""))


    from prompts import normalize_interview_language

    language_preference = normalize_interview_language(payload.get("language_preference"))
    phase = str(payload.get("phase", "intro_verbal"))
    engine = str(payload.get("engine") or "").strip().lower()
    if not engine:
        engine = "behavioral" if phase == "hr_verbal" else "technical"

    tech_stack = str(payload.get("tech_stack") or "Python")
    raw_skills = payload.get("resume_skills") or []
    resume_skills = [str(skill).strip() for skill in raw_skills if str(skill).strip()]
    candidate_name = payload.get("candidate_name")
    if candidate_name is not None:
        candidate_name = str(candidate_name).strip() or None
    candidate_id_raw = payload.get("candidate_id") or payload.get("application_id")
    candidate_id = str(candidate_id_raw).strip() if candidate_id_raw is not None else None
    if candidate_id == "":
        candidate_id = None
    job_profile_context = payload.get("job_profile_context")

    if engine == "bnd_build":
        logger.info("Starting Build & Defend Build-phase agent token=%s room=%s", token, room_name)
        from bnd_build.livekit_adapter import run_bnd_build_session

        result = await run_bnd_build_session(
            room_name,
            token,
            project_build_payload=payload.get("project_build_payload"),
            candidate_name=candidate_name,
            candidate_id=candidate_id,
            language_preference=language_preference,
        )
        if not result.get("done"):
            logger.warning("Build phase incomplete for token=%s", token)
        return

    if engine == "behavioral":
        logger.info(
            "Starting behavioural voice agent token=%s room=%s",
            token,
            room_name,
        )
        from behavioural.livekit_adapter import run_behavioural_interview

        result = await run_behavioural_interview(
            room_name,
            token,
            round_config=payload.get("round_config"),
            rubric_criteria=payload.get("rubric_criteria") or [],
            job_profile_context=job_profile_context,
            candidate_name=candidate_name,
            candidate_id=candidate_id,
            language_preference=language_preference,
        )
        if not result.done:
            logger.warning("Behavioural interview incomplete for token=%s", token)
            # Still persist whatever chat/audit we have — otherwise the report
            # opens an empty ses_ with no transcript (and sometimes no recording link).
            if result.chat_history or result.audit:
                from handoff import post_complete

                await post_complete(
                    token,
                    stage3_chat_history=result.chat_history or [],
                    hr_voice_audit=result.audit,
                )
        else:
            from handoff import post_complete
            await post_complete(token, stage3_chat_history=result.chat_history, hr_voice_audit=result.audit)
        return

    if engine == "screening":
        logger.info("Starting AI Screening voice agent token=%s room=%s", token, room_name)
        from ai_screening.livekit_adapter import run_ai_screening_interview

        result = await run_ai_screening_interview(
            room_name,
            token,
            round_config=payload.get("round_config"),
            job_profile_context=job_profile_context,
            candidate_name=candidate_name,
            candidate_id=candidate_id,
            resume_skills=resume_skills,
            language_preference=language_preference,
        )
        # The screening adapter's _finish() already posts completion; each post advances the pipeline.
        if not result.done:
            logger.warning("AI Screening incomplete for token=%s", token)
        return

    logger.info(
        "Starting unified voice agent token=%s room=%s phase=%s stack=%s resume_skills=%s take_home_verification_enabled=%s",
        token,
        room_name,
        phase,
        tech_stack,
        resume_skills,
        bool(payload.get("take_home_verification_enabled")),
    )

    th_enabled = bool(payload.get("take_home_verification_enabled"))
    raw_th_weight = payload.get("take_home_weight_pct")
    if raw_th_weight is None and th_enabled:
        th_weight = 20.0
    else:
        try:
            th_weight = float(raw_th_weight if raw_th_weight is not None else 0)
        except (TypeError, ValueError):
            th_weight = 20.0 if th_enabled else 0.0

    result = await run_unified_interview(
        room_name,
        tech_stack,
        token,
        resume_skills=resume_skills or None,
        candidate_name=candidate_name,
        candidate_id=candidate_id,
        job_profile_context=job_profile_context,
        rubric_criteria=payload.get("rubric_criteria") or [],
        take_home_verification_enabled=th_enabled,
        take_home_payload=payload.get("take_home_payload"),
        take_home_weight_pct=th_weight,
        project_interview_payload=payload.get("project_interview_payload"),
        language_preference=language_preference,
        round_config=payload.get("round_config"),
    )
    if not result.done:
        logger.warning("Unified interview incomplete for token=%s", token)
