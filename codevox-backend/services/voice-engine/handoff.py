"""HTTP handoff helpers to NestJS coordinator."""
from __future__ import annotations

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger("handoff")

NEST_CALLBACK_URL = os.getenv("NESTJS_CALLBACK_URL", "http://localhost:3000").rstrip("/")
SERVICE_KEY = os.getenv("AUTONOMOUS_INTERVIEW_SERVICE_KEY", "")


def _headers() -> dict[str, str]:
    headers: dict[str, str] = {}
    if SERVICE_KEY:
        headers["x-service-key"] = SERVICE_KEY
    return headers


async def post_save_intro_results(
    candidate_token: str,
    *,
    stage1_voice_score: int | None = None,
    stage1_chat_history: list[dict[str, Any]] | None = None,
    stage1_voice_audit: dict[str, Any] | None = None,
) -> None:
    body: dict[str, Any] = {"candidate_token": candidate_token}
    if stage1_voice_score is not None:
        body["stage1_voice_score"] = stage1_voice_score
    if stage1_chat_history is not None:
        body["stage1_chat_history"] = stage1_chat_history
    if stage1_voice_audit is not None:
        body["stage1_voice_audit"] = stage1_voice_audit
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.post(
            f"{NEST_CALLBACK_URL}/api/autonomous-interview/save-intro-results",
            json=body,
            headers=_headers(),
        )
        res.raise_for_status()
    logger.info("Saved intro results token=%s score=%s", candidate_token, stage1_voice_score)


async def post_screen_share_ready(candidate_token: str) -> None:
    body: dict[str, Any] = {"candidate_token": candidate_token}
    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.post(
            f"{NEST_CALLBACK_URL}/api/autonomous-interview/screen-share-ready",
            json=body,
            headers=_headers(),
        )
        res.raise_for_status()
    logger.info("Screen share ready notified token=%s", candidate_token)


async def post_assessment_active(
    candidate_token: str,
    *,
    stage1_voice_score: int | None = None,
    stage1_chat_history: list[dict[str, Any]] | None = None,
    stage1_voice_audit: dict[str, Any] | None = None,
) -> None:
    body: dict[str, Any] = {"candidate_token": candidate_token}
    if stage1_voice_score is not None:
        body["stage1_voice_score"] = stage1_voice_score
    if stage1_chat_history is not None:
        body["stage1_chat_history"] = stage1_chat_history
    if stage1_voice_audit is not None:
        body["stage1_voice_audit"] = stage1_voice_audit
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.post(
            f"{NEST_CALLBACK_URL}/api/autonomous-interview/assessment-active",
            json=body,
            headers=_headers(),
        )
        res.raise_for_status()
    logger.info("Assessment active (sandbox unlock) token=%s", candidate_token)


async def post_shift_to_sandbox(
    candidate_token: str,
    *,
    stage1_voice_score: int | None = None,
    stage1_chat_history: list[dict[str, Any]] | None = None,
    stage1_voice_audit: dict[str, Any] | None = None,
) -> None:
    body: dict[str, Any] = {"candidate_token": candidate_token}
    if stage1_voice_score is not None:
        body["stage1_voice_score"] = stage1_voice_score
    if stage1_chat_history is not None:
        body["stage1_chat_history"] = stage1_chat_history
    if stage1_voice_audit is not None:
        body["stage1_voice_audit"] = stage1_voice_audit
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.post(
            f"{NEST_CALLBACK_URL}/api/autonomous-interview/shift-to-sandbox",
            json=body,
            headers=_headers(),
        )
        res.raise_for_status()
    logger.info("Shifted to sandbox token=%s score=%s", candidate_token, stage1_voice_score)

async def post_interview_complete(
    candidate_token: str,
    *,
    stage1_voice_score: int | None = None,
    stage1_chat_history: list[dict[str, Any]] | None = None,
    stage1_voice_audit: dict[str, Any] | None = None,
) -> None:
    body: dict[str, Any] = {"candidate_token": candidate_token}
    if stage1_voice_score is not None:
        body["stage1_voice_score"] = stage1_voice_score
    if stage1_chat_history is not None:
        body["stage1_chat_history"] = stage1_chat_history
    if stage1_voice_audit is not None:
        body["stage1_voice_audit"] = stage1_voice_audit
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.post(
            f"{NEST_CALLBACK_URL}/api/autonomous-interview/complete",
            json=body,
            headers=_headers(),
        )
        res.raise_for_status()
    logger.info("Interview completed directly token=%s score=%s", candidate_token, stage1_voice_score)


async def post_screening_complete(
    candidate_token: str,
    *,
    transcript: list[dict[str, Any]],
    conversation_state: dict[str, Any],
    round_config: dict[str, Any] | None = None,
    job_profile_context: dict[str, Any] | None = None,
    ended_by: str | None = None,
    merge_to_verbal: bool = False,
) -> None:
    """Persist AI Screening conversation and trigger async analyzer on Nest."""
    body: dict[str, Any] = {
        "candidate_token": candidate_token,
        "transcript": transcript,
        "conversation_state": conversation_state,
        "round_config": round_config or {},
        "job_profile_context": job_profile_context or {},
    }
    if ended_by:
        body["ended_by"] = ended_by
    if merge_to_verbal:
        body["merge_to_verbal"] = True
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post(
            f"{NEST_CALLBACK_URL}/api/autonomous-interview/complete-screening",
            json=body,
            headers=_headers(),
        )
        res.raise_for_status()
    logger.info(
        "AI Screening completed token=%s turns=%s merge_to_verbal=%s",
        candidate_token,
        len(transcript),
        merge_to_verbal,
    )


async def post_leave_build(candidate_token: str) -> None:
    """Intentional Leave Build with no GitHub submission → Build 0, Defend skipped."""
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.post(
            f"{NEST_CALLBACK_URL}/api/project-interview/sessions/{candidate_token}/leave-build",
            json={"reason": "intentional_end"},
            headers=_headers(),
        )
        res.raise_for_status()
    logger.info("Build left without submission token=%s", candidate_token)


async def fetch_interview_proctor_events(candidate_token: str) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.get(
            f"{NEST_CALLBACK_URL}/api/autonomous-interview/proctor-events/{candidate_token}",
            headers=_headers(),
        )
        if res.status_code == 401:
            return []
        res.raise_for_status()
        payload = res.json()
        data = payload.get("data") if isinstance(payload, dict) else payload
        return data if isinstance(data, list) else []


async def post_voice_chat_sync(
    candidate_token: str,
    *,
    chat_history: list[dict[str, Any]],
    phase: str = "ai_verbal",
    turn_index: int | None = None,
    reply_latency_ms: int | None = None,
    stt_confidence: float | None = None,
    speech_start_delay_ms: int | None = None,
    utterance_duration_ms: int | None = None,
    user_text: str | None = None,
) -> None:
    body: dict[str, Any] = {
        "candidate_token": candidate_token,
        "chat_history": chat_history,
        "phase": phase,
    }
    if turn_index is not None:
        body["turn_index"] = turn_index
    if reply_latency_ms is not None:
        body["reply_latency_ms"] = reply_latency_ms
    if stt_confidence is not None:
        body["stt_confidence"] = stt_confidence
    if speech_start_delay_ms is not None:
        body["speech_start_delay_ms"] = speech_start_delay_ms
    if utterance_duration_ms is not None:
        body["utterance_duration_ms"] = utterance_duration_ms
    if user_text is not None:
        body["user_text"] = user_text
    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.post(
            f"{NEST_CALLBACK_URL}/api/autonomous-interview/voice-chat-sync",
            json=body,
            headers=_headers(),
        )
        res.raise_for_status()


async def post_defend_assessment_started(candidate_token: str) -> None:
    """Tell Nest to send the candidate to the assessing page. Does not score or finish the round."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.post(
            f"{NEST_CALLBACK_URL}/api/autonomous-interview/defend-assessment-started",
            json={"candidate_token": candidate_token},
            headers=_headers(),
        )
        res.raise_for_status()
    logger.info("Defend assessment page opened token=%s", candidate_token)


async def post_complete(
    candidate_token: str,
    *,
    stage1_voice_score: int | None = None,
    stage1_chat_history: list[dict[str, Any]] | None = None,
    stage1_voice_audit: dict[str, Any] | None = None,
    stage3_chat_history: list[dict[str, Any]] | None = None,
    final_decision: str = "UNDER_REVIEW",
    hr_voice_audit: dict[str, Any] | None = None,
    ended_by: str | None = None,
) -> None:
    body: dict[str, Any] = {
        "candidate_token": candidate_token,
        "final_decision": final_decision,
    }
    if ended_by:
        body["ended_by"] = ended_by
    if stage1_voice_score is not None:
        body["stage1_voice_score"] = stage1_voice_score
    if stage1_chat_history is not None:
        body["stage1_chat_history"] = stage1_chat_history
    if stage1_voice_audit is not None:
        body["stage1_voice_audit"] = stage1_voice_audit
    if stage3_chat_history is not None:
        body["stage3_chat_history"] = stage3_chat_history
    if hr_voice_audit is not None:
        body["hr_voice_audit"] = hr_voice_audit
    async with httpx.AsyncClient(timeout=60.0) as client:
        res = await client.post(
            f"{NEST_CALLBACK_URL}/api/autonomous-interview/complete",
            json=body,
            headers=_headers(),
        )
        res.raise_for_status()
    logger.info("Interview complete token=%s", candidate_token)
