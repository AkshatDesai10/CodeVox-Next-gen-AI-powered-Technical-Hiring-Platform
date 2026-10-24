"""Viva orchestrator LLM adapter and turn processing."""

from __future__ import annotations

import json
import logging
import re
import time
import asyncio
from typing import Any

from livekit.agents import llm, utils
from livekit.agents.llm.llm import ChatChunk, ChoiceDelta, LLM, LLMStream
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS, NOT_GIVEN, APIConnectOptions, NotGivenOr
from prompts_viva import VIVA_CLOSING_SCRIPT, build_viva_question_prompt
from provider_resilience import ProviderTurnMeta, sanitize_messages
from question_sources.viva import VIVA_MAX_TURNS
from reply_classifier import classify_reply_safe
from handoff_viva import post_viva_chat_sync
from llm_engine import MUFFLED_FIXED_REPLY, is_muffled
from topic_orchestrator import IntentTag, OrchestratorAction
from viva_session_state import VivaSessionState
from viva_speech_util import (
    build_icebreaker,
    build_recovery_reply,
    first_spoken_question,
    is_repeat_request,
)
from viva_language_util import (
    localize_examiner_text,
    requires_localization,
    text_looks_localized,
)

logger = logging.getLogger("viva-orchestrator-llm")

_EMPTY_STT_REPLY = "I did not catch that clearly. Could you repeat your answer?"


def _last_user_message(chat_ctx: llm.ChatContext) -> llm.ChatMessage | None:
    for item in reversed(chat_ctx.items):
        if isinstance(item, llm.ChatMessage) and item.role == "user":
            return item
    return None


def _grade_from_rubric(
    state: VivaSessionState,
    notes: list[dict],
) -> tuple[str, dict[str, Any]]:
    criteria = state.rubric_criteria or []
    
    # Separate normal notes from take_home notes
    normal_notes = [n for n in notes if n.get("topic") != "take_home_verification"]
    take_home_notes = [n for n in notes if n.get("topic") == "take_home_verification"]
    
    # --- 1. Compute Normal Interview Score ---
    if not normal_notes:
        normal_avg = 6.0
    else:
        normal_scores = [int(n.get("score", 5)) for n in normal_notes]
        normal_avg = sum(normal_scores) / len(normal_scores)
        
    criteria_marks: dict[str, float] = {}
    criteria_scores: dict[str, float] = {}
    
    if criteria:
        for idx, crit in enumerate(criteria):
            label = str(crit.get("label", f"Criterion {idx + 1}"))
            crit_id = str(crit.get("id", label))
            max_marks = float(crit.get("max_marks", 10) or 10)
            note = normal_notes[min(idx, len(normal_notes) - 1)] if normal_notes else {}
            score_10 = int(note.get("score", round(normal_avg)))
            scaled = round(max_marks * (score_10 / 10), 2)
            criteria_marks[crit_id] = scaled
            criteria_scores[label] = scaled
            
    normal_total = round(sum(criteria_marks.values()), 2)
    
    # --- 2. Compute Take-Home Score ---
    th_score = None
    take_home_weight_pct = 0.0
    if getattr(state, "take_home_verification_enabled", False):
        take_home_weight_pct = float(state.take_home_payload.get("take_home_weight_pct", 20)) if state.take_home_payload else 20.0
        
        if take_home_notes:
            th_raw_scores = [int(n.get("score", 0)) for n in take_home_notes]
            # Max possible for take-home is 3 per primary question
            max_possible = len(th_raw_scores) * 3
            if max_possible > 0:
                th_score = (sum(th_raw_scores) / max_possible) * 100
            else:
                th_score = 0.0
        else:
            th_score = 0.0 # Or maybe skip if no notes? Let's say 0 for safety.
            
    # --- 3. Compute Final Score ---
    # The normal rubrics are usually out of 100 or some base weight. 
    # If TH is 20%, we reduce the normal total proportionally and add the TH component.
    final_pct = 0.0
    if th_score is not None:
        # Scale normal_total to (100 - TH%)
        normal_weight = 100.0 - take_home_weight_pct
        # Assuming normal_total was out of 100, if not, we would need to scale it by sum(max_marks)
        sum_max_marks = sum(float(c.get("max_marks", 10)) for c in criteria) if criteria else 100.0
        if sum_max_marks == 0: sum_max_marks = 100.0
        
        normal_pct = (normal_total / sum_max_marks) * 100
        
        final_pct = (normal_pct * (normal_weight / 100.0)) + (th_score * (take_home_weight_pct / 100.0))
        final_avg = final_pct / 10.0 # Convert 100-scale to 10-scale for letter grades
    else:
        final_avg = normal_avg

    rubric = {
        "accuracy": min(10, max(1, round(normal_avg))),
        "depth": min(10, max(1, round(normal_avg - 0.5))),
        "communication": min(10, max(1, round(normal_avg))),
        "per_topic": notes,
        "criteria": criteria_scores,
        "criteria_marks": criteria_marks,
        "total_marks": normal_total,
    }
    
    if th_score is not None:
        rubric["take_home_verification_score"] = round(th_score, 2)
        rubric["take_home_concerns"] = [n for n in take_home_notes if n.get("concern")]
        rubric["final_combined_score_pct"] = round(final_pct, 2)

    if final_avg >= 8.5:
        return "A", rubric
    if final_avg >= 7:
        return "B", rubric
    if final_avg >= 5.5:
        return "C", rubric
    if final_avg >= 4:
        return "D", rubric
    return "F", rubric


async def _sync_chat(
    state: VivaSessionState,
    phase: str = "oral_exam",
    *,
    turn_index: int | None = None,
    question_kind: str | None = None,
    reply_latency_ms: int | None = None,
    stt_confidence: float | None = None,
    sync_meta: dict | None = None,
) -> None:
    meta = sync_meta or {}
    try:
        body_kwargs: dict = {
            "viva_token": state.viva_token,
            "chat_history": state.engine.history_payload(),
            "phase": phase,
            "turn_index": turn_index,
            "question_kind": question_kind,
            "question_id": meta.get("question_id"),
            "topic": meta.get("topic"),
            "difficulty": meta.get("difficulty"),
            "weight": meta.get("weight"),
            "prompt_text": meta.get("prompt_text"),
            "action_mode": meta.get("action_mode"),
            "follow_up_hints": meta.get("follow_up_hints"),
            "spoken_text": meta.get("spoken_text"),
            "voice_resume_state": meta.get("voice_resume_state"),
            "reply_latency_ms": reply_latency_ms,
            "stt_confidence": stt_confidence,
        }
        if meta.get("live_rubric_turn"):
            body_kwargs["live_rubric_turn"] = meta["live_rubric_turn"]
        await post_viva_chat_sync(**body_kwargs)
        from viva_llm_sync import flush_llm_audit_to_nest

        await flush_llm_audit_to_nest(state)
    except Exception as exc:
        logger.warning("Viva chat sync failed token=%s: %s", state.viva_token, exc)


def _question_kind(action_mode: str) -> str:
    if action_mode in ("icebreaker", "ask", "recovery", "tech_pivot", "closing", "injected"):
        return action_mode
    return "follow_up"


def _build_sync_meta(state: VivaSessionState, action_mode: str) -> dict:
    source = state.question_source
    entry = source.current_bank_entry()
    return {
        "question_id": source.last_question_id,
        "topic": source._current_topic,
        "difficulty": entry.difficulty if entry else None,
        "weight": entry.weight if entry else None,
        "prompt_text": entry.prompt_text if entry else None,
        "action_mode": action_mode,
        "follow_up_hints": entry.follow_up_hints if entry else None,
        "voice_resume_state": {
            "chat_history": state.engine.history_payload(),
            "current_turn": source.current_turn,
            "asked_ids": sorted(source.asked_ids),
            "last_question_id": source.last_question_id,
            "opening_reply": state.opening_reply,
            "bank_index": source._bank_index,
            "covered_topics": source._covered_topics,
            "skipped_topics": source._skipped_topics,
        },
    }


def _append_candidate_turn(state: VivaSessionState, user_text: str) -> None:
    cleaned = user_text.strip()
    if not cleaned or cleaned == "[skipped]":
        return
    history = state.engine.chat_history
    if (
        history
        and history[-1].get("role") == "user"
        and history[-1].get("content") == cleaned
    ):
        return
    state.engine.chat_history.append({"role": "user", "content": cleaned})


async def _spoken_reply(state: VivaSessionState, text: str, *, from_llm: bool = False) -> str:
    """Normalize to one question and localize for the active session language."""
    del from_llm
    out = first_spoken_question(text.strip())
    if not out:
        return out
    if requires_localization(state.active_language) and not text_looks_localized(
        out, state.active_language
    ):
        out = await localize_examiner_text(state.engine, out, state.active_language)
    return out


async def _generate_viva_reply(
    state: VivaSessionState,
    *,
    user_text: str,
    action: OrchestratorAction,
    turn: int,
    intent: IntentTag | None,
) -> tuple[str, ProviderTurnMeta | None]:
    source = state.question_source

    if action.mode == "icebreaker":
        text = build_icebreaker(
            state.project_title,
            state.course_code,
            state.active_language,
        )
        text = await _spoken_reply(state, text)
        state.engine.chat_history.append({"role": "assistant", "content": text})
        return text, None

    bank_prompt = source.consume_pending_bank_prompt()
    if bank_prompt:
        text = await _spoken_reply(state, bank_prompt)
        state.engine.chat_history.append({"role": "assistant", "content": text})
        return text, None

    if action.mode == "recovery" and is_repeat_request(user_text) and source.last_question_asked:
        text = await _spoken_reply(state, source.last_question_asked)
        state.engine.chat_history.append({"role": "assistant", "content": text})
        return text, None

    if action.mode == "recovery":
        entry = source.current_bank_entry()
        hint = entry.follow_up_hints[0] if entry and entry.follow_up_hints else None
        text = build_recovery_reply(
            last_question=source.last_question_asked,
            topic=source._current_topic,
            follow_up_hint=hint,
            language=state.active_language,
        )
        text = await _spoken_reply(state, text)
        state.engine.chat_history.append({"role": "assistant", "content": text})
        return text, None

    if action.mode == "closing":
        text = await _spoken_reply(state, VIVA_CLOSING_SCRIPT)
        return text, None

    def _fallback_reply() -> str:
        entry = source.current_bank_entry()
        if entry and entry.prompt_text.strip():
            return source.personalize_bank_prompt(entry.prompt_text.strip())
        return "Could you elaborate on how you applied that concept in your project?"

    system = build_viva_question_prompt(
        course_code=state.course_code,
        topic=action.current_tech,
        question_mode=state.question_mode,
        turn=turn,
        max_turns=source.max_turns,
        project_title=state.project_title,
        project_summary=state.project_summary,
        syllabus_ref=state.syllabus_ref,
        language_preference=state.active_language,
        system_addon=action.system_addon,
    )
    messages: list[dict[str, str]] = [
        {"role": "system", "content": system},
        *sanitize_messages(state.engine.chat_history),
    ]
    if intent:
        messages.append(
            {"role": "system", "content": f"Candidate intent classified as {intent}."},
        )
    try:
        text, meta = await state.engine._complete(messages, temperature=0.5, max_tokens=120)
        if not text.strip():
            text = _fallback_reply()
            logger.warning(
                "Viva LLM empty reply token=%s turn=%s mode=%s — using fallback",
                state.viva_token,
                turn,
                action.mode,
            )
        text = await _spoken_reply(state, text, from_llm=True)
        state.engine.chat_history.append({"role": "assistant", "content": text})
        return text, meta
    except Exception as exc:
        logger.error("Viva LLM turn failed (%s)", exc)
        fallback = await _spoken_reply(state, _fallback_reply())
        state.engine.chat_history.append({"role": "assistant", "content": fallback})
        return fallback, None


async def _score_last_answer(state: VivaSessionState, question: str, answer: str) -> dict | None:
    if not answer.strip():
        return None
    source = state.question_source
    topic = source._current_topic
    
    if getattr(state, "take_home_phase_active", False):
        from question_sources.take_home_verification import TakeHomeVerificationSource
        if isinstance(source, TakeHomeVerificationSource):
            return await source.evaluate_answer(state.engine, question, answer)

    topic = source._current_topic
    try:
        rubric_lines = []
        for crit in state.rubric_criteria or []:
            label = str(crit.get("label", "Criterion"))
            max_marks = crit.get("max_marks", 10)
            desc = crit.get("description") or ""
            rubric_lines.append(f"- {label} (max {max_marks}): {desc}".strip())
        rubric_block = "\n".join(rubric_lines)
        project_block = ""
        if state.project_title:
            project_block = f"Student project: {state.project_title}. "
        if state.project_summary:
            project_block += f"Report context: {str(state.project_summary)[:600]}. "
        if state.syllabus_ref:
            project_block += f"Syllabus: {str(state.syllabus_ref)[:600]}. "
        prompt = (
            "Score this viva answer on a 1-10 scale for accuracy, depth, and communication. "
        )
        if rubric_block:
            prompt += (
                "Use the institutional oral-exam rubric criteria below when judging the answer:\n"
                f"{rubric_block}\n"
            )
        if project_block:
            prompt += f"Ground your judgement in the student's project and syllabus: {project_block}\n"
        prompt += 'Return JSON only: {"score": <int>, "note": "<short>"}'
        messages = [
            {"role": "system", "content": prompt},
            {
                "role": "user",
                "content": json.dumps({"question": question, "answer": answer, "topic": topic}),
            },
        ]
        raw, _meta = await state.engine._complete(
            messages,
            temperature=0.2,
            max_tokens=80,
            purpose="score",
        )
        parsed = json.loads(raw)
        score = int(parsed.get("score", 5))
        note = str(parsed.get("note", ""))
        source.record_answer_evaluation(topic, score, note)
        return {
            "turn_index": max(1, source.current_turn - 1),
            "topic": topic,
            "ai_score": score,
            "ai_note": note,
        }
    except Exception:
        source.record_answer_evaluation(topic, 5, "auto-scored")
        return {
            "turn_index": max(1, source.current_turn - 1),
            "topic": topic,
            "ai_score": 5,
            "ai_note": "auto-scored",
        }


async def _wait_for_examiner_idle(state: VivaSessionState) -> None:
    if state.panel_mode != "ai_co_questioner" or state.human_takeover:
        return
    while state.examiner_speaking:
        await asyncio.sleep(0.15)


async def _apply_skip_if_pending(state: VivaSessionState, source) -> str | None:
    if not state.skip_pending:
        return None
    state.skip_pending = False
    action = source.skip_to_next_question()
    reply, _ = await _generate_viva_reply(
        state,
        user_text="[skipped]",
        action=action,
        turn=source.current_turn,
        intent="SKIP",
    )
    source.record_question(reply)
    sync_meta = _build_sync_meta(state, "ask")
    sync_meta["spoken_text"] = reply
    await _sync_chat(
        state,
        turn_index=source.current_turn,
        question_kind="ask",
        sync_meta=sync_meta,
    )
    source.advance_turn()
    return reply


async def process_viva_turn(
    state: VivaSessionState,
    *,
    user_text: str,
    confidence: float = 1.0,
) -> str:
    source = state.question_source
    audit = state.audit

    async with state.turn_lock:
        from viva_language import apply_pending_language, refresh_session_language

        await refresh_session_language(state, http_session=state.http_session)
        await apply_pending_language(state, http_session=state.http_session)

        while state.paused and not state.skip_pending:
            state.paused_event.clear()
            await state.paused_event.wait()

        if state.human_takeover:
            skip_reply = await _apply_skip_if_pending(state, source)
            if skip_reply:
                return skip_reply
            return ""

        await _wait_for_examiner_idle(state)

        skip_reply = await _apply_skip_if_pending(state, source)
        if skip_reply:
            return skip_reply

        if state.injected_queue:
            injected = state.injected_queue.pop(0)
            reply = str(injected.get("text", "")).strip()
            if reply:
                state.engine.chat_history.append({"role": "assistant", "content": reply})
                source.record_question(reply)
                sync_meta = {
                    "topic": injected.get("topic") or source._current_topic,
                    "action_mode": "injected",
                    "spoken_text": reply,
                    "voice_resume_state": _build_sync_meta(state, "injected")["voice_resume_state"],
                }
                await _sync_chat(
                    state,
                    turn_index=source.current_turn,
                    question_kind="injected",
                    sync_meta=sync_meta,
                )
                return reply

        turn = source.current_turn
        reply_started = time.monotonic()
        if turn == 1 and not user_text.strip() and state.opening_reply is not None:
            return state.opening_reply

        if turn > 1 and not user_text.strip():
            logger.info(
                "Empty STT transcript turn=%s token=%s confidence=%.2f",
                turn,
                state.viva_token,
                confidence,
            )
            if is_muffled(user_text, confidence):
                return MUFFLED_FIXED_REPLY
            return _EMPTY_STT_REPLY

        if turn > 1 and is_repeat_request(user_text) and source.last_question_asked:
            _append_candidate_turn(state, user_text)
            reply = await _spoken_reply(state, source.last_question_asked)
            source.record_question(reply)
            if audit is not None:
                audit.record_turn(
                    turn_index=turn,
                    topic_domain=source._current_topic,
                    level="MID",
                    question_asked=reply,
                    candidate_reply=user_text,
                    intent_label="REPEAT",
                    confidence_delta=0,
                    provider_meta=None,
                    action_mode="recovery",
                    resume_tech=source._current_topic,
                    strike_count=0,
                    tech_index=0,
                )
                audit.sync_topics(source.covered_topics, source.skipped_topics)
            sync_meta = _build_sync_meta(state, "recovery")
            sync_meta["spoken_text"] = reply
            await _sync_chat(
                state,
                turn_index=turn,
                question_kind="follow_up",
                reply_latency_ms=getattr(state, "last_reply_latency_ms", None),
                stt_confidence=confidence,
                sync_meta=sync_meta,
            )
            return reply

        intent: IntentTag | None = None
        confidence_delta = 0
        rubric_turn: dict | None = None
        if turn > 1:
            if is_muffled(user_text, confidence):
                return MUFFLED_FIXED_REPLY
            _append_candidate_turn(state, user_text)
            intent, confidence_delta = await classify_reply_safe(
                state.engine._client,
                user_text,
                topic=source._current_topic,
                question_asked=source.last_question_asked,
                confidence=confidence,
            )
            action = source.apply(intent, confidence_delta)
            reply, provider_meta = await _generate_viva_reply(
                state,
                user_text=user_text,
                action=action,
                turn=turn,
                intent=intent,
            )
            rubric_turn = await _score_last_answer(state, source.last_question_asked, user_text)
        else:
            action = source.initial_action()
            reply, provider_meta = await _generate_viva_reply(
                state,
                user_text="",
                action=action,
                turn=turn,
                intent=None,
            )
            rubric_turn = None

        if action.mode == "closing":
            source.mark_closing_done()

        source.record_question(reply)
        if audit is not None:
            audit.record_turn(
                turn_index=turn,
                topic_domain=source._current_topic,
                level="MID",
                question_asked=reply,
                candidate_reply=user_text if turn > 1 else "",
                intent_label=intent or ("OPENING" if turn == 1 else "UNKNOWN"),
                confidence_delta=confidence_delta,
                provider_meta=provider_meta,
                action_mode=action.mode,
                resume_tech=source._current_topic,
                strike_count=0,
                tech_index=0,
            )
            audit.sync_topics(source.covered_topics, source.skipped_topics)
        if turn > 1:
            state.last_reply_latency_ms = int((time.monotonic() - reply_started) * 1000)
        sync_meta = _build_sync_meta(state, action.mode)
        sync_meta["spoken_text"] = reply
        if rubric_turn:
            sync_meta["live_rubric_turn"] = rubric_turn
        await _sync_chat(
            state,
            turn_index=turn,
            question_kind=_question_kind(action.mode),
            reply_latency_ms=getattr(state, "last_reply_latency_ms", None),
            stt_confidence=confidence if turn > 1 else None,
            sync_meta=sync_meta,
        )
        source.advance_turn()
        if turn == 1:
            state.opening_reply = reply
        if not source.should_continue():
            if getattr(state, "take_home_verification_enabled", False) and not getattr(state, "take_home_phase_active", False):
                if not getattr(state, "take_home_payload", None):
                    logger.warning("Take-Home Verification enabled but payload missing. Skipping phase token=%s", state.viva_token)
                    state.oral_completed = True
                    state.completion_event.set()
                else:
                    # Transition to take home phase
                    state.take_home_phase_active = True
                    state.accumulated_rubric_notes.extend(getattr(source, "rubric_notes", []))
                    from question_sources.take_home_verification import TakeHomeVerificationSource
                    # Set up the new source for the next turn
                    state.question_source = TakeHomeVerificationSource( # type: ignore
                        take_home_payload=state.take_home_payload or {},
                        project_title=state.project_title,
                        language_preference=state.active_language,
                    )
                    logger.info("Transitioning to Take-Home Verification Phase token=%s", state.viva_token)
            else:
                state.oral_completed = True
                state.completion_event.set()
        return reply


class VivaOrchestratorLLM(LLM):
    def __init__(self, state: VivaSessionState) -> None:
        super().__init__()
        self._state = state

    @property
    def model(self) -> str:
        return "viva-orchestrator"

    @property
    def provider(self) -> str:
        return "custom"

    def chat(
        self,
        *,
        chat_ctx: llm.ChatContext,
        tools: list[llm.Tool] | None = None,
        conn_options: APIConnectOptions = NOT_GIVEN, # type: ignore
        parallel_tool_calls: NotGivenOr[bool] = NOT_GIVEN,
        tool_choice: NotGivenOr[llm.ToolChoice] = NOT_GIVEN,
        extra_kwargs: NotGivenOr[dict[str, Any]] = NOT_GIVEN,
    ) -> LLMStream:
        return VivaOrchestratorLLMStream(
            self,
            chat_ctx=chat_ctx,
            tools=tools or [],
            conn_options=conn_options if conn_options is not NOT_GIVEN else DEFAULT_API_CONNECT_OPTIONS,
        )


class VivaOrchestratorLLMStream(LLMStream):
    async def _run(self) -> None:
        state = self._llm._state # type: ignore
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

        user_msg = _last_user_message(self.chat_ctx)
        user_text = (user_msg.text_content or "").strip() if user_msg else ""
        confidence = 1.0
        if user_msg and user_msg.transcript_confidence is not None:
            confidence = user_msg.transcript_confidence

        logger.info(
            "Viva turn STT token=%s turn=%s chars=%s confidence=%.2f",
            state.viva_token,
            state.question_source.current_turn,
            len(user_text),
            confidence,
        )

        try:
            reply = await process_viva_turn(
                state,
                user_text=user_text,
                confidence=confidence,
            )
        except Exception as exc:
            logger.exception("Viva turn processing failed token=%s: %s", state.viva_token, exc)
            reply = _EMPTY_STT_REPLY

        if not reply.strip():
            return

        self._event_ch.send_nowait(
            ChatChunk(
                id=utils.shortuuid("chunk_"),
                delta=ChoiceDelta(role="assistant", content=reply),
            ),
        )
