"""Placeholder implementation for Viva question source."""

from dataclasses import dataclass, field
from question_sources.base import QuestionSource
from topic_orchestrator import IntentTag, OrchestratorAction


@dataclass
class VivaQuestionBankEntry:
    id: str
    topic: str
    prompt_text: str
    follow_up_hints: list[str] = field(default_factory=list)


class VivaQuestionSource(QuestionSource):
    def __init__(
        self,
        course_code: str = "GENERAL",
        question_mode: str = "hybrid",
        project_title: str | None = None,
        thesis_ref: str | None = None,
        syllabus_ref: str | None = None,
        bank: list[VivaQuestionBankEntry] | None = None,
    ):
        self.course_code = course_code
        self.question_mode = question_mode
        self.project_title = project_title
        self.thesis_ref = thesis_ref
        self.syllabus_ref = syllabus_ref
        self.bank = bank or []

    def get_initial_question(self) -> str:
        if self.bank and len(self.bank) > 0:
            return self.bank[0].prompt_text
        return f"Hello, welcome to your {self.course_code} oral assessment. Could you briefly introduce your project or area of study?"

    def next_action(self, user_text: str, intent: IntentTag) -> OrchestratorAction:
        return OrchestratorAction(
            action_type="ask",
            question="Can you elaborate further on your technical implementation?",
            topic="general",
        )
