"""InterviewPlanner — coverage, budgets, proposal validation, rejection handling."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from behavioural.schemas import (
    BehaviouralRoundConfig,
    FALLBACK_BY_EVIDENCE,
    QuestionAsk,
    Track,
)


@dataclass
class PlannerState:
    phase: str = "eligibility"  # eligibility | profile | behavioral | informational | done
    total_questions_used: int = 0
    proposal_retries: int = 0
    covered_topics: list[str] = field(default_factory=list)
    eligibility_idx: int = 0
    profile_idx: int = 0
    informational_idx: int = 0
    competency_idx: int = 0
    active_competency_id: str | None = None
    cv_hooks_used: list[str] = field(default_factory=list)


class InterviewPlanner:
    def __init__(self, config: BehaviouralRoundConfig) -> None:
        self.config = config
        self.state = PlannerState()
        self._eligibility = [q for q in config.screening_questions if q.category == "eligibility"]
        self._profile = [q for q in config.screening_questions if q.category == "background"]
        self._informational = [
            q
            for q in config.screening_questions
            if q.category in ("informational", "compensation")
        ]

    def over_budget(self) -> bool:
        return self.state.total_questions_used >= self.config.interview_limits.max_total_questions

    def advance_phase_if_needed(self) -> None:
        st = self.state
        if st.phase == "eligibility" and st.eligibility_idx >= len(self._eligibility):
            st.phase = "profile"
        if st.phase == "profile" and st.profile_idx >= len(self._profile):
            st.phase = "behavioral"
        if st.phase == "behavioral" and st.competency_idx >= len(self.config.competencies):
            st.phase = "informational"
        if st.phase == "informational" and st.informational_idx >= len(self._informational):
            st.phase = "done"

    def current_track(self) -> Track | None:
        self.advance_phase_if_needed()
        return {
            "eligibility": "eligibility",
            "profile": "profile",
            "behavioral": "behavioral",
            "informational": "informational",
            "done": None,
        }.get(self.state.phase)  # type: ignore[return-value]

    def next_screening_slot(self) -> tuple[str, Any] | None:
        self.advance_phase_if_needed()
        st = self.state
        if st.phase == "eligibility" and st.eligibility_idx < len(self._eligibility):
            q = self._eligibility[st.eligibility_idx]
            return ("eligibility", q)
        if st.phase == "profile" and st.profile_idx < len(self._profile):
            q = self._profile[st.profile_idx]
            return ("profile", q)
        if st.phase == "informational" and st.informational_idx < len(self._informational):
            q = self._informational[st.informational_idx]
            return ("informational", q)
        return None

    def current_competency(self):
        if self.state.competency_idx >= len(self.config.competencies):
            return None
        return self.config.competencies[self.state.competency_idx]

    def mark_screening_done(self, track: str) -> None:
        if track == "eligibility":
            self.state.eligibility_idx += 1
        elif track == "profile":
            self.state.profile_idx += 1
        elif track == "informational":
            self.state.informational_idx += 1
        self.advance_phase_if_needed()

    def mark_competency_done(self) -> None:
        self.state.competency_idx += 1
        self.state.active_competency_id = None
        self.advance_phase_if_needed()

    def validate_proposal(self, proposal: QuestionAsk) -> list[str]:
        errors: list[str] = []
        if not (proposal.text or "").strip():
            errors.append("empty_text")
        if self.over_budget():
            errors.append("over_budget")
        track = self.current_track()
        if track and proposal.track != track and proposal.type != "followup":
            # allow followups on behavioral while in behavioral
            if not (track == "behavioral" and proposal.track == "behavioral"):
                errors.append("wrong_phase")
        topic_key = (proposal.text or "").strip().lower()[:80]
        if topic_key and topic_key in self.state.covered_topics:
            errors.append("redundant")
        if proposal.track == "behavioral":
            comp = self.current_competency()
            if comp and proposal.competency_id and proposal.competency_id != comp.competency_id:
                errors.append("wrong_competency")
        if proposal.resume_anchor and proposal.resume_anchor in self.state.cv_hooks_used:
            if not proposal.is_followup:
                errors.append("cv_hook_reuse")
        return errors

    def handle_rejection(
        self,
        proposal: QuestionAsk,
        errors: list[str],
        *,
        gaps: list[str],
        regenerate_fn,
    ) -> QuestionAsk | None:
        """
        PROPOSE → VALIDATE → REPROMPT once → FALLBACK template → None (caller SKIP_GAP).
        """
        if self.state.proposal_retries < 1:
            self.state.proposal_retries += 1
            retry = regenerate_fn(errors)
            if retry:
                errs2 = self.validate_proposal(retry)
                if not errs2:
                    self.state.proposal_retries = 0
                    return retry
        # Fallback template
        for gid in gaps:
            text = FALLBACK_BY_EVIDENCE.get(gid)
            if text:
                self.state.proposal_retries = 0
                return QuestionAsk(
                    question_id=f"fb_{gid}_{self.state.total_questions_used}",
                    text=text,
                    track="behavioral",
                    type="followup",
                    competency_id=proposal.competency_id,
                    targets_evidence=[gid],
                    is_followup=True,
                    parent_question_id=proposal.question_id,
                )
        self.state.proposal_retries = 0
        return None

    def commit_ask(self, ask: QuestionAsk) -> None:
        self.state.total_questions_used += 1
        self.state.proposal_retries = 0
        topic_key = (ask.text or "").strip().lower()[:80]
        if topic_key:
            self.state.covered_topics.append(topic_key)
        if ask.resume_anchor:
            self.state.cv_hooks_used.append(ask.resume_anchor)
        if ask.competency_id:
            self.state.active_competency_id = ask.competency_id

    def snapshot(self) -> dict[str, Any]:
        return {
            "phase": self.state.phase,
            "total_questions_used": self.state.total_questions_used,
            "max_total_questions": self.config.interview_limits.max_total_questions,
            "active_competency_id": self.state.active_competency_id,
            "covered_topics": list(self.state.covered_topics)[-20:],
            "remaining_competency_ids": [
                c.competency_id for c in self.config.competencies[self.state.competency_idx :]
            ],
        }
