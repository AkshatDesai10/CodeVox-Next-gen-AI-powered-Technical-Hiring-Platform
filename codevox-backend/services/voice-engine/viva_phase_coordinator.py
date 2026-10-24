"""Oral-only viva phase coordinator."""

from __future__ import annotations

import logging

from handoff_viva import post_viva_complete, post_viva_oral_results, fetch_viva_proctor_events
from viva_orchestrator_llm import _grade_from_rubric
from viva_session_state import VivaSessionState

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from livekit.agents import AgentSession

logger = logging.getLogger("viva-phase-coordinator")


async def _persist_viva_results(state: VivaSessionState) -> None:
    audit = state.audit
    if audit is None:
        return
    try:
        depth = await state.engine.score_depth()
    except Exception:
        depth = 5
    alignment = state.question_source.finalize()
    # Combine notes from both phases
    all_notes = list(state.accumulated_rubric_notes) + alignment.get("rubric_notes", [])
    
    grade, rubric = _grade_from_rubric(
        state,
        all_notes,
    )
    state.final_grade = grade
    state.rubric_scores = rubric
    if audit is not None:
        audit.sync_topics(
            alignment.get("covered_topics", state.question_source.covered_topics),
            alignment.get("skipped_topics", state.question_source.skipped_topics),
        )
    payload = audit.finalize(
        depth,
        resume_alignment=None,
        llm_audit=state.llm_ledger.to_audit_payload() if state.llm_ledger else None,
    )
    payload["session_type"] = "student_viva"
    payload["course_code"] = state.course_code
    payload["question_mode"] = state.question_mode
    payload["syllabus_ref"] = state.syllabus_ref
    payload["syllabus_units"] = alignment.get("syllabus_units", [])
    payload["project_title"] = state.project_title
    payload["final_grade"] = grade
    payload["rubric_scores"] = rubric
    payload["viva_alignment"] = alignment
    payload["stage_chat_history"] = state.engine.history_payload()
    try:
        payload["proctor_events"] = await fetch_viva_proctor_events(state.viva_token)
    except Exception:
        logger.warning("Could not fetch proctor events token=%s", state.viva_token)
        payload["proctor_events"] = []
    from viva_llm_sync import flush_llm_audit_to_nest

    await flush_llm_audit_to_nest(state)
    audit.write_to_disk(payload)
    state.oral_audit_payload = payload
    state.oral_completed = True
    await post_viva_oral_results(
        state.viva_token,
        rubric_scores=rubric,
        final_grade=grade,
        stage_chat_history=state.engine.history_payload(),
    )


async def run_viva_phase_coordinator(
    state: VivaSessionState,
    session: "AgentSession",
) -> None:
    try:
        await state.completion_event.wait()
        if state.oral_audit_payload is None:
            if state.candidate_left and not state.engine.chat_history:
                logger.info(
                    "Viva ended early with no transcript token=%s",
                    state.viva_token,
                )
            else:
                await _persist_viva_results(state)

        if state.oral_completed or state.final_grade:
            await post_viva_complete(
                state.viva_token,
                final_grade=state.final_grade,
                rubric_scores=state.rubric_scores,
                stage_chat_history=state.engine.history_payload(),
            )
    except Exception:
        logger.exception("Viva coordinator failed token=%s", state.viva_token)
