from __future__ import annotations

import logging
import re
import time as _time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

_pacing_logger = logging.getLogger("interview-pacing")

KnowledgeLevel = Literal["STRONG", "MODERATE", "WEAK", "NOT_TESTED"]
UnderstandingLevel = Literal[
    "STRONG",
    "MODERATE",
    "WEAK",
    "MISCONCEPTION",
    "NO_KNOWLEDGE",
    "SKIP",
]
BrainActionMode = Literal[
    "PROBE_DEPTH",
    "CHALLENGE_EDGE_CASE",
    "CLARIFY_MISCONCEPTION",
    "REORIENT_PRACTICAL",
    "ANALOGOUS_PROBE",
    "PIVOT_COMPETENCY",
    "WRAP_UP",
    "FOLLOW_UP",
]

# Step 1 — evidence-pack coverage (exploration state; not the final hire score).
CoverageState = Literal["INSUFFICIENT", "PARTIAL", "SUFFICIENT"]
ExitReason = Literal[
    "strong_early_exit",
    "medium_complete",
    "weak_exhausted",
    "safety_ceiling",
    "time_pressure",
    "session_wrap",
    "plan_complete",
]
ProbeKind = Literal[
    "initial",
    "confirm",
    "challenge",
    "clarify",
    "reorient",
    "other",
]
AnswerClass = Literal["noise", "skip", "dont_know", "substantive"]
# Step 3.5 — what grounded the interviewer question (orthogonal to action_mode).
QuestionSource = Literal[
    "TECHNICAL",
    "PRACTICAL",
    "RESUME_VALIDATION",
    "FOLLOW_UP",
]
_VALID_QUESTION_SOURCES = frozenset(
    {"TECHNICAL", "PRACTICAL", "RESUME_VALIDATION", "FOLLOW_UP"}
)
DifficultyTier = Literal["FOUNDATIONAL", "APPLIED", "DESIGN", "FAILURE_MODE"]
TIER_ORDER: list[DifficultyTier] = ["FOUNDATIONAL", "APPLIED", "DESIGN", "FAILURE_MODE"]
EvidenceDimension = Literal[
    "FOUNDATIONAL",
    "TECHNICAL_APPLIED",
    "PROBLEM_SOLVING",
    "RESUME_VALIDATION",
]

# Locked v1 classifier knobs.
_MIN_SUBSTANTIVE_WORDS = 4
# Skip / meta-redirect phrases. Do NOT use bare \bpass\b — live Turn 3
# ("then pass the required features...") was false-positive skip/noise.
_SKIP_RE = re.compile(
    r"(?ix)\b(?:"
    r"skip(?:\s+(?:this|the\s+question))?"
    r"|next\s+question"
    r"|next\s+please"
    r"|move\s+on"
    r"|i(?:'?ll|\s+will)?\s+pass"
    r"|pass\s+(?:this|on(?:\s+this)?|the\s+question)"
    r"|(?:can|could)\s+we\s+(?:move|switch|go|talk)\s+(?:to|about)"
    r"|let'?s\s+(?:move|switch|go|talk)\s+(?:to|about)"
    r"|change\s+(?:the\s+)?topic"
    r"|different\s+(?:topic|question|subject)"
    r"|move\s+to\s+(?:some\s+)?\w+\s+questions?"
    r")\b"
)
_DONT_KNOW_RE = re.compile(
    r"\b(i\s+don'?t\s+know|dont\s+know|do\s+not\s+know|no\s+idea|not\s+sure)\b",
    re.I,
)
_INTRO_BACKGROUND_CONCEPT_RE = re.compile(
    r"(?ix)^\s*(?:introduction(?:\s*&\s*|\s+and\s+|/)background"
    r"|introduction|background|about\s+yourself|self[- ]?intro(?:duction)?)\s*$"
)


from pydantic import BaseModel, Field

# Late-friendly import for session concept cache (Step 3.5).
from concept_area_cache import ConceptAreaCache, infer_rubric_kind  # noqa: E402

class ConceptNode(BaseModel):
    concept: str
    level: KnowledgeLevel = "NOT_TESTED"
    evidence: str | None = None
    strikes: int = 0


class EvaluationResult(BaseModel):
    """Internal per-turn evaluation signal."""
    concept_tested: str
    competency_id: str | None = None
    understanding_level: UnderstandingLevel = "MODERATE"
    internal_score_10: int | None = 5
    eval_status: Literal["scored", "unscored"] = "scored"
    evidence: str = ""
    misconception: str | None = None
    verified_resume_claim: str | None = None
    identified_weakness: str | None = None
    stt_mitigation_applied: bool = False

    def to_dict(self) -> dict[str, Any]:
        return self.model_dump()


class BrainDecision(BaseModel):
    """Strategic next-action decision chosen by the Interview Brain."""
    action_mode: BrainActionMode = "PROBE_DEPTH"
    target_competency: str | None = None
    target_concept: str = ""
    difficulty: Literal["JUNIOR", "MID", "SENIOR"] = "MID"
    system_directive: str = ""
    resume_anchor: str | None = None
    # Step 3.5 — grounding of the *next* spoken question.
    question_source: QuestionSource = "TECHNICAL"
    # Phase 5 — evidence dimension targeted.
    evidence_dimension: EvidenceDimension = "TECHNICAL_APPLIED"

    def to_dict(self) -> dict[str, Any]:
        return self.model_dump()


class EvidenceItem(BaseModel):
    """One Q&A evidence row inside a rubric pack (Step 1)."""

    question: str
    answer_verbatim: str
    understanding_level: UnderstandingLevel
    internal_score_10: int = Field(ge=1, le=10)
    evidence_notes: str = ""
    resume_anchor: str | None = None
    concept_tested: str = ""
    concept_fingerprint: str = ""
    probe_kind: ProbeKind = "initial"
    # Derived classifiers (locked clarifications #1 / #2).
    is_meaningful: bool = False
    is_substantive: bool = False
    answer_class: AnswerClass = "noise"
    action_mode: str | None = None
    # Step 3.5 — grounding of the question that elicited this answer.
    question_source: QuestionSource = "TECHNICAL"
    evidence_dimension: EvidenceDimension | None = None
    question_difficulty: DifficultyTier | None = None

    def to_dict(self) -> dict[str, Any]:
        return self.model_dump()


DIMENSION_TARGETS: dict[str, dict[EvidenceDimension, int]] = {
    "JUNIOR": {"FOUNDATIONAL": 1, "TECHNICAL_APPLIED": 1, "PROBLEM_SOLVING": 0, "RESUME_VALIDATION": 1},
    "MID": {"FOUNDATIONAL": 0, "TECHNICAL_APPLIED": 2, "PROBLEM_SOLVING": 0, "RESUME_VALIDATION": 1},
    "SENIOR": {"FOUNDATIONAL": 0, "TECHNICAL_APPLIED": 1, "PROBLEM_SOLVING": 1, "RESUME_VALIDATION": 1},
}

# Recruiter-facing category keys. Order of asking stays _PLAN_DIMENSION_ORDER.
_QUESTION_PLAN_CATEGORIES: tuple[tuple[str, EvidenceDimension], ...] = (
    ("foundational", "FOUNDATIONAL"),
    ("technical", "TECHNICAL_APPLIED"),
    ("problem_solving", "PROBLEM_SOLVING"),
    ("resume", "RESUME_VALIDATION"),
)
_QUESTION_PLAN_MAX_CATEGORY = 10
_QUESTION_PLAN_MAX_TOTAL = 20
DEFAULT_QUESTION_PLAN_MAX = 3


def _default_dimension_counts() -> dict[EvidenceDimension, int]:
    return {
        "FOUNDATIONAL": 0,
        "TECHNICAL_APPLIED": 0,
        "PROBLEM_SOLVING": 0,
        "RESUME_VALIDATION": 0,
    }


class RubricEvidencePack(BaseModel):
    """Per-rubric evidence pack + coverage metadata (Step 1).

    coverage_state is exploration status — never derived from turn count alone.
    exit_reason stays null until a later step closes the rubric.
    """

    rubric_key: str
    coverage_state: CoverageState = "INSUFFICIENT"
    exit_reason: ExitReason | None = None
    items: list[EvidenceItem] = Field(default_factory=list)
    frozen: bool = False
    dimension_counts: dict[EvidenceDimension, int] = Field(
        default_factory=_default_dimension_counts
    )

    def to_dict(self) -> dict[str, Any]:
        return {
            "rubric_key": self.rubric_key,
            "coverage_state": self.coverage_state,
            "exit_reason": self.exit_reason,
            "frozen": self.frozen,
            "dimension_counts": self.dimension_counts.copy(),
            "items": [item.to_dict() for item in self.items],
        }

    def select_target_dimension(self, seniority_level: str) -> EvidenceDimension:
        """Select the most under-covered evidence dimension for the current seniority."""
        band = canonical_seniority_band(seniority_level)
        target_profile = DIMENSION_TARGETS[band]

        max_gap = -999
        best_dim: EvidenceDimension = "TECHNICAL_APPLIED"

        for dim, target in target_profile.items():
            current = self.dimension_counts.get(dim, 0)
            gap = target - current
            if gap > max_gap:
                max_gap = gap
                best_dim = dim

        return best_dim


def classify_answer_text(
    answer_verbatim: str,
    understanding_level: UnderstandingLevel | str | None = None,
) -> tuple[bool, bool, AnswerClass]:
    """Return (is_meaningful, is_substantive, answer_class).

    Locked v1 (+ clarification option c):
    - empty → noise
    - skip / conversational-redirect phrase OR understanding_level=SKIP → skip
      (not toward SUFFICIENT). Redirects like "can we move to PHP questions?"
      are meta-conversation, not coverage evidence.
    - dont_know phrase OR understanding_level=NO_KNOWLEDGE → meaningful weak
    - Brain understanding_level in {STRONG, MODERATE, WEAK, MISCONCEPTION}
      is the primary substantive signal (short factual answers like
      "PostgreSQL" count when Brain judged them)
    - word-count <4 is only a weak fallback when no usable Brain level
    """
    text = (answer_verbatim or "").strip()
    if not text:
        return False, False, "noise"

    level = str(understanding_level or "").strip().upper() or None

    if _SKIP_RE.search(text) or level == "SKIP":
        return False, False, "skip"
    if _DONT_KNOW_RE.search(text) or level == "NO_KNOWLEDGE":
        return True, True, "dont_know"

    # Primary signal: Brain evaluation (option c).
    if level in ("STRONG", "MODERATE", "WEAK", "MISCONCEPTION"):
        return True, True, "substantive"

    # Weak fallback only when Brain level is absent/unusable.
    words = [w for w in re.split(r"\s+", text) if w]
    if len(words) < _MIN_SUBSTANTIVE_WORDS:
        return False, False, "noise"
    return True, True, "substantive"


def normalize_question_source(value: str | None) -> QuestionSource:
    """Coerce LLM / legacy values to a valid QuestionSource (default TECHNICAL)."""
    raw = (value or "").strip().upper().replace("-", "_").replace(" ", "_")
    if raw in _VALID_QUESTION_SOURCES:
        return raw  # type: ignore[return-value]
    aliases = {
        "RESUME": "RESUME_VALIDATION",
        "RESUME_BASED": "RESUME_VALIDATION",
        "CV": "RESUME_VALIDATION",
        "CV_VALIDATION": "RESUME_VALIDATION",
        "TECH": "TECHNICAL",
        "THEORY": "TECHNICAL",
        "SCENARIO": "PRACTICAL",
        "APPLIED": "PRACTICAL",
        "FOLLOWUP": "FOLLOW_UP",
        "PROBE": "FOLLOW_UP",
    }
    mapped = aliases.get(raw)
    if mapped in _VALID_QUESTION_SOURCES:
        return mapped  # type: ignore[return-value]
    return "TECHNICAL"


def is_intro_background_concept(concept_tested: str | None) -> bool:
    """True for icebreaker / intro concepts that must not feed rubric coverage."""
    return bool(_INTRO_BACKGROUND_CONCEPT_RE.match((concept_tested or "").strip()))


def probe_kind_from_action_mode(action_mode: str | None) -> ProbeKind:
    """Map the Brain action that produced the question to probe_kind.

    ANALOGOUS_PROBE maps to confirm: it continues probing competence on a
    related tool/experience and counts as a confirming turn for strong_early_exit.
    """
    mode = (action_mode or "").strip().upper()
    if mode == "CHALLENGE_EDGE_CASE":
        return "challenge"
    if mode == "CLARIFY_MISCONCEPTION":
        return "clarify"
    if mode == "REORIENT_PRACTICAL":
        return "reorient"
    if mode in ("PROBE_DEPTH", "ANALOGOUS_PROBE"):
        return "confirm"
    if mode in ("PIVOT_COMPETENCY", "", "NONE"):
        return "initial"
    return "other"


def _crit_canonical_id(crit: dict[str, Any]) -> str:
    """Prefer stable unique id; fall back to label only when id missing."""
    crit_id = str(crit.get("id") or "").strip()
    if crit_id:
        return re.sub(r"^[\s.\u2022\-_–—]+", "", crit_id).strip()
    label = str(crit.get("label") or "").strip()
    return re.sub(r"^[\s.\u2022\-_–—]+", "", label).strip()


def normalize_rubric_label_for_match(value: str | None) -> str:
    """Normalize a rubric label/id for comparison only.

    Strips leading decorative punctuation (e.g. \". Database & SQL\" → \"Database & SQL\")
    without changing the stored canonical rubric name in criteria/packs.
    """
    text = (value or "").strip()
    if not text:
        return ""
    # Drop leading dots/bullets/dashes/underscores and surrounding spaces.
    text = re.sub(r"^[\s.\u2022\-_–—]+", "", text).strip()
    return text.casefold()


def rubric_display_name(crit: dict[str, Any]) -> str:
    """Stored human label if present, else id — never a normalized rewrite."""
    label = str(crit.get("label") or "").strip()
    if label:
        return re.sub(r"^[\s.\u2022\-_–—]+", "", label).strip()
    crit_id = str(crit.get("id") or "").strip()
    return re.sub(r"^[\s.\u2022\-_–—]+", "", crit_id).strip()


def _match_rubric_crit(
    candidate: str,
    rubric_criteria: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Exact id/label match (with label normalization), then unique soft match."""
    needle = candidate.strip()
    if not needle:
        return None
    needle_l = needle.lower()
    needle_norm = normalize_rubric_label_for_match(needle)

    for crit in rubric_criteria:
        crit_id = str(crit.get("id") or "").strip()
        crit_label = str(crit.get("label") or "").strip()
        if crit_id and needle_l == crit_id.lower():
            return crit
        if crit_label and needle_l == crit_label.lower():
            return crit
        # Leading-dot / decorative-prefix tolerant label match.
        if crit_label and needle_norm and needle_norm == normalize_rubric_label_for_match(crit_label):
            return crit
        if crit_id and needle_norm and needle_norm == normalize_rubric_label_for_match(crit_id):
            return crit

    soft: list[dict[str, Any]] = []
    for crit in rubric_criteria:
        crit_label = str(crit.get("label") or "").strip()
        crit_id = str(crit.get("id") or "").strip()
        for token in (crit_label, crit_id):
            if not token:
                continue
            token_l = token.lower()
            token_norm = normalize_rubric_label_for_match(token)
            if token_l in needle_l or needle_l in token_l:
                soft.append(crit)
                break
            if token_norm and needle_norm and (
                token_norm in needle_norm or needle_norm in token_norm
            ):
                soft.append(crit)
                break
    # Unique soft match only — avoid ambiguous collisions.
    if len(soft) == 1:
        return soft[0]
    return None


def canonicalize_rubric_key(
    candidate: str | None,
    rubric_criteria: list[dict[str, Any]] | None,
    *,
    fallback_candidate: str | None = None,
) -> str:
    """Resolve a Brain/orchestrator competency string to a rubric id.

    Matching order:
      1) exact id / exact label (case-insensitive)
      2) unique soft substring match (handles near-miss paraphrases)
      3) same resolution on fallback_candidate (e.g. active_competency)
      4) first rubric id (last resort — never create an orphan key)

    When rubric_criteria is empty, returns stripped candidate or \"general\".
    """
    criteria = list(rubric_criteria or [])
    raw = (candidate or "").strip().lstrip(".")

    if not criteria:
        return raw or "general"

    matched = _match_rubric_crit(raw, criteria) if raw else None
    if matched is not None:
        return _crit_canonical_id(matched)

    fb = (fallback_candidate or "").strip()
    if fb:
        fb_matched = _match_rubric_crit(fb, criteria)
        if fb_matched is not None:
            canon = _crit_canonical_id(fb_matched)
            _pacing_logger.warning(
                "rubric_key %r matched no rubric id/label; falling back to active/fallback → %r",
                raw or candidate,
                canon,
            )
            return canon

    # Last resort: first rubric id (still never an orphan string).
    canon = _crit_canonical_id(criteria[0]) or "general"
    _pacing_logger.warning(
        "rubric_key %r matched no rubric (fallback %r also failed); "
        "using first rubric id %r to avoid orphan pack",
        raw or candidate,
        fb or None,
        canon,
    )
    return canon


def rubric_key_for_answered_question(
    *,
    active_competency: str | None,
    rubric_criteria: list[dict[str, Any]] | None = None,
) -> str:
    """Rubric that owned the question being answered.

    Always prefers the locked/active competency. Evaluator competency_id must
    not be passed here — it is diagnostic only.
    """
    raw = (active_competency or "").strip() or "general"
    if rubric_criteria is not None:
        return canonicalize_rubric_key(
            raw,
            rubric_criteria,
            fallback_candidate=active_competency,
        )
    return raw


# Phase 3.5 constants
BASE_DURATION_MINUTES: int = 30
HARD_CEILING_MINUTES: int = 50  # product hard max; no further extension beyond this
MAX_TURNS_PER_RUBRIC: int = 5  # probe safety ceiling ONLY — never normal completion
JUNIOR_MAX_TURNS_PER_RUBRIC: int = MAX_TURNS_PER_RUBRIC


def canonical_seniority_band(seniority: str | None, *, entry_level: bool = False) -> str:
    """Map a job-profile seniority string to JUNIOR, MID, or SENIOR.

    Job Details stores Junior, Mid-level, Senior, and Staff/Principal (value "lead").
    Staff/Principal is treated as Junior for question depth until that option is split.
    An empty value stays MID only when the profile did not mark the role entry-level.
    """
    sen = (seniority or "").upper().replace("/", " ").replace("-", " ")
    tokens = set(re.findall(r"[A-Z]+", sen))
    if entry_level or tokens & {"JUNIOR", "ENTRY", "FRESHER", "INTERN", "TRAINEE", "GRADUATE"}:
        return "JUNIOR"
    if tokens & {"STAFF", "PRINCIPAL", "LEAD"}:
        return "JUNIOR"
    if tokens & {"SENIOR", "ARCHITECT", "DIRECTOR"}:
        return "SENIOR"
    if "MID" in tokens:
        return "MID"
    return "MID"


def max_turns_for_seniority(seniority: str | None, *, entry_level: bool = False) -> int:
    """Safety ceiling for rounds that do not use a saved question plan."""
    del seniority, entry_level
    return JUNIOR_MAX_TURNS_PER_RUBRIC


def default_question_plan(seniority: str | None, *, entry_level: bool = False) -> dict[str, Any]:
    """Initial category counts for a new rubric. Not a hard cap on later edits."""
    band = canonical_seniority_band(seniority, entry_level=entry_level)
    targets = DIMENSION_TARGETS[band]
    plan: dict[str, Any] = {
        key: {
            "enabled": int(targets[dim]) > 0,
            "count": int(targets[dim]),
        }
        for key, dim in _QUESTION_PLAN_CATEGORIES
    }
    plan["max_total_questions"] = DEFAULT_QUESTION_PLAN_MAX
    return plan


def question_plan_error(raw: Any) -> str | None:
    """Reject plans whose primary questions cannot fit in the maximum.

    Returns an error string, or None when the plan is usable. Does not drop
    categories to force a fit.
    """
    if not isinstance(raw, dict):
        return "Question plan must be an object."
    primary = 0
    enabled_categories = 0
    for key, _dim in _QUESTION_PLAN_CATEGORIES:
        slot = raw.get(key)
        if not isinstance(slot, dict):
            return f"Question plan is missing {key}."
        enabled = bool(slot.get("enabled"))
        try:
            count = int(slot.get("count") or 0)
        except (TypeError, ValueError):
            return f"{key} question count must be a whole number."
        if count < 0 or count > _QUESTION_PLAN_MAX_CATEGORY:
            return f"{key} question count must be between 0 and {_QUESTION_PLAN_MAX_CATEGORY}."
        if enabled:
            if count < 1:
                return f"Set at least 1 question for {key}, or turn that category off."
            enabled_categories += 1
            primary += count
    if enabled_categories < 1:
        return "Enable at least one question category."
    raw_max = raw.get("max_total_questions")
    if raw_max is None:
        return "Maximum questions must be a whole number."
    try:
        maximum = int(raw_max)
    except (TypeError, ValueError):
        return "Maximum questions must be a whole number."
    if maximum < 1 or maximum > _QUESTION_PLAN_MAX_TOTAL:
        return f"Maximum questions must be between 1 and {_QUESTION_PLAN_MAX_TOTAL}."
    if primary > maximum:
        return (
            f"Primary questions ({primary}) exceed the maximum ({maximum}). "
            "Raise the maximum or lower a category count."
        )
    return None


def resolve_question_plan(
    raw: Any,
    seniority: str | None,
    *,
    entry_level: bool = False,
) -> tuple[dict[EvidenceDimension, int], int]:
    """Saved plan when valid. Seniority defaults when missing or invalid.

    An invalid saved plan is not trimmed. The interview keeps the valid
    seniority default instead of dropping a required category.
    """
    if raw is None:
        chosen = default_question_plan(seniority, entry_level=entry_level)
    else:
        error = question_plan_error(raw)
        if error:
            _pacing_logger.warning(
                "Ignoring invalid rubric question plan (%s); using seniority defaults",
                error,
            )
            chosen = default_question_plan(seniority, entry_level=entry_level)
        else:
            chosen = raw
    targets: dict[EvidenceDimension, int] = {
        "FOUNDATIONAL": 0,
        "TECHNICAL_APPLIED": 0,
        "PROBLEM_SOLVING": 0,
        "RESUME_VALIDATION": 0,
    }
    for key, dim in _QUESTION_PLAN_CATEGORIES:
        slot = chosen.get(key) if isinstance(chosen, dict) else None
        if not isinstance(slot, dict) or not slot.get("enabled"):
            continue
        targets[dim] = int(slot.get("count") or 0)
    return targets, int(chosen["max_total_questions"])
MAX_FOLLOW_UP_DEPTH: int = 1
MAX_PRIMARY_QUESTIONS_PER_RUBRIC: int = MAX_TURNS_PER_RUBRIC
MAX_FOLLOWUPS_PER_PRIMARY: int = 1
_PLAN_DIMENSION_ORDER: tuple[EvidenceDimension, ...] = (
    "FOUNDATIONAL",
    "TECHNICAL_APPLIED",
    "PROBLEM_SOLVING",
    "RESUME_VALIDATION",
)
_PLAN_DIMENSION_SOURCE: dict[str, QuestionSource] = {
    "FOUNDATIONAL": "PRACTICAL",
    "TECHNICAL_APPLIED": "TECHNICAL",
    "PROBLEM_SOLVING": "TECHNICAL",
    "RESUME_VALIDATION": "RESUME_VALIDATION",
}
_PLAN_DIMENSION_ANGLE: dict[str, str] = {
    "FOUNDATIONAL": "everyday use",
    "TECHNICAL_APPLIED": "technical application",
    "PROBLEM_SOLVING": "problem solving and architecture",
    "RESUME_VALIDATION": "a real project from the resume",
}
_FOLLOWUP_UNDERSTANDING = frozenset({"WEAK", "MISCONCEPTION", "NO_KNOWLEDGE", "SKIP"})
# Ceiling is already 50; keep extension disabled so we never exceed the plan max.
ONE_TIME_EXTENSION_MINUTES: int = 0
ONE_TIME_EXTENSION_CHECK_TURN: int = 6
AVG_TURN_THRESHOLD_SECONDS: int = 100
RUBRIC_TIME_PRESSURE_FACTOR: float = 1.2  # 120% of target


def _item_counts_toward_coverage(item: EvidenceItem) -> bool:
    """Intro/background icebreakers are stored but never advance rubric coverage."""
    if is_intro_background_concept(item.concept_tested):
        return False
    return True


def _item_is_strong(item: EvidenceItem) -> bool:
    if not _item_counts_toward_coverage(item):
        return False
    return (
        item.is_meaningful
        and item.is_substantive
        and item.answer_class not in ("skip", "noise")
        and item.understanding_level == "STRONG"
        and int(item.internal_score_10) >= 8
    )


def _item_is_medium_or_better(item: EvidenceItem) -> bool:
    if not _item_counts_toward_coverage(item):
        return False
    if not item.is_meaningful or not item.is_substantive:
        return False
    if item.answer_class in ("skip", "noise"):
        return False
    if item.understanding_level in ("STRONG", "MODERATE"):
        return True
    return False


def _item_is_weak_attempt(item: EvidenceItem) -> bool:
    """Meaningful weak evidence that consumes a weak-path attempt."""
    if not _item_counts_toward_coverage(item):
        return False
    if not item.is_meaningful:
        return False
    if item.answer_class == "dont_know":
        return True
    return item.understanding_level in ("WEAK", "MISCONCEPTION", "NO_KNOWLEDGE")


def _item_is_substantive_evidence(item: EvidenceItem) -> bool:
    if not _item_counts_toward_coverage(item):
        return False
    return (
        item.is_meaningful
        and item.is_substantive
        and item.answer_class not in ("skip", "noise")
    )


def _item_is_non_resume_substantive(item: EvidenceItem) -> bool:
    """Substantive competency evidence from a TECHNICAL or PRACTICAL question.

    Step 3.5/3.6 coverage gate: SUFFICIENT requires at least one such item.
    RESUME_VALIDATION and FOLLOW_UP (including resume-rooted follow-ups) do
    NOT satisfy this gate — competency must be shown on a genuine
    technical/practical question.
    """
    if not _item_is_substantive_evidence(item):
        return False
    return normalize_question_source(item.question_source) in ("TECHNICAL", "PRACTICAL")


def _has_non_resume_substantive(items: list[EvidenceItem]) -> bool:
    return any(_item_is_non_resume_substantive(it) for it in items)


def _item_is_resume_substantive(item: EvidenceItem) -> bool:
    if not _item_is_substantive_evidence(item):
        return False
    return normalize_question_source(item.question_source) == "RESUME_VALIDATION"


def has_resume_validation_evidence(items: list[EvidenceItem]) -> bool:
    return any(_item_is_resume_substantive(it) for it in items)


def has_strong_non_resume(items: list[EvidenceItem]) -> bool:
    return any(
        _item_is_strong(it) and _item_is_non_resume_substantive(it) for it in items
    )


def has_strong_resume(items: list[EvidenceItem]) -> bool:
    return any(
        _item_is_strong(it)
        and normalize_question_source(it.question_source) == "RESUME_VALIDATION"
        for it in items
    )


def medium_non_resume_concept_count(items: list[EvidenceItem]) -> int:
    concepts = {
        (it.concept_tested or "").strip()
        for it in items
        if _item_is_medium_or_better(it) and _item_is_non_resume_substantive(it)
        and (it.concept_tested or "").strip()
    }
    return len(concepts)


def has_post_strong_confirm(items: list[EvidenceItem]) -> bool:
    """True when a strong non-resume turn is followed by later medium+/challenge."""
    strong_idxs = [
        idx
        for idx, it in enumerate(items)
        if _item_is_strong(it) and _item_is_non_resume_substantive(it)
    ]
    if not strong_idxs:
        return False
    first_strong = strong_idxs[0]
    return any(
        idx > first_strong
        and _item_is_medium_or_better(it)
        and _item_is_substantive_evidence(it)
        for idx, it in enumerate(items)
    )


def tech_evidence_good_enough(items: list[EvidenceItem]) -> bool:
    """Technical depth ready to allow a resume question (does not close the pack)."""
    if has_strong_non_resume(items):
        return True
    medium_plus = [
        it
        for it in items
        if _item_is_medium_or_better(it) and _item_is_non_resume_substantive(it)
    ]
    if medium_non_resume_concept_count(items) >= 2:
        return True
    if len(medium_plus) >= 3:
        return True
    return False


def last_substantive_item(items: list[EvidenceItem]) -> EvidenceItem | None:
    for it in reversed(items):
        if _item_is_substantive_evidence(it) or _item_is_weak_attempt(it):
            return it
    return None


def last_item_was_resume(items: list[EvidenceItem]) -> bool:
    last = last_substantive_item(items)
    if last is None:
        return False
    return normalize_question_source(last.question_source) == "RESUME_VALIDATION"


def _resume_corpus(
    job_profile_context: dict[str, Any] | None,
    resume_skills: list[str] | None,
    verified_claims: list[str] | None,
) -> str:
    parts: list[str] = []
    ctx = job_profile_context or {}
    for key in ("resume_projects", "resume_experience", "resume_summary"):
        val = ctx.get(key)
        if val:
            parts.append(str(val))
    if resume_skills:
        parts.append(" ".join(str(s) for s in resume_skills if s))
    if verified_claims:
        parts.append(" ".join(str(c) for c in verified_claims if c))
    return " ".join(parts).casefold()


def _significant_tokens(text: str) -> set[str]:
    raw = re.findall(r"[a-z0-9][a-z0-9+.#-]{2,}", (text or "").casefold())
    stop = {
        "and",
        "the",
        "for",
        "with",
        "from",
        "that",
        "this",
        "your",
        "their",
        "about",
        "into",
        "using",
        "based",
        "development",
        "fundamentals",
        "thinking",
        "logical",
        "problem",
        "solving",
        "soft",
        "skill",
        "skills",
    }
    return {t for t in raw if t not in stop}


# Deterministic rubric ↔ resume synonyms (not bare 2-letter matching alone).
_RUBRIC_TERM_SYNONYMS: dict[str, tuple[str, ...]] = {
    "ai": (
        "artificial intelligence",
        "machine learning",
        "deep learning",
        "neural network",
        "tensorflow",
        "pytorch",
        "scikit",
        "model training",
        "nlp",
        "computer vision",
    ),
    "ml": (
        "machine learning",
        "deep learning",
        "supervised learning",
        "unsupervised learning",
        "tensorflow",
        "pytorch",
        "scikit",
        "model training",
        "feature engineering",
    ),
    "llm": (
        "large language model",
        "language model",
        "prompt",
        "generative",
        "gpt",
        "rag",
    ),
    "nlp": ("natural language", "nlp", "text classification", "transformer"),
    "php": ("php", "laravel", "backend", "restful"),
    "python": ("django", "fastapi", "flask", "pandas"),
    "deep learning": ("lstm", "tensorflow", "keras", "pytorch", "cnn", "neural network"),
    "sql": ("sql", "mysql", "postgresql", "postgres", "database", "query"),
    "database": ("database", "sql", "mysql", "postgres", "indexing", "schema"),
    "backend": ("backend", "api", "server", "php", "laravel", "nodejs"),
    "api": ("api", "rest", "endpoint", "integration"),
    "python": ("python", "django", "flask", "fastapi", "pandas"),
    "cv": ("opencv", "open cv", "computer vision", "image processing"),
    "opencv": ("opencv", "open cv", "computer vision", "image processing"),
    "deep": ("deep learning", "neural network", "convolutional", "cnn"),
    "machine": ("machine learning", "classification", "scikit", "llm", "rag"),
}


def _rubric_match_terms(label: str) -> set[str]:
    """Expand a rubric label into match terms via tokens + curated synonyms."""
    text = (label or "").casefold()
    terms: set[str] = set(_significant_tokens(text))
    # Explicit short tech markers (only as synonym keys — expanded below).
    for short in re.findall(r"\b(ai|ml|llm|nlp|php|sql|api|cv)\b", text):
        terms.add(short)
    phrase = re.sub(r"\s+", " ", text).strip()
    if len(phrase) >= 5:
        terms.add(phrase)
    # Slash compounds: ai/ml, ml/ai
    if re.search(r"\bai\s*/\s*ml\b", text) or re.search(r"\bml\s*/\s*ai\b", text):
        terms.update(("ai", "ml"))
    expanded: set[str] = set(terms)
    for key in list(terms):
        for syn in _RUBRIC_TERM_SYNONYMS.get(key, ()):
            expanded.add(syn.casefold())
            expanded.update(_significant_tokens(syn))
    # Drop ultra-short keys after expansion so matching uses synonyms/phrases.
    return {t for t in expanded if len(t) >= 3 or t in _RUBRIC_TERM_SYNONYMS}


def relevant_resume_claim_available(
    rubric_key: str | None,
    *,
    job_profile_context: dict[str, Any] | None = None,
    resume_skills: list[str] | None = None,
    verified_claims: list[str] | None = None,
    rubric_criteria: list[dict[str, Any]] | None = None,
) -> bool:
    """True when resume text has meaningful overlap with the active rubric.

    Uses token overlap plus curated synonyms (e.g. AI/ML ↔ machine learning).
    Generic project presence alone is not enough.
    """
    corpus = _resume_corpus(job_profile_context, resume_skills, verified_claims)
    if not corpus.strip():
        return False

    label = (rubric_key or "").strip()
    id_part = ""
    if rubric_criteria and label:
        matched = _match_rubric_crit(label, rubric_criteria)
        if matched is not None:
            label = rubric_display_name(matched) or label
            id_part = str(matched.get("id") or "")

    terms = _rubric_match_terms(label) | _rubric_match_terms(id_part)
    if not terms:
        return False
    corpus_tokens = _significant_tokens(corpus)
    # Phrase / synonym substring match (preferred for AI/ML ↔ machine learning).
    for term in terms:
        if len(term) >= 3 and term in corpus:
            return True
    if terms & corpus_tokens:
        return True
    return False


def spoken_looks_resume_grounded(
    question_text: str,
    *,
    resume_anchor: str | None = None,
    job_profile_context: dict[str, Any] | None = None,
) -> bool:
    """True when spoken text clearly references a resume project/claim."""
    q = (question_text or "").casefold()
    if not q.strip():
        return False
    markers = (
        "resume",
        "your project",
        "on your ",
        "in your ",
        "you built",
        "you developed",
        "you mentioned",
        "your experience",
        "past work",
        "when you worked",
        "on that project",
    )
    if any(m in q for m in markers):
        return True
    anchors: list[str] = []
    if resume_anchor and str(resume_anchor).strip():
        anchors.append(str(resume_anchor).strip())
    ctx = job_profile_context or {}
    projects = str(ctx.get("resume_projects") or "")
    for chunk in re.split(r"[;\n]", projects):
        chunk = chunk.strip()
        if len(chunk) >= 4:
            anchors.append(chunk)
    for anchor in anchors:
        # Prefer distinctive quoted/title-like tokens (e.g. DSA World).
        for m in re.findall(r"'([^']+)'|\"([^\"]+)\"", anchor):
            name = (m[0] or m[1] or "").strip().casefold()
            if len(name) >= 3 and name in q:
                return True
        for tok in _significant_tokens(anchor):
            if len(tok) >= 4 and tok in q:
                return True
    return False


def resume_question_uses_unrelated_project(
    question_text: str,
    rubric_label: str,
    job_profile_context: dict[str, Any] | None,
) -> bool:
    """True when the spoken question names a resume project that does not match this rubric."""
    question = (question_text or "").casefold()
    if not question.strip() or not (rubric_label or "").strip():
        return False
    named = [
        chunk
        for chunk in _resume_project_chunks(job_profile_context)
        if any(len(token) >= 6 and token in question for token in _significant_tokens(chunk))
    ]
    if not named:
        return False
    return all(_project_rubric_score(chunk, rubric_label) == 0 for chunk in named)


def normalize_persisted_question_source(
    declared: QuestionSource | str | None,
    question_text: str,
    *,
    resume_anchor: str | None = None,
    job_profile_context: dict[str, Any] | None = None,
) -> QuestionSource:
    """Downgrade fake RESUME_VALIDATION when spoken Q is not resume-grounded."""
    src = normalize_question_source(declared)
    if src != "RESUME_VALIDATION":
        return src
    if spoken_looks_resume_grounded(
        question_text,
        resume_anchor=resume_anchor,
        job_profile_context=job_profile_context,
    ):
        return "RESUME_VALIDATION"
    return "TECHNICAL"


def same_concept_weak_streak(
    items: list[EvidenceItem],
    *,
    concept: str | None,
) -> int:
    """Count trailing weak/IDK answers on the same concept family."""
    needle_fp = _normalize_concept_key(concept or "")
    if not needle_fp:
        return 0
    streak = 0
    for it in reversed(items):
        if not _item_is_weak_attempt(it):
            break
        other_fp = _normalize_concept_key(it.concept_fingerprint or it.concept_tested or "")
        if not other_fp:
            break
        
        # 1. Exact match on stable fingerprint (from Cache)
        if needle_fp and other_fp and needle_fp == other_fp:
            streak += 1
        # 2. Fallback to legacy token overlap for cache misses
        elif _concepts_same_family(needle_fp, other_fp):
            streak += 1
        else:
            break
    return streak


def _normalize_concept_key(value: str) -> str:
    text = (value or "").casefold()
    text = re.sub(r"[^a-z0-9\s]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _concepts_same_family(a: str, b: str) -> bool:
    """True when concept strings are the same micro-topic family."""
    if not a or not b:
        return False
    if a == b or a in b or b in a:
        return True
    ta, tb = set(a.split()), set(b.split())
    # Shared distinctive token (e.g. retry across "retry config" / "retry factors").
    shared = {t for t in (ta & tb) if len(t) >= 4}
    return bool(shared)


def should_escape_same_concept_weak_loop(
    items: list[EvidenceItem],
    *,
    concept: str | None,
    last_understanding_level: str | None,
    min_streak: int = 2,
) -> bool:
    """True when candidate repeatedly fails the same micro-topic."""
    level = (last_understanding_level or "").strip().upper()
    if level not in ("WEAK", "NO_KNOWLEDGE", "MISCONCEPTION"):
        # Streak already includes the just-appended item; still allow based on streak.
        pass
    return same_concept_weak_streak(items, concept=concept) >= min_streak


def should_defer_pivot_for_resume(
    pack: RubricEvidencePack | None,
    *,
    claim_ok: bool,
) -> bool:
    """True when tech closed the pack but a relevant resume question is still owed.

    Selection-timing only: does not change coverage thresholds. Caller should
    stay on this rubric and ask RESUME_VALIDATION before pivoting.
    """
    if not pack or not claim_ok:
        return False
    if pack.coverage_state != "SUFFICIENT":
        return False
    # Only after strong/medium tech-complete paths — not weak_exhausted / safety.
    if pack.exit_reason not in ("strong_early_exit", "medium_complete"):
        return False
    if not _has_non_resume_substantive(pack.items):
        return False
    if has_resume_validation_evidence(pack.items):
        return False
    return True


_WEAK_PROJECT_TERMS = frozenset(
    {
        "learning",
        "machine",
        "model",
        "models",
        "data",
        "using",
        "system",
        "platform",
        "management",
        "project",
        "open",
        "work",
        "used",
    }
)
_SHORT_PROJECT_MARKERS = frozenset({"llm", "rag", "cnn", "sql", "php", "api", "nlp", "lstm"})


def _spoken_project_title(chunk: str) -> str:
    """Short project name safe to say aloud. Drops bullet numbers and descriptions."""
    text = re.sub(r"^\s*\d+\s*[.)]\s*", "", (chunk or "").strip())
    text = text.strip(" \t-•*")
    if ":" in text:
        head, tail = text.split(":", 1)
        if len(tail.strip()) > 24 and 4 <= len(head.strip()) <= 90:
            text = head.strip()
    text = re.split(r"[\n.]", text, maxsplit=1)[0].strip()
    return text[:90]


def _resume_project_chunks(job_profile_context: dict[str, Any] | None) -> list[str]:
    ctx = job_profile_context or {}
    projects = str(ctx.get("resume_projects") or "").strip()
    pieces = re.split(r"\s+(?=\d+\s*[.)]\s+\S)", projects)
    raw_parts: list[str] = []
    for piece in pieces:
        raw_parts.extend(re.split(r"\n\s*\n|;|\n", piece))
    chunks: list[str] = []
    seen: set[str] = set()
    for chunk in raw_parts:
        text = chunk.strip(" \t-•*")
        if len(text) < 8:
            continue
        key = text.casefold()
        if key in seen:
            continue
        seen.add(key)
        chunks.append(text)
    return chunks


def _project_rubric_score(project_text: str, rubric_label: str) -> int:
    """How specifically this project text matches one rubric. Zero means unrelated."""
    terms = _rubric_match_terms(rubric_label)
    text = (project_text or "").casefold()
    if not text or not terms:
        return 0
    score = 0
    for term in terms:
        if term in _WEAK_PROJECT_TERMS:
            continue
        if len(term) < 5 and " " not in term and term not in _SHORT_PROJECT_MARKERS:
            continue
        if term in text:
            score += 3 if " " in term else 1
    return score


def pick_resume_anchor(
    job_profile_context: dict[str, Any] | None,
    *,
    existing: str | None = None,
    rubric_label: str | None = None,
    avoid: list[str] | None = None,
) -> str | None:
    """Pick a short project title for this rubric.

    Returns a name that can be spoken. Bullet numbers and description text stay out.
    When several projects match, one already used in this interview is saved for later.
    """
    existing_text = str(existing).strip() if existing and str(existing).strip() else ""
    label = (rubric_label or "").strip()
    chunks = _resume_project_chunks(job_profile_context)
    avoided = {_spoken_project_title(item).casefold() for item in (avoid or []) if item}

    def _choose(rows: list[tuple[int, int, str]]) -> str | None:
        if not rows:
            return None
        fresh = [row for row in rows if _spoken_project_title(row[2]).casefold() not in avoided]
        chosen = (fresh or rows)[0][2]
        title = _spoken_project_title(chosen)
        return title or None

    if label:
        scored = [
            (_project_rubric_score(chunk, label), index, chunk)
            for index, chunk in enumerate(chunks)
        ]
        scored = [row for row in scored if row[0] > 0]
        scored.sort(key=lambda row: (-row[0], row[1]))
        best_score = scored[0][0] if scored else 0
        if existing_text and _project_rubric_score(existing_text, label) > 0:
            if _project_rubric_score(existing_text, label) >= best_score:
                title = _spoken_project_title(existing_text)
                if title.casefold() not in avoided or not scored:
                    return title or None
        return _choose(scored)
    if existing_text:
        return _spoken_project_title(existing_text) or None
    if chunks:
        return _choose([(1, index, chunk) for index, chunk in enumerate(chunks)])
    experience = str((job_profile_context or {}).get("resume_experience") or "").strip()
    if experience:
        return _spoken_project_title(experience) or None
    return None


@dataclass
class CandidateKnowledgeState:
    active_competency: str | None = None
    active_concept: str | None = None
    current_difficulty: Literal["JUNIOR", "MID", "SENIOR"] = "MID"
    follow_up_depth: int = 0
    concept_map: dict[str, ConceptNode] = field(default_factory=dict)
    verified_resume_claims: list[str] = field(default_factory=list)
    identified_weaknesses: list[str] = field(default_factory=list)
    tested_competencies: set[str] = field(default_factory=set)
    competency_scores: dict[str, list[int]] = field(default_factory=dict)
    turn_evaluations: list[dict[str, Any]] = field(default_factory=list)
    # Step 1 — per-rubric evidence packs (key = competency id or label).
    evidence_packs: dict[str, RubricEvidencePack] = field(default_factory=dict)
    start_time: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    target_duration_mins: int = BASE_DURATION_MINUTES
    # --- Phase 3.5: Pacing & Coverage Guardrails ---
    turns_per_competency: dict[str, int] = field(default_factory=dict)
    time_per_competency: dict[str, float] = field(default_factory=dict)
    resume_question_count: int = 0
    hard_ceiling_mins: int = HARD_CEILING_MINUTES
    _ceiling_extension_applied: bool = False
    _last_turn_monotonic: float = field(default_factory=_time.monotonic)
    # Observability side-channel only (INTERVIEW_TRACE); never used for decisions.
    _last_coverage_condition: str | None = None
    # Step 3.5 — per-session concept-area lists (one generate per rubric key).
    concept_area_cache: ConceptAreaCache = field(default_factory=ConceptAreaCache)
    # Phase 4 — Difficulty Tiers
    tier_per_rubric: dict[str, DifficultyTier] = field(default_factory=dict)
    # Asked questions, not scored answers. Follow-ups do not increment primary_asked.
    primary_asked: dict[str, int] = field(default_factory=dict)
    followup_asked: dict[str, int] = field(default_factory=dict)
    followup_open: dict[str, bool] = field(default_factory=dict)
    open_dimension: dict[str, str] = field(default_factory=dict)
    dimension_primaries: dict[str, dict[str, int]] = field(default_factory=dict)
    pending_question_plan: dict[str, Any] | None = None
    # Weightage planner (AI Verbal). Built once per session. Legacy rounds leave this empty.
    verbal_plan: dict[str, Any] | None = None
    asked_slots: set[int] = field(default_factory=set)
    slot_followups: dict[int, int] = field(default_factory=dict)
    open_competency: dict[str, str] = field(default_factory=dict)
    competency_evidence: dict[str, dict[str, str]] = field(default_factory=dict)
    last_evidence_result: dict[str, Any] | None = None
    used_resume_anchors: list[str] = field(default_factory=list)

    def get_or_init_tier(self, rubric_key: str, is_entry_level: bool, seniority: str | None) -> DifficultyTier:
        key = (rubric_key or "general").strip() or "general"
        if key not in self.tier_per_rubric:
            if is_entry_level or canonical_seniority_band(seniority, entry_level=is_entry_level) == "JUNIOR":
                self.tier_per_rubric[key] = "FOUNDATIONAL"
            elif canonical_seniority_band(seniority) == "SENIOR":
                    self.tier_per_rubric[key] = "DESIGN"
            else:
                    self.tier_per_rubric[key] = "APPLIED"
        return self.tier_per_rubric[key]

    def ensure_evidence_pack(self, rubric_key: str) -> RubricEvidencePack:
        """Create pack if missing; coverage_state=INSUFFICIENT, exit_reason=null."""
        key = (rubric_key or "general").strip() or "general"
        pack = self.evidence_packs.get(key)
        if pack is None:
            pack = RubricEvidencePack(
                rubric_key=key,
                coverage_state="INSUFFICIENT",
                exit_reason=None,
                items=[],
                frozen=False,
            )
            self.evidence_packs[key] = pack
        return pack

    def get_evidence_pack(self, rubric_key: str) -> RubricEvidencePack | None:
        key = (rubric_key or "general").strip() or "general"
        return self.evidence_packs.get(key)

    def append_evidence(
        self,
        *,
        rubric_key: str,
        question: str,
        answer_verbatim: str,
        understanding_level: UnderstandingLevel,
        internal_score_10: int,
        evidence_notes: str = "",
        resume_anchor: str | None = None,
        concept_tested: str = "",
        concept_fingerprint: str = "",
        probe_kind: ProbeKind | None = None,
        action_mode: str | None = None,
        question_source: QuestionSource | str | None = None,
        rubric_criteria: list[dict[str, Any]] | None = None,
        fallback_rubric_key: str | None = None,
        evidence_dimension: EvidenceDimension | None = None,
        question_difficulty: DifficultyTier | None = None,
    ) -> EvidenceItem:
        """Append one evidence row to a rubric pack (including skips/noise).

        When rubric_criteria is provided, rubric_key is canonicalized to the
        rubric id before the pack is touched (never creates orphan keys).
        """
        if rubric_criteria is not None:
            rubric_key = canonicalize_rubric_key(
                rubric_key,
                rubric_criteria,
                fallback_candidate=fallback_rubric_key,
            )
        pack = self.ensure_evidence_pack(rubric_key)
        is_meaningful, is_substantive, answer_class = classify_answer_text(
            answer_verbatim,
            understanding_level=understanding_level,
        )
        kind: ProbeKind = probe_kind or probe_kind_from_action_mode(action_mode)
        item = EvidenceItem(
            question=question or "",
            answer_verbatim=answer_verbatim or "",
            understanding_level=understanding_level,
            internal_score_10=int(internal_score_10),
            evidence_notes=evidence_notes or "",
            resume_anchor=resume_anchor,
            concept_tested=(concept_tested or "").strip(),
            concept_fingerprint=(concept_fingerprint or "").strip(),
            probe_kind=kind,
            is_meaningful=is_meaningful,
            is_substantive=is_substantive,
            answer_class=answer_class,
            action_mode=action_mode,
            question_source=normalize_question_source(question_source),
            evidence_dimension=evidence_dimension,
            question_difficulty=question_difficulty,
        )
        pack.items.append(item)

        # Phase 5 - Track evidence dimensions for substantive answers
        if is_substantive and evidence_dimension:
            pack.dimension_counts[evidence_dimension] += 1

        # Phase 4 - Dynamic difficulty tier adjustment has been disabled per user requirements
        # (Tier remains locked to the initial seniority level)

        _pack, condition = self.recompute_rubric_coverage_explained(rubric_key)
        # Side-channel for INTERVIEW_TRACE only (never read by decision logic).
        self._last_coverage_condition = condition
        return item

    def recompute_rubric_coverage(self, rubric_key: str) -> RubricEvidencePack:
        """Deterministic Rules 1+3 coverage transitions from the evidence pack."""
        pack, _condition = self.recompute_rubric_coverage_explained(rubric_key)
        return pack

    def recompute_rubric_coverage_explained(
        self, rubric_key: str
    ) -> tuple[RubricEvidencePack, str]:
        """Same transitions as recompute_rubric_coverage, plus a code-level condition string.

        Observability helper — does not change transition outcomes.
        """
        pack = self.ensure_evidence_pack(rubric_key)
        if pack.frozen:
            return pack, "pack.frozen=True → no transition"
        # Once probing is complete, keep the closed state.
        if pack.coverage_state == "SUFFICIENT" and pack.exit_reason is not None:
            pack.frozen = True
            return (
                pack,
                f"already closed: coverage_state=SUFFICIENT, exit_reason={pack.exit_reason} → no transition",
            )

        items = list(pack.items)
        # Required categories and the 5-primary cap close a rubric in note_planned_question.
        # Answer quality must not close it: three strong answers used to freeze a topic
        # before foundation, problem-solving, or resume had been asked.
        pack.coverage_state = "PARTIAL" if items else "INSUFFICIENT"
        pack.exit_reason = None
        if not items:
            trigger = "empty pack → CONTINUE"
        else:
            intro_excluded = [
                it for it in items if is_intro_background_concept(it.concept_tested)
            ]
            countable = [it for it in items if _item_counts_toward_coverage(it)]
            if intro_excluded and not countable:
                trigger = "only intro/background-excluded evidence → CONTINUE"
            elif intro_excluded and countable:
                trigger = (
                    "only intro/background-excluded and/or skips/noise → CONTINUE"
                )
            else:
                trigger = "only skips/noise → CONTINUE"
        return (
            pack,
            f"coverage_state=INSUFFICIENT, exit_reason=None, trigger={trigger}",
        )

    def record_turn_evaluation(self, eval_res: EvaluationResult) -> None:
        """Update candidate knowledge state with new turn evaluation evidence."""
        if eval_res.eval_status == "unscored" or eval_res.internal_score_10 is None:
            self.turn_evaluations.append(eval_res.to_dict())
            return
        concept_key = eval_res.concept_tested.strip() if eval_res.concept_tested else "General"
        
        # Map understanding level to KnowledgeLevel
        if eval_res.understanding_level == "STRONG":
            k_level: KnowledgeLevel = "STRONG"
            strikes = 0
        elif eval_res.understanding_level == "MODERATE":
            k_level = "MODERATE"
            strikes = 0
        elif eval_res.understanding_level in ("WEAK", "MISCONCEPTION", "NO_KNOWLEDGE"):
            k_level = "WEAK"
            existing = self.concept_map.get(concept_key)
            strikes = (existing.strikes + 1) if existing else 1
        else:
            k_level = "NOT_TESTED"
            strikes = 0

        self.concept_map[concept_key] = ConceptNode(
            concept=concept_key,
            level=k_level,
            evidence=eval_res.evidence,
            strikes=strikes,
        )

        # Track claims and gaps
        if eval_res.verified_resume_claim:
            claim = eval_res.verified_resume_claim.strip()
            if claim and claim not in self.verified_resume_claims:
                self.verified_resume_claims.append(claim)

        if eval_res.identified_weakness:
            weakness = eval_res.identified_weakness.strip()
            if weakness and weakness not in self.identified_weaknesses:
                self.identified_weaknesses.append(weakness)

        if eval_res.misconception:
            misc = f"Misconception on {concept_key}: {eval_res.misconception.strip()}"
            if misc not in self.identified_weaknesses:
                self.identified_weaknesses.append(misc)

        # Track internal scores per competency (diagnostic only)
        comp_id = eval_res.competency_id or self.active_competency or "general"
        self.tested_competencies.add(comp_id)
        if comp_id not in self.competency_scores:
            self.competency_scores[comp_id] = []
        self.competency_scores[comp_id].append(int(eval_res.internal_score_10))

        # Log turn evaluation snapshot
        self.turn_evaluations.append(eval_res.to_dict())

    def record_competency_turn(self, competency_id: str | None) -> None:
        """Increment turn count and accumulate time for the given competency."""
        comp = competency_id or self.active_competency or "general"
        now = _time.monotonic()
        turn_mins = max(0.0, (now - self._last_turn_monotonic) / 60.0)
        self._last_turn_monotonic = now
        self.turns_per_competency[comp] = self.turns_per_competency.get(comp, 0) + 1
        self.time_per_competency[comp] = self.time_per_competency.get(comp, 0.0) + turn_mins

    def get_elapsed_and_remaining_minutes(self) -> tuple[float, float]:
        """Return (elapsed_minutes, remaining_minutes_to_ceiling) from start_time.

        Remaining uses hard_ceiling_mins (product max 50), not target_duration_mins.
        The Brain still sees the 30-minute target as a pacing goal; remaining must
        not hit 0 while the ceiling still has budget.
        """
        try:
            start_dt = datetime.fromisoformat(self.start_time)
            if start_dt.tzinfo is None:
                start_dt = start_dt.replace(tzinfo=timezone.utc)
            now_dt = datetime.now(timezone.utc)
            elapsed = max(0.0, (now_dt - start_dt).total_seconds() / 60.0)
        except Exception:
            elapsed = 0.0
        remaining = max(0.0, float(self.hard_ceiling_mins) - elapsed)
        return elapsed, remaining

    def _competency_keys(self, crit: dict) -> tuple[str, str]:
        crit_id = str(crit.get("id") or crit.get("label") or "").strip()
        crit_label = str(crit.get("label") or crit_id).strip()
        return crit_id, crit_label

    def _scores_for_competency(self, crit_id: str, crit_label: str) -> list[int]:
        """Every score filed under this rubric's id or its label.

        The evaluator sometimes stores a turn under the label while another turn
        used the numeric id. Taking only the first key drops the rest.
        """
        keys: list[str] = []
        for key in (crit_id, crit_label):
            if key and key in self.competency_scores and key not in keys:
                keys.append(key)
        needle = normalize_rubric_label_for_match(crit_label or crit_id)
        if needle:
            for key in self.competency_scores:
                if key not in keys and normalize_rubric_label_for_match(key) == needle:
                    keys.append(key)
        scores: list[int] = []
        for key in keys:
            scores.extend(int(value) for value in self.competency_scores[key])
        return scores

    def _turns_for_competency(self, crit_id: str, crit_label: str) -> int:
        if crit_id and crit_id in self.turns_per_competency:
            return int(self.turns_per_competency[crit_id])
        if crit_label and crit_label in self.turns_per_competency:
            return int(self.turns_per_competency[crit_label])
        return 0

    def _time_for_competency(self, crit_id: str, crit_label: str) -> float:
        if crit_id and crit_id in self.time_per_competency:
            return float(self.time_per_competency[crit_id])
        if crit_label and crit_label in self.time_per_competency:
            return float(self.time_per_competency[crit_label])
        return 0.0

    def is_competency_sufficiently_covered(self, crit: dict) -> bool:
        """True when the rubric evidence pack is SUFFICIENT (Rules 1+3).

        Retired: turn-count (>=2) and mean(internal_score_10) >= target_score.
        """
        pack = self._evidence_pack_for_crit(crit)
        return bool(pack and pack.coverage_state == "SUFFICIENT")

    def is_rubric_frozen(self, crit: dict) -> bool:
        pack = self._evidence_pack_for_crit(crit)
        return bool(pack and pack.frozen)

    def _evidence_pack_for_crit(self, crit: dict) -> RubricEvidencePack | None:
        crit_id, crit_label = self._competency_keys(crit)
        if crit_id and crit_id in self.evidence_packs:
            return self.evidence_packs[crit_id]
        if crit_label and crit_label in self.evidence_packs:
            return self.evidence_packs[crit_label]
        # Leading-dot tolerant label lookup against pack keys / stored labels.
        needle = normalize_rubric_label_for_match(crit_label or crit_id)
        if needle:
            for key, pack in self.evidence_packs.items():
                if normalize_rubric_label_for_match(key) == needle:
                    return pack
                if normalize_rubric_label_for_match(pack.rubric_key) == needle:
                    return pack
        return None

    def get_untested_competencies(self, rubric_criteria: list[dict]) -> list[dict]:
        """Return rubrics still needing probing (not SUFFICIENT, not frozen), weight desc."""
        untested = [
            crit
            for crit in rubric_criteria
            if not self.is_competency_sufficiently_covered(crit)
            and not self.is_rubric_frozen(crit)
        ]
        untested.sort(key=lambda c: float(c.get("weight_pct", 0) or 0), reverse=True)
        return untested

    def get_zero_touch_rubrics(self, rubric_criteria: list[dict]) -> list[dict]:
        """Return required rubrics with zero substantive evidence turns, weight desc."""
        zero_touch = []
        for crit in rubric_criteria:
            if crit.get("is_optional", False):
                continue
            
            pack = self._evidence_pack_for_crit(crit)
            if not pack:
                zero_touch.append(crit)
                continue
            
            substantive_items = [item for item in pack.items if item.is_substantive]
            if not substantive_items:
                zero_touch.append(crit)
                
        zero_touch.sort(key=lambda c: float(c.get("weight_pct", 0) or 0), reverse=True)
        return zero_touch


    def _plan_key(self, rubric_key: str, rubric_criteria: list[dict[str, Any]] | None) -> str:
        return canonicalize_rubric_key(
            rubric_key,
            rubric_criteria,
            fallback_candidate=rubric_key,
        )

    def dimension_gap(
        self,
        rubric_key: str,
        seniority: str | None,
        *,
        entry_level: bool = False,
        rubric_criteria: list[dict[str, Any]] | None = None,
        configured_plans: bool = False,
    ) -> EvidenceDimension | None:
        """Next required category still missing a primary question. Ignores answer quality."""
        key = self._plan_key(rubric_key, rubric_criteria)
        if configured_plans:
            crit = _match_rubric_crit(key, list(rubric_criteria or []))
            raw = crit.get("question_plan") if isinstance(crit, dict) else None
            targets, _maximum = resolve_question_plan(
                raw,
                seniority,
                entry_level=entry_level,
            )
        else:
            band = canonical_seniority_band(seniority, entry_level=entry_level)
            targets = DIMENSION_TARGETS[band]
        asked = self.dimension_primaries.get(key, {})
        for dim in _PLAN_DIMENSION_ORDER:
            if int(targets.get(dim, 0)) > int(asked.get(dim, 0)):
                return dim
        return None

    def primary_count_for(self, crit_id: str | None, crit_label: str | None) -> int:
        """Primary questions asked for a rubric. Zero when the plan tracked other rubrics only."""
        for key in (crit_id, crit_label):
            if key and key in self.primary_asked:
                return int(self.primary_asked[key])
        needle = normalize_rubric_label_for_match(crit_label or crit_id)
        if needle:
            for key, count in self.primary_asked.items():
                if normalize_rubric_label_for_match(key) == needle:
                    return int(count)
        return 0

    def note_planned_question(self) -> None:
        """Count the question that was just spoken. Follow-ups never become a new primary.

        Introductions, repeats, and clarifications never call this. A missing plan
        is a transition and does not spend the rubric budget.
        """
        plan = self.pending_question_plan
        self.pending_question_plan = None
        if not plan:
            return
        key = str(plan.get("key") or "").strip()
        if not key:
            return
        if plan.get("weightage"):
            from verbal_interview_plan import note_weightage_question

            self.pending_question_plan = plan
            note_weightage_question(self)
            return
        configured = bool(plan.get("configured_plans"))
        if plan.get("is_followup"):
            self.followup_open[key] = False
            self.followup_asked[key] = int(self.followup_asked.get(key, 0)) + 1
            if not configured:
                return
        else:
            dimension = str(plan.get("dimension") or "TECHNICAL_APPLIED")
            self.primary_asked[key] = int(self.primary_asked.get(key, 0)) + 1
            dims = self.dimension_primaries.setdefault(key, {})
            dims[dimension] = int(dims.get(dimension, 0)) + 1
            self.open_dimension[key] = dimension
            if not configured:
                self.followup_open[key] = self.primary_asked[key] <= MAX_PRIMARY_QUESTIONS_PER_RUBRIC
        seniority = str(plan.get("seniority") or "")
        entry_level = bool(plan.get("entry_level"))
        criteria = plan.get("criteria") if isinstance(plan.get("criteria"), list) else None
        gap = self.dimension_gap(
            key,
            seniority,
            entry_level=entry_level,
            rubric_criteria=criteria,
            configured_plans=configured,
        )
        pack = self.ensure_evidence_pack(key)
        if not configured:
            if self.primary_asked[key] >= MAX_PRIMARY_QUESTIONS_PER_RUBRIC or gap is None:
                pack.coverage_state = "SUFFICIENT"
                pack.exit_reason = (
                    "safety_ceiling"
                    if self.primary_asked[key] >= MAX_PRIMARY_QUESTIONS_PER_RUBRIC and gap is not None
                    else "plan_complete"
                )
                pack.frozen = True
                # The last primary may still take its one follow-up. No further primary on this rubric.
                self.followup_open[key] = True
            return

        max_total = int(plan.get("max_total") or 0)
        primary_total = int(plan.get("primary_total") or 0)
        buffer = max(0, max_total - primary_total)
        used = int(self.primary_asked.get(key, 0)) + int(self.followup_asked.get(key, 0))
        if not plan.get("is_followup"):
            self.followup_open[key] = (
                int(self.followup_asked.get(key, 0)) < buffer and used < max_total
            )
        if used >= max_total or (gap is None and not self.followup_open.get(key)):
            pack.coverage_state = "SUFFICIENT"
            pack.exit_reason = "safety_ceiling" if gap is not None else "plan_complete"
            pack.frozen = True
            if used >= max_total:
                self.followup_open[key] = False

    def select_next_rubric(self, rubric_criteria: list[dict]) -> dict[str, Any] | None:
        """Highest-weight remaining rubric that is not SUFFICIENT and not frozen."""
        remaining = self.get_untested_competencies(rubric_criteria)
        return remaining[0] if remaining else None

    def crit_for_rubric_key(
        self,
        rubric_key: str,
        rubric_criteria: list[dict],
    ) -> dict[str, Any] | None:
        return _match_rubric_crit(rubric_key, rubric_criteria)

    def calculate_pacing_pressure(
        self,
        rubric_criteria: list[dict],
        current_turn: int,
        max_turns: int,
    ) -> float:
        """Returns ratio (>1.0 means urgency to cover untested areas)."""
        untested = self.get_untested_competencies(rubric_criteria)
        remaining_turns = max(1, max_turns - current_turn)
        return len(untested) / float(remaining_turns)

    def to_dict(self) -> dict:
        return {
            "active_competency": self.active_competency,
            "active_concept": self.active_concept,
            "current_difficulty": self.current_difficulty,
            "follow_up_depth": self.follow_up_depth,
            "concept_map": {
                k: {
                    "concept": v.concept,
                    "level": v.level,
                    "evidence": v.evidence,
                    "strikes": v.strikes,
                }
                for k, v in self.concept_map.items()
            },
            "verified_resume_claims": list(self.verified_resume_claims),
            "identified_weaknesses": list(self.identified_weaknesses),
            "tested_competencies": list(self.tested_competencies),
            "competency_scores": self.competency_scores,
            "turn_evaluations": self.turn_evaluations,
            "evidence_packs": {
                key: pack.to_dict() for key, pack in self.evidence_packs.items()
            },
            "start_time": self.start_time,
            "target_duration_mins": self.target_duration_mins,
            "primary_asked": dict(self.primary_asked),
            "followup_asked": dict(self.followup_asked),
            "dimension_primaries": {
                key: dict(dims) for key, dims in self.dimension_primaries.items()
            },
            "turns_per_competency": dict(self.turns_per_competency),
            "time_per_competency": {k: round(v, 2) for k, v in self.time_per_competency.items()},
            "resume_question_count": self.resume_question_count,
            "hard_ceiling_mins": self.hard_ceiling_mins,
            "primary_question_target": (self.verbal_plan or {}).get("min_primary"),
            "followup_buffer": (self.verbal_plan or {}).get("followup_buffer"),
            "asked_slots": sorted(self.asked_slots),
            "competency_evidence": {
                key: dict(names) for key, names in self.competency_evidence.items()
            },
            "last_evidence_result": self.last_evidence_result,
        }


def _answer_needs_followup(
    *,
    understanding_level: str | None,
    eval_status: str | None,
    user_text: str,
) -> bool:
    """One follow-up is for a thin or unscored answer. A strong answer moves on."""
    if (eval_status or "").strip().lower() == "unscored":
        return True
    level = (understanding_level or "").strip().upper()
    if level in _FOLLOWUP_UNDERSTANDING:
        return True
    if level == "STRONG":
        return False
    return len((user_text or "").split()) < 12


def apply_interview_plan(
    decision: BrainDecision,
    knowledge_state: CandidateKnowledgeState,
    rubric_criteria: list[dict[str, Any]],
    *,
    evaluated_rubric_key: str,
    seniority: str | None,
    entry_level: bool = False,
    understanding_level: str | None = None,
    eval_status: str | None = None,
    user_text: str = "",
    job_profile_context: dict[str, Any] | None = None,
    configured_plans: bool = False,
    resume_skills: list[str] | None = None,
    round_config: dict[str, Any] | None = None,
) -> tuple[BrainDecision, str | None]:
    """Choose the next question from the rubric plan.

    Categories are asked in foundation, technical, problem-solving, then resume order.
    Answer quality cannot skip a required category or invent one that is off.
    When configured_plans is set, the interview-wide minimum and rubric weights
    decide the primary questions. The maximum is the whole budget, follow-ups
    included, and is not used to invent extra primary questions.
    Rounds that pass configured_plans=False keep the older five-primary ceiling.
    """
    criteria = list(rubric_criteria or [])
    if not criteria:
        return decision, None
    if configured_plans:
        from verbal_interview_plan import apply_weightage_plan

        return apply_weightage_plan(
            decision,
            knowledge_state,
            criteria,
            evaluated_rubric_key=evaluated_rubric_key,
            seniority=seniority,
            entry_level=entry_level,
            understanding_level=understanding_level,
            eval_status=eval_status,
            user_text=user_text,
            job_profile_context=job_profile_context,
            resume_skills=resume_skills,
            round_config=round_config,
        )

    def _budget(crit: dict[str, Any]) -> tuple[dict[EvidenceDimension, int], int]:
        if not configured_plans:
            band = canonical_seniority_band(seniority, entry_level=entry_level)
            return DIMENSION_TARGETS[band], MAX_PRIMARY_QUESTIONS_PER_RUBRIC
        return resolve_question_plan(
            crit.get("question_plan"),
            seniority,
            entry_level=entry_level,
        )

    def _slot(crit: dict[str, Any]) -> tuple[str, str, EvidenceDimension | None]:
        key = knowledge_state._plan_key(_crit_canonical_id(crit), criteria)
        label = rubric_display_name(crit) or key
        gap = knowledge_state.dimension_gap(
            key,
            seniority,
            entry_level=entry_level,
            rubric_criteria=criteria,
            configured_plans=configured_plans,
        )
        return key, label, gap

    def _room_for_primary(key: str, crit: dict[str, Any]) -> bool:
        targets, maximum = _budget(crit)
        asked = int(knowledge_state.primary_asked.get(key, 0))
        if not configured_plans:
            return asked < maximum
        followups = int(knowledge_state.followup_asked.get(key, 0))
        return asked < sum(int(v) for v in targets.values()) and (asked + followups) < maximum

    def _remember(
        *,
        key: str,
        label: str,
        dimension: str,
        is_followup: bool,
        crit: dict[str, Any],
    ) -> None:
        targets, maximum = _budget(crit)
        knowledge_state.pending_question_plan = {
            "key": key,
            "label": label,
            "dimension": dimension,
            "is_followup": is_followup,
            "seniority": seniority or "",
            "entry_level": entry_level,
            "criteria": criteria,
            "configured_plans": configured_plans,
            "max_total": maximum,
            "primary_total": sum(int(v) for v in targets.values()),
        }

    evaluated_crit = _match_rubric_crit(evaluated_rubric_key, criteria)
    if evaluated_crit is None and criteria:
        evaluated_crit = criteria[0]
    evaluated_crit = evaluated_crit or criteria[0]
    evaluated_key, evaluated_label, evaluated_gap = _slot(evaluated_crit)
    primary_here = int(knowledge_state.primary_asked.get(evaluated_key, 0))
    followups_here = int(knowledge_state.followup_asked.get(evaluated_key, 0))
    followup_open = bool(knowledge_state.followup_open.get(evaluated_key)) and primary_here > 0
    needs_followup = _answer_needs_followup(
        understanding_level=understanding_level,
        eval_status=eval_status,
        user_text=user_text,
    )
    targets_here, maximum_here = _budget(evaluated_crit)
    primary_total_here = sum(int(v) for v in targets_here.values())
    buffer_here = (
        max(0, maximum_here - primary_total_here) if configured_plans else 1
    )
    followup_allowed = followup_open and needs_followup and (
        (not configured_plans)
        or (
            followups_here < buffer_here
            and (primary_here + followups_here) < maximum_here
        )
    )

    if followup_allowed:
        dimension = knowledge_state.open_dimension.get(evaluated_key) or "TECHNICAL_APPLIED"
        if dimension not in _PLAN_DIMENSION_SOURCE:
            dimension = "TECHNICAL_APPLIED"
        concept = (knowledge_state.active_concept or evaluated_label).strip()
        _remember(
            key=evaluated_key,
            label=evaluated_label,
            dimension=dimension,
            is_followup=True,
            crit=evaluated_crit,
        )
        return (
            BrainDecision.model_validate(
                {
                    **decision.model_dump(),
                    "action_mode": "PROBE_DEPTH",
                    "target_competency": evaluated_label,
                    "target_concept": concept,
                    "question_source": "FOLLOW_UP",
                    "evidence_dimension": dimension,
                    "resume_anchor": None,
                    "system_directive": (
                        f"LOCKED RUBRIC: {evaluated_label}. "
                        f"Ask exactly one follow-up that stays on this same question ({concept}). "
                        "Do not start a new topic and do not switch to another competency."
                    ),
                }
            ),
            "plan_followup",
        )

    if followup_open and not needs_followup:
        knowledge_state.followup_open[evaluated_key] = False
        if configured_plans and evaluated_gap is None:
            finished = knowledge_state.ensure_evidence_pack(evaluated_key)
            finished.coverage_state = "SUFFICIENT"
            finished.exit_reason = "plan_complete"
            finished.frozen = True

    chosen: tuple[str, str, EvidenceDimension, dict[str, Any]] | None = None
    evaluated_pack = knowledge_state.get_evidence_pack(evaluated_key)
    if (
        evaluated_gap is not None
        and _room_for_primary(evaluated_key, evaluated_crit)
        and not (evaluated_pack and evaluated_pack.frozen)
    ):
        chosen = (evaluated_key, evaluated_label, evaluated_gap, evaluated_crit)

    if chosen is None:
        for crit in criteria:
            key, label, gap = _slot(crit)
            if gap is None:
                continue
            if not _room_for_primary(key, crit):
                continue
            pack = knowledge_state.get_evidence_pack(key)
            if pack and pack.frozen:
                continue
            chosen = (key, label, gap, crit)
            break

    if chosen is None:
        knowledge_state.pending_question_plan = None
        return (
            BrainDecision.model_validate(
                {
                    **decision.model_dump(),
                    "action_mode": "WRAP_UP",
                    "system_directive": (
                        "Every required category has been asked. Close the interview."
                    ),
                }
            ),
            "plan_complete",
        )

    key, label, dimension, chosen_crit = chosen
    source = _PLAN_DIMENSION_SOURCE[dimension]
    angle = _PLAN_DIMENSION_ANGLE[dimension]
    anchor = None
    if source == "RESUME_VALIDATION":
        anchor = pick_resume_anchor(
            job_profile_context,
            existing=decision.resume_anchor,
            rubric_label=label,
        )
    directive = (
        f"LOCKED RUBRIC: {label}. LOCKED ANGLE: {angle}. "
        f"Ask ONE new {angle} question about {label} only. "
        "Do not continue the previous topic and do not ask a follow-up."
    )
    if anchor:
        directive += (
            f" Ground it in this resume project only: {anchor}. "
            "Do not name a different project."
        )
    elif source == "RESUME_VALIDATION":
        directive += (
            f" No resume project mentions {label}. "
            f"Ask where they have actually used {label}. "
            "Do not attach an unrelated project."
        )
    _remember(
        key=key,
        label=label,
        dimension=dimension,
        is_followup=False,
        crit=chosen_crit,
    )
    return (
        BrainDecision.model_validate(
            {
                **decision.model_dump(),
                "action_mode": "PIVOT_COMPETENCY",
                "target_competency": label,
                "target_concept": f"{label} — {angle}",
                "question_source": source,
                "evidence_dimension": dimension,
                "resume_anchor": anchor,
                "system_directive": directive,
            }
        ),
        "plan_primary",
    )


def enforce_deterministic_rubric_routing(
    decision: BrainDecision,
    knowledge_state: CandidateKnowledgeState,
    rubric_criteria: list[dict[str, Any]],
    *,
    evaluated_rubric_key: str,
    job_profile_context: dict[str, Any] | None = None,
    resume_skills: list[str] | None = None,
) -> tuple[BrainDecision, str | None]:
    """Single authority for which RUBRIC is active next.

    Brain may choose subtopic/question style inside the locked rubric via
    target_concept / system_directive / action_mode (when not forced to pivot).
    Brain target_competency and tech_pool cannot override the rubric.

    When a rubric is tech-SUFFICIENT but still owes RESUME_VALIDATION for a
    relevant claim, pivot is deferred (selection timing only — coverage math
    unchanged) so the resume question can be asked on the same rubric.
    """
    if not rubric_criteria:
        return decision, None
    if decision.action_mode == "WRAP_UP":
        return decision, None

    evaluated_pack = knowledge_state.get_evidence_pack(evaluated_rubric_key)
    # Also resolve via canonicalize when pack keyed by id vs label.
    if evaluated_pack is None and rubric_criteria:
        canon = canonicalize_rubric_key(
            evaluated_rubric_key,
            rubric_criteria,
            fallback_candidate=evaluated_rubric_key,
        )
        evaluated_pack = knowledge_state.get_evidence_pack(canon)
    evaluated_crit = knowledge_state.crit_for_rubric_key(
        evaluated_rubric_key, rubric_criteria
    )
    evaluated_display = (
        rubric_display_name(evaluated_crit)
        if evaluated_crit
        else (evaluated_rubric_key or "").strip()
    )

    claim_ok = relevant_resume_claim_available(
        evaluated_rubric_key,
        job_profile_context=job_profile_context,
        resume_skills=resume_skills,
        verified_claims=list(knowledge_state.verified_resume_claims),
        rubric_criteria=rubric_criteria,
    )
    defer_resume = should_defer_pivot_for_resume(evaluated_pack, claim_ok=claim_ok)

    must_leave = bool(
        evaluated_pack
        and (
            evaluated_pack.coverage_state == "SUFFICIENT"
            or evaluated_pack.frozen
        )
        and not defer_resume
    )
    wants_pivot = (decision.action_mode == "PIVOT_COMPETENCY" or must_leave) and not defer_resume

    # Defer: stay on evaluated rubric and request RESUME_VALIDATION.
    if defer_resume and evaluated_pack is not None:
        anchor = pick_resume_anchor(
            job_profile_context,
            existing=decision.resume_anchor,
            rubric_label=evaluated_display,
        )
        return (
            BrainDecision.model_validate(
                {
                    **decision.model_dump(),
                    "action_mode": "PROBE_DEPTH",
                    "target_competency": evaluated_display,
                    "target_concept": decision.target_concept
                    or "resume claim validation",
                    "question_source": "RESUME_VALIDATION",
                    "resume_anchor": anchor,
                    "system_directive": (
                        decision.system_directive
                        if normalize_question_source(decision.question_source)
                        == "RESUME_VALIDATION"
                        and (decision.system_directive or "").strip()
                        else (
                            f"Acknowledge their answer. Then ask ONE RESUME_VALIDATION "
                            f"question about a specific claim related to {evaluated_display}"
                            + (f" — grounded in: {anchor}." if anchor else ".")
                        )
                    ),
                }
            ),
            "defer_pivot_for_resume",
        )

    if must_leave and evaluated_pack is not None:
        evaluated_pack.frozen = True

    if wants_pivot:
        nxt = knowledge_state.select_next_rubric(rubric_criteria)
        if nxt is None:
            return (
                BrainDecision.model_validate(
                    {
                        **decision.model_dump(),
                        "action_mode": "WRAP_UP",
                        "system_directive": (
                            "We have covered the required baseline across all rubric areas. "
                            "Close cleanly and summarize the assessment."
                        ),
                    }
                ),
                "sufficient_freeze_pivot" if must_leave else "coverage_complete",
            )
        next_name = rubric_display_name(nxt)
        reason = "sufficient_freeze_pivot" if must_leave else "deterministic_pivot"
        # On forced leave (SUFFICIENT freeze), clear sticky concept/directive so the
        # next spoken question is a fresh opening for the new rubric — not the old thread.
        if must_leave:
            target_concept = ""
            system_directive = (
                f"Acknowledge briefly, then ask a fresh TECHNICAL or PRACTICAL opening "
                f"question about {next_name}. Do NOT continue the previous concept thread "
                f"and do NOT begin with a CV project walkthrough."
            )
            question_source: QuestionSource = "TECHNICAL"
            resume_anchor = None
        else:
            target_concept = decision.target_concept or ""
            system_directive = decision.system_directive or (
                f"Acknowledge their answer, then move on to {next_name}."
            )
            question_source = normalize_question_source(decision.question_source)
            resume_anchor = decision.resume_anchor
        return (
            BrainDecision.model_validate(
                {
                    **decision.model_dump(),
                    "action_mode": "PIVOT_COMPETENCY",
                    "target_competency": next_name,
                    "target_concept": target_concept,
                    "system_directive": system_directive,
                    "question_source": question_source,
                    "resume_anchor": resume_anchor,
                }
            ),
            reason,
        )

    # Continue on the evaluated rubric — clamp Brain if it tried to switch.
    locked = evaluated_display
    brain_target = (decision.target_competency or "").strip()
    matched = _match_rubric_crit(brain_target, rubric_criteria) if brain_target else None
    matched_id = _crit_canonical_id(matched) if matched else ""
    evaluated_id = (
        _crit_canonical_id(evaluated_crit) if evaluated_crit else evaluated_rubric_key
    )
    if matched is not None and matched_id == evaluated_id:
        # Brain named the same rubric (possibly without leading dot) — keep stored name.
        if brain_target != locked:
            return (
                BrainDecision.model_validate(
                    {
                        **decision.model_dump(),
                        "target_competency": locked,
                    }
                ),
                None,
            )
        return decision, None

    return (
        BrainDecision.model_validate(
            {
                **decision.model_dump(),
                "target_competency": locked,
            }
        ),
        "rubric_lock",
    )


def _pack_items_for_key(
    knowledge_state: CandidateKnowledgeState,
    rubric_key: str | None,
    rubric_criteria: list[dict[str, Any]] | None = None,
) -> list[EvidenceItem]:
    key = (rubric_key or "").strip()
    if not key:
        return []
    if rubric_criteria:
        key = canonicalize_rubric_key(key, rubric_criteria, fallback_candidate=key)
    pack = knowledge_state.get_evidence_pack(key)
    if pack is None and rubric_criteria:
        # Try display-name / id variants via ensure without creating permanently if missing
        pack = knowledge_state.get_evidence_pack(key)
    return list(pack.items) if pack else []


def enforce_question_source_policy(
    decision: BrainDecision,
    knowledge_state: CandidateKnowledgeState,
    *,
    next_rubric_key: str,
    rubric_criteria: list[dict[str, Any]] | None = None,
    job_profile_context: dict[str, Any] | None = None,
    resume_skills: list[str] | None = None,
    last_understanding_level: str | None = None,
    last_identified_weakness: str | None = None,
    last_question_source: str | None = None,
) -> tuple[BrainDecision, str | None]:
    """Adaptive Technical + Resume question-source steering.

    Intended per-rubric flow (soft; does not change SUFFICIENT math):
      TECHNICAL → deepen/challenge → RESUME_VALIDATION (if claim) →
      optional FOLLOW_UP on resume answer → stop resume stacking /
      return to tech only on gaps → pivot when coverage says so.

    Resume-alone never establishes competency (coverage gate unchanged).
    FOLLOW_UP after resume is allowed; do not auto-return to technical
    after every resume answer.
    """
    if decision.action_mode == "WRAP_UP":
        return decision, None

    items = _pack_items_for_key(knowledge_state, next_rubric_key, rubric_criteria)
    has_non_resume = _has_non_resume_substantive(items)
    has_resume = has_resume_validation_evidence(items)
    tech_ready = tech_evidence_good_enough(items)
    strong_resume = has_strong_resume(items)
    claim_ok = relevant_resume_claim_available(
        next_rubric_key,
        job_profile_context=job_profile_context,
        resume_skills=resume_skills,
        verified_claims=list(knowledge_state.verified_resume_claims),
        rubric_criteria=rubric_criteria,
    )
    source = normalize_question_source(decision.question_source)
    reason: str | None = None
    updates: dict[str, Any] = {}

    last_src = normalize_question_source(last_question_source) if last_question_source else None
    if last_src is None and last_item_was_resume(items):
        last_src = "RESUME_VALIDATION"
    last_level = (last_understanding_level or "").strip().upper()
    gap_on_resume = last_src == "RESUME_VALIDATION" and (
        last_level in ("WEAK", "MISCONCEPTION", "NO_KNOWLEDGE")
        or bool((last_identified_weakness or "").strip())
    )

    def _force_tech(*, why: str, practical: bool = False) -> None:
        nonlocal source, reason
        source = "PRACTICAL" if practical else "TECHNICAL"
        updates["question_source"] = source
        updates["resume_anchor"] = None
        reason = why

    # 1) Weak / REORIENT — never resume rescue
    if decision.action_mode == "REORIENT_PRACTICAL":
        _force_tech(why="reorient_no_resume", practical=True)
        return (
            BrainDecision.model_validate({**decision.model_dump(), **updates}),
            reason,
        )
    if decision.action_mode == "CLARIFY_MISCONCEPTION" and (
        source == "RESUME_VALIDATION" or decision.resume_anchor
    ):
        _force_tech(why="reorient_no_resume", practical=False)

    if (
        source == "RESUME_VALIDATION"
        and last_level in ("WEAK", "MISCONCEPTION", "NO_KNOWLEDGE")
        and last_src != "RESUME_VALIDATION"
    ):
        # Weak technical answer must not be rescued by jumping to CV.
        _force_tech(why="reorient_no_resume", practical=False)

    # 2) FOLLOW_UP — always allow (tech or resume answer). Do not auto-tech.
    if source == "FOLLOW_UP" and "question_source" not in updates:
        updates["question_source"] = "FOLLOW_UP"
        updates["resume_anchor"] = None
        if last_src == "RESUME_VALIDATION":
            reason = "adaptive_keep_follow_up"
        return (
            BrainDecision.model_validate({**decision.model_dump(), **updates}),
            reason,
        )

    # 3) Opening / still no non-resume substantive — never resume-first
    if not has_non_resume:
        if source == "RESUME_VALIDATION" or decision.resume_anchor:
            _force_tech(
                why="question_source_no_resume_until_partial",
                practical=decision.action_mode == "REORIENT_PRACTICAL",
            )
        elif source not in ("TECHNICAL", "PRACTICAL"):
            _force_tech(why="question_source_force_opening")
        if decision.action_mode == "PIVOT_COMPETENCY":
            updates.setdefault("question_source", "TECHNICAL")
            updates["resume_anchor"] = None
            if reason is None and (
                decision.resume_anchor
                or normalize_question_source(decision.question_source) == "RESUME_VALIDATION"
            ):
                reason = "question_source_pivot_opening"
        if updates:
            updates.setdefault("question_source", source)
            return (
                BrainDecision.model_validate({**decision.model_dump(), **updates}),
                reason,
            )
        if decision.question_source != source:
            return (
                BrainDecision.model_validate(
                    {**decision.model_dump(), "question_source": source}
                ),
                None,
            )
        return decision, None

    # 4) Resume answer exposed a technical gap → back to tech (FOLLOW_UP already returned)
    if gap_on_resume and source == "RESUME_VALIDATION":
        _force_tech(why="adaptive_resume_gap_to_tech")
        return (
            BrainDecision.model_validate({**decision.model_dump(), **updates}),
            reason,
        )
    if gap_on_resume and source not in ("TECHNICAL", "PRACTICAL", "FOLLOW_UP"):
        _force_tech(why="adaptive_resume_gap_to_tech")

    # 5) Tech not good enough yet — stay technical/practical (deeper/challenge)
    if not tech_ready:
        if source == "RESUME_VALIDATION" or decision.resume_anchor:
            _force_tech(why="adaptive_need_deeper_tech")
            return (
                BrainDecision.model_validate({**decision.model_dump(), **updates}),
                reason,
            )

    # 6) Tech ready + claim + no resume evidence → prefer RESUME_VALIDATION
    if tech_ready and claim_ok and not has_resume:
        if source != "RESUME_VALIDATION":
            updates["question_source"] = "RESUME_VALIDATION"
            updates["resume_anchor"] = pick_resume_anchor(
                job_profile_context,
                existing=decision.resume_anchor,
                rubric_label=next_rubric_key,
            )
            reason = "adaptive_prefer_resume"
            return (
                BrainDecision.model_validate({**decision.model_dump(), **updates}),
                reason,
            )
        # Already RESUME_VALIDATION — ensure anchor
        anchor = pick_resume_anchor(
            job_profile_context,
            existing=decision.resume_anchor,
            rubric_label=next_rubric_key,
        )
        if anchor and not decision.resume_anchor:
            updates["resume_anchor"] = anchor
            reason = "adaptive_prefer_resume"
            return (
                BrainDecision.model_validate({**decision.model_dump(), **updates}),
                reason,
            )
        return decision, None

    # 7) No claim → never allow resume
    if not claim_ok and (source == "RESUME_VALIDATION" or decision.resume_anchor):
        _force_tech(why="adaptive_need_deeper_tech")
        return (
            BrainDecision.model_validate({**decision.model_dump(), **updates}),
            reason,
        )

    # 8) Strong resume already — do not stack another RESUME_VALIDATION
    if strong_resume and source == "RESUME_VALIDATION":
        updates["question_source"] = "FOLLOW_UP"
        updates["resume_anchor"] = None
        reason = "adaptive_stop_resume_stacking"
        return (
            BrainDecision.model_validate({**decision.model_dump(), **updates}),
            reason,
        )

    # 9) Resume present but tech still thin (shouldn't happen if tech_ready was required,
    # but defend: if somehow only weak tech + resume) — force tech
    if has_resume and not has_non_resume:
        _force_tech(why="adaptive_resume_gap_to_tech")
        return (
            BrainDecision.model_validate({**decision.model_dump(), **updates}),
            reason,
        )

    if not updates:
        if decision.question_source != source:
            return (
                BrainDecision.model_validate(
                    {**decision.model_dump(), "question_source": source}
                ),
                None,
            )
        return decision, None

    updates.setdefault("question_source", source)
    return (
        BrainDecision.model_validate({**decision.model_dump(), **updates}),
        reason,
    )

