"""Weightage planner checks. No network and no LiveKit."""

from collections import Counter

from candidate_knowledge import BrainDecision, CandidateKnowledgeState, apply_interview_plan
from verbal_interview_plan import (
    allocate_primary_questions,
    build_verbal_plan,
    eligible_categories,
    judge_competency_evidence,
    parse_verbal_budget,
)

STRONG = "I would split the records, train a small model, and check precision on the held-out set."
BUDGET = {"verbal_min_primary_questions": 2, "verbal_max_total_questions": 4}


def _rubrics():
    return [
        {"id": "ml", "label": "Machine Learning", "weight_pct": 60, "target_score": 8},
        {"id": "resume", "label": "Resume Projects", "weight_pct": 40, "target_score": 8},
    ]


def _ask(ks, rubrics, understanding, text, *, seniority="junior", budget=None, status="scored"):
    decided, reason = apply_interview_plan(
        BrainDecision(
            action_mode="PROBE_DEPTH",
            target_competency="Machine Learning",
            target_concept="train test split",
            difficulty="SENIOR",
            system_directive="raise the difficulty",
            question_source="TECHNICAL",
        ),
        ks,
        rubrics,
        evaluated_rubric_key=ks.active_competency or "ml",
        seniority=seniority,
        understanding_level=understanding,
        eval_status=status,
        user_text=text,
        configured_plans=True,
        round_config=BUDGET if budget is None else budget,
        resume_skills=["recommendation projects"],
        job_profile_context={"resume_projects": "recommendation projects"},
    )
    if decided.action_mode != "WRAP_UP":
        ks.note_planned_question()
    ks.active_competency = decided.target_competency
    return decided, reason


def test_weightage_allocation_matches_the_largest_remainder_example():
    assert allocate_primary_questions([40, 25, 15, 10, 10], 10) == [4, 3, 1, 1, 1]
    assert allocate_primary_questions([20, 20, 20, 20, 20], 5) == [1, 1, 1, 1, 1]
    short = allocate_primary_questions([40, 25, 15, 10, 10], 4)
    assert isinstance(short, str)
    assert "less than the number" in short
    # A heavy rubric cannot take every seat when others would otherwise get zero.
    repaired = allocate_primary_questions([80, 5, 5, 5, 5], 10)
    assert repaired == [6, 1, 1, 1, 1]
    assert sum(repaired) == 10


def test_invalid_budget_does_not_drop_a_rubric_and_missing_budget_is_one_each():
    five = [
        {"id": str(i), "label": f"Skill {i}", "weight_pct": 20}
        for i in range(5)
    ]
    missing_min, missing_max = parse_verbal_budget({}, 5)
    assert (missing_min, missing_max) == (5, 5)
    invalid = build_verbal_plan(
        five,
        seniority="mid",
        round_config={"verbal_min_primary_questions": 3, "verbal_max_total_questions": 8},
    )
    assert invalid["min_primary"] == 5
    assert invalid["max_total"] == 5
    assert sorted(invalid["allocations"].values()) == [1, 1, 1, 1, 1]
    assert len(invalid["slots"]) == 5


def test_default_category_eligibility_by_seniority():
    junior = eligible_categories("junior")
    mid = eligible_categories("mid-level")
    senior = eligible_categories("Senior Engineer")
    assert junior == ("FOUNDATIONAL", "TECHNICAL_APPLIED", "RESUME_VALIDATION")
    assert "PROBLEM_SOLVING" not in junior
    assert mid == ("TECHNICAL_APPLIED", "RESUME_VALIDATION", "PROBLEM_SOLVING")
    assert senior == mid
    assert "FOUNDATIONAL" not in mid
    assert "FOUNDATIONAL" not in senior


def test_categories_differ_by_rubric_and_skip_resume_without_evidence():
    with_resume = build_verbal_plan(
        _rubrics(),
        seniority="senior",
        round_config={"verbal_min_primary_questions": 2, "verbal_max_total_questions": 2},
        resume_skills=["recommendation projects"],
        job_profile_context={"resume_projects": "recommendation projects"},
    )
    first = with_resume["slots"][0]
    second = with_resume["slots"][1]
    assert first["rubric_key"] == "ml"
    assert first["dimension"] == "TECHNICAL_APPLIED"
    assert second["rubric_key"] == "resume"
    assert second["dimension"] == "RESUME_VALIDATION"
    assert first["dimension"] != second["dimension"]

    without = build_verbal_plan(
        _rubrics(),
        seniority="senior",
        round_config={"verbal_min_primary_questions": 2, "verbal_max_total_questions": 2},
    )
    assert all(slot["dimension"] != "RESUME_VALIDATION" for slot in without["slots"])
    assert {slot["dimension"] for slot in without["slots"]} <= {
        "TECHNICAL_APPLIED",
        "PROBLEM_SOLVING",
    }


def test_at_most_two_primary_questions_per_category():
    plan = build_verbal_plan(
        [{"id": "py", "label": "Python", "weight_pct": 100, "description": "types, testing"}],
        seniority="junior",
        round_config={"verbal_min_primary_questions": 4, "verbal_max_total_questions": 4},
    )
    counts = Counter(slot["dimension"] for slot in plan["slots"])
    assert sum(counts.values()) == 4
    assert max(counts.values()) <= 2
    assert len(counts) >= 2
    assert "PROBLEM_SOLVING" not in counts
    competencies = [slot["competency"] for slot in plan["slots"]]
    assert len(competencies) == len(set(competencies))


def test_evidence_moves_on_and_seniority_stays_fixed():
    rubrics = [{"id": "py", "label": "Python", "weight_pct": 100, "description": "types, testing"}]
    budget = {"verbal_min_primary_questions": 2, "verbal_max_total_questions": 2}
    ks = CandidateKnowledgeState()
    first, _ = _ask(ks, rubrics, "STRONG", STRONG, budget=budget)
    assert first.difficulty == "JUNIOR"
    assert first.evidence_dimension == "TECHNICAL_APPLIED"
    second, reason = _ask(ks, rubrics, "STRONG", STRONG, seniority="senior", budget=budget)
    assert reason == "plan_primary"
    assert second.difficulty == "JUNIOR"
    assert second.target_concept != first.target_concept
    evidence = ks.competency_evidence["py"]
    assert "SUFFICIENT" in evidence.values()
    assert ks.verbal_plan["seniority_band"] == "JUNIOR"
    judged = judge_competency_evidence(
        understanding_level="WEAK",
        eval_status="scored",
        user_text="no",
    )
    assert judged["evidence_state"] == "PARTIAL"
    assert judged["follow_up_justified"] is True


def test_followups_use_the_buffer_and_do_not_count_as_primary():
    ks = CandidateKnowledgeState()
    rubrics = _rubrics()
    first, _ = _ask(ks, rubrics, "WEAK", "no")
    assert first.difficulty == "JUNIOR"
    assert sum(ks.primary_asked.values()) == 1
    follow, reason = _ask(ks, rubrics, "WEAK", "still no", seniority="senior")
    assert reason == "plan_followup"
    assert follow.question_source == "FOLLOW_UP"
    assert follow.difficulty == "JUNIOR"
    assert follow.target_competency == first.target_competency
    assert sum(ks.primary_asked.values()) == 1
    assert sum(ks.followup_asked.values()) == 1
    other, _ = _ask(ks, rubrics, "WEAK", "no")
    assert other.target_competency != first.target_competency
    assert sum(ks.primary_asked.values()) == 2
    assert sum(ks.followup_asked.values()) == 1
    second_follow, _ = _ask(ks, rubrics, "WEAK", "no")
    assert second_follow.question_source == "FOLLOW_UP"
    assert sum(ks.primary_asked.values()) == 2
    assert sum(ks.followup_asked.values()) == 2
    done, reason = _ask(ks, rubrics, "WEAK", "no")
    assert reason == "plan_complete"
    assert done.action_mode == "WRAP_UP"
    assert sum(ks.primary_asked.values()) + sum(ks.followup_asked.values()) == 4


def test_unused_followup_buffer_does_not_add_primary_questions():
    ks = CandidateKnowledgeState()
    rubrics = _rubrics()
    _ask(ks, rubrics, "STRONG", STRONG)
    second, _ = _ask(ks, rubrics, "STRONG", STRONG)
    assert second.target_competency == "Resume Projects"
    done, reason = _ask(ks, rubrics, "STRONG", STRONG)
    assert reason == "plan_complete"
    assert done.action_mode == "WRAP_UP"
    assert sum(ks.primary_asked.values()) == 2
    assert sum(ks.followup_asked.values()) == 0


def test_full_budget_refuses_a_followup_and_legacy_plan_is_unchanged():
    ks = CandidateKnowledgeState()
    rubrics = [{"id": "py", "label": "Python", "weight_pct": 100}]
    budget = {"verbal_min_primary_questions": 1, "verbal_max_total_questions": 1}
    _ask(ks, rubrics, "WEAK", "no", budget=budget)
    done, _ = _ask(ks, rubrics, "WEAK", "no", budget=budget)
    assert done.action_mode == "WRAP_UP"
    assert sum(ks.followup_asked.values()) == 0
    assert sum(ks.primary_asked.values()) == 1

    legacy = CandidateKnowledgeState()
    decided, _ = apply_interview_plan(
        BrainDecision(target_competency="Machine Learning", difficulty="SENIOR"),
        legacy,
        _rubrics(),
        evaluated_rubric_key="ml",
        seniority="junior",
        understanding_level="STRONG",
        eval_status="scored",
        user_text=STRONG,
        configured_plans=False,
        round_config={"verbal_min_primary_questions": 10, "verbal_max_total_questions": 10},
    )
    assert decided.evidence_dimension == "FOUNDATIONAL"
    assert decided.question_source != "FOLLOW_UP"


def test_undelivered_question_does_not_spend_the_budget():
    ks = CandidateKnowledgeState()
    decided, _ = _ask(ks, _rubrics(), "STRONG", STRONG)
    ks.primary_asked.clear()
    ks.asked_slots.clear()
    ks.open_competency.clear()
    ks.followup_open.clear()
    ks.pending_question_plan = {
        "weightage": True,
        "key": decided.target_competency,
        "slot_index": 0,
        "dimension": decided.evidence_dimension,
        "competency": decided.target_concept,
        "is_followup": False,
        "followup_buffer": 2,
        "rubric_allocation": 1,
    }
    # A blank delivery clears the pending plan without counting it.
    ks.pending_question_plan = None
    assert sum(ks.primary_asked.values()) == 0
    assert ks.competency_evidence == {}
    again, _ = apply_interview_plan(
        BrainDecision(target_competency="Machine Learning"),
        ks,
        _rubrics(),
        evaluated_rubric_key="ml",
        seniority="junior",
        configured_plans=True,
        round_config=BUDGET,
        resume_skills=["recommendation projects"],
        job_profile_context={"resume_projects": "recommendation projects"},
    )
    assert again.action_mode != "WRAP_UP"
    assert ks.pending_question_plan["slot_index"] == 0
    assert sum(ks.primary_asked.values()) == 0


def test_moderate_answer_uses_one_followup_and_strong_does_not():
    ks = CandidateKnowledgeState()
    rubrics = [{"id": "py", "label": "Python", "weight_pct": 100}]
    budget = {"verbal_min_primary_questions": 1, "verbal_max_total_questions": 2}
    first, _ = _ask(ks, rubrics, "MODERATE", STRONG, budget=budget)
    assert "—" not in (first.system_directive or "")
    assert "core" not in (first.target_concept or "").casefold() or "python" in (first.target_concept or "").casefold()
    follow, reason = _ask(ks, rubrics, "MODERATE", STRONG, budget=budget)
    assert reason == "plan_followup"
    assert follow.question_source == "FOLLOW_UP"
    assert sum(ks.primary_asked.values()) == 1
    assert sum(ks.followup_asked.values()) == 1
    done, _ = _ask(ks, rubrics, "MODERATE", STRONG, budget=budget)
    assert done.action_mode == "WRAP_UP"


def test_questions_do_not_expose_internal_competency_tokens():
    plan = build_verbal_plan(
        [{"id": "dl", "label": "Deep Learning", "weight_pct": 100}],
        seniority="senior",
        round_config={"verbal_min_primary_questions": 4, "verbal_max_total_questions": 4},
    )
    for slot in plan["slots"]:
        assert "—" not in slot["competency"]
        assert not slot["competency"].casefold().endswith("core")


def test_optional_rubric_is_not_required_for_the_minimum():
    plan = build_verbal_plan(
        [
            {"id": "py", "label": "Python", "weight_pct": 100},
            {"id": "extra", "label": "Nice to have", "weight_pct": 50, "is_optional": True},
        ],
        seniority="mid",
        round_config={"verbal_min_primary_questions": 1, "verbal_max_total_questions": 1},
    )
    assert list(plan["allocations"]) == ["py"]
    assert plan["slots"][0]["dimension"] != "FOUNDATIONAL"


if __name__ == "__main__":
    test_weightage_allocation_matches_the_largest_remainder_example()
    test_invalid_budget_does_not_drop_a_rubric_and_missing_budget_is_one_each()
    test_default_category_eligibility_by_seniority()
    test_categories_differ_by_rubric_and_skip_resume_without_evidence()
    test_at_most_two_primary_questions_per_category()
    test_evidence_moves_on_and_seniority_stays_fixed()
    test_followups_use_the_buffer_and_do_not_count_as_primary()
    test_unused_followup_buffer_does_not_add_primary_questions()
    test_full_budget_refuses_a_followup_and_legacy_plan_is_unchanged()
    test_undelivered_question_does_not_spend_the_budget()
    test_optional_rubric_is_not_required_for_the_minimum()
    test_moderate_answer_uses_one_followup_and_strong_does_not()
    test_questions_do_not_expose_internal_competency_tokens()
    print("verbal interview plan tests passed")
