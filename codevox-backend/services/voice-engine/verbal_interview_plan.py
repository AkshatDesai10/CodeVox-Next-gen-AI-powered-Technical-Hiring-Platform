"""Weightage-driven plan for the AI Verbal interview.

Recruiters set one minimum primary-question count and one maximum for the
whole interview. Rubric weights decide how those primary questions are split.
Category choice follows seniority eligibility, the skill, and resume evidence.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from typing import Any

from candidate_knowledge import (
    BrainDecision,
    CandidateKnowledgeState,
    EvidenceDimension,
    canonical_seniority_band,
    pick_resume_anchor,
    relevant_resume_claim_available,
    rubric_display_name,
    _crit_canonical_id,
)

MAX_PRIMARY_PER_CATEGORY = 2
_CATEGORY_ORDER: tuple[EvidenceDimension, ...] = (
    "FOUNDATIONAL",
    "TECHNICAL_APPLIED",
    "PROBLEM_SOLVING",
    "RESUME_VALIDATION",
)
_ELIGIBLE: dict[str, tuple[EvidenceDimension, ...]] = {
    "JUNIOR": ("FOUNDATIONAL", "TECHNICAL_APPLIED", "RESUME_VALIDATION"),
    "MID": ("TECHNICAL_APPLIED", "RESUME_VALIDATION", "PROBLEM_SOLVING"),
    "SENIOR": ("TECHNICAL_APPLIED", "RESUME_VALIDATION", "PROBLEM_SOLVING"),
}
_SOURCE = {
    "FOUNDATIONAL": "PRACTICAL",
    "TECHNICAL_APPLIED": "TECHNICAL",
    "PROBLEM_SOLVING": "TECHNICAL",
    "RESUME_VALIDATION": "RESUME_VALIDATION",
}
_ANGLE = {
    "FOUNDATIONAL": "everyday use",
    "TECHNICAL_APPLIED": "technical application",
    "PROBLEM_SOLVING": "problem solving and architecture",
    "RESUME_VALIDATION": "a real project from the resume",
}
_RESUME_RUBRIC = re.compile(r"resume|project|portfolio|experience|\bcv\b", re.I)
_DESIGN_RUBRIC = re.compile(r"design|architect|system|problem|leadership|trade-?off", re.I)
_FOUNDATION_RUBRIC = re.compile(r"fundamental|basics?|concept|core\b|introduc", re.I)
_NATURAL_FOCUS = (
    "core concepts of {label}",
    "practical application of {label}",
    "fundamental differences in {label}",
    "common pitfalls when using {label}",
)


def eligible_categories(seniority: str | None, *, entry_level: bool = False) -> tuple[EvidenceDimension, ...]:
    band = canonical_seniority_band(seniority, entry_level=entry_level)
    return _ELIGIBLE.get(band, _ELIGIBLE["MID"])


def verbal_budget_error(minimum: int, maximum: int, rubric_count: int) -> str | None:
    if rubric_count < 1:
        return "Select at least one rubric."
    if minimum < 1 or maximum < 1:
        return "Minimum and maximum questions must be at least 1."
    if minimum > maximum:
        return f"Minimum primary questions ({minimum}) cannot exceed the maximum ({maximum})."
    if minimum < rubric_count:
        return (
            f"Minimum primary questions ({minimum}) is less than the number of required rubrics "
            f"({rubric_count}). Give every rubric at least one question, or remove a rubric."
        )
    if maximum > 40:
        return "Maximum questions cannot exceed 40."
    return None


def allocate_primary_questions(weights: list[float], minimum: int) -> list[int] | str:
    """Largest-remainder split of `minimum` seats. Every rubric gets at least one.

    The quota is the full minimum, not an independent rounding of each percentage.
    A floor of one is applied by moving a seat from the largest allocation when a
    zero appears. Returns an error string when the minimum cannot cover every rubric.
    """
    count = len(weights)
    error = verbal_budget_error(minimum, max(minimum, 1), count)
    if error and "cannot exceed the maximum" not in error and "cannot exceed 40" not in error:
        if count < 1 or minimum < count or minimum < 1:
            return error
    if count < 1:
        return "Select at least one rubric."
    if minimum < count:
        return (
            f"Minimum primary questions ({minimum}) is less than the number of required rubrics "
            f"({count}). Give every rubric at least one question, or remove a rubric."
        )
    safe = [float(w) if w and w > 0 else 0.0 for w in weights]
    total = sum(safe)
    if total <= 0:
        safe = [1.0] * count
        total = float(count)
    raw = [minimum * (weight / total) for weight in safe]
    seats = [int(math.floor(value + 1e-9)) for value in raw]
    leftover = minimum - sum(seats)
    ranked = sorted(
        range(count),
        key=lambda index: (raw[index] - seats[index], safe[index], -index),
        reverse=True,
    )
    for index in ranked:
        if leftover <= 0:
            break
        seats[index] += 1
        leftover -= 1
    guard = 0
    while any(seat < 1 for seat in seats) and guard < count * minimum:
        guard += 1
        needy = next(index for index, seat in enumerate(seats) if seat < 1)
        donors = [index for index, seat in enumerate(seats) if seat > 1]
        if not donors:
            return (
                f"Minimum primary questions ({minimum}) cannot cover all {count} required rubrics."
            )
        donor = max(donors, key=lambda index: (seats[index], safe[index]))
        seats[donor] -= 1
        seats[needy] += 1
    if sum(seats) != minimum or any(seat < 1 for seat in seats):
        return f"Minimum primary questions ({minimum}) cannot cover all {count} required rubrics."
    return seats


def parse_verbal_budget(
    round_config: dict[str, Any] | None,
    rubric_count: int,
) -> tuple[int, int]:
    """Saved min/max, or one primary per rubric and no follow-up buffer.

    A missing budget is not written back. An invalid saved budget falls back
    to one question per rubric instead of dropping a rubric.
    """
    raw = round_config if isinstance(round_config, dict) else {}
    minimum = raw.get("verbal_min_primary_questions")
    maximum = raw.get("verbal_max_total_questions")
    if minimum is None or maximum is None:
        count = max(1, rubric_count)
        return count, count
    try:
        minimum_n = int(minimum)
        maximum_n = int(maximum)
    except (TypeError, ValueError):
        count = max(1, rubric_count)
        return count, count
    if verbal_budget_error(minimum_n, maximum_n, max(1, rubric_count)):
        count = max(1, rubric_count)
        return count, count
    return minimum_n, maximum_n


def _required_rubrics(criteria: list[dict[str, Any]]) -> list[dict[str, Any]]:
    required = [crit for crit in criteria if not crit.get("is_optional")]
    return required or list(criteria)


def _category_score(
    dimension: EvidenceDimension,
    label: str,
    *,
    resume_ok: bool,
    resume_match: int = 0,
) -> float:
    if dimension == "RESUME_VALIDATION":
        if not resume_ok:
            return -1
        base = 3.0 if _RESUME_RUBRIC.search(label) else 1.0
        # A project that actually uses this skill should beat a generic technical start.
        if resume_match >= 3:
            base = max(base, 2.6)
        return base
    if dimension == "PROBLEM_SOLVING":
        return 3.0 if _DESIGN_RUBRIC.search(label) else 1.0
    if dimension == "FOUNDATIONAL":
        return 3.0 if _FOUNDATION_RUBRIC.search(label) else 1.2
    if _RESUME_RUBRIC.search(label):
        return 0.4
    if _DESIGN_RUBRIC.search(label):
        return 1.0
    return 2.0


def _competency_names(crit: dict[str, Any], needed: int) -> list[str]:
    label = rubric_display_name(crit) or _crit_canonical_id(crit) or "General"
    names = [label]
    description = str(crit.get("description") or "")
    for part in re.split(r"[,;|/]", description):
        text = part.strip()
        if text and "—" not in text and text.lower() not in {name.lower() for name in names}:
            names.append(text)
    focus = 0
    while len(names) < needed:
        names.append(_NATURAL_FOCUS[focus % len(_NATURAL_FOCUS)].format(label=label))
        focus += 1
    return names[:needed]


def _initial_category(
    scores: dict[EvidenceDimension, float],
    used: Counter[str],
) -> EvidenceDimension:
    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    best, best_score = ranked[0]
    # A rubric with its own project stays on resume even if another rubric already did.
    if best == "RESUME_VALIDATION" and best_score >= 2.5:
        return best
    if used[best] == 0:
        return best
    for dimension, score in ranked[1:]:
        if used[dimension] == 0 and score >= 1 and score >= best_score - 1:
            return dimension
    return best


def build_verbal_plan(
    criteria: list[dict[str, Any]],
    *,
    seniority: str | None,
    entry_level: bool = False,
    round_config: dict[str, Any] | None = None,
    job_profile_context: dict[str, Any] | None = None,
    resume_skills: list[str] | None = None,
) -> dict[str, Any]:
    required = _required_rubrics(criteria)
    band = canonical_seniority_band(seniority, entry_level=entry_level)
    minimum, maximum = parse_verbal_budget(round_config, len(required))
    weights = [float(crit.get("weight_pct") or 0) for crit in required]
    allocated = allocate_primary_questions(weights, minimum)
    if isinstance(allocated, str):
        allocated = [1] * len(required)
        minimum = len(required)
        maximum = max(maximum, minimum)
    order = sorted(
        range(len(required)),
        key=lambda index: (-weights[index], index),
    )
    eligible = eligible_categories(seniority, entry_level=entry_level)
    used: Counter[str] = Counter()
    slots: list[dict[str, Any]] = []
    allocations: dict[str, int] = {}
    for index in order:
        crit = required[index]
        key = _crit_canonical_id(crit)
        label = rubric_display_name(crit) or key
        count = allocated[index]
        allocations[key] = count
        resume_ok = relevant_resume_claim_available(
            key,
            job_profile_context=job_profile_context,
            resume_skills=resume_skills,
            rubric_criteria=criteria,
        )
        resume_match = 0
        if resume_ok and job_profile_context:
            from candidate_knowledge import _project_rubric_score, _resume_project_chunks

            for chunk in _resume_project_chunks(job_profile_context):
                resume_match = max(resume_match, _project_rubric_score(chunk, label))
        category_scores: dict[EvidenceDimension, float] = {
            dimension: _category_score(
                dimension, label, resume_ok=resume_ok, resume_match=resume_match
            )
            for dimension in eligible
        }
        scores: dict[EvidenceDimension, float] = {
            dimension: score for dimension, score in category_scores.items() if score > 0
        }
        if not scores:
            default_dim: EvidenceDimension = "TECHNICAL_APPLIED"
            scores = {default_dim: 1.0}
        initial: EvidenceDimension = _initial_category(scores, used)
        assigned: list[EvidenceDimension] = [initial] * min(MAX_PRIMARY_PER_CATEGORY, count)
        remaining = count - len(assigned)
        while remaining > 0:
            options: list[tuple[int, float, int, EvidenceDimension]] = []
            for dimension, score in scores.items():
                already = assigned.count(dimension)
                if already >= MAX_PRIMARY_PER_CATEGORY:
                    continue
                options.append((used[dimension], -score, already, dimension))
            if not options:
                break
            options.sort()
            assigned.append(options[0][3])
            remaining -= 1
        names = _competency_names(crit, len(assigned))
        for offset, dimension in enumerate(assigned):
            used[dimension] += 1
            slots.append(
                {
                    "slot_index": len(slots),
                    "rubric_key": key,
                    "label": label,
                    "dimension": dimension,
                    "competency": names[offset],
                    "allocation": count,
                }
            )
    return {
        "seniority_band": band,
        "min_primary": minimum,
        "max_total": maximum,
        "followup_buffer": max(0, maximum - minimum),
        "allocations": allocations,
        "slots": slots,
        "eligible": list(eligible),
    }


def judge_competency_evidence(
    *,
    understanding_level: str | None,
    eval_status: str | None,
    user_text: str,
    seniority: str | None = None,
    already_followed_up: bool = False,
) -> dict[str, Any]:
    """Evidence for one competency. Sound answers close the competency for Junior and Mid-level."""
    level = (understanding_level or "").strip().upper()
    status = (eval_status or "").strip().lower()
    words = [word for word in (user_text or "").split() if word]
    missing = ""
    follow_up = False
    if status == "unscored" or level in {"WEAK", "MISCONCEPTION", "NO_KNOWLEDGE", "SKIP"}:
        state = "PARTIAL"
        follow_up = True
        missing = "The answer does not yet show the depth expected for this competency."
    elif level == "STRONG":
        state = "SUFFICIENT"
    elif level == "MODERATE":
        if already_followed_up:
            state = "SUFFICIENT"
            follow_up = False
            missing = ""
        else:
            state = "PARTIAL"
            follow_up = True
            missing = "The answer is sound; one follow-up to explore practical depth."
    elif len(words) < 12:
        state = "PARTIAL"
        follow_up = True
        missing = "The explanation is too thin to treat the competency as covered."
    else:
        state = "PARTIAL"
        missing = "More specific reasoning is still missing."
        follow_up = True
    return {
        "evidence_state": state,
        "follow_up_justified": follow_up,
        "missing": missing,
        "evidence": " ".join(words[:40]),
    }


def _totals(state: CandidateKnowledgeState) -> tuple[int, int]:
    primary = sum(int(value) for value in state.primary_asked.values())
    followups = sum(int(value) for value in state.followup_asked.values())
    return primary, followups


def apply_weightage_plan(
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
    resume_skills: list[str] | None = None,
    round_config: dict[str, Any] | None = None,
) -> tuple[BrainDecision, str | None]:
    criteria = list(rubric_criteria or [])
    if not criteria:
        return decision, None
    if knowledge_state.verbal_plan is None:
        knowledge_state.verbal_plan = build_verbal_plan(
            criteria,
            seniority=seniority,
            entry_level=entry_level,
            round_config=round_config,
            job_profile_context=job_profile_context,
            resume_skills=resume_skills,
        )
    plan = knowledge_state.verbal_plan
    band = str(plan.get("seniority_band") or "MID")
    maximum = int(plan.get("max_total") or 0)
    buffer = int(plan.get("followup_buffer") or 0)
    slots: list[dict[str, Any]] = list(plan.get("slots") or [])

    open_key = ""
    open_name = ""
    if knowledge_state.open_competency:
        open_key, open_name = next(iter(knowledge_state.open_competency.items()))
        prior_fu = knowledge_state.followup_asked.get(open_key, 0)
        judged = judge_competency_evidence(
            understanding_level=understanding_level,
            eval_status=eval_status,
            user_text=user_text,
            seniority=plan.get("seniority_band") or seniority,
            already_followed_up=prior_fu > 0,
        )
        judged["competency"] = open_name
        judged["rubric_key"] = open_key
        bucket = knowledge_state.competency_evidence.setdefault(open_key, {})
        current = bucket.get(open_name, "NOT_ASSESSED")
        incoming = str(judged["evidence_state"])
        if current != "SUFFICIENT":
            bucket[open_name] = incoming
        else:
            judged["evidence_state"] = "SUFFICIENT"
            judged["follow_up_justified"] = False
        knowledge_state.last_evidence_result = judged
    else:
        judged = {"follow_up_justified": False, "evidence_state": "NOT_ASSESSED", "competency": ""}

    primary_n, follow_n = _totals(knowledge_state)
    if maximum and primary_n + follow_n >= maximum:
        knowledge_state.pending_question_plan = None
        return _wrap(decision, band), "plan_complete"

    last_slot: dict[str, Any] | None = None
    for slot in reversed(slots):
        if int(slot["slot_index"]) in knowledge_state.asked_slots:
            last_slot = slot
            break
    follow_open = (
        last_slot is not None
        and bool(knowledge_state.followup_open.get(str(last_slot["rubric_key"])))
    )
    slot_index = int(last_slot["slot_index"]) if last_slot is not None else -1
    already = int(knowledge_state.slot_followups.get(slot_index, 0))
    justified = bool(judged.get("follow_up_justified")) and already < 1
    if (
        follow_open
        and justified
        and last_slot is not None
        and follow_n < buffer
        and primary_n + follow_n < maximum
    ):
        _remember(
            knowledge_state,
            slot=last_slot,
            is_followup=True,
            seniority=seniority or "",
            entry_level=entry_level,
            criteria=criteria,
            maximum=maximum,
            buffer=buffer,
        )
        concept = str(last_slot.get("competency") or last_slot.get("label"))
        return (
            BrainDecision.model_validate(
                {
                    **decision.model_dump(),
                    "action_mode": "PROBE_DEPTH",
                    "target_competency": last_slot["label"],
                    "target_concept": concept,
                    "difficulty": band,
                    "question_source": "FOLLOW_UP",
                    "evidence_dimension": last_slot["dimension"],
                    "resume_anchor": None,
                    "system_directive": (
                        f"LOCKED SENIORITY: {band}. Keep this depth. "
                        f"LOCKED RUBRIC: {last_slot['label']}. "
                        f"Ask one follow-up on {concept} only. "
                        "Do not start a new competency."
                    ),
                }
            ),
            "plan_followup",
        )

    if follow_open and last_slot is not None:
        knowledge_state.followup_open[str(last_slot["rubric_key"])] = False
        asked_here = int(knowledge_state.primary_asked.get(str(last_slot["rubric_key"]), 0))
        if asked_here >= int(last_slot.get("allocation") or 0):
            pack = knowledge_state.ensure_evidence_pack(str(last_slot["rubric_key"]))
            pack.coverage_state = "SUFFICIENT"
            pack.exit_reason = "plan_complete"
            pack.frozen = True

    for slot in slots:
        if int(slot["slot_index"]) in knowledge_state.asked_slots:
            continue
        if primary_n >= maximum:
            break
        key = str(slot["rubric_key"])
        evidence = knowledge_state.competency_evidence.get(key, {})
        competency = str(slot["competency"])
        if evidence.get(competency) == "SUFFICIENT":
            alternate = next(
                (
                    name
                    for name, status in evidence.items()
                    if status != "SUFFICIENT"
                ),
                "",
            )
            # Prefer an uncovered competency, but still ask the planned primary.
            if alternate:
                competency = alternate
                slot = {**slot, "competency": competency}
        dimension = str(slot["dimension"])
        anchor = None
        if dimension == "RESUME_VALIDATION":
            anchor = pick_resume_anchor(
                job_profile_context,
                existing=decision.resume_anchor,
                rubric_label=str(slot["label"]),
                avoid=list(knowledge_state.used_resume_anchors),
            )
            if not anchor and not relevant_resume_claim_available(
                key,
                job_profile_context=job_profile_context,
                resume_skills=resume_skills,
                rubric_criteria=criteria,
            ):
                dimension = "TECHNICAL_APPLIED" if "TECHNICAL_APPLIED" in (plan.get("eligible") or []) else dimension
                slot = {**slot, "dimension": dimension}
                anchor = None
        _remember(
            knowledge_state,
            slot=slot,
            is_followup=False,
            seniority=seniority or "",
            entry_level=entry_level,
            criteria=criteria,
            maximum=maximum,
            buffer=buffer,
            resume_anchor=anchor,
        )
        angle = _ANGLE.get(dimension, "technical application")
        focus = str(slot["competency"])
        directive = (
            f"LOCKED SENIORITY: {band}. Do not raise or lower the expected depth. "
            f"LOCKED RUBRIC: {slot['label']}. The spoken question must test {slot['label']} only. "
            f"Do not switch to another skill from earlier in the interview. "
            f"LOCKED CATEGORY: {angle}. "
            f"Private focus, never read this aloud: {focus}. "
            "Ask one natural question. Do not say planning labels, facet names, em dashes, "
            "or bullet numbers."
        )
        if anchor:
            directive += (
                f" Name only this project: {anchor}. "
                "Do not read the resume bullet, its number, or its description."
            )
        return (
            BrainDecision.model_validate(
                {
                    **decision.model_dump(),
                    "action_mode": "PIVOT_COMPETENCY",
                    "target_competency": slot["label"],
                    "target_concept": str(slot["competency"]),
                    "difficulty": band,
                    "question_source": _SOURCE.get(dimension, "TECHNICAL"),
                    "evidence_dimension": dimension,
                    "resume_anchor": anchor,
                    "system_directive": directive,
                }
            ),
            "plan_primary",
        )

    knowledge_state.pending_question_plan = None
    return _wrap(decision, band), "plan_complete"


def note_weightage_question(state: CandidateKnowledgeState) -> bool:
    """Count a delivered weightage question. Returns True when this plan owned it."""
    plan = state.pending_question_plan or {}
    if not plan.get("weightage"):
        return False
    state.pending_question_plan = None
    key = str(plan.get("key") or "").strip()
    if not key:
        return True
    slot_index = plan.get("slot_index")
    if plan.get("is_followup"):
        state.followup_open[key] = False
        state.followup_asked[key] = int(state.followup_asked.get(key, 0)) + 1
        if slot_index is not None:
            state.slot_followups[int(slot_index)] = int(state.slot_followups.get(int(slot_index), 0)) + 1
        return True
    dimension = str(plan.get("dimension") or "TECHNICAL_APPLIED")
    state.primary_asked[key] = int(state.primary_asked.get(key, 0)) + 1
    dims = state.dimension_primaries.setdefault(key, {})
    dims[dimension] = int(dims.get(dimension, 0)) + 1
    state.open_dimension[key] = dimension
    state.open_competency = {key: str(plan.get("competency") or "")}
    if slot_index is not None:
        state.asked_slots.add(int(slot_index))
    anchor = str(plan.get("resume_anchor") or "").strip()
    if anchor and anchor not in state.used_resume_anchors:
        state.used_resume_anchors.append(anchor)
    followups = sum(int(value) for value in state.followup_asked.values())
    buffer = int(plan.get("followup_buffer") or 0)
    state.followup_open[key] = followups < buffer
    allocation = int(plan.get("rubric_allocation") or 0)
    if state.primary_asked[key] >= allocation and not state.followup_open[key]:
        pack = state.ensure_evidence_pack(key)
        pack.coverage_state = "SUFFICIENT"
        pack.exit_reason = "plan_complete"
        pack.frozen = True
    return True


def _remember(
    state: CandidateKnowledgeState,
    *,
    slot: dict[str, Any],
    is_followup: bool,
    seniority: str,
    entry_level: bool,
    criteria: list[dict[str, Any]],
    maximum: int,
    buffer: int,
    resume_anchor: str | None = None,
) -> None:
    state.pending_question_plan = {
        "key": slot["rubric_key"],
        "label": slot["label"],
        "dimension": slot["dimension"],
        "competency": slot.get("competency") or slot["label"],
        "slot_index": slot["slot_index"],
        "is_followup": is_followup,
        "seniority": seniority,
        "entry_level": entry_level,
        "criteria": criteria,
        "configured_plans": True,
        "weightage": True,
        "max_total": maximum,
        "followup_buffer": buffer,
        "rubric_allocation": slot.get("allocation") or 0,
        "primary_total": slot.get("allocation") or 0,
        "resume_anchor": resume_anchor,
    }


def _wrap(decision: BrainDecision, band: str) -> BrainDecision:
    return BrainDecision.model_validate(
        {
            **decision.model_dump(),
            "action_mode": "WRAP_UP",
            "difficulty": band,
            "system_directive": "The planned primary questions are complete. Close the interview.",
        }
    )
