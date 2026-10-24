"""Stateful resume technology rotation with a 2-strike pivot rule."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any


def _skill_words(value: str) -> set[str]:
    """Tokens long enough that a letter inside another word cannot match a skill."""
    return {word for word in re.findall(r"[a-z0-9+#.]{3,}", (value or "").lower())}


@dataclass
class TechPoolManager:
    tech_stack: list[str]
    active_index: int = 0
    strikes: int = 0
    locked_out: set[int] = field(default_factory=set)
    verified: set[int] = field(default_factory=set)
    _turns_per_index: dict[int, int] = field(default_factory=dict)
    _max_strikes_per_index: dict[int, int] = field(default_factory=dict)

    @property
    def current_tech(self) -> str:
        if not self.tech_stack:
            return "General"
        idx = min(self.active_index, len(self.tech_stack) - 1)
        return self.tech_stack[idx]

    @property
    def exhausted(self) -> bool:
        if not self.tech_stack:
            return True
        return (
            len(self.locked_out) >= len(self.tech_stack)
            or self.active_index >= len(self.tech_stack)
        )

    def record_turn(self) -> None:
        idx = self.active_index
        self._turns_per_index[idx] = self._turns_per_index.get(idx, 0) + 1

    def on_success(self) -> None:
        self.strikes = 0
        self.verified.add(self.active_index)

    def register_strike(self) -> int:
        self.strikes += 1
        idx = self.active_index
        self._max_strikes_per_index[idx] = max(
            self._max_strikes_per_index.get(idx, 0),
            self.strikes,
        )
        return self.strikes

    def lock_current_and_advance(self) -> str | None:
        idx = self.active_index
        self.locked_out.add(idx)
        self.strikes = 0

        next_index = idx + 1
        while next_index < len(self.tech_stack) and next_index in self.locked_out:
            next_index += 1

        if next_index >= len(self.tech_stack):
            self.active_index = len(self.tech_stack)
            return None

        self.active_index = next_index
        return self.tech_stack[next_index]

    def advance_after_coverage(self) -> str | None:
        """Move to the next resume skill after successful coverage (no lock-out)."""
        self.on_success()
        self.strikes = 0

        next_index = self.active_index + 1
        while next_index < len(self.tech_stack) and next_index in self.locked_out:
            next_index += 1

        if next_index >= len(self.tech_stack):
            return None

        self.active_index = next_index
        return self.tech_stack[next_index]

    def matching_index(self, name: str) -> int | None:
        """Return the skill index for a rubric label.

        Exact names match first. Otherwise words of length 3+ must overlap, so the
        skill "C" is not selected just because "machine learning" contains the letter c.
        """
        needle = (name or "").strip().lower()
        if not needle or not self.tech_stack:
            return None
        for i, skill in enumerate(self.tech_stack):
            if skill.strip().lower() == needle:
                return i
        needle_words = _skill_words(needle)
        if not needle_words:
            return None
        for i, skill in enumerate(self.tech_stack):
            if _skill_words(skill) & needle_words:
                return i
        return None

    def focus_on(self, name: str) -> str:
        """Align pool index to ``name`` when it really is that skill."""
        idx = self.matching_index(name)
        if idx is None:
            return self.current_tech
        self.active_index = idx
        self.strikes = 0
        return self.tech_stack[idx]

    def finalize_alignment(self) -> dict[str, Any]:
        skills = list(self.tech_stack)
        verified_names = [skills[i] for i in sorted(self.verified) if i < len(skills)]
        skipped_names = [
            skills[i]
            for i in sorted(self.locked_out - self.verified)
            if i < len(skills)
        ]
        un_assessed_names = [
            skill
            for i, skill in enumerate(skills)
            if i not in self.verified and i not in self.locked_out
        ]
        per_skill: dict[str, dict[str, Any]] = {}
        for i, skill in enumerate(skills):
            if i in self.verified:
                status = "verified"
            elif i in self.locked_out:
                status = "skipped"
            else:
                status = "un_assessed"
            per_skill[skill] = {
                "status": status,
                "strikes": self._max_strikes_per_index.get(i, 0),
                "turns": self._turns_per_index.get(i, 0),
            }

        return {
            "resume_skills": skills,
            "verified": verified_names,
            "skipped_due_to_struggles": skipped_names,
            "un_assessed_due_to_time": un_assessed_names,
            "per_skill": per_skill,
        }
