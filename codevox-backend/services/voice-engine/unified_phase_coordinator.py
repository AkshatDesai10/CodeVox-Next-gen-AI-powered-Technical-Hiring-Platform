"""Phase coordinator and room media wiring for unified interviews."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import TYPE_CHECKING

from livekit import rtc

from assessment_state_machine import AssessmentSessionPhase
from final_evaluation import aggregate_rubric_scorecard, combine_technical_and_take_home_scores
from handoff import (
    fetch_interview_proctor_events,
    post_assessment_active,
    post_complete,
    post_defend_assessment_started,
    post_save_intro_results,
    post_screen_share_ready,
)
from prompts import PRE_ASSESSMENT_SCRIPT, SCREEN_SHARE_REMINDER, speak_line

if TYPE_CHECKING:
    from livekit.agents import AgentSession

    from orchestrator_llm import InterviewSessionState

logger = logging.getLogger("unified-phase-coordinator")

REMINDER_SEC = int(os.getenv("PRE_ASSESSMENT_SCREEN_SHARE_TIMEOUT_SEC", "45"))

# LiveKit Python SDK uses SOURCE_SCREENSHARE (not SOURCE_SCREEN_SHARE).
_SCREEN_SHARE_SOURCE = getattr(
    rtc.TrackSource,
    "SOURCE_SCREENSHARE",
    getattr(rtc.TrackSource, "SOURCE_SCREEN_SHARE", None),
)
_CAMERA_SOURCE = rtc.TrackSource.SOURCE_CAMERA
_AUDIO_KIND = rtc.TrackKind.KIND_AUDIO


def _is_screen_share_source(source: object) -> bool:
    return _SCREEN_SHARE_SOURCE is not None and source == _SCREEN_SHARE_SOURCE


async def _wait_for_closing_playout(session: AgentSession) -> None:
    """Wait until the thank-you line has been spoken, then return."""
    speaking = asyncio.Event()
    finished = asyncio.Event()

    def on_state(ev: object) -> None:
        new_state = getattr(ev, "new_state", None)
        if new_state == "speaking":
            speaking.set()
        if new_state == "listening" and speaking.is_set():
            finished.set()

    current = getattr(session, "agent_state", None)
    if current == "speaking":
        speaking.set()
    session.on("agent_state_changed", on_state)
    try:
        if not speaking.is_set():
            try:
                await asyncio.wait_for(speaking.wait(), timeout=2.0 if current == "listening" else 12.0)
            except asyncio.TimeoutError:
                logger.info("Closing speech already finished or did not start")
                return
        await asyncio.wait_for(finished.wait(), timeout=30.0)
    except asyncio.TimeoutError:
        logger.warning("Closing speech playout timed out — opening the assessment page anyway")


async def _finish_project_defense(state: InterviewSessionState, session: AgentSession) -> None:
    """Redirect as soon as thank-you audio ends, then score Build and Defend together."""
    state.finalization_in_progress = True
    try:
        await _wait_for_closing_playout(session)
        try:
            await post_defend_assessment_started(state.candidate_token)
        except Exception:
            logger.exception(
                "Could not open defend assessment page token=%s",
                state.candidate_token,
            )
        try:
            await _persist_intro_results(state)
        except Exception:
            logger.exception(
                "Project defense evaluation failed token=%s",
                state.candidate_token,
            )
        score = getattr(state, "intro_depth_score", None)
        audit = getattr(state, "intro_audit_payload", None)
        history = state.engine.history_payload()
        try:
            await post_complete(
                state.candidate_token,
                stage1_voice_score=int(score) if isinstance(score, (int, float)) else None,
                stage1_chat_history=history,
                stage1_voice_audit=audit if isinstance(audit, dict) else None,
                stage3_chat_history=history,
                final_decision="UNDER_REVIEW",
            )
        except Exception:
            logger.exception(
                "Project defense complete failed token=%s",
                state.candidate_token,
            )
        state.assessment.enter_closing("end_interview")
        state.closing_delivered = True
    finally:
        state.finalization_in_progress = False
        state.completion_event.set()


async def _speak_fixed(
    session: AgentSession,
    state: InterviewSessionState,
    text: str,
) -> None:
    state.fixed_tts_reply = text
    state.engine.chat_history.append({"role": "assistant", "content": text})
    session.input.set_audio_enabled(False)
    try:
        handle = session.generate_reply(allow_interruptions=False)
        await handle.wait_for_playout()
    finally:
        session.input.set_audio_enabled(True)


async def _finalize_defense_notes(state: InterviewSessionState) -> None:
    """Early-ended Defend: grade an answer still waiting on its follow-up, then score
    unanswered questions 0 instead of dropping them out of the average."""
    from question_sources.project_defense import PROJECT_DEFENSE_TOPIC

    source = state.question_source
    notes = getattr(source, "rubric_notes", None)
    total = getattr(source, "max_primary_questions", None)
    if not isinstance(notes, list) or not isinstance(total, int):
        return
    pending = getattr(source, "_current_eval_unit", None)
    if isinstance(pending, dict) and pending.get("primary_q"):
        try:
            await source.evaluate_answer(state.engine, "", "")
        except Exception:
            logger.exception("Defend pending answer scoring failed token=%s", state.candidate_token)
    for _ in range(max(0, total - len(notes))):
        notes.append(
            {
                "topic": PROJECT_DEFENSE_TOPIC,
                "score": 0,
                "note": "Not answered (interview ended early)",
                "concern": False,
            }
        )


async def _persist_intro_results(state: InterviewSessionState) -> None:
    source = state.question_source
    # Prefer the technical TopicOrchestrator for topic sync; Take-Home source has none.
    orchestrator = state.orchestrator
    if orchestrator is None and source is not None and hasattr(source, "orchestrator"):
        orchestrator = source.orchestrator
    audit = state.audit
    if orchestrator is None or audit is None:
        return

    orchestrator.sync_topic_lists()
    audit.sync_topics(orchestrator.covered_topics, orchestrator.skipped_topics)

    resume_alignment = None
    if orchestrator.tech_pool is not None:
        resume_alignment = orchestrator.tech_pool.finalize_alignment()

    depth_score = 0
    history = state.engine.history_payload()
    k_state_dict = state.knowledge_state.to_dict() if hasattr(state, "knowledge_state") else None
    rubric_eval = aggregate_rubric_scorecard(
        state.knowledge_state,
        state.rubric_criteria,
        candidate_left=state.candidate_left,
    )

    # Take-Home verification notes (0–3 scale) from the verification source.
    th_notes: list = []
    from question_sources.take_home_verification import TakeHomeVerificationSource

    if isinstance(source, TakeHomeVerificationSource):
        th_notes = list(source.rubric_notes)
    th_weight = float(getattr(state, "take_home_weight_pct", 0) or 0)
    if getattr(state, "take_home_payload", None) and isinstance(state.take_home_payload, dict):
        payload_weight = state.take_home_payload.get("take_home_weight_pct")
        if payload_weight is not None:
            try:
                th_weight = float(payload_weight)
            except (TypeError, ValueError):
                pass

    project_payload = getattr(state, "project_interview_payload", None)
    is_project_defense = bool(project_payload)
    defense_pct: float | None = None

    tech_10 = rubric_eval.get("weighted_overall_10")
    # Build & Defend: do not let legacy 0–3 take-home average become the final voice score.
    # Score like AI Verbal (depth_score / turn 1–10) instead.
    combined = combine_technical_and_take_home_scores(
        technical_score_10=tech_10,
        take_home_notes=(
            None
            if is_project_defense
            else (th_notes if getattr(state, "take_home_verification_enabled", False) else None)
        ),
        take_home_weight_pct=(
            0
            if is_project_defense
            else (th_weight if getattr(state, "take_home_verification_enabled", False) else 0)
        ),
        fallback_to_take_home=False if is_project_defense else bool(project_payload),
    )
    logger.info(
        "Technical score calculated token=%s tech_10=%s take_home_pct=%s weight=%s final_10=%s project_defense=%s",
        state.candidate_token,
        combined.get("technical_score_10"),
        combined.get("take_home_verification_score_pct"),
        combined.get("take_home_weight_pct"),
        combined.get("final_combined_score_10"),
        is_project_defense,
    )

    audit_payload = audit.finalize(
        depth_score,
        resume_alignment=resume_alignment,
        knowledge_state=k_state_dict,
        rubric_evaluation=rubric_eval,
    )
    audit_payload["take_home_verification"] = {
        "enabled": bool(getattr(state, "take_home_verification_enabled", False)),
        "phase_completed": bool(getattr(state, "take_home_phase_active", False) and th_notes),
        **{k: v for k, v in combined.items() if k != "take_home_notes"},
        "notes": th_notes,
    }
    if combined.get("final_combined_score_pct") is not None:
        audit_payload["final_combined_score_pct"] = combined["final_combined_score_pct"]
        logger.info(
            "Weight aggregation completed token=%s final_pct=%s",
            state.candidate_token,
            combined["final_combined_score_pct"],
        )

    def _project_defense_turn_mean_10(notes: list) -> float | None:
        scores = [
            float(n["score_10"])
            for n in notes
            if isinstance(n, dict)
            and n.get("score_10") is not None
            and not n.get("unscored")
        ]
        if not scores:
            return None
        return sum(scores) / float(len(scores))

    if not state.candidate_left:
        depth_score, ai_summary = await state.engine.evaluate_interview()
        if is_project_defense:
            # Same primary signal as AI Verbal: whole-interview depth 1–10.
            turn_mean = _project_defense_turn_mean_10(th_notes)
            if depth_score is not None:
                voice_score = int(max(1, min(10, int(depth_score))))
                audit_payload["stage1_voice_score_source"] = "depth_score"
            elif turn_mean is not None:
                voice_score = int(max(1, min(10, round(turn_mean))))
                audit_payload["stage1_voice_score_source"] = "project_defense_turn_mean_10"
            else:
                audit_payload["depth_score_unscored"] = True
                voice_score = 0
                audit_payload["stage1_voice_score_source"] = "unscored"
            defense_pct = float(voice_score) * 10.0 if voice_score else None
            if turn_mean is not None:
                audit_payload["project_defense_turn_mean_10"] = round(turn_mean, 2)
        elif combined.get("final_combined_score_10") is not None:
            voice_score = int(max(0, min(10, round(combined["final_combined_score_10"]))))
            audit_payload["stage1_voice_score_source"] = "technical_plus_take_home"
            defense_pct = None
        else:
            rounded = rubric_eval.get("weighted_overall_rounded")
            if depth_score is None:
                audit_payload["depth_score_unscored"] = True
                voice_score = int(rounded) if rounded is not None else 0
            else:
                voice_score = rounded if rounded is not None else depth_score
            audit_payload["stage1_voice_score_source"] = (
                "weighted_rubric" if rubric_eval.get("weighted_overall_rounded") is not None else "depth_score"
            )
            defense_pct = None
        if depth_score is None and not is_project_defense:
            depth_score = int(voice_score)
        elif depth_score is None and is_project_defense and voice_score:
            depth_score = int(voice_score)
        audit_payload = audit.finalize(
            depth_score if depth_score is not None else int(voice_score or 0),
            resume_alignment=resume_alignment,
            knowledge_state=k_state_dict,
            rubric_evaluation=rubric_eval,
        )
        audit_payload["depth_score_secondary"] = depth_score
        audit_payload["executive_summary"] = ai_summary
        audit_payload["take_home_verification"] = {
            "enabled": bool(getattr(state, "take_home_verification_enabled", False)),
            "phase_completed": bool(getattr(state, "take_home_phase_active", False) and th_notes),
            **{k: v for k, v in combined.items() if k != "take_home_notes"},
            "notes": th_notes,
        }
        if is_project_defense and defense_pct is not None:
            audit_payload["final_combined_score_pct"] = round(defense_pct, 2)
            audit_payload["take_home_verification"]["take_home_verification_score_pct"] = round(
                defense_pct, 2
            )
            audit_payload["take_home_verification"]["final_combined_score_pct"] = round(defense_pct, 2)
            audit_payload["take_home_verification"]["final_combined_score_10"] = round(
                defense_pct / 10.0, 2
            )
        elif combined.get("final_combined_score_pct") is not None:
            audit_payload["final_combined_score_pct"] = combined["final_combined_score_pct"]
        if not is_project_defense:
            audit_payload["stage1_voice_score_source"] = (
                "technical_plus_take_home"
                if combined.get("final_combined_score_10") is not None
                else (
                    "weighted_rubric"
                    if rubric_eval.get("weighted_overall_rounded") is not None
                    else "depth_score"
                )
            )
        try:
            audit_payload["proctor_events"] = await fetch_interview_proctor_events(
                state.candidate_token,
            )
        except Exception:
            logger.warning(
                "Could not fetch proctor events token=%s",
                state.candidate_token,
            )
            audit_payload["proctor_events"] = []
    else:
        if is_project_defense:
            turn_mean = _project_defense_turn_mean_10(th_notes)
            voice_score = int(max(1, min(10, round(turn_mean)))) if turn_mean is not None else 0
            defense_pct = float(voice_score) * 10.0 if voice_score else None
            audit_payload["stage1_voice_score_source"] = (
                "project_defense_turn_mean_10" if turn_mean is not None else "candidate_left"
            )
        elif combined.get("final_combined_score_10") is not None:
            voice_score = int(max(0, min(10, round(combined["final_combined_score_10"]))))
            defense_pct = None
        else:
            rounded = rubric_eval.get("weighted_overall_rounded")
            voice_score = rounded if rounded is not None else depth_score
            defense_pct = None

    if project_payload:
        project = project_payload.get("project") or {}
        if defense_pct is None and isinstance(voice_score, (int, float)) and voice_score:
            defense_pct = float(voice_score) * 10.0
        audit_payload["interview_mode"] = "project_defense"
        audit_payload["project_interview"] = {
            "submission_id": project_payload.get("submission_id"),
            "project_id": project.get("id"),
            "project_title": project.get("title"),
            "repo_url": project_payload.get("repo_url"),
            "questions_asked": getattr(source, "_primary_questions_asked", None),
            "question_count": getattr(source, "max_primary_questions", None),
            "defense_score_pct": round(defense_pct, 2) if defense_pct is not None else None,
            "interview_weight_pct": 100,
            "score_source": audit_payload.get("stage1_voice_score_source"),
        }

    audit.write_to_disk(audit_payload)
    
    state.intro_depth_score = int(voice_score)
    state.intro_audit_payload = audit_payload
    state.assessment.resume_alignment = resume_alignment
    state.intro_completed = True
    logger.info(
        "Final score calculated token=%s voice_score=%s — Interview closing",
        state.candidate_token,
        voice_score,
    )

    try:
        await post_save_intro_results(
            state.candidate_token,
            stage1_voice_score=int(voice_score),
            stage1_chat_history=history,
            stage1_voice_audit=audit_payload,
        )
    except Exception as e:
        logger.warning("post_save_intro_results failed: %s", e)



async def _notify_assessment_active(state: InterviewSessionState) -> None:
    await post_assessment_active(
        state.candidate_token,
        stage1_voice_score=state.intro_depth_score,
        stage1_chat_history=state.engine.history_payload(),
        stage1_voice_audit=state.intro_audit_payload,
    )


async def _deliver_closing(state: InterviewSessionState, session: AgentSession) -> None:
    if state.assessment.phase != AssessmentSessionPhase.CLOSING:
        state.assessment.enter_closing("assessment_complete")
    reason = state.assessment.closing_reason
    if reason == "end_interview":
        await _speak_fixed(
            session,
            state,
            speak_line(
                "Thank you for your time. You can now continue to the next rounds for the recruitment.",
                state.interview_language,
            ),
        )
        state.closing_delivered = True
        return
    state.fixed_tts_reply = None
    session.input.set_audio_enabled(False)
    try:
        handle = session.generate_reply(allow_interruptions=False)
        await handle.wait_for_playout()
    finally:
        session.input.set_audio_enabled(True)
    state.closing_delivered = True


async def _await_coding_confirmation(state: InterviewSessionState) -> bool:
    """Wait until candidate confirms coding start or ends interview."""
    ctx = state.assessment
    while ctx.phase == AssessmentSessionPhase.PRE_ASSESSMENT and ctx.is_screen_sharing:
        if ctx.end_interview_event.is_set():
            return False
        if ctx.coding_confirmed_event.is_set() and ctx.enter_assessment_active():
            return True
        waiters = [
            asyncio.create_task(ctx.coding_confirmed_event.wait()),
            asyncio.create_task(ctx.end_interview_event.wait()),
        ]
        await asyncio.wait(waiters, return_when=asyncio.FIRST_COMPLETED)
        for task in waiters:
            if not task.done():
                task.cancel()
    return ctx.assessment_active_signaled


async def run_unified_phase_coordinator(
    state: InterviewSessionState,
    session: AgentSession,
) -> None:
    try:
        await state.assessment.conversational_done_event.wait()
        if state.candidate_left:
            await _persist_intro_results(state)
            state.completion_event.set()
            return

        if (
            state.assessment.phase == AssessmentSessionPhase.CLOSING
            and state.assessment.closing_reason == "end_interview"
        ):
            # Standalone AI Verbal and Defend: score what was covered (uncovered
            # rubrics and unanswered questions stay 0), save the transcript, and
            # complete the round. Take-home keeps the previous early-end path.
            project_defense = bool(getattr(state, "project_interview_payload", None))
            standalone_verbal = (
                not project_defense
                and not bool(getattr(state, "take_home_verification_enabled", False))
            )
            if standalone_verbal or project_defense:
                if project_defense:
                    await _finalize_defense_notes(state)
                try:
                    await _persist_intro_results(state)
                except Exception:
                    logger.exception(
                        "AI verbal early-end evaluation failed token=%s",
                        state.candidate_token,
                    )
                try:
                    await _deliver_closing(state, session)
                except Exception:
                    logger.exception(
                        "AI verbal closing failed token=%s",
                        state.candidate_token,
                    )
                score = getattr(state, "intro_depth_score", None)
                audit = getattr(state, "intro_audit_payload", None)
                try:
                    await post_complete(
                        state.candidate_token,
                        stage1_voice_score=int(score) if isinstance(score, (int, float)) else None,
                        stage1_chat_history=state.engine.history_payload(),
                        stage1_voice_audit=audit if isinstance(audit, dict) else None,
                        stage3_chat_history=(
                            state.engine.history_payload() if project_defense else None
                        ),
                        ended_by=state.ended_by,
                    )
                except Exception:
                    logger.exception(
                        "AI verbal complete failed token=%s",
                        state.candidate_token,
                    )
                return

            await _deliver_closing(state, session)
            await post_complete(
                state.candidate_token,
                stage3_chat_history=state.engine.history_payload(),
                ended_by=state.ended_by,
            )
            return

        # Defend thank-you is already in the orchestrator stream. Leave the room
        # as soon as that audio finishes; scoring continues after the redirect.
        if getattr(state, "project_interview_payload", None):
            await _finish_project_defense(state, session)
            return

        await _persist_intro_results(state)

        # We skip the sandbox and end the interview here
        await _speak_fixed(
            session,
            state,
            speak_line(PRE_ASSESSMENT_SCRIPT, state.interview_language),
        )
        
        # Mark as closing and call completion
        state.assessment.enter_closing("end_interview")
        await post_complete(
            state.candidate_token,
            stage3_chat_history=state.engine.history_payload(),
        )
        state.completion_event.set()
        return
    except Exception:
        logger.exception("Unified phase coordinator failed token=%s", state.candidate_token)
    finally:
        state.completion_event.set()


def _is_candidate(participant: rtc.Participant | None) -> bool:
    if participant is None:
        return False
    return participant.identity.startswith("candidate-")


def _handle_data_packet(state: InterviewSessionState, payload: bytes) -> None:
    try:
        message = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return

    msg_type = message.get("type")
    if msg_type == "end_interview":
        # End disconnects the candidate immediately. Keep scoring this attempt
        # until post_complete; a session-close must not cancel it.
        # Only the confirm button sends this reason. Silence cutoff does not.
        if message.get("reason") == "candidate_ended_interview":
            state.ended_by = "candidate"
        state.finalization_in_progress = True
        state.assessment.signal_end_interview()
        if state.assessment.phase == AssessmentSessionPhase.CONVERSATIONAL:
            state.pending_shutdown = True
            state.assessment.conversational_done_event.set()
        if state.assessment.phase != AssessmentSessionPhase.CLOSING:
            state.assessment.enter_closing("end_interview")
    elif msg_type == "confirm_coding":
        state.assessment.signal_confirm_coding()
    elif msg_type == "assessment_complete":
        state.assessment.signal_assessment_complete(
            code_quality_score=message.get("code_quality_score"),
            architectural_flaws=message.get("architectural_flaws"),
        )


def wire_room_media_events(room: rtc.Room, state: InterviewSessionState) -> None:
    ctx = state.assessment

    @room.on("track_subscribed")
    def on_track_subscribed(
        track: rtc.Track,
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> None:
        if not _is_candidate(participant):
            return
        source = publication.source
        if _is_screen_share_source(source):
            ctx.mark_screen_sharing(True)
        elif source == _CAMERA_SOURCE:
            ctx.mark_video(True)

    @room.on("track_unsubscribed")
    def on_track_unsubscribed(
        track: rtc.Track,
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> None:
        if not _is_candidate(participant):
            return
        if _is_screen_share_source(publication.source):
            ctx.mark_screen_sharing(False)
            if ctx.phase == AssessmentSessionPhase.ASSESSMENT_ACTIVE:
                ctx.enter_closing("screen_unsubscribed")
                ctx.assessment_complete_event.set()

    @room.on("track_muted")
    def on_track_muted(
        participant: rtc.Participant,
        publication: rtc.TrackPublication,
    ) -> None:
        if not _is_candidate(participant):
            return
        if publication.kind == _AUDIO_KIND:
            ctx.mark_muted(True)
        elif publication.source == _CAMERA_SOURCE:
            ctx.mark_video(False)

    @room.on("track_unmuted")
    def on_track_unmuted(
        participant: rtc.Participant,
        publication: rtc.TrackPublication,
    ) -> None:
        if not _is_candidate(participant):
            return
        if publication.kind == _AUDIO_KIND:
            ctx.mark_muted(False)
        elif publication.source == _CAMERA_SOURCE:
            ctx.mark_video(True)

    @room.on("track_published")
    def on_track_published(
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> None:
        if not _is_candidate(participant):
            return
        if _is_screen_share_source(publication.source):
            ctx.mark_screen_sharing(True)

    @room.on("data_received")
    def on_data_received(data: rtc.DataPacket) -> None:
        participant = getattr(data, "participant", None)
        if participant is not None and not _is_candidate(participant):
            return
        if participant is None and not any(
            p.identity.startswith("candidate-") for p in room.remote_participants.values()
        ):
            return
        _handle_data_packet(state, data.data)
