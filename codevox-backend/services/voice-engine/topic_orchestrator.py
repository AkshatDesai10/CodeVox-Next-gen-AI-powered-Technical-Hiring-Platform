"""Stateful topic orchestrator with resume tech rotation and recovery rules."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Literal

from candidate_knowledge import (
    BrainDecision,
    EvaluationResult,
    QuestionSource,
    normalize_question_source,
)
from tech_pool_manager import TechPoolManager
from topic_catalog import normalize_stack

Level = Literal["JUNIOR", "MID", "SENIOR"]
IntentTag = Literal["ANSWERED", "ANALOGOUS_REDIRECT", "SKIP", "UNKNOWN", "OFFTOPIC"]
ActionMode = Literal[
    "icebreaker",
    "ask",
    "recovery",
    "pivot",
    "tech_pivot",
    "closing",
    "probe_depth",
    "challenge",
    "clarify",
    "reorient",
    "analogous",
]

SUCCESS_INTENTS: frozenset[IntentTag] = frozenset({"ANSWERED", "ANALOGOUS_REDIRECT"})
STRIKE_INTENTS: frozenset[IntentTag] = frozenset({"UNKNOWN", "SKIP", "OFFTOPIC"})

LEVEL_ORDER: list[Level] = ["JUNIOR", "MID", "SENIOR"]
TURNS_PER_SKILL = int(os.getenv("INTERVIEW_TURNS_PER_SKILL", "2"))

_REPEAT_THEME_KEYWORDS: list[tuple[str, str]] = [
    ("index", "database indexing"),
    ("slow quer", "slow queries"),
    ("select *", "SELECT * vs specific columns"),
    ("caching", "caching"),
    ("optimiz", "query optimization"),
    ("crud", "CRUD optimization"),
]

_ENTRY_SKILL_HINTS: dict[str, str] = {
    "php": "e.g. a form, handling POST data, basic routing, or a small CRUD page",
    "mysql": "e.g. a JOIN, table design, or INSERT/UPDATE — avoid repeating indexing topics",
    "basic sql": "e.g. WHERE filters, sorting, or a simple COUNT",
    "git": "e.g. commits, branches, or pull requests",
    "html/css": "e.g. page layout, forms, or styling",
    "rest apis": "e.g. GET vs POST, JSON responses, or calling an API from PHP",
}


def _themes_from_question(question: str) -> list[str]:
    lowered = question.lower()
    return [label for keyword, label in _REPEAT_THEME_KEYWORDS if keyword in lowered]


def _entry_skill_hint(tech: str) -> str:
    key = normalize_stack(tech)
    return _ENTRY_SKILL_HINTS.get(key, f"day-to-day work with {tech}")


def _base_level(*, entry_level: bool = False) -> Level:
    if entry_level:
        return "JUNIOR"
    raw = os.getenv("INTERVIEW_BASE_LEVEL", "MID").strip().upper()
    if raw in LEVEL_ORDER:
        return raw  # type: ignore[return-value]
    return "MID"


@dataclass
class TopicState:
    topic_name: str
    current_level: Level = "MID"
    consecutive_successes: int = 0
    fallback_attempts: int = 0
    topic_index: int = 0


@dataclass(frozen=True)
class OrchestratorAction:
    mode: ActionMode
    topic: str
    level: Level
    current_tech: str
    system_addon: str = ""
    intent: IntentTag | None = None
    # Propagated from BrainDecision so the verbal generator can gate resume injection.
    question_source: QuestionSource = "TECHNICAL"
    resume_anchor: str | None = None


@dataclass
class TopicOrchestrator:
    tech_stack: str
    min_turns: int
    max_turns: int
    tech_pool: TechPoolManager | None = None
    topic_pool: list[str] = field(default_factory=list)
    state: TopicState = field(default_factory=lambda: TopicState(topic_name=""))
    current_turn: int = 1
    covered_topics: list[str] = field(default_factory=list)
    skipped_topics: list[str] = field(default_factory=list)
    closing_handshake_done: bool = False
    last_question_asked: str = ""
    icebreaker_complete: bool = False
    pending_first_technical: bool = False
    turns_on_current_tech: int = 0
    entry_level: bool = False
    locked_level: Level | None = None
    _asked_themes: list[str] = field(default_factory=list)
    _last_intent: IntentTag | None = None
    _topics_with_success: set[str] = field(default_factory=set)

    def __post_init__(self) -> None:
        if self.tech_pool is None:
            label = (self.tech_stack or "the role").strip() or "the role"
            self.tech_pool = TechPoolManager([label])
        self._load_topic_for_current_tech()

    def _load_topic_for_current_tech(self) -> None:
        assert self.tech_pool is not None
        tech = self.tech_pool.current_tech
        topic_key = normalize_stack(tech).replace(" ", "_") or "architecture"
        self.topic_pool = [topic_key]
        self.state.topic_name = topic_key
        self.state.topic_index = 0
        self.state.current_level = self.seniority_level()
        self.state.consecutive_successes = 0
        self.state.fallback_attempts = 0

    def lock_seniority(self, band: str) -> None:
        """Fix question seniority for the whole session. Answers must not move it."""
        if band in LEVEL_ORDER:
            self.locked_level = band  # type: ignore[assignment]
            self.state.current_level = self.locked_level

    def seniority_level(self) -> Level:
        if self.locked_level in LEVEL_ORDER:
            return self.locked_level  # type: ignore[return-value]
        return _base_level(entry_level=self.entry_level)

    def _anti_repeat_addon(self, next_tech: str) -> str:
        recent = list(dict.fromkeys(self._asked_themes[-8:]))
        if not recent:
            return ""
        forbidden = ", ".join(recent)
        return (
            f"Do NOT ask about {forbidden} again — those subtopics were already covered. "
            f"Ask something entirely different about {next_tech} only."
        )

    def _tech_pivot_addon(self, prev_tech: str, next_tech: str, *, struggled: bool) -> str:
        anti_repeat = self._anti_repeat_addon(next_tech)
        if self.entry_level:
            hint = _entry_skill_hint(next_tech)
            struggle_line = (
                f"They struggled with {prev_tech}; start fresh on {next_tech}. "
                if struggled
                else f"Acknowledge their {prev_tech} answer, then move to {next_tech}. "
            )
            return (
                f"One brief validation sentence, then pivot to {next_tech}. "
                f"{struggle_line}"
                f"Ask ONE practical entry-level technical question about {next_tech} ({hint}). "
                "Do NOT begin with a CV project walkthrough. "
                f"{anti_repeat}"
            ).strip()
        struggle_line = (
            f"They struggled with {prev_tech}; start fresh on {next_tech}."
            if struggled
            else (
                f"Acknowledge their {prev_tech} answer, then naturally move to {next_tech}."
            )
        )
        return (
            f"{struggle_line} Ask one broad technical or practical question about {next_tech} only — "
            f"not database indexing, slow queries, or SELECT * unless {next_tech} is MySQL "
            f"and that subtopic was not yet covered. Do NOT begin with a CV project walkthrough. "
            f"{anti_repeat}"
        ).strip()

    def _experience_focus(self) -> str:
        if self.entry_level:
            return "projects, day-to-day work, and practical tasks"
        return "architecture and design, not syntax"

    def should_continue(self) -> bool:
        return self.current_turn <= self.max_turns

    def in_closing_window(self) -> bool:
        """Safety net only: closing is triggered at the terminal turn, not by a fixed countdown."""
        return self.current_turn >= self.max_turns

    def initial_action(self) -> OrchestratorAction:
        assert self.tech_pool is not None
        skills_preview = ", ".join(self.tech_pool.tech_stack[:4])
        return OrchestratorAction(
            mode="icebreaker",
            topic="introduction",
            level=self.state.current_level,
            current_tech=self.tech_pool.current_tech,
            system_addon=(
                "Welcome the candidate by name if known. "
                "Ask ONE simple question, at most 25 words: tell me a bit about yourself. "
                "Do not ask a work-skill or definition question yet."
            ),
        )

    def apply(self, intent: IntentTag, confidence_delta: int) -> OrchestratorAction:
        assert self.tech_pool is not None
        self._last_intent = intent

        if self.in_closing_window() and not self.closing_handshake_done:
            return OrchestratorAction(
                mode="closing",
                topic=self.state.topic_name,
                level=self.state.current_level,
                current_tech=self.tech_pool.current_tech,
                intent=intent,
            )

        if self.pending_first_technical:
            self.pending_first_technical = False
            self._turns_on_current_tech = 0
            return OrchestratorAction(
                mode="ask",
                topic=self.state.topic_name,
                level=self.state.current_level,
                current_tech=self.tech_pool.current_tech,
                system_addon=(
                    "Thank them for the introduction. Begin exploring their resume — "
                    f"ask one open question about real-world experience with "
                    f"{self.tech_pool.current_tech} ({self._experience_focus()})."
                ),
                intent=intent,
            )

        if intent in SUCCESS_INTENTS:
            self.tech_pool.on_success()
            self.state.fallback_attempts = 0
            self.state.consecutive_successes += 1
            self._topics_with_success.add(self.tech_pool.current_tech)
            self.turns_on_current_tech += 1

            if self.turns_on_current_tech >= TURNS_PER_SKILL:
                advance = self._advance_tech_after_coverage(intent)
                if advance is not None:
                    return advance

            return self._ask_action(intent, confidence_delta)

        if intent in STRIKE_INTENTS:
            strike_count = self.tech_pool.register_strike()
            self.state.fallback_attempts = strike_count
            if strike_count == 1:
                level = self.seniority_level()
                self.state.current_level = level
                addon = (
                    "The candidate could not answer. Ask one different angle about "
                    f"{self.tech_pool.current_tech} at the same {level} seniority. "
                    "Do not drop to an easier seniority."
                )
                if intent == "OFFTOPIC":
                    addon = (
                        "The candidate went off-topic. Gently redirect and ask one question "
                        f"about their experience with {self.tech_pool.current_tech} "
                        f"at the same {level} seniority."
                    )
                return OrchestratorAction(
                    mode="recovery",
                    topic=self.state.topic_name,
                    level=level,
                    current_tech=self.tech_pool.current_tech,
                    system_addon=addon,
                    intent=intent,
                )
            return self._pivot_tech(intent)

        return self._ask_action(intent, confidence_delta)

    def apply_brain_decision(
        self,
        decision: BrainDecision,
        eval_res: EvaluationResult,
    ) -> OrchestratorAction:
        """Apply dynamic Brain next-action decision without naive 'wrong -> easier' fallback."""
        assert self.tech_pool is not None

        qs = normalize_question_source(getattr(decision, "question_source", None))
        resume_anchor = (
            decision.resume_anchor
            if qs == "RESUME_VALIDATION"
            else None
        )

        # Map understanding level to IntentTag
        if eval_res.understanding_level == "SKIP":
            intent: IntentTag = "SKIP"
        elif eval_res.understanding_level == "STRONG":
            intent = "ANSWERED"
        elif eval_res.understanding_level == "MODERATE":
            intent = "ANSWERED"
        elif decision.action_mode == "ANALOGOUS_PROBE":
            intent = "ANALOGOUS_REDIRECT"
        elif eval_res.understanding_level in ("WEAK", "NO_KNOWLEDGE"):
            intent = "UNKNOWN"
        else:
            intent = "ANSWERED"
        self._last_intent = intent

        def _action(
            *,
            mode: ActionMode,
            topic: str,
            level: Level,
            current_tech: str,
            system_addon: str = "",
            intent_tag: IntentTag | None = None,
        ) -> OrchestratorAction:
            addon = system_addon
            if qs == "RESUME_VALIDATION":
                # Ensure verbal path cannot "forget" the resume requirement.
                anchor_bit = (
                    f" Ground the question in resume_anchor={resume_anchor}."
                    if resume_anchor
                    else " Ground the question in a named resume project from context."
                )
                if "RESUME_VALIDATION" not in (addon or "") and "resume_anchor" not in (
                    addon or ""
                ).casefold():
                    addon = (
                        (addon or "").rstrip()
                        + " This turn is RESUME_VALIDATION."
                        + anchor_bit
                        + " Name the project in the spoken question."
                    ).strip()
            return OrchestratorAction(
                mode=mode,
                topic=topic,
                level=level,
                current_tech=current_tech,
                system_addon=addon,
                intent=intent_tag,
                question_source=qs,
                resume_anchor=resume_anchor,
            )

        # Closing check
        if decision.action_mode == "WRAP_UP" or (self.in_closing_window() and not self.closing_handshake_done):
            return _action(
                mode="closing",
                topic=self.state.topic_name,
                level=self.state.current_level,
                current_tech=self.tech_pool.current_tech,
                intent_tag=intent,
            )

        if self.pending_first_technical:
            self.pending_first_technical = False
            self.turns_on_current_tech = 0

        target_tech = decision.target_competency or self.tech_pool.current_tech
        target_concept = decision.target_concept or self.state.topic_name
        # Ignore any difficulty the model emitted. Seniority stays on the job profile.
        self.state.current_level = self.seniority_level()

        if decision.action_mode == "PIVOT_COMPETENCY":
            # Rubric is already locked by enforce_deterministic_rubric_routing.
            # Do NOT let tech_pool.advance_after_coverage() change the rubric.
            target_tech = decision.target_competency or self.tech_pool.current_tech
            self.tech_pool.focus_on(target_tech)
            self.turns_on_current_tech = 0
            # Cleared target_concept must NOT fall back to the previous rubric's topic.
            target_concept = (decision.target_concept or "").strip() or target_tech
            self.state.topic_name = target_concept
            if decision.system_directive.strip():
                addon = decision.system_directive
            elif qs == "RESUME_VALIDATION":
                addon = (
                    f"Ask about a specific resume claim related to {target_tech}."
                )
            else:
                addon = (
                    f"Ask ONE technical or practical question about {target_tech} only. "
                    "Do NOT begin with a CV project walkthrough."
                )
            return _action(
                mode="tech_pivot",
                topic=target_concept,
                level=self.state.current_level,
                current_tech=target_tech,
                system_addon=addon,
                intent_tag=intent,
            )

        if decision.action_mode == "PROBE_DEPTH":
            self.turns_on_current_tech += 1
            self.state.consecutive_successes += 1
            self.tech_pool.on_success()
            return _action(
                mode="probe_depth",
                topic=target_concept,
                level=self.state.current_level,
                current_tech=target_tech,
                system_addon=decision.system_directive,
                intent_tag=intent,
            )

        if decision.action_mode == "CHALLENGE_EDGE_CASE":
            self.turns_on_current_tech += 1
            self.state.consecutive_successes += 1
            self.tech_pool.on_success()
            return _action(
                mode="challenge",
                topic=target_concept,
                level=self.seniority_level(),
                current_tech=target_tech,
                system_addon=decision.system_directive,
                intent_tag=intent,
            )

        if decision.action_mode == "CLARIFY_MISCONCEPTION":
            # Probe misconception with counter-example or trade-off; do NOT drop to junior quiz
            self.turns_on_current_tech += 1
            return _action(
                mode="clarify",
                topic=target_concept,
                level=self.state.current_level,
                current_tech=target_tech,
                system_addon=decision.system_directive,
                intent_tag=intent,
            )

        if decision.action_mode == "REORIENT_PRACTICAL":
            # Shift to a simpler practical/scenario angle; do NOT drop to trivial trivia
            # and do NOT resume-rescue weak answers (Step 3.5).
            self.turns_on_current_tech += 1
            return _action(
                mode="reorient",
                topic=target_concept,
                level=self.state.current_level,
                current_tech=target_tech,
                system_addon=decision.system_directive,
                intent_tag=intent,
            )

        if decision.action_mode == "ANALOGOUS_PROBE":
            self.turns_on_current_tech += 1
            return _action(
                mode="analogous",
                topic=target_concept,
                level=self.state.current_level,
                current_tech=target_tech,
                system_addon=decision.system_directive,
                intent_tag="ANALOGOUS_REDIRECT",
            )

        self.turns_on_current_tech += 1
        return _action(
            mode="ask",
            topic=target_concept,
            level=self.state.current_level,
            current_tech=target_tech,
            system_addon=decision.system_directive,
            intent_tag=intent,
        )

    def _advance_tech_after_coverage(self, intent: IntentTag) -> OrchestratorAction | None:
        assert self.tech_pool is not None
        prev_tech = self.tech_pool.current_tech
        next_tech = self.tech_pool.advance_after_coverage()
        self.turns_on_current_tech = 0
        if next_tech is None:
            return None
        self._load_topic_for_current_tech()
        return OrchestratorAction(
            mode="tech_pivot",
            topic=self.state.topic_name,
            level=self.state.current_level,
            current_tech=next_tech,
            system_addon=self._tech_pivot_addon(prev_tech, next_tech, struggled=False),
            intent=intent,
        )

    def _ask_action(self, intent: IntentTag, _confidence_delta: int) -> OrchestratorAction:
        assert self.tech_pool is not None
        addon = ""
        if intent == "ANALOGOUS_REDIRECT":
            addon = (
                "The candidate redirected to analogous experience. Acknowledge it and probe "
                "depth on the parallel approach they described."
            )
        elif self.turns_on_current_tech == 0:
            focus = (
                "projects and practical tasks"
                if self.entry_level
                else "projects, trade-offs, and design choices"
            )
            addon = (
                f"Explore their hands-on experience with {self.tech_pool.current_tech} "
                f"from their resume — {focus}."
            )
        return OrchestratorAction(
            mode="ask",
            topic=self.state.topic_name,
            level=self.state.current_level,
            current_tech=self.tech_pool.current_tech,
            system_addon=addon,
            intent=intent,
        )

    def _pivot_tech(self, intent: IntentTag) -> OrchestratorAction:
        assert self.tech_pool is not None
        prev_tech = self.tech_pool.current_tech
        skipped = prev_tech
        if skipped and skipped not in self.skipped_topics:
            self.skipped_topics.append(skipped)

        next_tech = self.tech_pool.lock_current_and_advance()
        self.turns_on_current_tech = 0
        if next_tech is None or self.tech_pool.exhausted:
            return OrchestratorAction(
                mode="ask",
                topic=self.state.topic_name,
                level=self.state.current_level,
                current_tech=self.tech_pool.current_tech,
                system_addon=(
                    f"Continue with a lightweight concrete scenario question on {self.tech_pool.current_tech} "
                    "or another resume skill they mentioned. Avoid overly broad or vague questions."
                ),
                intent=intent,
            )

        self._load_topic_for_current_tech()
        return OrchestratorAction(
            mode="tech_pivot",
            topic=self.state.topic_name,
            level=self.state.current_level,
            current_tech=next_tech,
            system_addon=self._tech_pivot_addon(prev_tech, next_tech, struggled=True),
            intent=intent,
        )

    def record_question(self, question: str) -> None:
        self.last_question_asked = question
        self._asked_themes.extend(_themes_from_question(question))

    def sync_topic_lists(self) -> None:
        assert self.tech_pool is not None
        self.covered_topics = [
            self.tech_pool.tech_stack[i]
            for i in sorted(self.tech_pool.verified)
            if i < len(self.tech_pool.tech_stack)
        ]

    def advance_turn(self, question_rubric: str | None = None) -> None:
        if self.current_turn == 1:
            self.icebreaker_complete = True
            self.pending_first_technical = True
        self.current_turn += 1
        # Count a resume skill only when the question's rubric is that skill.
        # A fuzzy index was charging Machine Learning questions to the skill "C".
        if self.tech_pool is not None and question_rubric:
            idx = self.tech_pool.matching_index(question_rubric)
            if idx is not None:
                self.tech_pool.active_index = idx
                self.tech_pool.record_turn()

    def mark_closing_done(self) -> None:
        self.closing_handshake_done = True
