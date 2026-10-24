"""Viva session state container."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

from livekit.agents import AgentSession
from llm_engine import LlmEngine
from llm_call_ledger import LlmCallLedger
from question_sources.viva import VivaQuestionSource
from session_audit import SessionAuditLedger
from session_config.types import AgentRuntimeConfig


@dataclass
class VivaSessionState:
    viva_token: str
    course_code: str
    question_mode: str
    engine: LlmEngine
    question_source: VivaQuestionSource
    runtime: AgentRuntimeConfig
    student_name: str | None = None
    project_title: str | None = None
    project_summary: str | None = None
    syllabus_ref: str | None = None
    panel_mode: str = "ai_sole"
    rubric_criteria: list[dict] = field(default_factory=list)
    audit: SessionAuditLedger | None = None
    session: AgentSession | None = None
    completion_event: asyncio.Event = field(default_factory=asyncio.Event)
    turn_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    opening_reply: str | None = None
    fixed_tts_reply: str | None = None
    candidate_left: bool = False
    oral_completed: bool = False
    closing_delivered: bool = False
    final_grade: str | None = None
    rubric_scores: dict[str, Any] | None = None
    oral_audit_payload: dict[str, Any] | None = None
    last_reply_latency_ms: int | None = None
    paused: bool = False
    paused_event: asyncio.Event = field(default_factory=asyncio.Event)
    injected_queue: list[dict] = field(default_factory=list)
    reconnect_grace_sec: int = 90
    disconnect_timer: asyncio.Task | None = None
    disconnect_debounce_task: asyncio.Task | None = None
    last_bank_entry: dict | None = None
    human_takeover: bool = False
    skip_pending: bool = False
    examiner_speaking: bool = False
    pending_language: str | None = None
    takeover_event: asyncio.Event = field(default_factory=asyncio.Event)
    active_language: str | None = None
    http_session: Any | None = None
    llm_ledger: LlmCallLedger | None = None
    take_home_verification_enabled: bool = False
    take_home_payload: dict | None = None
    take_home_phase_active: bool = False
    accumulated_rubric_notes: list[dict] = field(default_factory=list)
