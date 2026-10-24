"""Pure backend rules for AI Behavioural — no LLM control-flow."""

from __future__ import annotations

import re
from typing import Any

from behavioural.schemas import (
    CompetencyConfig,
    CompetencyEvaluation,
    CompetencyEvidenceState,
    DecisionPolicy,
    EvidenceItemState,
    EvidenceQuality,
    NextAction,
    RequirementAlignment,
    ScoreThresholds,
    ScreeningCapture,
    ScreeningQuestion,
    score_to_level,
)


_QUALITY_RANK = {"weak": 1, "medium": 2, "strong": 3}

# Synonym / phrase cues that an opening question invites a given evidence slot.
_EVIDENCE_QUESTION_CUES: dict[str, tuple[str, ...]] = {
    "situation": (
        "situation",
        "context",
        "background",
        "scenario",
        "tell me about a time",
        "about a time",
        "when you",
        "project where",
        "what was going on",
    ),
    "responsibility": (
        "responsibility",
        "responsible",
        "your role",
        "your part",
        "you own",
        "you owned",
        "ownership",
        "what was your",
        "accountable",
        "your job",
    ),
    "action": (
        "action",
        "what did you do",
        "what action",
        "how did you",
        "steps you",
        "approach",
        "handled",
        "what you did",
        "did you take",
        "what you tried",
    ),
    "result": (
        "result",
        "outcome",
        "what happened",
        "how did it turn out",
        "turn out",
        "impact",
        "ended up",
        "what was the result",
        "consequence",
        "effect",
    ),
}

# Lightweight specificity markers used for calibration regression fixtures.
_SPECIFICITY_MARKERS: tuple[str, ...] = (
    "tensorrt",
    "tensorflow",
    "pre-processing",
    "preprocessing",
    "threshold",
    "pipeline",
    "decision model",
    "latency",
    "percent",
    "%",
    "aws",
    "redis",
    "django",
    "fastapi",
    "opencv",
)


def question_covers_evidence(question_text: str, required_ids: list[str]) -> list[str]:
    """Return required evidence_ids not referenced in the question (deterministic).

    Uses keyword/synonym matching per evidence_id. Unknown evidence_ids are treated
    as covered only if the id string itself appears in the question text.
    """
    text = (question_text or "").lower()
    missing: list[str] = []
    for eid in required_ids:
        cues = _EVIDENCE_QUESTION_CUES.get(eid.lower())
        if cues is None:
            if eid.lower() not in text:
                missing.append(eid)
            continue
        if not any(cue in text for cue in cues):
            missing.append(eid)
    return missing


def estimate_answer_specificity_quality(answer: str) -> str:
    """Heuristic quality estimate matching prompt anchors (for regression fixtures).

    - strong: concrete markers (tools/techniques/numbers)
    - weak: very short / empty of substance
    - medium: otherwise (plausible but generic)
    """
    text = (answer or "").strip().lower()
    if len(text) < 24:
        return "weak"
    if any(m in text for m in _SPECIFICITY_MARKERS):
        return "strong"
    # Generic but on-topic phrasing without named tech
    if any(
        g in text
        for g in (
            "example",
            "visual flow",
            "explained",
            "communicat",
            "team",
            "handled",
        )
    ):
        return "medium"
    if len(text.split()) < 12:
        return "weak"
    return "medium"


def decide_next_action(
    evidence_state: CompetencyEvidenceState,
    *,
    max_followups: int,
    followups_used: int,
    required_ids: list[str] | None = None,
    optional_ids: list[str] | None = None,
    questions_used: int | None = None,
    max_questions: int | None = None,
) -> NextAction:
    """Backend-owned FOLLOWUP / COMPLETE / COMPLETE_WITH_GAPS.

    Priority:
    1) Required evidence missing/weak -> FOLLOWUP (or COMPLETE_WITH_GAPS at limit)
    2) Soft-probe optional "result" once if still NOT_COVERED and budget remains
    3) COMPLETE
    """
    required = required_ids if required_ids is not None else evidence_state.required_ids
    # Soft-probe only when caller passes optional_ids (orchestrator always does).
    # None => skip soft-probe so legacy callers keep previous COMPLETE behavior.
    optional = list(optional_ids) if optional_ids is not None else []
    q_used = evidence_state.questions_used if questions_used is None else questions_used
    max_q = max_questions

    gaps: list[str] = []
    for eid in required:
        item = evidence_state.evidence_state.get(eid) or EvidenceItemState()
        if item.status == "NOT_COVERED" or item.quality == "weak":
            gaps.append(eid)
    if gaps:
        if followups_used >= max_followups:
            return NextAction(
                action="COMPLETE_WITH_GAPS",
                target_evidence=gaps,
                reason="Follow-up limit reached.",
            )
        return NextAction(
            action="FOLLOWUP",
            target_evidence=gaps,
            reason="Required evidence missing or weak.",
        )

    # Soft-probe optional "result" once when required evidence is clear
    if (
        "result" in optional
        and not evidence_state.result_probed
        and (evidence_state.evidence_state.get("result") or EvidenceItemState()).status
        == "NOT_COVERED"
    ):
        budget_ok = followups_used < max_followups and (
            max_q is None or q_used < max_q
        )
        if budget_ok:
            evidence_state.result_probed = True
            return NextAction(
                action="FOLLOWUP",
                target_evidence=["result"],
                reason="Soft-probe optional result before complete.",
            )

    return NextAction(
        action="COMPLETE",
        reason="All required evidence meets minimum quality.",
    )


def apply_extracted_evidence(
    state: CompetencyEvidenceState,
    extracted: list[dict[str, Any]],
    turn_id: str,
) -> CompetencyEvidenceState:
    for ex in extracted:
        eid = str(ex.get("evidence_id") or "")
        if not eid:
            continue
        if not ex.get("present"):
            continue
        quality = ex.get("quality")
        if quality not in ("strong", "medium", "weak"):
            quality = "medium"
        prev = state.evidence_state.get(eid)
        prev_rank = _QUALITY_RANK.get((prev.quality if prev else None) or "", 0)
        new_rank = _QUALITY_RANK.get(quality, 0)
        if prev and prev.status == "COVERED" and prev_rank > new_rank:
            continue
        state.evidence_state[eid] = EvidenceItemState(
            status="COVERED",
            quality=quality,  # type: ignore[arg-type]
            source_turn=turn_id,
        )
    return state


def evaluate_hard_filter(condition: str | None, parsed_value: Any) -> str:
    """Return SATISFIED | NOT_SATISFIED | UNKNOWN."""
    if condition is None or condition.strip() == "":
        return "UNKNOWN"
    if parsed_value is None:
        return "UNKNOWN"
    value = parsed_value
    if isinstance(parsed_value, dict) and "value" in parsed_value:
        value = parsed_value["value"]
    cond = condition.strip()
    # Safe subset: value <= N, value >= N, value == true/false, value == N
    m = re.fullmatch(r"value\s*(<=|>=|==|<|>)\s*(.+)", cond, flags=re.I)
    if not m:
        return "UNKNOWN"
    op, rhs_raw = m.group(1), m.group(2).strip()
    rhs_l = rhs_raw.lower()
    try:
        if rhs_l in ("true", "false"):
            rhs: Any = rhs_l == "true"
            left = bool(value)
        else:
            rhs = float(rhs_raw)
            left = float(value)
    except (TypeError, ValueError):
        return "UNKNOWN"
    ok = {
        "<=": left <= rhs,
        ">=": left >= rhs,
        "<": left < rhs,
        ">": left > rhs,
        "==": left == rhs,
    }.get(op, False)
    return "SATISFIED" if ok else "NOT_SATISFIED"


def apply_screening_rule(
    question: ScreeningQuestion,
    raw_answer: str,
    parsed_value: Any,
) -> ScreeningCapture:
    mapping_id = None
    if isinstance(question.requirement_mapping, str):
        mapping_id = question.requirement_mapping
    elif isinstance(question.requirement_mapping, list) and question.requirement_mapping:
        mapping_id = str(question.requirement_mapping[0])

    status = "UNKNOWN"
    rule = question.decision_rule or {}
    if rule.get("type") == "hard_filter":
        status = evaluate_hard_filter(rule.get("condition"), parsed_value)
    elif rule.get("type") == "info_only":
        status = "SATISFIED"  # informational — no gate
    elif rule.get("type") == "soft_flag":
        status = evaluate_hard_filter(rule.get("condition"), parsed_value)
        if status == "NOT_SATISFIED":
            status = "UNKNOWN"  # soft: do not hard-fail; flag in report

    req_map = None
    if mapping_id:
        req_map = {"requirement_id": mapping_id, "status": status}

    return ScreeningCapture(
        question_id=question.question_id,
        category=question.category,
        answer_field=question.answer_field,
        raw_answer_final=raw_answer,
        parsed_value=parsed_value,
        requirement_mapping=req_map,
    )


def effective_weight(comp: CompetencyConfig) -> float:
    return comp.effective_weight()


def weighted_competency_score(evaluations: list[CompetencyEvaluation]) -> float:
    num = den = 0.0
    for ev in evaluations:
        if ev.score is None:
            continue
        w = float(ev.weight or 0)
        if w <= 0:
            w = 1.0
        num += float(ev.score) * w
        den += w
    return round(num / den, 2) if den else 0.0


def final_automated_decision(
    *,
    competency_results: list[CompetencyEvaluation],
    eligibility_captures: list[ScreeningCapture],
    alignments: list[RequirementAlignment],
    thresholds: ScoreThresholds,
    policy: DecisionPolicy,
) -> dict[str, Any]:
    """Backend hiring policy — never LLM."""
    flags: list[dict[str, Any]] = []

    for cap in eligibility_captures:
        rm = cap.requirement_mapping or {}
        if (
            policy.require_all_mandatory_eligibility
            and cap.category == "eligibility"
            and rm.get("status") == "NOT_SATISFIED"
        ):
            return {
                "final_outcome": "Auto-Rejected",
                "platform_decision": "AUTO_REJECT",
                "weighted_competency_score": weighted_competency_score(competency_results),
                "decision_inputs": {
                    "mandatory_eligibility_met": False,
                    "core_competencies_met": False,
                    "minimum_score_met": False,
                    "screening_hard_filters_passed": False,
                    "flags": [
                        {
                            "type": "eligibility",
                            "requirement_id": rm.get("requirement_id"),
                            "status": "NOT_SATISFIED",
                        }
                    ],
                },
                "reason": f"{cap.question_id} failed hard eligibility filter",
            }

    for ev in competency_results:
        if (
            ev.is_core
            and ev.score is not None
            and ev.score < thresholds.core_competency_min_score
        ):
            return {
                "final_outcome": "No Hire",
                "platform_decision": "AUTO_REJECT",
                "weighted_competency_score": weighted_competency_score(competency_results),
                "decision_inputs": {
                    "mandatory_eligibility_met": True,
                    "core_competencies_met": False,
                    "minimum_score_met": False,
                    "screening_hard_filters_passed": True,
                    "flags": [
                        {
                            "type": "core_competency",
                            "competency_id": ev.competency_id,
                            "score": ev.score,
                        }
                    ],
                },
                "reason": f"{ev.competency_id} below core threshold",
            }

    for al in alignments:
        if al.status == "CONTRADICTED":
            flags.append(
                {
                    "type": "requirement_contradicted",
                    "requirement_id": al.requirement_id,
                    "status": al.status,
                }
            )
        if al.status == "NOT_ESTABLISHED" and al.importance == "PREFERRED":
            flags.append(
                {
                    "type": "preferred_requirement",
                    "requirement_id": al.requirement_id,
                    "status": "NOT_ESTABLISHED",
                }
            )
        if (
            policy.require_all_mandatory_requirements_supported
            and al.importance == "MANDATORY"
            and al.status != "SUPPORTED"
        ):
            return {
                "final_outcome": "No Hire",
                "platform_decision": "UNDER_REVIEW",
                "weighted_competency_score": weighted_competency_score(competency_results),
                "decision_inputs": {
                    "mandatory_eligibility_met": True,
                    "core_competencies_met": True,
                    "minimum_score_met": False,
                    "screening_hard_filters_passed": True,
                    "flags": [
                        {
                            "type": "mandatory_requirement",
                            "requirement_id": al.requirement_id,
                            "status": al.status,
                        }
                    ],
                },
                "reason": f"Mandatory requirement {al.requirement_id} not SUPPORTED",
            }

    w_score = weighted_competency_score(competency_results)
    if w_score >= thresholds.strong_hire_min:
        outcome, platform = "Strong Hire", "AUTO_PASS_TO_OFFER"
    elif w_score >= thresholds.hire_with_reservations_min:
        outcome, platform = "Hire with reservations", "UNDER_REVIEW"
    else:
        outcome, platform = "No Hire", "AUTO_REJECT"

    return {
        "final_outcome": outcome,
        "platform_decision": platform,
        "weighted_competency_score": w_score,
        "decision_inputs": {
            "mandatory_eligibility_met": True,
            "core_competencies_met": True,
            "minimum_score_met": w_score >= thresholds.hire_with_reservations_min,
            "screening_hard_filters_passed": True,
            "flags": flags,
        },
        "reason": f"weighted_score={w_score}",
    }


def derive_evidence_quality(state: CompetencyEvidenceState) -> str:
    """Deterministic overall evidence_quality from REQUIRED items only.

    - all required == strong                         -> high
    - mixed strong/medium, none weak, none missing   -> medium
    - any required weak OR any required NOT_COVERED  -> low
    Optional (non-required) NOT_COVERED is ignored.
    """
    if not state.required_ids:
        return "low"
    qualities: list[str] = []
    for eid in state.required_ids:
        item = state.evidence_state.get(eid)
        if item is None or item.status == "NOT_COVERED":
            return "low"
        q = item.quality
        if q is None or q == "weak":
            return "low"
        qualities.append(q)
    if all(q == "strong" for q in qualities):
        return "high"
    return "medium"


def resolve_supporting_quotes(
    llm_quotes: Any,
    available_quotes: list[dict[str, Any]],
    *,
    max_n: int = 3,
) -> list[dict[str, Any]]:
    """Use LLM quotes only when non-empty; otherwise fall back to collected quotes."""
    if isinstance(llm_quotes, list) and llm_quotes:
        return llm_quotes
    return available_quotes[:max_n]


_QUOTE_ABSENCE_PHRASES: tuple[str, ...] = (
    "no supporting quote",
    "no direct quote",
    "no quotes provided",
    "without quotes",
    "no quote",
)


def sanitize_reasoning_for_quotes(
    reasoning: str,
    supporting_quotes: list[dict[str, Any]],
) -> str:
    """Drop full sentences that claim quotes are missing when quotes exist."""
    text = (reasoning or "").strip()
    if not text or not supporting_quotes:
        return text
    # Split on sentence boundaries; keep separators attached to prior chunk via lookbehind.
    parts = re.split(r"(?<=[.!?])\s+", text)
    kept: list[str] = []
    for sent in parts:
        low = sent.lower()
        if any(phrase in low for phrase in _QUOTE_ABSENCE_PHRASES):
            continue
        kept.append(sent)
    return " ".join(kept).strip()


def build_competency_evaluation(
    comp: CompetencyConfig,
    state: CompetencyEvidenceState,
    *,
    score: int,
    reasoning: str,
    supporting_quotes: list[dict[str, Any]],
) -> CompetencyEvaluation:
    score_i = max(1, min(5, int(score)))
    optional_ids = [
        e.evidence_id for e in comp.evidence_requirements if not e.required
    ]
    # Soft-cap: cannot be Exceptional (5) if any optional evidence is still missing
    optional_missing = any(
        (state.evidence_state.get(oid) is None
         or state.evidence_state[oid].status == "NOT_COVERED")
        for oid in optional_ids
    )
    if optional_missing:
        score_i = min(score_i, 4)

    gaps: list[str] = []
    for eid, item in state.evidence_state.items():
        if item.status == "NOT_COVERED":
            gaps.append(eid)
        elif eid in state.required_ids and item.quality == "weak":
            gaps.append(eid)

    clean_reasoning = sanitize_reasoning_for_quotes(reasoning, supporting_quotes)

    return CompetencyEvaluation(
        competency_id=comp.competency_id,
        name=comp.name,
        is_core=comp.is_core,
        weight=comp.effective_weight(),
        score=score_i,
        level=score_to_level(score_i),
        evidence_quality=derive_evidence_quality(state),
        completion_status=state.status,
        reasoning=clean_reasoning,
        supporting_quotes=supporting_quotes,
        gaps=gaps,
    )
