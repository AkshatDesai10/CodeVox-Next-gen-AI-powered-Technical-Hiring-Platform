"""Observability-only interview turn tracing.

Gated by INTERVIEW_TRACE=true (default false). Prints structured blocks
prefixed with [INTERVIEW_TRACE] for docker/log grepping. Does not change
interview decisions, scoring, prompts, or persistence.

Phase 0 also emits one machine-readable JSONL row per turn
(`[TURN_EVENT_JSONL] {...}`) when INTERVIEW_TRACE or TURN_EVENT_JSONL is on.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("interview-trace")
turn_event_logger = logging.getLogger("interview-turn-event")

_TRUE = {"1", "true", "yes", "on"}


def interview_trace_enabled() -> bool:
    return os.getenv("INTERVIEW_TRACE", "false").strip().lower() in _TRUE


def turn_event_jsonl_enabled() -> bool:
    """JSONL turn events: explicit TURN_EVENT_JSONL, else follow INTERVIEW_TRACE."""
    raw = os.getenv("TURN_EVENT_JSONL", "").strip().lower()
    if raw:
        return raw in _TRUE
    return interview_trace_enabled()


def concept_fingerprint(concept: str | None) -> str | None:
    """Stable-ish observability slug from a concept string (not used for decisions)."""
    text = (concept or "").casefold()
    text = re.sub(r"[^a-z0-9\s]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return None
    toks = [t for t in text.split() if len(t) >= 3][:6]
    return "_".join(toks) if toks else None


def infer_spoken_question_source(
    intended: str | None,
    spoken_text: str,
    *,
    resume_anchor: str | None = None,
    job_profile_context: dict[str, Any] | None = None,
) -> str:
    """Classify what the spoken question actually looks like (observability only)."""
    from candidate_knowledge import normalize_question_source, spoken_looks_resume_grounded

    src = normalize_question_source(intended)
    if src == "RESUME_VALIDATION":
        if spoken_looks_resume_grounded(
            spoken_text,
            resume_anchor=resume_anchor,
            job_profile_context=job_profile_context,
        ):
            return "RESUME_VALIDATION"
        return "TECHNICAL"
    return src


def emit_turn_event_jsonl(event: dict[str, Any]) -> None:
    """Emit one Phase-0 JSONL turn event. No effect on interview decisions."""
    if not turn_event_jsonl_enabled():
        return
    payload = {
        "event": "turn_event",
        **event,
    }
    line = json.dumps(payload, ensure_ascii=False, default=str, separators=(",", ":"))
    msg = f"[TURN_EVENT_JSONL] {line}"
    turn_event_logger.info(msg)
    # Also mirror on interview-trace logger so docker logs with INTERVIEW_TRACE capture it.
    logger.info(msg)


@dataclass
class BrainCallArtifacts:
    """Captured Brain call I/O for tracing (no effect on decisions)."""

    system_prompt: str = ""
    user_prompt: str = ""
    raw_response: str = ""
    used_fallback: bool = False


@dataclass
class CoverageSnap:
    coverage_state: str
    exit_reason: str | None


@dataclass
class PivotSnap:
    previous_rubric: str
    previous_coverage: str
    previous_exit: str | None
    remaining: list[dict[str, Any]] = field(default_factory=list)
    selected_next: str | None = None
    selection_why: str = ""


def _line(text: str = "") -> None:
    logger.info(f"[INTERVIEW_TRACE] {text}")


def _section(title: str) -> None:
    _line("")
    _line(f"===== {title} =====")


def _dump(obj: Any) -> str:
    try:
        return json.dumps(obj, indent=2, ensure_ascii=False, default=str)
    except Exception:
        return str(obj)


def _weight_pct(rubric_criteria: list[dict[str, Any]], rubric_key: str) -> float | None:
    key = (rubric_key or "").strip()
    for crit in rubric_criteria or []:
        cid = str(crit.get("id") or "").strip()
        label = str(crit.get("label") or "").strip()
        if key and key in (cid, label):
            try:
                return float(crit.get("weight_pct", 0) or 0)
            except (TypeError, ValueError):
                return None
    return None


def describe_coverage_condition(
    *,
    before: CoverageSnap,
    after: CoverageSnap,
    condition: str,
) -> str:
    """Format the deterministic coverage condition for the trace block."""
    return (
        f"coverage_state={after.coverage_state}, "
        f"exit_reason={after.exit_reason}, "
        f"before={before.coverage_state}/{before.exit_reason}, "
        f"trigger={condition}"
    )


def emit_evaluation_trace(
    *,
    turn: int,
    user_text: str,
    elapsed_mins: float,
    remaining_to_target_mins: float,
    remaining_to_ceiling_mins: float,
    active_rubric: str,
    coverage_before: CoverageSnap,
    weight_pct: float | None,
    concept_being_tested: str,
    evidence_count_before: int,
    brain: BrainCallArtifacts | None,
    eval_res: Any,
    brain_dec: Any,
    evidence_item: dict[str, Any] | None,
    coverage_after: CoverageSnap,
    coverage_condition: str,
    forced_override_reason: str | None,
    pivot: PivotSnap | None,
) -> None:
    if not interview_trace_enabled():
        return

    _section(f"TURN {turn} EVALUATION START")

    # 1. CANDIDATE INPUT
    _section("1. CANDIDATE INPUT")
    _line(f"turn_number={turn}")
    _line(f"elapsed_mins={elapsed_mins:.2f}")
    _line(f"remaining_to_30_target_mins={remaining_to_target_mins:.2f}")
    _line(f"remaining_to_50_ceiling_mins={remaining_to_ceiling_mins:.2f}")
    _line("answer_verbatim=")
    for row in (user_text or "").splitlines() or [""]:
        _line(row)

    # 2. ACTIVE RUBRIC
    _section("2. ACTIVE RUBRIC")
    _line(f"current_rubric={active_rubric}")
    _line(f"coverage_state={coverage_before.coverage_state}")
    _line(f"exit_reason={coverage_before.exit_reason}")
    _line(f"evidence_count={evidence_count_before}")
    _line(f"weight_pct={weight_pct}")
    _line(f"concept_being_tested={concept_being_tested}")

    # 3. BRAIN CONTEXT
    _section("3. BRAIN CONTEXT")
    if brain is None:
        _line("(brain artifacts unavailable)")
    else:
        _line("--- system ---")
        for row in (brain.system_prompt or "").splitlines() or [""]:
            _line(row)
        _line("--- user ---")
        for row in (brain.user_prompt or "").splitlines() or [""]:
            _line(row)

    # 4. RAW BRAIN RESPONSE
    _section("4. RAW BRAIN RESPONSE")
    if brain is None:
        _line("(unavailable)")
    elif brain.used_fallback:
        _line("(heuristic fallback — LLM parse/call failed; raw preview below)")
        for row in (brain.raw_response or "").splitlines() or [""]:
            _line(row)
    else:
        for row in (brain.raw_response or "").splitlines() or [""]:
            _line(row)

    # 5. PARSED DECISION
    _section("5. PARSED DECISION")
    parsed = {
        "action_mode": getattr(brain_dec, "action_mode", None),
        "next_question_directive": getattr(brain_dec, "system_directive", None),
        "target_rubric": getattr(brain_dec, "target_competency", None),
        "concept_tested": getattr(eval_res, "concept_tested", None),
        "target_concept": getattr(brain_dec, "target_concept", None),
        "understanding_level": getattr(eval_res, "understanding_level", None),
        "internal_score_10": getattr(eval_res, "internal_score_10", None),
        "evidence_notes": getattr(eval_res, "evidence", None),
        "resume_anchor": getattr(brain_dec, "resume_anchor", None)
        or getattr(eval_res, "verified_resume_claim", None),
        "question_source": getattr(brain_dec, "question_source", None),
        "forced_override_reason": forced_override_reason,
    }
    for row in _dump(parsed).splitlines():
        _line(row)

    # 6. EVIDENCE UPDATE
    _section("6. EVIDENCE UPDATE")
    if evidence_item is None:
        _line("(no evidence item)")
    else:
        for row in _dump(evidence_item).splitlines():
            _line(row)
    _line(
        f"coverage_state: {coverage_before.coverage_state} → {coverage_after.coverage_state}"
    )
    _line(
        f"exit_reason: {coverage_before.exit_reason} → {coverage_after.exit_reason}"
    )

    # 7. RUBRIC DECISION
    _section("7. RUBRIC DECISION")
    _line(
        describe_coverage_condition(
            before=coverage_before,
            after=coverage_after,
            condition=coverage_condition,
        )
    )
    if forced_override_reason:
        _line(f"guardrail_override={forced_override_reason}")

    # 8. PIVOT DECISION
    _section("8. PIVOT DECISION")
    if pivot is None:
        _line("(not applicable — continue on same / non-pivot path)")
    else:
        _line(f"previous_rubric={pivot.previous_rubric}")
        _line(
            f"previous_final_state={pivot.previous_coverage}/{pivot.previous_exit}"
        )
        _line("remaining_rubrics=")
        for row in _dump(pivot.remaining).splitlines():
            _line(row)
        _line(f"selected_next={pivot.selected_next}")
        _line(f"why={pivot.selection_why}")

    _line("")
    _line(
        f"TURN {turn}: Candidate → Evaluation → Evidence → Coverage Decision → Pivot Decision"
    )
    _line(f"===== TURN {turn} EVALUATION END =====")
    _line("")


def emit_generation_trace(
    *,
    turn: int,
    next_question: str,
    next_target_rubric: str | None,
    next_probe_kind: str | None,
    next_concept_tested: str | None,
) -> None:
    if not interview_trace_enabled():
        return

    _section(f"TURN {turn} GENERATION START")
    _line(f"target_rubric={next_target_rubric}")
    _line(f"probe_kind={next_probe_kind}")
    _line(f"concept_tested={next_concept_tested}")
    _line("question=")
    for row in (next_question or "").splitlines() or [""]:
        _line(row)

    _line("")
    _line(f"===== TURN {turn} GENERATION END =====")
    _line("")


def remaining_rubric_snapshots(
    knowledge_state: Any,
    rubric_criteria: list[dict[str, Any]],
    *,
    exclude_key: str | None = None,
) -> list[dict[str, Any]]:
    """Existing pack states/weights for pivot visibility (read-only)."""
    rows: list[dict[str, Any]] = []
    exclude = (exclude_key or "").strip()
    for crit in rubric_criteria or []:
        cid = str(crit.get("id") or "").strip()
        label = str(crit.get("label") or cid).strip()
        if exclude and exclude in (cid, label):
            continue
        pack = knowledge_state._evidence_pack_for_crit(crit)
        rows.append(
            {
                "id": cid,
                "label": label,
                "weight_pct": crit.get("weight_pct"),
                "coverage_state": pack.coverage_state if pack else "INSUFFICIENT",
                "exit_reason": pack.exit_reason if pack else None,
                "sufficient": bool(
                    pack and pack.coverage_state == "SUFFICIENT"
                ),
            }
        )
    rows.sort(key=lambda r: float(r.get("weight_pct") or 0), reverse=True)
    return rows


def lookup_weight_pct(
    rubric_criteria: list[dict[str, Any]], rubric_key: str
) -> float | None:
    return _weight_pct(rubric_criteria, rubric_key)
