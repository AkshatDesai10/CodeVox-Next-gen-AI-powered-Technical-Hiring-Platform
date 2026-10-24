"""Final Evaluation Engine: aggregate per-turn diagnostic scores into rubric scorecard.

Per-turn internal_score_10 values are diagnostics only during the session.
At oral-phase end this module computes mean scores per competency, a weight_pct
roll-up, and a secondary overall integer for stage1_voice_score persistence.
"""

from __future__ import annotations

from typing import Any

from candidate_knowledge import CandidateKnowledgeState


def _mean(scores: list) -> float | None:
    numeric = [
        float(score)
        for score in scores
        if isinstance(score, (int, float)) and not isinstance(score, bool)
    ]
    if not numeric:
        return None
    return sum(numeric) / float(len(numeric))


def aggregate_rubric_scorecard(
    knowledge_state: CandidateKnowledgeState | dict[str, Any],
    rubric_criteria: list[dict[str, Any]] | None,
    candidate_left: bool = False,
) -> dict[str, Any]:
    """Build rubric scorecard from competency_scores × weight_pct.

    Returns:
      {
        "rubric_scorecard": [{competency, id, score_10, weight_pct, target_score,
                              sample_count, meets_target, justification}],
        "weighted_overall_10": float | None,
        "weighted_overall_rounded": int | None,
      }
    """
    if isinstance(knowledge_state, CandidateKnowledgeState):
        ks = knowledge_state
        scores_map = dict(ks.competency_scores)
    else:
        scores_map = dict(knowledge_state.get("competency_scores") or {})
        # Build a thin adapter for helpers
        ks = CandidateKnowledgeState()
        ks.competency_scores = {str(k): list(v) for k, v in scores_map.items()}
        ks.tested_competencies = set(knowledge_state.get("tested_competencies") or [])
        ks.turns_per_competency = {
            str(k): int(v) for k, v in (knowledge_state.get("turns_per_competency") or {}).items()
        }
        ks.primary_asked = {
            str(k): int(v) for k, v in (knowledge_state.get("primary_asked") or {}).items()
        }
        ks.time_per_competency = {
            str(k): float(v) for k, v in (knowledge_state.get("time_per_competency") or {}).items()
        }

    criteria = list(rubric_criteria or [])
    rows: list[dict[str, Any]] = []
    weighted_sum = 0.0
    weight_total = 0.0
    attempted_weight = 0.0

    if not criteria:
        # Fall back to raw competency_scores keys when no rubric was loaded
        for comp_id, scores in scores_map.items():
            mean = _mean(list(scores))
            if mean is None:
                continue
            rows.append(
                {
                    "id": str(comp_id),
                    "competency": str(comp_id),
                    "score_10": round(mean, 2),
                    "weight_pct": 0.0,
                    "target_score": None,
                    "sample_count": len(scores),
                    "meets_target": None,
                    "justification": f"Mean of {len(scores)} diagnostic turn score(s).",
                }
            )
        overall = _mean([int(round(r["score_10"])) for r in rows]) if rows else None
        return {
            "rubric_scorecard": rows,
            "weighted_overall_10": round(overall, 2) if overall is not None else None,
            "weighted_overall_rounded": int(round(overall)) if overall is not None else None,
        }

    for crit in criteria:
        crit_id, crit_label = ks._competency_keys(crit)
        label = crit_label or crit_id or "Competency"
        scores = ks._scores_for_competency(crit_id, crit_label)
        mean = _mean(scores)
        # primary_asked is the number of real questions. Follow-ups and mis-labeled
        # pivots must not inflate the count the report shows.
        if ks.primary_asked:
            sample_count = ks.primary_count_for(crit_id, crit_label)
        else:
            sample_count = len(scores)
        weight = float(crit.get("weight_pct", 0) or 0)
        target_raw = crit.get("target_score")
        target = float(target_raw) if target_raw is not None and target_raw != "" else None
        # Uncovered rubrics stay in the scorecard at 0 so a partial interview
        # still completes. Covered rubrics keep their mean.
        effective = 0.0 if mean is None else mean
        meets = target is not None and effective >= target
        if mean is None:
            if candidate_left:
                justification = "Incomplete due to early disconnect; scored 0."
            else:
                justification = "Not assessed in this session due to time allocation; normalized across covered competencies."
        elif target is not None:
            justification = (
                f"Mean {mean:.1f}/10 across {len(scores)} scored answer(s); "
                f"{sample_count} primary question(s); "
                f"target {target:.0f}/10 {'met' if meets else 'not met'}."
            )
        else:
            justification = (
                f"Mean {mean:.1f}/10 across {len(scores)} scored answer(s); "
                f"{sample_count} primary question(s)."
            )

        row = {
            "id": crit_id or crit_label,
            "competency": label,
            "score_10": round(effective, 2),
            "weight_pct": weight,
            "target_score": target,
            "sample_count": sample_count,
            "meets_target": meets,
            "justification": justification,
        }
        
        pack = ks._evidence_pack_for_crit(crit) if hasattr(ks, "_evidence_pack_for_crit") else None
        if pack and pack.exit_reason == "weak_exhausted":
            row["justification"] = row["justification"].rstrip(".") + " (Resume was not tested because the candidate struggled with the basics of this topic)."

        if candidate_left and not crit.get("is_optional", False):
            substantive_items = [item for item in pack.items if item.is_substantive] if pack else []
            if not substantive_items:
                row["incomplete_disconnect"] = True
                row["justification"] = row["justification"].rstrip(".") + " (Incomplete due to early disconnect)."
                
        rows.append(row)
        if weight > 0:
            if mean is not None:
                weighted_sum += mean * weight
                attempted_weight += weight
            elif candidate_left:
                weighted_sum += 0.0
                attempted_weight += weight
            weight_total += weight

    denom = attempted_weight if (attempted_weight > 0 and not candidate_left) else weight_total
    overall = (weighted_sum / denom) if denom > 0 else None
    rounded = int(max(0, min(10, round(overall)))) if overall is not None else None
    unscored = 0
    scored_turns = 0
    if isinstance(knowledge_state, CandidateKnowledgeState):
        for row in ks.turn_evaluations:
            if isinstance(row, dict) and row.get("eval_status") == "unscored":
                unscored += 1
            else:
                scored_turns += 1
    ranking_reliable = unscored == 0 or scored_turns >= unscored
    return {
        "rubric_scorecard": rows,
        "weighted_overall_10": round(overall, 2) if overall is not None and ranking_reliable else None,
        "weighted_overall_rounded": rounded if ranking_reliable else None,
        "unscored_turns": unscored,
        "scored_turns": scored_turns,
        "unscored_note": f"{unscored} of {unscored + scored_turns} turns unscored" if unscored else "",
        "ranking_reliable": ranking_reliable,
    }


def combine_technical_and_take_home_scores(
    *,
    technical_score_10: float | None,
    take_home_notes: list[dict[str, Any]] | None,
    take_home_weight_pct: float,
    fallback_to_take_home: bool = False,
) -> dict[str, Any]:
    """Weight Technical rubric score with Take-Home verification (0–3 scale → %).

    Final = Technical × (100 - th_weight)% + TakeHome × th_weight%.
    At 100% weight the Take-Home score is final even without a technical score;
    `fallback_to_take_home` (Build & Defend) also uses it when no rubric score exists.
    Returns fields suitable for stage1_voice_audit + stage1VoiceScore (0–10).
    """
    tech_10 = float(technical_score_10) if technical_score_10 is not None else None
    tech_pct = (tech_10 / 10.0) * 100.0 if tech_10 is not None else None
    weight = max(0.0, min(100.0, float(take_home_weight_pct or 0)))
    notes = list(take_home_notes or [])

    th_pct: float | None = None
    if notes:
        raw = [int(n.get("score", 0) or 0) for n in notes]
        max_possible = len(raw) * 3
        th_pct = (sum(raw) / max_possible) * 100.0 if max_possible > 0 else 0.0

    if th_pct is not None and weight > 0 and (
        weight >= 100 or (tech_pct is None and fallback_to_take_home)
    ):
        final_pct = th_pct
        final_10 = th_pct / 10.0
    elif th_pct is None or weight <= 0 or tech_pct is None:
        final_pct = tech_pct
        final_10 = tech_10
    else:
        tech_w = 100.0 - weight
        final_pct = (tech_pct * (tech_w / 100.0)) + (th_pct * (weight / 100.0))
        final_10 = final_pct / 10.0

    return {
        "technical_score_10": round(tech_10, 2) if tech_10 is not None else None,
        "technical_score_pct": round(tech_pct, 2) if tech_pct is not None else None,
        "take_home_verification_score_pct": round(th_pct, 2) if th_pct is not None else None,
        "take_home_weight_pct": weight,
        "technical_weight_pct": round(100.0 - weight, 2) if weight > 0 else 100.0,
        "final_combined_score_pct": round(final_pct, 2) if final_pct is not None else None,
        "final_combined_score_10": round(final_10, 2) if final_10 is not None else None,
        "take_home_notes": notes,
        "take_home_concerns": [n for n in notes if n.get("concern")],
    }
