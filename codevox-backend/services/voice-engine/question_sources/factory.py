"""Factory for session question sources."""

from __future__ import annotations

from question_sources.base import QuestionSource
from question_sources.hr import HrQuestionSource
from question_sources.viva import VivaQuestionBankEntry, VivaQuestionSource
from session_config.types import SessionType
from tech_pool_manager import TechPoolManager
from topic_orchestrator import TopicOrchestrator


def build_question_source(
    session_type: SessionType,
    *,
    tech_stack: str = "General",
    min_turns: int = 3,
    max_turns: int = 8,
    resume_skills: list[str] | None = None,
    entry_level: bool = False,
    course_code: str = "GENERAL",
    question_mode: str = "hybrid",
    project_title: str | None = None,
    thesis_ref: str | None = None,
    syllabus_ref: str | None = None,
    question_bank: list[dict] | None = None,
) -> QuestionSource:
    if session_type == "student_viva":
        bank = [
            VivaQuestionBankEntry(
                id=str(entry.get("id", idx)),
                topic=str(entry.get("topic", course_code)),
                prompt_text=str(entry.get("prompt_text", "")),
                follow_up_hints=list(entry.get("follow_up_hints") or []),
            )
            for idx, entry in enumerate(question_bank or [])
            if entry.get("prompt_text")
        ]
        return VivaQuestionSource(
            course_code=course_code,
            question_mode=question_mode,
            project_title=project_title,
            thesis_ref=thesis_ref,
            syllabus_ref=syllabus_ref,
            bank=bank,
        )

    skills = resume_skills or [tech_stack]
    pool = TechPoolManager(skills)
    orchestrator = TopicOrchestrator(
        skills[0],
        min_turns,
        max_turns,
        tech_pool=pool,
        entry_level=entry_level,
    )
    return HrQuestionSource(orchestrator)
