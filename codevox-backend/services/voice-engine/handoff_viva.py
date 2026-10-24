"""HTTP handoff helpers for student viva NestJS coordinator."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger("handoff-viva")

NEST_CALLBACK_URL = os.getenv("NESTJS_CALLBACK_URL", "http://localhost:3000").rstrip("/")
SERVICE_KEY = os.getenv("AUTONOMOUS_INTERVIEW_SERVICE_KEY", "")


def _headers() -> dict[str, str]:
    headers: dict[str, str] = {}
    if SERVICE_KEY:
        headers["x-service-key"] = SERVICE_KEY
    return headers


async def fetch_viva_session_language(viva_token: str) -> str | None:
    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.get(
            f"{NEST_CALLBACK_URL}/api/student-viva/session/{viva_token}",
            headers=_headers(),
        )
        res.raise_for_status()
        payload = res.json()
        data = payload.get("data") if isinstance(payload, dict) else payload
        if isinstance(data, dict):
            lang = data.get("languagePreference") or data.get("language_preference")
            if isinstance(lang, str) and lang.strip():
                return lang.strip()
    return None


async def post_viva_chat_sync(
    viva_token: str,
    *,
    chat_history: list[dict[str, Any]] | None = None,
    phase: str | None = None,
    turn_index: int | None = None,
    question_kind: str | None = None,
    question_id: str | None = None,
    topic: str | None = None,
    difficulty: str | None = None,
    weight: int | None = None,
    prompt_text: str | None = None,
    action_mode: str | None = None,
    follow_up_hints: list[str] | None = None,
    spoken_text: str | None = None,
    voice_resume_state: dict[str, Any] | None = None,
    reply_latency_ms: int | None = None,
    stt_confidence: float | None = None,
    live_rubric_turn: dict[str, Any] | None = None,
) -> None:
    body: dict[str, Any] = {"viva_token": viva_token}
    if chat_history is not None:
        body["chat_history"] = chat_history
    if phase:
        body["phase"] = phase
    if turn_index is not None:
        body["turn_index"] = turn_index
    if question_kind:
        body["question_kind"] = question_kind
    if question_id:
        body["question_id"] = question_id
    if topic:
        body["topic"] = topic
    if difficulty:
        body["difficulty"] = difficulty
    if weight is not None:
        body["weight"] = weight
    if prompt_text:
        body["prompt_text"] = prompt_text
    if action_mode:
        body["action_mode"] = action_mode
    if follow_up_hints:
        body["follow_up_hints"] = follow_up_hints
    if spoken_text:
        body["spoken_text"] = spoken_text
    if voice_resume_state is not None:
        body["voice_resume_state"] = voice_resume_state
    if reply_latency_ms is not None:
        body["reply_latency_ms"] = reply_latency_ms
    if stt_confidence is not None:
        body["stt_confidence"] = stt_confidence
    if live_rubric_turn is not None:
        body["live_rubric_turn"] = live_rubric_turn
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.post(
            f"{NEST_CALLBACK_URL}/api/student-viva/voice-chat-sync",
            json=body,
            headers=_headers(),
        )
        res.raise_for_status()


async def fetch_viva_proctor_events(viva_token: str) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.get(
            f"{NEST_CALLBACK_URL}/api/student-viva/proctor-events/{viva_token}",
            headers=_headers(),
        )
        res.raise_for_status()
        payload = res.json()
        data = payload.get("data") if isinstance(payload, dict) else payload
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and isinstance(data.get("events"), list):
            return data["events"]
        return []


async def post_viva_oral_results(
    viva_token: str,
    *,
    rubric_scores: dict[str, Any] | None = None,
    final_grade: str | None = None,
    stage_chat_history: list[dict[str, Any]] | None = None,
) -> None:
    body: dict[str, Any] = {"viva_token": viva_token}
    if rubric_scores is not None:
        body["rubric_scores"] = rubric_scores
    if final_grade:
        body["final_grade"] = final_grade
    if stage_chat_history is not None:
        body["stage_chat_history"] = stage_chat_history
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.post(
            f"{NEST_CALLBACK_URL}/api/student-viva/save-oral-results",
            json=body,
            headers=_headers(),
        )
        res.raise_for_status()


async def post_viva_llm_audit_sync(
    viva_token: str,
    *,
    llm_calls: list[dict[str, Any]] | None = None,
    llm_degradation_events: list[dict[str, Any]] | None = None,
    intended_llm_model: str | None = None,
) -> None:
    body: dict[str, Any] = {"viva_token": viva_token}
    if llm_calls:
        body["llm_calls"] = llm_calls
    if llm_degradation_events:
        body["llm_degradation_events"] = llm_degradation_events
    if intended_llm_model:
        body["intended_llm_model"] = intended_llm_model
    if len(body) <= 1:
        return
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.post(
            f"{NEST_CALLBACK_URL}/api/student-viva/llm-audit-sync",
            json=body,
            headers=_headers(),
        )
        res.raise_for_status()


async def post_viva_complete(
    viva_token: str,
    *,
    final_grade: str | None = None,
    rubric_scores: dict[str, Any] | None = None,
    stage_chat_history: list[dict[str, Any]] | None = None,
) -> None:
    body: dict[str, Any] = {"viva_token": viva_token}
    if final_grade:
        body["final_grade"] = final_grade
    if rubric_scores is not None:
        body["rubric_scores"] = rubric_scores
    if stage_chat_history is not None:
        body["stage_chat_history"] = stage_chat_history
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.post(
            f"{NEST_CALLBACK_URL}/api/student-viva/complete",
            json=body,
            headers=_headers(),
        )
        res.raise_for_status()
