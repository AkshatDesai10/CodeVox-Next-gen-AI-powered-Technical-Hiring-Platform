"""Take home verification placeholder / alias to ProjectDefenseQuestionSource."""

from question_sources.base import QuestionSource
from topic_orchestrator import IntentTag, OrchestratorAction


class TakeHomeVerificationSource(QuestionSource):
    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs

    def get_initial_question(self) -> str:
        return "Could you provide an overview of your submitted take-home project?"

    def next_action(self, user_text: str, intent: IntentTag) -> OrchestratorAction:
        return OrchestratorAction(
            action_type="ask",
            question="Can you explain the key architectural decisions you made?",
            topic="architecture",
        )
