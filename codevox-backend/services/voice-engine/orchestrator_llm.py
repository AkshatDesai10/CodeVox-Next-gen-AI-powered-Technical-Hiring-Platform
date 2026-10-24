"""Custom LiveKit LLM adapters wired to the interview orchestrator."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal

from livekit.agents import llm, utils
from livekit.agents.llm.llm import ChatChunk, ChoiceDelta, LLM, LLMStream
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS, NOT_GIVEN, APIConnectOptions, NotGivenOr
from assessment_state_machine import AssessmentSessionContext, AssessmentSessionPhase
from candidate_knowledge import (
    CandidateKnowledgeState,
    BrainDecision,
    EvaluationResult,
    apply_interview_plan,
    enforce_deterministic_rubric_routing,
    enforce_question_source_policy,
    normalize_persisted_question_source,
    normalize_question_source,
    should_escape_same_concept_weak_loop,
    relevant_resume_claim_available,
    has_resume_validation_evidence,
    MAX_TURNS_PER_RUBRIC,
    canonical_seniority_band,
    canonicalize_rubric_key,
    max_turns_for_seniority,
    _pack_items_for_key,
)
from interview_brain import evaluate_and_decide
from interview_trace import (
    CoverageSnap,
    PivotSnap,
    concept_fingerprint,
    emit_evaluation_trace,
    emit_generation_trace,
    emit_turn_event_jsonl,
    infer_spoken_question_source,
    interview_trace_enabled,
    lookup_weight_pct,
    remaining_rubric_snapshots,
    turn_event_jsonl_enabled,
)
from prompts import (
    CLOSING_HANDSHAKE_SCRIPT,
    HR_CLOSING_SCRIPT,
    HR_VERBAL_SYSTEM_PROMPT,
    INTRO_VERBAL_SYSTEM_PROMPT,
    build_closing_prompt,
)
from provider_resilience import ProviderTurnMeta
from reply_classifier import classify_reply_safe
from session_audit import SessionAuditLedger
from topic_orchestrator import IntentTag, OrchestratorAction, TopicOrchestrator
from question_sources.hr import HrQuestionSource

from handoff import post_voice_chat_sync
from llm_engine import LlmEngine, MUFFLED_FIXED_REPLY, is_muffled, normalize_stt_text

if TYPE_CHECKING:
    from livekit.agents import AgentSession

logger = logging.getLogger("orchestrator-llm")

INTRO_MIN_TURNS = int(os.getenv("INTRO_MIN_TURNS", "3"))
# Safety net only. Real stop conditions are coverage-complete and hard_ceiling_mins.
INTRO_MAX_TURNS = int(os.getenv("INTRO_MAX_TURNS", "50"))
HR_MIN_TURNS = int(os.getenv("HR_MIN_TURNS", "3"))
HR_MAX_TURNS = int(os.getenv("HR_MAX_TURNS", "8"))
MAX_QUESTION_REPEATS = int(os.getenv("INTERVIEW_MAX_QUESTION_REPEATS", "2"))
# Short utterances only, so an answer that merely mentions "repeat" is still scored.
_REPEAT_REQUEST_MAX_WORDS = 15
_REPEAT_REQUEST_RE = re.compile(
    r"\b("
    r"repeat|say again|say that again|come again|pardon|one more time|"
    r"didn'?t (?:catch|get|hear)|did not (?:catch|get|hear)|"
    r"what was the question|what is the question|what'?s the question"
    r")\b",
    re.IGNORECASE,
)
_REPEAT_LIMIT_EVAL_TEXT = "I don't know."
_NEED_TIME_RE = re.compile(
    r"\b(just a second|give me a (?:moment|second|minute)|let me think|hold on|one moment)\b",
    re.IGNORECASE,
)
_BARE_FILLER_RE = re.compile(
    r"^(?:okay|ok|yeah|yes|uh|um|hm+|sure)[.!? ]*$",
    re.IGNORECASE,
)
_CLARIFY_RE = re.compile(
    r"(?:"
    r"\b(?:can|could) you (?:please\s+)?(?:explain|clarify|rephrase|simplify)\b"
    r"|\b(?:explain|rephrase|simplify|clarify)(?:\s+\w+){0,4}\s+(?:the\s+)?question\b"
    r"|\bsimpler\s+terms\b"
    r"|\bwhat do you mean\b"
    r"|\bi (?:don'?t|do not) understand\b"
    r")",
    re.IGNORECASE,
)
_NON_ANSWER_RE = re.compile(
    r"^(?:(?:um+|uh+|actually|sorry|yeah|well)[, ]+)*"
    r"(?:"
    r"i (?:do not|don't|dont) (?:really )?(?:know|remember)(?: (?:this|the|that)(?: answer| one)?)?"
    r"|no idea|i have no idea|not sure|i(?:'m| am) not sure"
    r")"
    r"[.!? ]*$",
    re.IGNORECASE,
)

INTRO_OPENING_FALLBACK = (
    "Hello, welcome — thanks for joining today. "
    "To get us started, could you tell me a bit about yourself?"
)

Phase = Literal["intro_verbal", "hr_verbal", "unified"]


@dataclass
class InterviewSessionState:
    candidate_token: str
    tech_stack: str
    phase: Phase
    engine: LlmEngine
    resume_skills: list[str] = field(default_factory=list)
    candidate_name: str | None = None
    orchestrator: TopicOrchestrator | None = None
    question_source: HrQuestionSource | None = None
    audit: SessionAuditLedger | None = None
    assessment: AssessmentSessionContext = field(default_factory=AssessmentSessionContext)
    session: AgentSession | None = None
    completion_event: asyncio.Event = field(default_factory=asyncio.Event)
    turn_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    opening_reply: str | None = None
    fixed_tts_reply: str | None = None
    interview_language: str = "en-IN"
    rubric_criteria: list[dict] = field(default_factory=list)
    knowledge_state: CandidateKnowledgeState = field(default_factory=CandidateKnowledgeState)
    pending_shutdown: bool = False
    candidate_left: bool = False
    # Set only when the candidate confirms End interview. Silence cutoff does not set this.
    ended_by: str | None = None
    intro_completed: bool = False
    intro_depth_score: int = 0
    intro_audit_payload: dict[str, Any] | None = None
    closing_delivered: bool = False
    hr_turn: int = 1
    hr_opening_reply: str | None = None
    last_reply_latency_ms: int | None = None
    last_speech_start_delay_ms: int | None = None
    last_utterance_duration_ms: int | None = None
    last_stt_confidence: float | None = None
    # Action mode that produced the last asked question (for evidence probe_kind).
    last_emitted_action_mode: str | None = None
    # Step 3.5 — question_source of the last asked question (for evidence tracking).
    last_emitted_question_source: str | None = None
    last_emitted_resume_anchor: str | None = None
    # Take-Home Verification (recruitment Technical / AI Verbal) — after rubrics, before closing.
    take_home_verification_enabled: bool = False
    take_home_payload: dict[str, Any] | None = None
    take_home_phase_active: bool = False
    take_home_weight_pct: float = 0.0
    # Build & Defend: set when the whole session is a project-defense interview.
    project_interview_payload: dict[str, Any] | None = None
    round_config: dict[str, Any] | None = None
    repeat_question: str | None = None
    repeat_count: int = 0
    intro_notes: str = ""
    muffled_streak: int = 0
    last_processed_user_text: str = ""
    last_spoken_reply: str = ""


def _is_short_intent(text: str) -> bool:
    return bool(text.strip()) and len(text.split()) <= _REPEAT_REQUEST_MAX_WORDS


def _role_uses_design_gate(state: InterviewSessionState) -> bool:
    """Design/scale wording is only rejected for technical roles."""
    profile = state.engine.job_profile_context or {}
    blob = " ".join(
        [
            str(profile.get("title") or ""),
            str(profile.get("department") or ""),
            str(state.tech_stack or ""),
        ]
    ).lower()
    technical = ("engineer", "developer", "software", "data", "devops", "technical", "programmer")
    non_technical = ("sales", "recruiter", "human resource", "hr ", "account", "finance", "marketing", "support")
    if any(word in blob for word in non_technical) and not any(word in blob for word in technical):
        return False
    return True


def is_clarify_request(text: str) -> bool:
    """A request to rephrase the question is not an answer and must not be scored."""
    stripped = text.strip()
    return bool(stripped) and len(stripped.split()) <= 20 and bool(_CLARIFY_RE.search(stripped))


def is_non_answer(text: str) -> bool:
    """The whole reply is only 'I don't know'. A longer answer that mentions not remembering a detail still counts."""
    stripped = text.strip()
    return bool(stripped) and len(stripped.split()) <= 12 and bool(_NON_ANSWER_RE.match(stripped))


def is_repeat_request(text: str) -> bool:
    stripped = text.strip()
    return (
        bool(stripped)
        and len(stripped.split()) <= _REPEAT_REQUEST_MAX_WORDS
        and bool(_REPEAT_REQUEST_RE.search(stripped))
    )


def _repeat_limit_reached(state: InterviewSessionState, question: str | None) -> bool:
    return state.repeat_question == question and state.repeat_count >= MAX_QUESTION_REPEATS


async def _try_repeat_question(
    state: InterviewSessionState,
    *,
    user_text: str,
    question: str | None,
) -> str | None:
    """Repeat the pending question without scoring or advancing the turn (max per question)."""
    logger.info(
        "repeat check last_question_asked=%r token=%s",
        question,
        state.candidate_token,
    )
    if not question or not is_repeat_request(user_text):
        return None
    if state.repeat_question != question:
        state.repeat_question = question
        state.repeat_count = 0
    if state.repeat_count >= MAX_QUESTION_REPEATS:
        logger.info(
            "Repeat limit reached (%s) token=%s — treating as no answer",
            MAX_QUESTION_REPEATS,
            state.candidate_token,
        )
        return None
    state.repeat_count += 1
    reply = f"Sure, here is the question again. {question}"
    state.engine.chat_history.append({"role": "user", "content": user_text.strip()})
    state.engine.chat_history.append({"role": "assistant", "content": reply})
    logger.info(
        "Repeated question %s/%s token=%s",
        state.repeat_count,
        MAX_QUESTION_REPEATS,
        state.candidate_token,
    )
    _schedule_chat_sync(state)
    return reply


def _fallback_reply(
    turn: int,
    tech_stack: str,
    user_text: str,
    *,
    topic: str = "",
    resume_skills: list[str] | None = None,
) -> str:
    skills = [skill for skill in (resume_skills or []) if skill] or [topic or "this work"]
    if turn == 1:
        return INTRO_OPENING_FALLBACK
    skill = skills[min(max(turn - 2, 0), len(skills) - 1)]
    return (
        f"Thanks. How would you handle a typical situation involving {skill} in this role?"
    )


def _end_conversational_if_needed(
    state: InterviewSessionState,
    action: OrchestratorAction,
    source: Any,
) -> str | None:
    """Stop the oral phase after this turn's reply. WRAP_UP must not wait for the turn cap.

    When Take-Home Verification is enabled and not yet started, transition into that
    phase instead of ending — Take-Home must run after all technical rubrics.
    """
    reason: str | None = None
    if action.mode == "closing":
        reason = "wrap_up"
    elif not source.should_continue():
        reason = "turn_safety_net"
    if reason is None:
        return None

    # Technical rubrics done → enter Take-Home Verification (never mid-rubric).
    if (
        reason
        and getattr(state, "take_home_verification_enabled", False)
        and not getattr(state, "take_home_phase_active", False)
    ):
        if _begin_take_home_phase(state):
            logger.info(
                "Take-Home verification phase started (deferred closing) token=%s reason=%s",
                state.candidate_token,
                reason,
            )
            return "take_home_transition"
        logger.warning(
            "Take-Home verification enabled but context missing — skipping phase token=%s",
            state.candidate_token,
        )

    state.pending_shutdown = True
    if not state.assessment.conversational_done_event.is_set():
        state.assessment.conversational_done_event.set()
        logger.info("Conversational phase complete immediately (%s)", reason)
    return reason


def _begin_take_home_phase(state: InterviewSessionState) -> bool:
    """Swap question source to Take-Home Verification. Returns False if payload missing."""
    payload = getattr(state, "take_home_payload", None)
    if not payload:
        return False
    from question_sources.take_home_verification import TakeHomeVerificationSource

    state.take_home_phase_active = True
    state.pending_shutdown = False
    state.question_source = TakeHomeVerificationSource(  # type: ignore[assignment]
        take_home_payload=payload,
        project_title=None,
        language_preference=None,
        max_primary_questions=3,
    )
    logger.info(
        "Take-Home verification phase started token=%s weight_pct=%s",
        state.candidate_token,
        getattr(state, "take_home_weight_pct", 0),
    )
    return True


def _try_divert_closing_to_take_home(
    state: InterviewSessionState,
    action: OrchestratorAction,
) -> OrchestratorAction | None:
    """If technical WRAP_UP/closing fires and Take-Home is pending, ask Q1 instead."""
    if action.mode != "closing":
        return None
    if not getattr(state, "take_home_verification_enabled", False):
        return None
    if getattr(state, "take_home_phase_active", False):
        return None
    if not _begin_take_home_phase(state):
        return None
    source = state.question_source
    assert source is not None
    logger.info(
        "Take-Home question 1/3 token=%s (diverted from technical closing)",
        state.candidate_token,
    )
    return source.initial_action()


def apply_coverage_guardrails(
    state: InterviewSessionState,
    brain_dec: BrainDecision,
    *,
    turn: int,
    current_comp: str | None,
    forced_override_reason: str | None = None,
) -> tuple[BrainDecision, str | None]:
    """Production guardrail: wrap once every rubric area has baseline coverage (not single-touch)."""
    ks = state.knowledge_state
    if not state.rubric_criteria:
        return brain_dec, forced_override_reason

    # Phase 3 Guardrail: Block WRAP_UP if there are zero-touch required rubrics
    # (unless we hit a hard ceiling).
    if brain_dec.action_mode == "WRAP_UP" and forced_override_reason != "hard_ceiling":
        zero_touch = ks.get_zero_touch_rubrics(state.rubric_criteria)
        if zero_touch:
            target = zero_touch[0]
            target_label = target.get("label") or target.get("id") or "this competency"
            brain_dec = BrainDecision.model_validate({
                **brain_dec.model_dump(),
                "action_mode": "PIVOT_COMPETENCY",
                "target_competency": target_label,
                "target_concept": "",
                "system_directive": f"We cannot wrap up yet. This required rubric has not been discussed. You must ask at least one question about it: {target_label}."
            })
            logger.info("Phase 3 OVERRIDE: Blocked WRAP_UP due to zero-touch required rubric '%s'", target_label)
            return brain_dec, "zero_touch_rescue"

    if not ks.get_untested_competencies(state.rubric_criteria) and brain_dec.action_mode != "WRAP_UP":
        brain_dec = BrainDecision.model_validate({
            **brain_dec.model_dump(),
            "action_mode": "WRAP_UP",
            "system_directive": "We have covered the required baseline across all rubric areas. Close cleanly and summarize the assessment.",
        })
        logger.info("Phase 3.5 OVERRIDE: all rubric areas have baseline coverage → WRAP_UP")
        return brain_dec, "coverage_complete"
    return brain_dec, forced_override_reason


def _last_user_message(chat_ctx: llm.ChatContext) -> llm.ChatMessage | None:
    for item in reversed(chat_ctx.items):
        if isinstance(item, llm.ChatMessage) and item.role == "user":
            return item
    return None


def _schedule_chat_sync(
    state: InterviewSessionState,
    *,
    turn_index: int | None = None,
    user_text: str | None = None,
) -> None:
    try:
        asyncio.get_running_loop().create_task(
            _sync_chat(state, turn_index=turn_index, user_text=user_text)
        )
    except RuntimeError:
        logger.warning("Chat sync skipped; no running event loop token=%s", state.candidate_token)


async def _sync_chat(
    state: InterviewSessionState,
    *,
    turn_index: int | None = None,
    user_text: str | None = None,
) -> None:
    if getattr(state, "project_interview_payload", None):
        sync_phase = "bnd_interview"
    elif state.phase == "ai_screening":
        sync_phase = "ai_screening"
    elif state.phase == "hr_verbal":
        sync_phase = "hr_verbal"
    else:
        sync_phase = "ai_verbal"
    try:
        await post_voice_chat_sync(
            state.candidate_token,
            chat_history=state.engine.history_payload(),
            phase=sync_phase,
            turn_index=turn_index,
            reply_latency_ms=state.last_reply_latency_ms,
            stt_confidence=state.last_stt_confidence,
            speech_start_delay_ms=state.last_speech_start_delay_ms,
            utterance_duration_ms=state.last_utterance_duration_ms,
            user_text=user_text,
        )
    except Exception as exc:
        logger.warning("Chat sync failed token=%s: %s", state.candidate_token, exc)


async def _generate_orchestrated_reply(
    state: InterviewSessionState,
    *,
    user_text: str,
    action: OrchestratorAction,
    turn: int,
    intent: IntentTag | None,
) -> tuple[str, ProviderTurnMeta | None]:
    min_turns = HR_MIN_TURNS if state.phase == "hr_verbal" else INTRO_MIN_TURNS
    max_turns = HR_MAX_TURNS if state.phase == "hr_verbal" else INTRO_MAX_TURNS

    if action.mode == "closing":
        next_phase = bool(state.take_home_verification_enabled and not state.take_home_phase_active)
        if state.phase == "hr_verbal":
            script = HR_CLOSING_SCRIPT
        elif next_phase:
            script = (
                "Thank you. We have covered this conversation, "
                "and we will move on to the next part of the assessment."
            )
        else:
            script = CLOSING_HANDSHAKE_SCRIPT
        from prompts import speak_line

        script = speak_line(script, state.interview_language)
        if user_text.strip():
            state.engine.chat_history.append({"role": "user", "content": user_text.strip()})
        state.engine.chat_history.append({"role": "assistant", "content": script})
        return script, None
    try:
        return await state.engine.generate_orchestrated_turn(
            user_text,
            action=action,
            turn=turn,
            min_turns=min_turns,
            max_turns=max_turns,
            intent=intent,
        )
    except Exception as exc:
        logger.exception("Orchestrated LLM turn %s failed (%s) — using fallback", turn, exc)
        return _fallback_reply(
            turn,
            state.tech_stack,
            user_text,
            topic=action.topic,
            resume_skills=state.resume_skills,
        ), None


def _resolve_question_source(state: InterviewSessionState) -> HrQuestionSource:
    if state.question_source is not None:
        return state.question_source
    if state.orchestrator is not None:
        from question_sources.hr import HrQuestionSource

        return HrQuestionSource(state.orchestrator)
    raise RuntimeError("Session missing question source")


def turn_event_jsonl_enabled() -> bool:
    return os.getenv("TURN_EVENT_JSONL", "true").lower() == "true"


def _extract_domain_keywords(concept: str, rubric_label: str) -> str:
    """Robust fallback for cache misses: extract, filter, and sort domain keywords."""
    stop_words = {"how", "what", "the", "a", "an", "of", "in", "to", "for", "with", "vs", "is", "are", "and", "or", "on"}
    rubric_tokens = {t.casefold() for t in re.sub(r"[^a-zA-Z0-9\s]+", " ", rubric_label).split()}
    stop_words.update(rubric_tokens)
    
    text = (concept or "").casefold()
    text = re.sub(r"[^a-z0-9\s]+", " ", text)
    tokens = text.split()
    
    domain_keywords = sorted([t for t in set(tokens) if len(t) > 2 and t not in stop_words])
    return "_".join(domain_keywords) if domain_keywords else text.strip().replace(" ", "_")


async def _process_orchestrated_turn(
    state: InterviewSessionState,
    *,
    user_text: str,
    confidence: float = 1.0,
) -> str:
    if not state.assessment.should_run_llm():
        return ""
    if state.pending_shutdown or state.assessment.conversational_done_event.is_set():
        logger.info("Skipping orchestrated turn — conversational phase already complete")
        return ""

    # Take-Home Verification phase (after technical rubrics complete).
    if getattr(state, "take_home_phase_active", False):
        from question_sources.take_home_verification import TakeHomeVerificationSource

        if isinstance(state.question_source, TakeHomeVerificationSource):
            return await _process_take_home_verification_turn(
                state, user_text=user_text, confidence=confidence
            )

    source = _resolve_question_source(state)
    orchestrator = source.orchestrator
    audit = state.audit
    if audit is None:
        raise RuntimeError("Session missing audit")

    async with state.turn_lock:
        turn = source.current_turn
        reply_started = time.monotonic()
        if turn == 1 and not user_text.strip() and state.opening_reply is not None:
            return state.opening_reply

        state.last_stt_confidence = confidence if turn > 1 else None
        user_text = normalize_stt_text(user_text)

        intent: IntentTag | None = None
        eval_res = None
        brain_dec = None
        brain_artifacts = None
        pool = orchestrator.tech_pool
        # Trace snapshots (filled only on candidate-answer turns when INTERVIEW_TRACE=true)
        trace_coverage_before: CoverageSnap | None = None
        trace_coverage_after: CoverageSnap | None = None
        trace_evidence_item: dict[str, Any] | None = None
        trace_coverage_condition = ""
        trace_active_rubric = ""
        trace_evidence_count_before = 0
        trace_elapsed = 0.0
        trace_remaining_target = 0.0
        trace_remaining_ceiling = 0.0
        trace_weight: float | None = None
        trace_concept = ""
        trace_pivot: PivotSnap | None = None

        if turn > 1:
            pending_question = source.last_question_asked or state.opening_reply
            if user_text.strip() and user_text.strip() == state.last_processed_user_text:
                logger.info(
                    "Skipping duplicate candidate utterance token=%s",
                    state.candidate_token,
                )
                return state.last_spoken_reply or pending_question or ""

            if is_muffled(user_text, confidence):
                state.muffled_streak += 1
                if state.muffled_streak <= 2:
                    return MUFFLED_FIXED_REPLY
            else:
                state.muffled_streak = 0

            if _is_short_intent(user_text) and _NEED_TIME_RE.search(user_text):
                state.engine.chat_history.append({"role": "user", "content": user_text.strip()})
                reply = "Sure, take your time."
                state.engine.chat_history.append({"role": "assistant", "content": reply})
                state.last_spoken_reply = reply
                _schedule_chat_sync(state)
                return reply

            if _is_short_intent(user_text) and _BARE_FILLER_RE.match(user_text.strip()):
                state.engine.chat_history.append({"role": "user", "content": user_text.strip()})
                reply = f"Take your time. Whenever you're ready: {pending_question}" if pending_question else "Take your time. Whenever you're ready."
                state.engine.chat_history.append({"role": "assistant", "content": reply})
                state.last_spoken_reply = reply
                _schedule_chat_sync(state)
                return reply

            if is_clarify_request(user_text) and pending_question:
                reply = f"Sure, here it is more simply. {pending_question}"
                state.engine.chat_history.append({"role": "user", "content": user_text.strip()})
                state.engine.chat_history.append({"role": "assistant", "content": reply})
                state.last_spoken_reply = reply
                _schedule_chat_sync(state)
                return reply

            repeat_reply = await _try_repeat_question(
                state, user_text=user_text, question=pending_question
            )
            if repeat_reply is not None:
                state.last_spoken_reply = repeat_reply
                return repeat_reply
            if is_repeat_request(user_text) and _repeat_limit_reached(state, pending_question):
                reply = (
                    f"Let me put that more simply. {pending_question}"
                    if pending_question
                    else "Let me ask that in a simpler way."
                )
                state.engine.chat_history.append({"role": "user", "content": user_text.strip()})
                state.engine.chat_history.append({"role": "assistant", "content": reply})
                state.last_spoken_reply = reply
                _schedule_chat_sync(state)
                return reply

            opening_answer = turn == 2 and state.last_emitted_action_mode in ("OPENING", "icebreaker")
            non_answer = is_non_answer(user_text)
            if opening_answer:
                state.intro_notes = user_text.strip()
                first = state.rubric_criteria[0] if state.rubric_criteria else {}
                first_label = str(first.get("label") or first.get("id") or state.tech_stack or "the role")
                band = canonical_seniority_band(
                    str((state.engine.job_profile_context or {}).get("seniority_level") or ""),
                    entry_level=bool(state.engine.entry_level),
                )
                brain_dec = BrainDecision(
                    action_mode="PIVOT_COMPETENCY",
                    target_competency=first_label,
                    target_concept="",
                    difficulty=band,  # type: ignore[arg-type]
                    system_directive=(
                        f"The introduction is not scored. Ask ONE short scenario question about {first_label}, "
                        "grounded in the job responsibilities. No definition and no CV walkthrough."
                    ),
                    question_source="TECHNICAL",
                )
                eval_res = EvaluationResult(
                    concept_tested="Introduction",
                    understanding_level="MODERATE",
                    internal_score_10=None,
                    eval_status="unscored",
                    evidence="Opening answer kept in intro notes only.",
                )
                brain_artifacts = None
                skip_rubric_evidence = True
            elif non_answer:
                skip_rubric_evidence = True
                eval_res = EvaluationResult(
                    concept_tested=state.knowledge_state.active_concept or "current question",
                    understanding_level="SKIP",
                    internal_score_10=None,
                    eval_status="unscored",
                    evidence="Candidate said they do not know. Turn left unscored.",
                )
                active_comp = state.knowledge_state.active_competency or state.tech_stack
                brain_dec = BrainDecision(
                    action_mode="REORIENT_PRACTICAL",
                    target_competency=active_comp,
                    target_concept="",
                    system_directive=(
                        "The candidate states they do not know the answer. Do NOT recite interview policy disclaimers "
                        "or say 'I cannot share answers'. Smoothly and naturally transition without explaining or giving "
                        f"the answer (e.g., 'No problem at all, let's explore another area of {active_comp}: [Follow-up question]'). "
                        f"Ask ONE practical, concrete scenario question about another aspect of {active_comp}."
                    ),
                )
                brain_artifacts = None
            else:
                skip_rubric_evidence = False
                eval_res, brain_dec, brain_artifacts = await evaluate_and_decide(
                    state.engine._client,
                    user_text=user_text,
                    last_question=pending_question or "",
                    knowledge_state=state.knowledge_state,
                    rubric_criteria=state.rubric_criteria,
                    job_profile_context=state.engine.job_profile_context,
                    resume_skills=state.resume_skills,
                    tech_stack=state.tech_stack,
                    current_turn=turn,
                    max_turns=orchestrator.max_turns,
                    entry_level_fallback=state.engine.entry_level,
                    recent_exchanges=list(state.engine.chat_history),
                )
                if getattr(eval_res, "eval_status", "scored") == "unscored":
                    skip_rubric_evidence = True

            # Update CandidateKnowledgeState with diagnostic evaluation + evidence pack
            # (append BEFORE coverage transitions / guardrails — clarification #9).
            prev_action = state.last_emitted_action_mode or "PIVOT_COMPETENCY"
            prev_question_source = state.last_emitted_question_source or "TECHNICAL"
            # Attribute evidence to the rubric that owned the question being answered
            # (locked active competency). eval_res.competency_id is diagnostic only.
            from candidate_knowledge import (
                probe_kind_from_action_mode,
                rubric_key_for_answered_question,
            )

            rubric_key = rubric_key_for_answered_question(
                active_competency=state.knowledge_state.active_competency,
                rubric_criteria=state.rubric_criteria,
            )
            pack_before = state.knowledge_state.get_evidence_pack(str(rubric_key))
            if interview_trace_enabled():
                trace_active_rubric = str(rubric_key)
                trace_evidence_count_before = len(pack_before.items) if pack_before else 0
                trace_coverage_before = CoverageSnap(
                    coverage_state=pack_before.coverage_state if pack_before else "INSUFFICIENT",
                    exit_reason=pack_before.exit_reason if pack_before else None,
                )
                trace_elapsed, trace_remaining_ceiling = (
                    state.knowledge_state.get_elapsed_and_remaining_minutes()
                )
                trace_remaining_target = max(
                    0.0,
                    float(state.knowledge_state.target_duration_mins) - trace_elapsed,
                )
                trace_weight = lookup_weight_pct(state.rubric_criteria, str(rubric_key))
                trace_concept = eval_res.concept_tested or state.knowledge_state.active_concept or ""

            if not skip_rubric_evidence:
                # The question's rubric owns the score. The evaluator's competency
                # label is only a hint and must not split the scorecard.
                if rubric_key and rubric_key != "general":
                    eval_res.competency_id = str(rubric_key)
                state.knowledge_state.record_turn_evaluation(eval_res)
            prev_resume_anchor = state.last_emitted_resume_anchor
            persisted_qs = normalize_persisted_question_source(
                prev_question_source,
                source.last_question_asked or "",
                resume_anchor=prev_resume_anchor,
                job_profile_context=state.engine.job_profile_context,
            )
            if (
                normalize_question_source(prev_question_source) == "RESUME_VALIDATION"
                and persisted_qs != "RESUME_VALIDATION"
            ):
                logger.warning(
                    "Downgrading persisted question_source RESUME_VALIDATION→%s "
                    "(spoken question not resume-grounded) turn=%s",
                    persisted_qs,
                    turn,
                )
            
            # --- Concept Fingerprint generation ---
            active_concept = state.knowledge_state.active_concept or ""
            touched = state.knowledge_state.concept_area_cache.touched_areas(str(rubric_key), [active_concept])
            if touched:
                turn_concept_fingerprint = touched[0]
            else:
                r_label = ""
                if state.rubric_criteria:
                    for r in state.rubric_criteria:
                        if str(r.get("id")) == str(rubric_key):
                            r_label = str(r.get("label", ""))
                            break
                    if not r_label:
                        r_label = str(state.rubric_criteria[0].get("label", ""))
                turn_concept_fingerprint = _extract_domain_keywords(active_concept, r_label)
                logger.info(
                    "ConceptAreaCache miss for '%s'. Fallback fingerprint: '%s'",
                    active_concept,
                    turn_concept_fingerprint,
                )
            
            evidence_row = None
            if not skip_rubric_evidence and eval_res.internal_score_10 is not None:
                evidence_row = state.knowledge_state.append_evidence(
                rubric_key=str(rubric_key),
                question=source.last_question_asked or "",
                answer_verbatim=user_text,
                understanding_level=eval_res.understanding_level,
                internal_score_10=eval_res.internal_score_10,
                evidence_notes=eval_res.evidence or "",
                resume_anchor=(
                    prev_resume_anchor
                    if persisted_qs == "RESUME_VALIDATION"
                    else None
                )
                or eval_res.verified_resume_claim,
                concept_tested=eval_res.concept_tested or "",
                concept_fingerprint=turn_concept_fingerprint,
                action_mode=prev_action,
                question_source=persisted_qs,
                rubric_criteria=state.rubric_criteria,
                fallback_rubric_key=state.knowledge_state.active_competency,
                evidence_dimension=getattr(brain_dec, "evidence_dimension", None),
            )
            if interview_trace_enabled() and evidence_row is not None:
                pack_after = state.knowledge_state.get_evidence_pack(str(rubric_key))
                trace_evidence_item = evidence_row.to_dict()
                trace_coverage_after = CoverageSnap(
                    coverage_state=pack_after.coverage_state if pack_after else "INSUFFICIENT",
                    exit_reason=pack_after.exit_reason if pack_after else None,
                )
                trace_coverage_condition = (
                    state.knowledge_state._last_coverage_condition or "(unknown)"
                )
            state.knowledge_state.active_competency = brain_dec.target_competency
            state.knowledge_state.active_concept = brain_dec.target_concept
            locked = getattr(state.orchestrator, "locked_level", None)
            if locked in ("JUNIOR", "MID", "SENIOR"):
                state.knowledge_state.current_difficulty = locked
            else:
                state.knowledge_state.current_difficulty = brain_dec.difficulty
            if (
                not skip_rubric_evidence
                and brain_dec.action_mode
                in (
                    "PROBE_DEPTH",
                    "CHALLENGE_EDGE_CASE",
                    "CLARIFY_MISCONCEPTION",
                    "ANALOGOUS_PROBE",
                )
            ):
                state.knowledge_state.follow_up_depth += 1
            else:
                state.knowledge_state.follow_up_depth = 0

            # --- Phase 3.5: Pacing & Coverage Guardrails ---
            from candidate_knowledge import (
                BASE_DURATION_MINUTES,
                MAX_FOLLOW_UP_DEPTH,
                MAX_TURNS_PER_RUBRIC,
                ONE_TIME_EXTENSION_CHECK_TURN,
                ONE_TIME_EXTENSION_MINUTES,
                AVG_TURN_THRESHOLD_SECONDS,
                RUBRIC_TIME_PRESSURE_FACTOR,
            )
            ks = state.knowledge_state
            forced_override_reason: str | None = None
            # Count the rubric that owned the question just answered, not the brain's next target.
            current_comp = str(rubric_key or ks.active_competency or "general")

            if not opening_answer:
                ks.record_competency_turn(current_comp)

            elapsed_mins, _ = ks.get_elapsed_and_remaining_minutes()

            # Item 1: One-time extension check at turn 6 (disabled when extension minutes == 0)
            if (
                ONE_TIME_EXTENSION_MINUTES > 0
                and turn == ONE_TIME_EXTENSION_CHECK_TURN
                and not ks._ceiling_extension_applied
            ):
                avg_turn_secs = (elapsed_mins * 60.0) / max(1, turn - 1)
                if avg_turn_secs > AVG_TURN_THRESHOLD_SECONDS:
                    ks.hard_ceiling_mins += ONE_TIME_EXTENSION_MINUTES
                    ks._ceiling_extension_applied = True
                    logger.info(
                        "Phase 3.5: One-time ceiling extension applied at turn %d "
                        "(avg turn=%.0fs > %ds threshold). New ceiling=%d min",
                        turn, avg_turn_secs, AVG_TURN_THRESHOLD_SECONDS, ks.hard_ceiling_mins,
                    )

            # --- Priority-ordered guardrail overrides ---
            resume_nudge_applied = False
            pre_guardrail_action = brain_dec.action_mode
            pre_guardrail_target = brain_dec.target_competency

            # 0. Same-concept weak/IDK rabbit hole → different concept/rubric
            # (selection only; does not change Steps 1–3 coverage/freeze math).
            pack_escape = ks.get_evidence_pack(str(rubric_key))
            escape_items = pack_escape.items if pack_escape else []
            if (
                brain_dec.action_mode
                not in ("WRAP_UP", "PIVOT_COMPETENCY")
                and should_escape_same_concept_weak_loop(
                    escape_items,
                    concept=eval_res.concept_tested or ks.active_concept,
                    last_understanding_level=eval_res.understanding_level,
                )
            ):
                untested = (
                    ks.get_untested_competencies(state.rubric_criteria)
                    if state.rubric_criteria
                    else []
                )
                next_comp = None
                for u in untested:
                    label = str(u.get("label") or u.get("id") or "")
                    if label and label not in (current_comp, str(rubric_key)):
                        next_comp = label
                        break
                if next_comp:
                    brain_dec = BrainDecision.model_validate({
                        **brain_dec.model_dump(),
                        "action_mode": "PIVOT_COMPETENCY",
                        "target_competency": next_comp,
                        "target_concept": "",
                        "system_directive": (
                            f"Acknowledge briefly. They repeatedly struggled with the same "
                            f"micro-topic — move to {next_comp}. Do NOT reframe that concept."
                        ),
                        "question_source": "TECHNICAL",
                        "resume_anchor": None,
                    })
                else:
                    brain_dec = BrainDecision.model_validate({
                        **brain_dec.model_dump(),
                        "action_mode": "REORIENT_PRACTICAL",
                        "target_concept": "",
                        "system_directive": (
                            "Acknowledge briefly. Do NOT reframe the same micro-topic. "
                            "Ask about a DIFFERENT concept within this competency."
                        ),
                        "question_source": "PRACTICAL",
                        "resume_anchor": None,
                    })
                ks.active_concept = ""
                ks.follow_up_depth = 0
                forced_override_reason = "escape_same_concept_weak_loop"
                logger.info(
                    "OVERRIDE: escape_same_concept_weak_loop concept=%s → action=%s target=%s",
                    eval_res.concept_tested,
                    brain_dec.action_mode,
                    brain_dec.target_competency,
                )

            # 1. Hard ceiling → WRAP_UP (always wins)
            if elapsed_mins >= ks.hard_ceiling_mins:
                brain_dec = BrainDecision.model_validate({
                    **brain_dec.model_dump(),
                    "action_mode": "WRAP_UP",
                    "system_directive": "We have reached the session time limit. Deliver a smooth closing transition.",
                })
                forced_override_reason = "hard_ceiling"
                logger.warning("Phase 3.5 OVERRIDE: hard ceiling reached (%.1f >= %d min) → WRAP_UP", elapsed_mins, ks.hard_ceiling_mins)

            # 2. Coverage is its own step. A populated rubric list must not swallow later caps.
            coverage_locked = forced_override_reason == "hard_ceiling"
            if state.rubric_criteria and not coverage_locked:
                brain_dec, coverage_override_reason = apply_coverage_guardrails(
                    state,
                    brain_dec,
                    turn=turn,
                    current_comp=current_comp,
                    forced_override_reason=forced_override_reason,
                )
                if coverage_override_reason in ("zero_touch_rescue", "coverage_complete"):
                    forced_override_reason = coverage_override_reason
                    coverage_locked = True

            sen_for_cap = str((state.engine.job_profile_context or {}).get("seniority_level") or "")
            # AI Verbal uses the interview-wide question budget. HR and project
            # defense keep the older per-rubric ceiling.
            plans_enabled = state.phase != "hr_verbal" and not state.project_interview_payload
            if plans_enabled and state.rubric_criteria:
                from verbal_interview_plan import parse_verbal_budget

                required = [crit for crit in state.rubric_criteria if not crit.get("is_optional")] or list(
                    state.rubric_criteria
                )
                _minimum, turn_cap = parse_verbal_budget(state.round_config, len(required))
            else:
                turn_cap = max_turns_for_seniority(
                    sen_for_cap,
                    entry_level=bool(state.engine.entry_level),
                )
            turns_here = ks.turns_per_competency.get(current_comp, 0)

            # 3. Depth, resume guarantee, turn cap, and time pressure run only if coverage did not wrap up.
            if not coverage_locked and brain_dec.action_mode != "WRAP_UP":
                if ks.follow_up_depth >= MAX_FOLLOW_UP_DEPTH and brain_dec.action_mode in ("PROBE_DEPTH", "CHALLENGE_EDGE_CASE", "CLARIFY_MISCONCEPTION"):
                    untested = ks.get_untested_competencies(state.rubric_criteria)
                    next_comp = str((untested[0].get("label") or untested[0].get("id")) if untested else current_comp)
                    brain_dec = BrainDecision.model_validate({
                        **brain_dec.model_dump(),
                        "action_mode": "PIVOT_COMPETENCY",
                        "target_competency": next_comp,
                        "target_concept": "",
                        "system_directive": f"Acknowledge their answer. We've explored this topic well — let's move on to {next_comp}.",
                    })
                    ks.follow_up_depth = 0
                    forced_override_reason = "depth_cap"
                    logger.info("Phase 3.5 OVERRIDE: follow-up depth cap (%d) → PIVOT to %s", MAX_FOLLOW_UP_DEPTH, next_comp)
                elif (
                    turns_here == turn_cap - 1
                    and brain_dec.action_mode in ("PROBE_DEPTH", "CHALLENGE_EDGE_CASE", "FOLLOW_UP")
                ):
                    items = _pack_items_for_key(ks, current_comp, state.rubric_criteria)
                    has_resume = has_resume_validation_evidence(items)
                    has_claim = relevant_resume_claim_available(
                        current_comp,
                        job_profile_context=state.engine.job_profile_context,
                        resume_skills=state.resume_skills,
                        verified_claims=list(ks.verified_resume_claims),
                        rubric_criteria=state.rubric_criteria,
                    )
                    if has_claim and not has_resume:
                        brain_dec = BrainDecision.model_validate({
                            **brain_dec.model_dump(),
                            "action_mode": "PROBE_DEPTH",
                            "question_source": "RESUME_VALIDATION",
                            "evidence_dimension": "RESUME_VALIDATION",
                            "system_directive": f"Acknowledge their answer. Let's validate their resume experience with {current_comp}.",
                        })
                        forced_override_reason = "drilldown_sacrifice_resume_guarantee"
                        logger.info("Phase 3.5 OVERRIDE: resume guarantee for '%s' before turn cap.", current_comp)
                elif turns_here >= turn_cap:
                    untested = ks.get_untested_competencies(state.rubric_criteria)
                    if untested:
                        next_comp = str(untested[0].get("label") or untested[0].get("id"))
                        brain_dec = BrainDecision.model_validate({
                            **brain_dec.model_dump(),
                            "action_mode": "PIVOT_COMPETENCY",
                            "target_competency": next_comp,
                            "target_concept": "",
                            "system_directive": f"Acknowledge their answer. Let's now explore {next_comp}.",
                        })
                        ks.follow_up_depth = 0
                        forced_override_reason = "turn_cap"
                        logger.info("Phase 3.5 OVERRIDE: turn cap (%d) for '%s' → PIVOT to %s", turn_cap, current_comp, next_comp)
                elif state.rubric_criteria and brain_dec.action_mode not in ("PIVOT_COMPETENCY", "WRAP_UP"):
                    weight_pct = 0.0
                    for crit in state.rubric_criteria:
                        crit_label = str(crit.get("label") or crit.get("id") or "")
                        if crit_label == current_comp:
                            weight_pct = float(crit.get("weight_pct", 0) or 0) / 100.0
                            break
                    if weight_pct > 0:
                        target_time = BASE_DURATION_MINUTES * weight_pct
                        actual_time = ks.time_per_competency.get(current_comp, 0.0)
                        untested = ks.get_untested_competencies(state.rubric_criteria)
                        if actual_time > target_time * RUBRIC_TIME_PRESSURE_FACTOR and untested:
                            next_comp = str(untested[0].get("label") or untested[0].get("id"))
                            brain_dec = BrainDecision.model_validate({
                                **brain_dec.model_dump(),
                                "action_mode": "PIVOT_COMPETENCY",
                                "target_competency": next_comp,
                                "target_concept": "",
                                "system_directive": f"Acknowledge their answer. We need to cover other areas — let's discuss {next_comp}.",
                            })
                            ks.follow_up_depth = 0
                            forced_override_reason = "time_pressure"
                            logger.info(
                                "Phase 3.5 OVERRIDE: time pressure for '%s' → PIVOT to %s",
                                current_comp,
                                next_comp,
                            )

            # 6. Resume adaptive selection is owned by enforce_question_source_policy
            # (Technical → deepen → Resume → optional FOLLOW_UP; no fixed ratio).

            # Track resume-grounded questions for observability / Brain hints.
            if (
                normalize_question_source(getattr(brain_dec, "question_source", None))
                == "RESUME_VALIDATION"
                and not resume_nudge_applied
            ):
                ks.resume_question_count += 1

            # Step 3 + authoritative rubric routing (sole authority for next RUBRIC).
            # Replaces exact-string invalid_competency pivot; leading-dot labels match via normalize.
            if state.rubric_criteria and brain_dec.action_mode != "WRAP_UP":
                brain_dec, route_reason = enforce_deterministic_rubric_routing(
                    brain_dec,
                    ks,
                    state.rubric_criteria,
                    evaluated_rubric_key=str(rubric_key),
                    job_profile_context=state.engine.job_profile_context,
                    resume_skills=state.resume_skills,
                )
                if route_reason:
                    ks.follow_up_depth = 0
                    forced_override_reason = route_reason
                    logger.info(
                        "Step3/routing OVERRIDE: %s → action=%s target=%s",
                        route_reason,
                        brain_dec.action_mode,
                        brain_dec.target_competency,
                    )

            # Adaptive question_source / resume_anchor (after rubric lock).
            if brain_dec.action_mode != "WRAP_UP":
                next_key = str(
                    brain_dec.target_competency or rubric_key or ks.active_competency or ""
                )
                brain_dec, qs_reason = enforce_question_source_policy(
                    brain_dec,
                    ks,
                    next_rubric_key=next_key,
                    rubric_criteria=state.rubric_criteria,
                    job_profile_context=state.engine.job_profile_context,
                    resume_skills=state.resume_skills,
                    last_understanding_level=getattr(
                        eval_res, "understanding_level", None
                    ),
                    last_identified_weakness=getattr(
                        eval_res, "identified_weakness", None
                    ),
                    last_question_source=prev_question_source,
                )
                if qs_reason:
                    forced_override_reason = qs_reason
                    logger.info(
                        "Step3.5/question_source OVERRIDE: %s → source=%s resume_anchor=%s",
                        qs_reason,
                        brain_dec.question_source,
                        brain_dec.resume_anchor,
                    )

            # The rubric plan is the last word on the next question. Earlier
            # guardrails can suggest a pivot; they cannot skip a required category
            # or keep the interview on one rubric. The time ceiling still wraps up.
            # Repeats, clarifications, and the opening never reach this planner.
            if forced_override_reason != "hard_ceiling" and state.rubric_criteria:
                sen = str((state.engine.job_profile_context or {}).get("seniority_level") or "")
                brain_dec, plan_reason = apply_interview_plan(
                    brain_dec,
                    ks,
                    state.rubric_criteria,
                    evaluated_rubric_key=str(rubric_key),
                    seniority=sen,
                    entry_level=bool(state.engine.entry_level),
                    understanding_level=getattr(eval_res, "understanding_level", None),
                    eval_status=getattr(eval_res, "eval_status", None),
                    user_text=user_text,
                    job_profile_context=state.engine.job_profile_context,
                    resume_skills=state.resume_skills,
                    round_config=state.round_config,
                    configured_plans=state.phase != "hr_verbal" and not state.project_interview_payload,
                )
                if plan_reason:
                    forced_override_reason = plan_reason
                    logger.info(
                        "Interview plan → %s action=%s target=%s dimension=%s",
                        plan_reason,
                        brain_dec.action_mode,
                        brain_dec.target_competency,
                        brain_dec.evidence_dimension,
                    )

            # Update active state after potential overrides
            ks.active_competency = brain_dec.target_competency
            ks.active_concept = brain_dec.target_concept
            # --- End Phase 3.5 Guardrails ---

            if interview_trace_enabled() and brain_dec.action_mode == "PIVOT_COMPETENCY":
                remaining = remaining_rubric_snapshots(
                    ks,
                    state.rubric_criteria,
                    exclude_key=trace_active_rubric or str(rubric_key),
                )
                why_parts = [
                    f"brain_action={pre_guardrail_action}",
                    f"brain_target={pre_guardrail_target}",
                    f"final_action={brain_dec.action_mode}",
                    f"final_target={brain_dec.target_competency}",
                ]
                if forced_override_reason:
                    why_parts.append(f"guardrail={forced_override_reason}")
                if trace_coverage_condition:
                    why_parts.append(f"coverage={trace_coverage_condition}")
                untested = ks.get_untested_competencies(state.rubric_criteria)
                selected = brain_dec.target_competency
                if untested:
                    top = untested[0]
                    why_parts.append(
                        "selection=get_untested_competencies sorted by weight_pct desc → "
                        f"{top.get('label') or top.get('id')} (weight_pct={top.get('weight_pct')})"
                    )
                trace_pivot = PivotSnap(
                    previous_rubric=trace_active_rubric or str(rubric_key),
                    previous_coverage=(
                        trace_coverage_after.coverage_state
                        if trace_coverage_after
                        else "INSUFFICIENT"
                    ),
                    previous_exit=(
                        trace_coverage_after.exit_reason if trace_coverage_after else None
                    ),
                    remaining=remaining,
                    selected_next=selected,
                    selection_why="; ".join(why_parts),
                )

            action = source.apply_brain_decision(brain_dec, eval_res)
            diverted = _try_divert_closing_to_take_home(state, action)
            take_home_diverted = False
            if diverted is not None:
                action = diverted
                source = state.question_source  # type: ignore[assignment]
                take_home_diverted = True
            state.last_emitted_action_mode = (
                "TAKE_HOME_VERIFICATION" if take_home_diverted else brain_dec.action_mode
            )
            state.last_emitted_question_source = (
                "TAKE_HOME_VERIFICATION"
                if take_home_diverted
                else (getattr(brain_dec, "question_source", None) or "TECHNICAL")
            )
            state.last_emitted_resume_anchor = (
                None
                if take_home_diverted
                else (
                    brain_dec.resume_anchor
                    if normalize_question_source(state.last_emitted_question_source)
                    == "RESUME_VALIDATION"
                    else None
                )
            )
            intent = action.intent

            target_key = canonicalize_rubric_key(
                brain_dec.target_competency, 
                state.rubric_criteria, 
                fallback_candidate=str(rubric_key)
            )
            pack_target = state.knowledge_state.get_evidence_pack(target_key)
            turns_on_target = len(pack_target.items) if pack_target else 0
            
            # Priority 9: Inject already covered concepts for this rubric to prevent semantic repetition
            if (not take_home_diverted) and pack_target and pack_target.items:
                tested_concepts = []
                for item in pack_target.items:
                    if item.concept_tested and item.concept_tested not in tested_concepts:
                        tested_concepts.append(item.concept_tested)
                if tested_concepts:
                    import dataclasses
                    concepts_str = ", ".join(tested_concepts)
                    addon = f" Already Covered Concepts for this topic: [{concepts_str}]. Do not ask about these again."
                    new_addon = (action.system_addon + addon) if action.system_addon else addon.strip()
                    action = dataclasses.replace(action, system_addon=new_addon)
            
            if take_home_diverted:
                reply, provider_meta = await _generate_orchestrated_reply(
                    state,
                    user_text=user_text,
                    action=action,
                    turn=turn,
                    intent=intent,
                )
            else:
                import dataclasses
                scenario_bits = []
                resume_turn = (
                    normalize_question_source(getattr(brain_dec, "question_source", None))
                    == "RESUME_VALIDATION"
                )
                is_junior = (
                    canonical_seniority_band(
                        str((state.engine.job_profile_context or {}).get("seniority_level") or ""),
                        entry_level=bool(state.engine.entry_level),
                    ) == "JUNIOR"
                )
                target_comp = str(getattr(brain_dec, "target_competency", "") or state.knowledge_state.active_competency or "")
                active_tier = state.knowledge_state.tier_per_rubric.get(target_comp, "FOUNDATIONAL" if is_junior else "APPLIED")
                if turns_on_target == 0 and not resume_turn:
                    responsibilities = (state.engine.job_profile_context or {}).get("responsibilities") or []
                    if isinstance(responsibilities, list):
                        responsibilities = "; ".join(str(item) for item in responsibilities[:4] if item)
                    if active_tier == "FOUNDATIONAL" or is_junior:
                        scenario_bits.append(
                            "Ask ONE short, clear foundational question testing core concepts, definitions, "
                            "the meaning of terms, or fundamental differences (e.g., 'What is the difference between X and Y?', "
                            "'What does X mean and why is it used?'). Keep it clear and calibrated for a junior candidate. "
                            "No CV walkthrough on a technical turn. Acknowledge the last answer in one short phrase."
                        )
                    else:
                        scenario_bits.append(
                            "Ask ONE short scenario question grounded in this job's responsibilities"
                            + (f" ({responsibilities})" if responsibilities else "")
                            + ". No definition, no high-level overview, and no CV walkthrough on a technical turn. "
                            "Acknowledge the last answer in one short phrase."
                        )
                score = getattr(eval_res, "internal_score_10", None) if eval_res is not None else None
                if isinstance(score, int) and score >= 8:
                    scenario_bits.append("A brief positive acknowledgement is allowed.")
                else:
                    scenario_bits.append("Use a neutral acknowledgement. Do not praise the answer.")
                if scenario_bits:
                    extra = " ".join(scenario_bits)
                    action = dataclasses.replace(
                        action,
                        system_addon=((action.system_addon + " ") if action.system_addon else "") + extra,
                    )
                try:
                    reply, provider_meta = await _generate_orchestrated_reply(
                        state,
                        user_text=user_text,
                        action=action,
                        turn=turn,
                        intent=intent,
                    )
                except Exception as exc:
                    logger.warning("Question generation failed token=%s: %s", state.candidate_token, exc)
                    reply = _fallback_reply(
                        turn,
                        state.tech_stack,
                        "",
                        topic=str(getattr(brain_dec, "target_competency", "") or ""),
                        resume_skills=state.resume_skills,
                    )
                    provider_meta = ProviderTurnMeta(
                        provider_name="safe_fallback", model="static", purpose="generate"
                    )
                    if user_text.strip():
                        state.engine.chat_history.append({"role": "user", "content": user_text.strip()})
                    fallback_turn = {"role": "assistant", "content": reply}
                    planned = state.knowledge_state.pending_question_plan or {}
                    if planned.get("label"):
                        fallback_turn["rubric"] = str(planned["label"])
                        fallback_turn["question_kind"] = (
                            "followup" if planned.get("is_followup") else "primary"
                        )
                    state.engine.chat_history.append(fallback_turn)
            locked = ""
            brain_comp = ""
            intended_qs = ""
            spoken_qs = ""
            actual_tier = "FOUNDATIONAL"
            fp_concept = ""

            if action.mode != "closing":
                intended_qs = normalize_question_source(
                    getattr(action, "question_source", None)
                    or getattr(brain_dec, "question_source", None)
                )
                spoken_qs = infer_spoken_question_source(
                    intended_qs,
                    reply or "",
                    resume_anchor=getattr(action, "resume_anchor", None),
                    job_profile_context=state.engine.job_profile_context,
                )
                locked = str(trace_active_rubric or rubric_key or "")
                brain_comp = str(getattr(eval_res, "competency_id", None) or "")
                fp_concept = (
                    brain_dec.target_concept
                    or getattr(eval_res, "concept_tested", None)
                    or ks.active_concept
                )
                dimension_mismatch = (intended_qs != spoken_qs)
                if dimension_mismatch:
                    logger.error("BUG FLAG: source_mismatch (intended: %s, spoken: %s) turn=%s", intended_qs, spoken_qs, turn)
                
                competency_desync = bool(
                    brain_comp
                    and locked
                    and brain_comp.strip().casefold()
                    != locked.strip().casefold()
                )
                if competency_desync:
                    logger.error("BUG FLAG: competency_desync (brain: %s, locked: %s) turn=%s", brain_comp, locked, turn)

                # Phase 4 - Tier Mismatch Heuristic & Hard Gate
                is_junior = (
                    canonical_seniority_band(
                        str((state.engine.job_profile_context or {}).get("seniority_level") or ""),
                        entry_level=bool(state.engine.entry_level),
                    ) == "JUNIOR"
                )
                actual_tier = state.knowledge_state.tier_per_rubric.get(locked, "FOUNDATIONAL")
                tier_mismatch = False
                lower_question = reply.lower() if reply else ""
                action_mode = getattr(brain_dec, "action_mode", None)
                
                if _role_uses_design_gate(state) and actual_tier == "FOUNDATIONAL":
                    if any(w in lower_question for w in ["design", "trade-off", "scale", "architect"]):
                        tier_mismatch = True
                    elif action_mode == "REORIENT_PRACTICAL" and any(w in lower_question for w in ["alert", "production", "distinguish", "bottleneck"]):
                        tier_mismatch = True
                elif _role_uses_design_gate(state) and actual_tier == "APPLIED":
                    if any(w in lower_question for w in ["design", "scale", "architect"]):
                        tier_mismatch = True
                elif actual_tier == "DESIGN" and any(w in lower_question for w in ["what is", "define", "syntax"]):
                    tier_mismatch = True

                hard_gate_triggered = False
                # Trigger hard gate if tier mismatch (for F/A) or dimension mismatch
                if intended_qs in ("FOLLOW_UP", "RESUME_VALIDATION"):
                    # A follow-up or resume validation question legitimately uses design/trade-off phrasing
                    # about the candidate's real project (e.g. "When you designed those two branches...").
                    # The rewrite templates must not override grounded resume questions.
                    hard_gate_triggered = False
                elif (tier_mismatch and actual_tier in ("FOUNDATIONAL", "APPLIED")) or dimension_mismatch:
                    hard_gate_triggered = True
                    logger.warning(
                        "HARD GATE TRIGGERED: Rejecting due to mismatch (tier=%s, dimension=%s). Original reply: %r",
                        tier_mismatch, dimension_mismatch, reply
                    )
                    safe_concept = str(fp_concept or locked or "this topic").strip()
                    if not safe_concept:
                        safe_concept = str(locked or "this topic").strip()
                        
                    # Priority 1.1: Humanize concept & remove redundant "using" prefix
                    safe_concept = safe_concept.replace("_", " ").strip()
                    if safe_concept.lower().startswith("using "):
                        safe_concept = safe_concept[6:].strip()
                        
                    anchor = str(getattr(action, "resume_anchor", None) or "your background")
                    if dimension_mismatch and intended_qs == "RESUME_VALIDATION":
                        templates = [
                            "I noticed {anchor} in your background. What was your part in that?",
                            "You mentioned {anchor}. What was the hardest part of that work?",
                            "Looking at {anchor}, how did you use {concept} there?",
                        ]
                    elif actual_tier == "FOUNDATIONAL" or is_junior:
                        templates = [
                            "Can you explain the basic concept of {concept} and what it is used for?",
                            "In your own words, what does {concept} mean and what core problem does it solve?",
                            "What is the fundamental difference or key idea behind {concept}?",
                        ]
                    else:
                        templates = [
                            "Suppose you are tasked with a practical project using {concept}. Walk me through the stages you'd follow, from initial setup to implementation and evaluation.",
                            "Can you walk me through a concrete scenario where you would implement a pipeline or feature with {concept}, focusing on the specific steps you would follow?",
                            "Suppose you need to build a solution involving {concept} on the job. Walk me through how you would design and validate that step-by-step.",
                        ]
                    used_templates = getattr(state, "_used_fallback_templates", None)
                    if used_templates is None:
                        used_templates = set()
                        setattr(state, "_used_fallback_templates", used_templates)
                    available = [t for t in templates if t not in used_templates]
                    chosen = available[0] if available else templates[turn % len(templates)]
                    used_templates.add(chosen)
                    reply = chosen.format(concept=safe_concept, anchor=anchor)
                    if state.engine.chat_history and state.engine.chat_history[-1]["role"] == "assistant":
                        state.engine.chat_history[-1]["content"] = reply
                    # concept_fingerprint remains unchanged in the evaluation result to support Phase 2 loop escape

                if turn > 1:
                    emit_turn_event_jsonl(
                        {
                            "session_token": state.candidate_token,
                            "turn_id": turn - 1,
                            "rubric_active": trace_active_rubric or str(rubric_key),
                            "locked_rubric_key": locked,
                            "brain_competency_id": brain_comp or None,
                            "competency_desync": competency_desync,
                            "competency_evaluated": locked,
                            "question_source_intended": state.last_emitted_question_source,
                            "question_source_spoken": state.last_emitted_question_source,
                            "source_mismatch": False,
                            "difficulty_tier": actual_tier,
                            "tier_mismatch": tier_mismatch,
                            "hard_gate_triggered": hard_gate_triggered,
                            "difficulty": getattr(brain_dec, "difficulty", None) or action.level,
                            "evidence_dimension": getattr(brain_dec, "evidence_dimension", None),
                            "entry_level": bool(getattr(state.engine, "entry_level", False)),
                            "eval_score": getattr(eval_res, "internal_score_10", None),
                            "understanding_level": getattr(eval_res, "understanding_level", None),
                            "coverage_before": trace_coverage_before.coverage_state if trace_coverage_before else None,
                            "coverage_after": trace_coverage_after.coverage_state if trace_coverage_after else None,
                            "exit_reason_before": trace_coverage_before.exit_reason if trace_coverage_before else None,
                            "exit_reason_after": trace_coverage_after.exit_reason if trace_coverage_after else None,
                            "forced_override_reason": forced_override_reason,
                            "concept_fingerprint": concept_fingerprint(fp_concept),
                            "action_mode": getattr(brain_dec, "action_mode", None),
                            "next_target_rubric": None,
                        }
                    )

            if interview_trace_enabled() and trace_coverage_before is not None and trace_coverage_after is not None:
                emit_evaluation_trace(
                    turn=turn - 1,
                    user_text=user_text,
                    elapsed_mins=trace_elapsed,
                    remaining_to_target_mins=trace_remaining_target,
                    remaining_to_ceiling_mins=trace_remaining_ceiling,
                    active_rubric=trace_active_rubric or str(rubric_key),
                    coverage_before=trace_coverage_before,
                    weight_pct=trace_weight,
                    concept_being_tested=trace_concept,
                    evidence_count_before=trace_evidence_count_before,
                    brain=brain_artifacts,
                    eval_res=eval_res,
                    brain_dec=brain_dec,
                    evidence_item=trace_evidence_item,
                    coverage_after=trace_coverage_after,
                    coverage_condition=trace_coverage_condition,
                    forced_override_reason=forced_override_reason,
                    pivot=trace_pivot,
                )
                
            if action.mode == "closing":
                pass
            else:
                if turn_event_jsonl_enabled():
                    emit_turn_event_jsonl(
                        {
                            "session_token": state.candidate_token,
                            "turn_id": turn,
                            "rubric_active": locked,
                            "locked_rubric_key": locked,
                            "brain_competency_id": brain_comp or None,
                            "competency_desync": False,
                            "competency_evaluated": locked,
                            "question_source_intended": intended_qs,
                            "question_source_spoken": spoken_qs,
                            "source_mismatch": intended_qs != spoken_qs,
                            "difficulty_tier": actual_tier,
                            "tier_mismatch": False,
                            "hard_gate_triggered": False,
                            "difficulty": getattr(brain_dec, "difficulty", None) or action.level,
                            "evidence_dimension": getattr(brain_dec, "evidence_dimension", None),
                            "entry_level": bool(getattr(state.engine, "entry_level", False)),
                            "eval_score": None,
                            "understanding_level": None,
                            "coverage_before": None,
                            "coverage_after": None,
                            "exit_reason_before": None,
                            "exit_reason_after": None,
                            "forced_override_reason": None,
                            "concept_fingerprint": concept_fingerprint(fp_concept),
                            "action_mode": getattr(brain_dec, "action_mode", None),
                            "next_target_rubric": getattr(brain_dec, "target_competency", None),
                        }
                    )
                if interview_trace_enabled():
                    emit_generation_trace(
                        turn=turn,
                        next_question=reply,
                        next_target_rubric=getattr(brain_dec, "target_competency", None),
                        next_probe_kind=probe_kind_from_action_mode(getattr(brain_dec, "action_mode", None)),
                        next_concept_tested=getattr(brain_dec, "target_concept", None) or getattr(eval_res, "concept_tested", None),
                    )
        else:
            action = source.initial_action()
            if state.rubric_criteria:
                first_crit = state.rubric_criteria[0]
                state.knowledge_state.active_competency = str(first_crit.get("label") or first_crit.get("id"))
            else:
                state.knowledge_state.active_competency = state.tech_stack
            state.knowledge_state.active_concept = "Introduction & Background"
            reply, provider_meta = await _generate_orchestrated_reply(
                state,
                user_text="",
                action=action,
                turn=turn,
                intent=None,
            )
            state.last_emitted_action_mode = action.mode
            state.last_emitted_question_source = normalize_question_source(
                getattr(action, "question_source", None)
            )
            state.last_emitted_resume_anchor = getattr(action, "resume_anchor", None)
            if turn_event_jsonl_enabled():
                intended_qs = normalize_question_source(
                    getattr(action, "question_source", None)
                )
                spoken_qs = infer_spoken_question_source(
                    intended_qs,
                    reply or "",
                    resume_anchor=getattr(action, "resume_anchor", None),
                    job_profile_context=state.engine.job_profile_context,
                )
                locked = str(state.knowledge_state.active_competency or state.tech_stack)
                emit_turn_event_jsonl(
                    {
                        "session_token": state.candidate_token,
                        "turn_id": turn,
                        "rubric_active": locked,
                        "locked_rubric_key": locked,
                        "brain_competency_id": None,
                        "competency_desync": False,
                        "competency_evaluated": locked,
                        "question_source_intended": intended_qs,
                        "question_source_spoken": spoken_qs,
                        "source_mismatch": intended_qs != spoken_qs,
                        "difficulty_tier": state.knowledge_state.tier_per_rubric.get(locked, "FOUNDATIONAL"),
                        "tier_mismatch": False,
                        "difficulty": action.level,
                        "evidence_dimension": None,
                        "entry_level": bool(getattr(state.engine, "entry_level", False)),
                        "eval_score": None,
                        "understanding_level": None,
                        "coverage_before": "INSUFFICIENT",
                        "coverage_after": "INSUFFICIENT",
                        "exit_reason_before": None,
                        "exit_reason_after": None,
                        "forced_override_reason": None,
                        "concept_fingerprint": concept_fingerprint(
                            state.knowledge_state.active_concept
                        ),
                        "action_mode": "OPENING",
                        "next_target_rubric": locked,
                    }
                )
            forced_override_reason = None

        if action.mode == "closing":
            source.mark_closing_done()

        source.record_question(reply)
        if user_text.strip():
            state.last_processed_user_text = user_text.strip()
        state.last_spoken_reply = reply
        
        if turn > 1 and audit.turns:
            prev_turn = audit.turns[-1]
            prev_turn.candidate_reply = user_text
            if intent and prev_turn.intent_label != "OPENING":
                prev_turn.intent_label = intent
            elif prev_turn.intent_label == "PENDING":
                prev_turn.intent_label = intent or "UNKNOWN"
            if eval_res:
                # Keep the rubric assigned when the question was asked.
                # concept_tested is the micro-topic and must not replace the category.
                prev_turn.concept_tested = eval_res.concept_tested or ""
                prev_turn.understanding_level = eval_res.understanding_level
                prev_turn.internal_score_10 = eval_res.internal_score_10
                prev_turn.evidence = eval_res.evidence
                prev_turn.stt_mitigation_applied = eval_res.stt_mitigation_applied

        spoken_plan = dict(state.knowledge_state.pending_question_plan or {})
        if action.mode == "closing" or action.mode == "icebreaker" or turn == 1:
            state.knowledge_state.pending_question_plan = None
            spoken_plan = {}
        elif turn > 1 and (reply or "").strip():
            state.knowledge_state.note_planned_question()
        elif turn > 1:
            state.knowledge_state.pending_question_plan = None
        rubric_label = str(spoken_plan.get("label") or "").strip()

        audit.record_turn(
            turn_index=turn,
            topic_domain=rubric_label or ("Introduction" if turn == 1 else orchestrator.state.topic_name or "Introduction"),
            level=action.level,
            question_asked=reply,
            candidate_reply="",
            intent_label="CLOSING" if action.mode == "closing" else ("OPENING" if turn == 1 else "PENDING"),
            confidence_delta=0,
            provider_meta=provider_meta,
            action_mode=action.mode,
            resume_tech=rubric_label or action.current_tech,
            strike_count=pool.strikes if pool else 0,
            tech_index=pool.active_index if pool else 0,
            concept_tested="",
            understanding_level="",
            internal_score_10=None,
            evidence="",
            forced_override_reason=forced_override_reason,
            stt_mitigation_applied=False,
        )
        if turn > 1:
            state.last_reply_latency_ms = int((time.monotonic() - reply_started) * 1000)
        _schedule_chat_sync(state, turn_index=turn, user_text=user_text if turn > 1 else None)
        source.advance_turn(question_rubric=rubric_label or None)
        if turn == 1:
            state.opening_reply = reply
        _end_conversational_if_needed(state, action, source)
        return reply


async def process_closing_turn(state: InterviewSessionState) -> str:
    if state.closing_delivered:
        return ""
    async with state.turn_lock:
        system = build_closing_prompt(
            resume_alignment=state.assessment.resume_alignment,
            code_quality_score=state.assessment.code_quality_score,
            architectural_flaws=state.assessment.architectural_flaws,
            candidate_name=state.candidate_name,
            phase=state.phase,
            interview_language=state.interview_language,
        )
        messages: list[dict[str, str]] = [
            {"role": "system", "content": system},
            *state.engine.chat_history,
            {
                "role": "user",
                "content": "Deliver the final closing summary and sign-off now.",
            },
        ]
        try:
            reply, _meta = await state.engine._complete(messages, temperature=0.7, max_tokens=280)
        except Exception as exc:
            logger.error("Closing LLM failed (%s) — using fallback", exc)
            from prompts import speak_line

            if state.phase == "hr_verbal":
                reply = speak_line(
                    "Thank you for your time today. We covered several areas from your resume. "
                    "We'll be in touch soon with the next steps.",
                    state.interview_language,
                )
            else:
                reply = speak_line(
                    "Thank you for your time today. We've covered the baseline areas we needed to discuss. "
                    "This part of the interview is now complete.",
                    state.interview_language,
                )
        state.engine.chat_history.append({"role": "assistant", "content": reply})
        _schedule_chat_sync(state)
        state.closing_delivered = True
        return reply


async def process_intro_turn(
    state: InterviewSessionState,
    *,
    user_text: str,
    confidence: float = 1.0,
) -> str:
    return await _process_orchestrated_turn(state, user_text=user_text, confidence=confidence)


async def _process_take_home_verification_turn(
    state: InterviewSessionState,
    *,
    user_text: str,
    confidence: float = 1.0,
) -> str:
    """Exactly 3 Take-Home verification Q&A turns after technical rubrics."""
    from question_sources.take_home_verification import TakeHomeVerificationSource

    source = state.question_source
    if not isinstance(source, TakeHomeVerificationSource):
        logger.error("Take-Home phase active but source is not TakeHomeVerificationSource")
        state.pending_shutdown = True
        state.assessment.conversational_done_event.set()
        return ""

    audit = state.audit
    custom_reply = getattr(source, "generate_reply", None)
    topic_domain = getattr(source, "_current_topic", "take_home_verification")

    async def _reply(action: OrchestratorAction, turn: int, text: str, intent: IntentTag | None):
        if custom_reply is not None:
            return await custom_reply(state.engine, user_text=text, action=action, turn=turn)
        return await _generate_orchestrated_reply(
            state, user_text=text, action=action, turn=turn, intent=intent
        )

    async with state.turn_lock:
        turn = source.current_turn
        reply_started = time.monotonic()
        intent: IntentTag | None = None
        provider_meta = None

        if custom_reply is not None and turn > 1 and not user_text.strip():
            # Empty turn (silence / reconnect): repeat the pending question instead of restarting at Q1.
            return source.last_question_asked or ""

        if turn > 1 and user_text.strip():
            if is_muffled(user_text, confidence):
                return MUFFLED_FIXED_REPLY
            repeat_reply = await _try_repeat_question(
                state, user_text=user_text, question=source.last_question_asked
            )
            if repeat_reply is not None:
                return repeat_reply
            intent, confidence_delta = await classify_reply_safe(
                state.engine._client,
                user_text,
                topic=source._current_topic,
                question_asked=source.last_question_asked,
                confidence=confidence,
            )
            prev_q = source.last_question_asked
            action = source.apply(intent, confidence_delta)
            # Evaluate after apply so a scheduled follow-up can defer scoring.
            eval_result = await source.evaluate_answer(state.engine, prev_q, user_text)
            if eval_result and isinstance(eval_result.get("competency_scores"), dict):
                ks_scores = state.knowledge_state.competency_scores
                for comp_id, comp_score in eval_result["competency_scores"].items():
                    ks_scores.setdefault(str(comp_id), []).append(int(comp_score))
                    state.knowledge_state.record_competency_turn(str(comp_id))
            q_done = source._primary_questions_asked
            logger.info(
                "Take-Home question %s/%s answered token=%s follow_up_pending=%s",
                q_done,
                source.max_primary_questions,
                state.candidate_token,
                bool(source._has_followed_up_current_primary and action.mode != "closing"),
            )
            if action.mode == "closing":
                logger.info(
                    "Take-Home verification completed token=%s notes=%s",
                    state.candidate_token,
                    len(source.rubric_notes),
                )
                closing = getattr(source, "closing_reply", None)
                from prompts import speak_line

                reply = closing() if callable(closing) else speak_line(
                    "Thank you for walking me through your Take-Home work. "
                    "That completes the verification questions for this interview.",
                    state.interview_language,
                )
                if user_text.strip():
                    state.engine.chat_history.append({"role": "user", "content": user_text.strip()})
                state.engine.chat_history.append({"role": "assistant", "content": reply})
                provider_meta = None
            else:
                is_fu = bool(source._has_followed_up_current_primary and action.mode in ("recovery", "clarify"))
                logger.info(
                    "Take-Home %s %s/%s token=%s",
                    "follow-up" if is_fu else "question",
                    source._primary_questions_asked,
                    source.max_primary_questions,
                    state.candidate_token,
                )
                reply, provider_meta = await _reply(action, turn, user_text, intent)
        else:
            action = source.initial_action()
            logger.info(
                "Take-Home question 1/%s token=%s",
                source.max_primary_questions,
                state.candidate_token,
            )
            reply, provider_meta = await _reply(action, turn, "", None)

        if action.mode == "closing":
            source.mark_closing_done()

        source.record_question(reply)
        if user_text.strip():
            state.last_processed_user_text = user_text.strip()
        state.last_spoken_reply = reply
        if audit is not None:
            if turn > 1 and audit.turns:
                prev_turn = audit.turns[-1]
                prev_turn.candidate_reply = user_text
                if intent and prev_turn.intent_label != "OPENING":
                    prev_turn.intent_label = intent
                elif prev_turn.intent_label == "PENDING":
                    prev_turn.intent_label = intent or "UNKNOWN"
            audit.record_turn(
                turn_index=turn,
                topic_domain=topic_domain,
                level="MID",
                question_asked=reply,
                candidate_reply="",
                intent_label="CLOSING" if action.mode == "closing" else ("OPENING" if turn == 1 else "PENDING"),
                confidence_delta=0,
                provider_meta=provider_meta,
                action_mode=action.mode,
                resume_tech=topic_domain,
                strike_count=0,
                tech_index=0,
                concept_tested=topic_domain,
                understanding_level="",
                internal_score_10=None,
                evidence="",
                forced_override_reason=None,
                stt_mitigation_applied=False,
            )
        if turn > 1:
            state.last_reply_latency_ms = int((time.monotonic() - reply_started) * 1000)
        _schedule_chat_sync(state, turn_index=turn, user_text=user_text if turn > 1 else None)
        source.advance_turn()
        _end_conversational_if_needed(state, action, source)
        return reply


async def process_hr_turn(
    state: InterviewSessionState,
    *,
    user_text: str,
    confidence: float = 1.0,
) -> str:
    return await _process_orchestrated_turn(state, user_text=user_text, confidence=confidence)


class IntroOrchestratorLLM(LLM):
    def __init__(self, state: InterviewSessionState) -> None:
        super().__init__()
        self._state = state

    @property
    def model(self) -> str:
        return "interview-orchestrator"

    @property
    def provider(self) -> str:
        return "custom"

    def chat(
        self,
        *,
        chat_ctx: llm.ChatContext,
        tools: list[llm.Tool] | None = None,
        conn_options: NotGivenOr[APIConnectOptions] = NOT_GIVEN,
        parallel_tool_calls: NotGivenOr[bool] = NOT_GIVEN,
        tool_choice: NotGivenOr[llm.ToolChoice] = NOT_GIVEN,
        extra_kwargs: NotGivenOr[dict[str, Any]] = NOT_GIVEN,
    ) -> LLMStream:
        return IntroOrchestratorLLMStream(
            self,
            chat_ctx=chat_ctx,
            tools=tools or [],
            conn_options=conn_options if conn_options is not NOT_GIVEN else DEFAULT_API_CONNECT_OPTIONS,  # type: ignore
        )


class IntroOrchestratorLLMStream(LLMStream):
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

        if state.assessment.should_run_closing_llm():
            reply = await process_closing_turn(state)
            if reply:
                self._event_ch.send_nowait(
                    ChatChunk(
                        id=utils.shortuuid("chunk_"),
                        delta=ChoiceDelta(role="assistant", content=reply),
                    ),
                )
            return

        if not state.assessment.should_run_llm():
            return

        user_msg = _last_user_message(self._chat_ctx)
        user_text = (user_msg.text_content or "").strip() if user_msg else ""
        confidence = 1.0
        if user_msg and user_msg.transcript_confidence is not None:
            confidence = user_msg.transcript_confidence

        reply = await process_intro_turn(state, user_text=user_text, confidence=confidence)
        self._event_ch.send_nowait(
            ChatChunk(
                id=utils.shortuuid("chunk_"),
                delta=ChoiceDelta(role="assistant", content=reply),
            ),
        )


class HrInterviewLLM(LLM):
    def __init__(self, state: InterviewSessionState) -> None:
        super().__init__()
        self._state = state

    @property
    def model(self) -> str:
        return "hr-interview"

    @property
    def provider(self) -> str:
        return "custom"

    def chat(
        self,
        *,
        chat_ctx: llm.ChatContext,
        tools: list[llm.Tool] | None = None,
        conn_options: NotGivenOr[APIConnectOptions] = NOT_GIVEN,
        parallel_tool_calls: NotGivenOr[bool] = NOT_GIVEN,
        tool_choice: NotGivenOr[llm.ToolChoice] = NOT_GIVEN,
        extra_kwargs: NotGivenOr[dict[str, Any]] = NOT_GIVEN,
    ) -> LLMStream:
        return HrInterviewLLMStream(
            self,
            chat_ctx=chat_ctx,
            tools=tools or [],
            conn_options=conn_options if conn_options is not NOT_GIVEN else DEFAULT_API_CONNECT_OPTIONS,  # type: ignore
        )


class HrInterviewLLMStream(LLMStream):
    async def _run(self) -> None:
        state = self._llm._state
        user_msg = _last_user_message(self._chat_ctx)
        user_text = (user_msg.text_content or "").strip() if user_msg else ""
        confidence = 1.0
        if user_msg and user_msg.transcript_confidence is not None:
            confidence = user_msg.transcript_confidence
        reply = await process_hr_turn(state, user_text=user_text, confidence=confidence)
        self._event_ch.send_nowait(
            ChatChunk(
                id=utils.shortuuid("chunk_"),
                delta=ChoiceDelta(role="assistant", content=reply),
            ),
        )


def agent_instructions(phase: Phase, tech_stack: str) -> str:
    if phase == "hr_verbal":
        return HR_VERBAL_SYSTEM_PROMPT
    return f"{INTRO_VERBAL_SYSTEM_PROMPT}\nTech stack: {tech_stack}."
