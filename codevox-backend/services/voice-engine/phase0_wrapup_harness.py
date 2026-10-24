"""Phase 0 gate: drive coverage to WRAP_UP and emit TURN_EVENT_JSONL rows.

Observability-only harness — does not change production decision math.
Uses real CandidateKnowledgeState + apply_coverage_guardrails path.
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import MagicMock

# Ensure local imports work when run as `python phase0_wrapup_harness.py`.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

os.environ["TURN_EVENT_JSONL"] = "true"
os.environ.setdefault("INTERVIEW_TRACE", "true")

from candidate_knowledge import (  # noqa: E402
    BrainDecision,
    CandidateKnowledgeState,
    EvaluationResult,
    canonicalize_rubric_key,
    enforce_deterministic_rubric_routing,
)
from interview_trace import (  # noqa: E402
    concept_fingerprint,
    emit_turn_event_jsonl,
    infer_spoken_question_source,
)
from orchestrator_llm import apply_coverage_guardrails  # noqa: E402


SESSION_TOKEN = "demo_phase0_wrapup_proof"

RUBRIC = [
    {"id": "r_php", "label": "PHP & Backend Development", "weight_pct": 40, "target_score": 8},
    {"id": "r_db", "label": "Database & SQL", "weight_pct": 35, "target_score": 8},
    {"id": "r_ps", "label": "Problem Solving", "weight_pct": 25, "target_score": 8},
]


def _strong(state: CandidateKnowledgeState, key: str, concept: str, q: str) -> None:
    state.append_evidence(
        rubric_key=key,
        question=q,
        answer_verbatim=(
            "In production we used connection pooling with bounded pool size matched to "
            "worker count, monitored wait time, and failed closed with a clear client error "
            "when the pool was exhausted rather than hanging the request thread."
        ),
        understanding_level="STRONG",
        internal_score_10=9,
        concept_tested=concept,
        probe_kind="initial",
        question_source="TECHNICAL",
        rubric_criteria=RUBRIC,
    )
    state.append_evidence(
        rubric_key=key,
        question=f"Challenge on {concept}",
        answer_verbatim=(
            "Under write-heavy load we keep selective indexes only, batch writes where "
            "safe, and measure p99 latency before adding another secondary index."
        ),
        understanding_level="MODERATE",
        internal_score_10=7,
        concept_tested=f"{concept} edge",
        probe_kind="challenge",
        question_source="TECHNICAL",
        rubric_criteria=RUBRIC,
    )


@dataclass
class _FakeEngine:
    entry_level: bool = True
    job_profile_context: dict[str, Any] = field(
        default_factory=lambda: {"resume_projects": "DSA World; MediVault"}
    )


@dataclass
class _FakeState:
    candidate_token: str
    rubric_criteria: list[dict]
    knowledge_state: CandidateKnowledgeState
    engine: _FakeEngine = field(default_factory=_FakeEngine)


def main() -> int:
    events: list[dict[str, Any]] = []
    original_emit = emit_turn_event_jsonl

    def _capture(event: dict[str, Any]) -> None:
        events.append(dict(event))
        original_emit(event)

    # Patch emit used by this module's calls only — we call capture wrapper directly.
    ks = CandidateKnowledgeState()
    state = _FakeState(
        candidate_token=SESSION_TOKEN,
        rubric_criteria=RUBRIC,
        knowledge_state=ks,
    )

    # Opening event
    _capture(
        {
            "session_token": SESSION_TOKEN,
            "turn_id": 1,
            "rubric_active": "PHP & Backend Development",
            "locked_rubric_key": "PHP & Backend Development",
            "brain_competency_id": None,
            "competency_desync": False,
            "competency_evaluated": "PHP & Backend Development",
            "question_source_intended": "TECHNICAL",
            "question_source_spoken": "TECHNICAL",
            "source_mismatch": False,
            "difficulty_tier": "FOUNDATIONAL",
            "tier_mismatch": False,
            "difficulty": "JUNIOR",
            "entry_level": True,
            "eval_score": None,
            "understanding_level": None,
            "coverage_before": "INSUFFICIENT",
            "coverage_after": "INSUFFICIENT",
            "exit_reason_before": None,
            "exit_reason_after": None,
            "forced_override_reason": None,
            "concept_fingerprint": concept_fingerprint("Introduction & Background"),
            "action_mode": "OPENING",
            "next_target_rubric": "PHP & Backend Development",
        }
    )

    turn = 2
    plan = [
        ("PHP & Backend Development", "pooling", "Explain PHP DB pooling."),
        ("Database & SQL", "indexing", "Explain indexing trade-offs."),
        ("Problem Solving", "timeouts", "How do you handle downstream timeouts?"),
    ]
    for rubric, concept, q in plan:
        key = canonicalize_rubric_key(rubric, RUBRIC)
        before = ks.get_evidence_pack(key)
        cov_before = before.coverage_state if before else "INSUFFICIENT"
        _strong(ks, rubric, concept, q)
        after = ks.get_evidence_pack(key)
        assert after is not None, f"missing pack for {rubric}->{key} packs={list(ks.evidence_packs)}"
        # Force freeze path as production would after SUFFICIENT
        brain = BrainDecision(
            action_mode="PROBE_DEPTH",
            target_competency=rubric,
            target_concept=concept,
            difficulty="JUNIOR",
            system_directive="Continue",
            question_source="TECHNICAL",
        )
        eval_res = EvaluationResult(
            concept_tested=concept,
            competency_id=rubric,
            understanding_level="STRONG",
            internal_score_10=9,
            evidence="strong technical answer",
        )
        brain, reason = enforce_deterministic_rubric_routing(
            brain,
            ks,
            RUBRIC,
            evaluated_rubric_key=key,
            job_profile_context=state.engine.job_profile_context,
            resume_skills=["PHP", "SQL"],
        )
        spoken = (
            f"Thanks. On {concept}, what failure mode would you watch in production?"
        )
        intended = "TECHNICAL"
        _capture(
            {
                "session_token": SESSION_TOKEN,
                "turn_id": turn,
                "rubric_active": rubric,
                "locked_rubric_key": rubric,
                "brain_competency_id": eval_res.competency_id,
                "competency_desync": False,
                "competency_evaluated": eval_res.competency_id,
                "question_source_intended": intended,
                "question_source_spoken": infer_spoken_question_source(
                    intended, spoken, job_profile_context=state.engine.job_profile_context
                ),
                "source_mismatch": False,
                "difficulty_tier": "FOUNDATIONAL", # Mock value for testing
                "tier_mismatch": False,
                "difficulty": brain.difficulty,
                "entry_level": True,
                "eval_score": eval_res.internal_score_10,
                "understanding_level": eval_res.understanding_level,
                "coverage_before": cov_before,
                "coverage_after": after.coverage_state,
                "exit_reason_before": None,
                "exit_reason_after": after.exit_reason,
                "forced_override_reason": reason,
                "concept_fingerprint": concept_fingerprint(concept),
                "action_mode": brain.action_mode,
                "next_target_rubric": brain.target_competency,
            }
        )
        turn += 1

    # All rubrics should now be SUFFICIENT → WRAP_UP via coverage guardrail
    brain = BrainDecision(
        action_mode="PROBE_DEPTH",
        target_competency="Problem Solving",
        target_concept="more",
        difficulty="JUNIOR",
        question_source="TECHNICAL",
    )
    brain, wrap_reason = apply_coverage_guardrails(
        state,  # type: ignore[arg-type]
        brain,
        turn=turn,
        current_comp="Problem Solving",
        forced_override_reason=None,
    )
    assert brain.action_mode == "WRAP_UP", brain.action_mode
    assert wrap_reason == "coverage_complete", wrap_reason

    _capture(
        {
            "session_token": SESSION_TOKEN,
            "turn_id": turn,
            "rubric_active": "Problem Solving",
            "locked_rubric_key": "Problem Solving",
            "brain_competency_id": "Problem Solving",
            "competency_desync": False,
            "competency_evaluated": "Problem Solving",
            "question_source_intended": "TECHNICAL",
            "question_source_spoken": "TECHNICAL",
            "source_mismatch": False,
            "difficulty_tier": "FOUNDATIONAL",
            "tier_mismatch": False,
            "difficulty": "JUNIOR",
            "entry_level": True,
            "eval_score": 8,
            "understanding_level": "STRONG",
            "coverage_before": "SUFFICIENT",
            "coverage_after": "SUFFICIENT",
            "exit_reason_before": "medium_complete",
            "exit_reason_after": "medium_complete",
            "forced_override_reason": wrap_reason,
            "concept_fingerprint": concept_fingerprint("wrap_up"),
            "action_mode": "WRAP_UP",
            "next_target_rubric": "Problem Solving",
        }
    )

    out_path = os.path.join(os.path.dirname(__file__), "phase0_wrapup_events.jsonl")
    with open(out_path, "w", encoding="utf-8") as fh:
        for ev in events:
            fh.write(json.dumps({"event": "turn_event", **ev}, ensure_ascii=False) + "\n")

    print(f"WRAP_UP_OK session_token={SESSION_TOKEN} turns={len(events)} file={out_path}")
    print("--- JSONL filtered ---")
    for ev in events:
        print(json.dumps({"event": "turn_event", **ev}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
