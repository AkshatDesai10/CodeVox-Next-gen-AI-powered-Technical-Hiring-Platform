"""HR/candidate question source — thin facade over TopicOrchestrator."""

from __future__ import annotations

from typing import Any

from topic_orchestrator import IntentTag, OrchestratorAction, TopicOrchestrator


class HrQuestionSource:
    def __init__(self, orchestrator: TopicOrchestrator) -> None:
        self._orchestrator = orchestrator

    def initial_action(self) -> OrchestratorAction:
        return self._orchestrator.initial_action()

    def apply(self, intent: IntentTag, confidence_delta: int) -> OrchestratorAction:
        return self._orchestrator.apply(intent, confidence_delta)

    def apply_brain_decision(self, decision: Any, eval_res: Any) -> OrchestratorAction:
        return self._orchestrator.apply_brain_decision(decision, eval_res)

    def record_question(self, question: str) -> None:
        self._orchestrator.record_question(question)

    def should_continue(self) -> bool:
        return self._orchestrator.should_continue()

    def advance_turn(self, question_rubric: str | None = None) -> None:
        self._orchestrator.advance_turn(question_rubric=question_rubric)

    def finalize(self) -> dict:
        self._orchestrator.sync_topic_lists()
        pool = self._orchestrator.tech_pool
        alignment = pool.finalize_alignment() if pool else {}
        return {
            "resume_alignment": alignment,
            "covered_topics": list(self._orchestrator.covered_topics),
            "skipped_topics": list(self._orchestrator.skipped_topics),
        }

    @property
    def current_turn(self) -> int:
        return self._orchestrator.current_turn

    @property
    def last_question_asked(self) -> str:
        return self._orchestrator.last_question_asked

    def mark_closing_done(self) -> None:
        self._orchestrator.mark_closing_done()

    def in_closing_window(self) -> bool:
        return self._orchestrator.in_closing_window()

    @property
    def closing_handshake_done(self) -> bool:
        return self._orchestrator.closing_handshake_done

    def sync_topic_lists(self) -> None:
        self._orchestrator.sync_topic_lists()

    @property
    def covered_topics(self) -> list[str]:
        return self._orchestrator.covered_topics

    @property
    def skipped_topics(self) -> list[str]:
        return self._orchestrator.skipped_topics

    @property
    def orchestrator(self) -> TopicOrchestrator:
        return self._orchestrator
