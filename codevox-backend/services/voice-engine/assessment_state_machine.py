"""In-room assessment phase state machine for unified LiveKit interviews."""

from __future__ import annotations

import asyncio
import enum
from dataclasses import dataclass, field
from typing import Any, Literal

ClosingReason = Literal[
    "assessment_complete",
    "screen_unsubscribed",
    "end_interview",
]


class AssessmentSessionPhase(enum.Enum):
    CONVERSATIONAL = "conversational"
    PRE_ASSESSMENT = "pre_assessment"
    ASSESSMENT_ACTIVE = "assessment_active"
    CLOSING = "closing"


@dataclass
class AssessmentSessionContext:
    phase: AssessmentSessionPhase = AssessmentSessionPhase.CONVERSATIONAL
    llm_suspended: bool = False
    is_video_on: bool = False
    is_muted: bool = False
    is_screen_sharing: bool = False
    resume_skills: list[str] = field(default_factory=list)
    resume_alignment: dict[str, Any] | None = None
    code_quality_score: int | None = None
    architectural_flaws: list[str] = field(default_factory=list)
    closing_reason: ClosingReason | None = None
    assessment_active_signaled: bool = False
    screen_share_reminder_sent: bool = False
    screen_share_ready_emitted: bool = False
    conversational_done_event: asyncio.Event = field(default_factory=asyncio.Event)
    screen_share_event: asyncio.Event = field(default_factory=asyncio.Event)
    coding_confirmed_event: asyncio.Event = field(default_factory=asyncio.Event)
    assessment_complete_event: asyncio.Event = field(default_factory=asyncio.Event)
    end_interview_event: asyncio.Event = field(default_factory=asyncio.Event)

    def should_run_llm(self) -> bool:
        return self.phase == AssessmentSessionPhase.CONVERSATIONAL and not self.llm_suspended

    def should_run_closing_llm(self) -> bool:
        return self.phase == AssessmentSessionPhase.CLOSING and not self.llm_suspended

    def enter_pre_assessment(self) -> None:
        self.phase = AssessmentSessionPhase.PRE_ASSESSMENT
        self.llm_suspended = True

    def enter_assessment_active(self) -> bool:
        if self.assessment_active_signaled:
            return False
        if not self.is_screen_sharing:
            return False
        self.assessment_active_signaled = True
        self.phase = AssessmentSessionPhase.ASSESSMENT_ACTIVE
        self.llm_suspended = True
        return True

    def enter_closing(self, reason: ClosingReason) -> None:
        self.phase = AssessmentSessionPhase.CLOSING
        self.closing_reason = reason
        self.llm_suspended = False

    def mark_screen_sharing(self, active: bool) -> None:
        self.is_screen_sharing = active
        if active:
            self.screen_share_event.set()

    def mark_video(self, on: bool) -> None:
        self.is_video_on = on

    def mark_muted(self, muted: bool) -> None:
        self.is_muted = muted

    def signal_assessment_complete(
        self,
        *,
        code_quality_score: int | None = None,
        architectural_flaws: list[str] | None = None,
    ) -> None:
        if code_quality_score is not None:
            self.code_quality_score = code_quality_score
        if architectural_flaws:
            self.architectural_flaws = list(architectural_flaws)
        self.assessment_complete_event.set()

    def signal_end_interview(self) -> None:
        self.end_interview_event.set()

    def signal_confirm_coding(self) -> None:
        self.coding_confirmed_event.set()
