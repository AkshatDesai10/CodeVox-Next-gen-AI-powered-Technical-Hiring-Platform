"""Policy checks for the AI verbal interview fixes. No network and no LiveKit."""

from pathlib import Path

from candidate_knowledge import (
    BrainDecision,
    CandidateKnowledgeState,
    EvaluationResult,
    apply_interview_plan,
    canonical_seniority_band,
    max_turns_for_seniority,
    pick_resume_anchor,
    resume_question_uses_unrelated_project,
)
from final_evaluation import aggregate_rubric_scorecard
from interview_brain import _heuristic_fallback, coerce_invalid_eval_field
from llm_engine import is_muffled, normalize_stt_text
from prompts import build_resume_fallback_question, job_profile_question_context
from provider_resilience import (
    EmptyCompletionError,
    _extract_completion_text,
    _is_retryable,
    _merge_chat_messages,
    parse_json_loose,
)


def test_junior_turn_cap_and_seniority_band():
    assert canonical_seniority_band("Junior Recruiter") == "JUNIOR"
    assert canonical_seniority_band("junior") == "JUNIOR"
    assert canonical_seniority_band("lead") == "JUNIOR"
    assert canonical_seniority_band("Staff / Principal") == "JUNIOR"
    assert canonical_seniority_band("Fresher") == "JUNIOR"
    assert canonical_seniority_band("Senior Accountant") == "SENIOR"
    assert canonical_seniority_band("senior") == "SENIOR"
    assert canonical_seniority_band("mid") == "MID"
    assert canonical_seniority_band("Mid-level HR") == "MID"
    assert max_turns_for_seniority("Junior") == 5
    assert max_turns_for_seniority("lead") == 5
    assert max_turns_for_seniority("Senior") == 5


def test_unscored_fallback_does_not_enter_scores():
    state = CandidateKnowledgeState()
    state.active_competency = "Excel"
    evaluation, decision = _heuristic_fallback("I use sheets", "How do you use Excel?", state, [], "Excel")
    assert evaluation.eval_status == "unscored"
    assert evaluation.internal_score_10 is None
    assert decision.action_mode in ("PIVOT_COMPETENCY", "REORIENT_PRACTICAL")
    state.record_turn_evaluation(evaluation)
    assert state.competency_scores == {}


def test_intro_note_is_not_rubric_evidence():
    state = CandidateKnowledgeState()
    opening = EvaluationResult(
        concept_tested="Introduction",
        internal_score_10=None,
        eval_status="unscored",
        evidence="Opening answer kept in intro notes only.",
    )
    state.record_turn_evaluation(opening)
    assert state.evidence_packs == {}
    assert state.competency_scores == {}


def test_parse_json_loose_and_message_merge():
    parsed = parse_json_loose('```json\n{"evaluation": {"internal_score_10": 7}}\n``` trailing')
    assert parsed["evaluation"]["internal_score_10"] == 7
    merged = _merge_chat_messages(
        [
            {"role": "system", "content": "one"},
            {"role": "user", "content": "hi"},
            {"role": "system", "content": "two"},
            {"role": "user", "content": "again"},
        ]
    )
    assert merged[0]["role"] == "system"
    assert "one" in merged[0]["content"] and "two" in merged[0]["content"]
    assert merged[1]["role"] == "user"
    assert "hi" in merged[1]["content"] and "again" in merged[1]["content"]


def test_short_yes_is_not_muffled_when_confident():
    assert is_muffled("Yes", 0.9) is False
    assert is_muffled("Yes", 0.2) is True


def test_seniority_stays_fixed_when_answers_change():
    from candidate_knowledge import BrainDecision, EvaluationResult
    from topic_orchestrator import TopicOrchestrator

    orchestrator = TopicOrchestrator("Excel", min_turns=2, max_turns=8)
    orchestrator.lock_seniority("SENIOR")
    strong = EvaluationResult(concept_tested="Excel", understanding_level="STRONG")
    challenge = BrainDecision(
        action_mode="CHALLENGE_EDGE_CASE",
        target_competency="Excel",
        difficulty="JUNIOR",
        system_directive="Go deeper.",
    )
    action = orchestrator.apply_brain_decision(challenge, strong)
    assert action.level == "SENIOR"
    assert orchestrator.state.current_level == "SENIOR"

    weak = EvaluationResult(concept_tested="Excel", understanding_level="NO_KNOWLEDGE")
    orchestrator.apply("UNKNOWN", 0)
    assert orchestrator.state.current_level == "SENIOR"

    orchestrator._load_topic_for_current_tech()
    assert orchestrator.state.current_level == "SENIOR"
    assert weak.understanding_level == "NO_KNOWLEDGE"


def test_department_and_seniority_reach_the_question_prompt():
    block = job_profile_question_context(
        {"title": "Account Executive", "department": "Sales", "seniority_level": "lead"}
    )
    assert "Department: Sales" in block
    assert "Seniority: Staff/Principal" in block
    assert "Question depth: JUNIOR" in block
    assert normalize_stt_text("my ectc is 12 lpa") == "my ECTC is 12 lpa"
    assert build_resume_fallback_question(resume_anchor=None, current_tech="Excel") == ""
    grounded = build_resume_fallback_question(resume_anchor="Campus hiring", current_tech="Excel")
    assert "in your work" in grounded
    assert "in production" not in grounded


def test_empty_completion_is_retryable_and_json_cases():
    assert _is_retryable(EmptyCompletionError("blank")) is True
    assert parse_json_loose('note {"a": 1} trailing')["a"] == 1
    try:
        parse_json_loose("no object here")
        raise AssertionError("expected ValueError")
    except ValueError:
        pass


def test_unscored_turns_do_not_rank():
    state = CandidateKnowledgeState()
    state.competency_scores["Excel"] = [8]
    state.turn_evaluations.append({"eval_status": "scored", "internal_score_10": 8})
    state.turn_evaluations.append({"eval_status": "unscored"})
    state.turn_evaluations.append({"eval_status": "unscored"})
    result = aggregate_rubric_scorecard(
        state,
        [{"id": "excel", "label": "Excel", "weight_pct": 100}],
    )
    assert result["unscored_note"] == "2 of 3 turns unscored"
    assert result["ranking_reliable"] is False
    assert result["weighted_overall_rounded"] is None


def test_scripted_openers_and_concept_nameerror_are_gone():
    source = Path(__file__).with_name("orchestrator_llm.py").read_text(encoding="utf-8")
    assert "Could you give me a high-level overview" not in source
    assert "turns_on_target < 2" not in source
    assert "{concept}" not in source or "concept=safe_concept" in source


_RUBRICS = [
    {"id": "ml", "label": "Machine Learning", "weight_pct": 25, "target_score": 8},
    {"id": "py", "label": "Python", "weight_pct": 25, "target_score": 8},
]


def _ask(ks, seniority, understanding, text, *, status="scored"):
    decision = BrainDecision(
        action_mode="PROBE_DEPTH",
        target_competency="Python",
        target_concept="train test split",
        difficulty="JUNIOR",
        system_directive="keep asking about the last machine learning answer",
        question_source="TECHNICAL",
    )
    decided, reason = apply_interview_plan(
        decision,
        ks,
        _RUBRICS,
        evaluated_rubric_key=ks.active_competency or "Machine Learning",
        seniority=seniority,
        understanding_level=understanding,
        eval_status=status,
        user_text=text,
    )
    ks.active_competency = decided.target_competency
    ks.active_concept = decided.target_concept
    if decided.action_mode != "WRAP_UP":
        ks.note_planned_question()
    return decided, reason


def test_plan_follows_seniority_and_one_followup():
    junior = CandidateKnowledgeState(active_competency="Machine Learning")
    long = "I would split the records, train a small model, and check precision on the held-out set."
    first, _ = _ask(junior, "junior", "STRONG", long)
    assert first.target_competency == "Machine Learning"
    assert first.evidence_dimension == "FOUNDATIONAL"
    assert junior.primary_asked["ml"] == 1

    # The brain wants to stay on Machine Learning and call it Python. A strong answer moves on.
    technical, _ = _ask(junior, "junior", "STRONG", long)
    assert technical.evidence_dimension == "TECHNICAL_APPLIED"
    assert technical.target_competency == "Machine Learning"
    resume, _ = _ask(junior, "junior", "STRONG", long)
    assert resume.evidence_dimension == "RESUME_VALIDATION"
    assert resume.question_source == "RESUME_VALIDATION"
    nxt, _ = _ask(junior, "junior", "STRONG", long)
    assert nxt.target_competency == "Python"
    assert nxt.evidence_dimension == "FOUNDATIONAL"
    assert junior.primary_asked["ml"] == 3
    assert junior.primary_asked["py"] == 1

    weak = CandidateKnowledgeState(active_competency="Machine Learning")
    _ask(weak, "junior", "STRONG", long)
    follow, reason = _ask(weak, "junior", "WEAK", "I do not know")
    assert reason == "plan_followup"
    assert follow.question_source == "FOLLOW_UP"
    assert follow.target_competency == "Machine Learning"
    assert weak.primary_asked["ml"] == 1
    assert weak.followup_asked["ml"] == 1
    assert weak.primary_asked.get("py", 0) == 0
    moved, _ = _ask(weak, "junior", "NO_KNOWLEDGE", "still nothing")
    assert moved.question_source != "FOLLOW_UP"
    assert moved.evidence_dimension == "TECHNICAL_APPLIED"
    assert weak.primary_asked["ml"] == 2
    assert weak.followup_asked["ml"] == 1

    mid = CandidateKnowledgeState(active_competency="Machine Learning")
    assert _ask(mid, "mid", "STRONG", long)[0].evidence_dimension == "TECHNICAL_APPLIED"
    assert _ask(mid, "mid", "WEAK", "unsure")[0].question_source == "FOLLOW_UP"
    assert _ask(mid, "mid", "STRONG", long)[0].evidence_dimension == "TECHNICAL_APPLIED"
    assert _ask(mid, "mid", "STRONG", long)[0].evidence_dimension == "RESUME_VALIDATION"
    assert mid.dimension_primaries["ml"].get("FOUNDATIONAL", 0) == 0

    senior = CandidateKnowledgeState(active_competency="Machine Learning")
    assert _ask(senior, "senior", "STRONG", long)[0].evidence_dimension == "TECHNICAL_APPLIED"
    assert _ask(senior, "senior", "STRONG", long)[0].evidence_dimension == "PROBLEM_SOLVING"
    assert _ask(senior, "senior", "STRONG", long)[0].evidence_dimension == "RESUME_VALIDATION"

    lead = CandidateKnowledgeState(active_competency="Machine Learning")
    assert _ask(lead, "lead", "STRONG", long)[0].evidence_dimension == "FOUNDATIONAL"


def test_primary_cap_and_scorecard_ignore_followups():
    ks = CandidateKnowledgeState(active_competency="Machine Learning")
    ks.primary_asked["ml"] = 5
    decided, _ = apply_interview_plan(
        BrainDecision(target_competency="Machine Learning", target_concept="accuracy"),
        ks,
        _RUBRICS,
        evaluated_rubric_key="Machine Learning",
        seniority="junior",
        understanding_level="STRONG",
        eval_status="scored",
        user_text="A full answer that already covered the point with a concrete example.",
    )
    assert decided.target_competency == "Python"
    pack = ks.ensure_evidence_pack("ml")
    for _ in range(3):
        ks.append_evidence(
            rubric_key="ml",
            question="q",
            answer_verbatim="a concrete working example with enough detail",
            understanding_level="STRONG",
            internal_score_10=8,
            question_source="TECHNICAL",
            evidence_dimension="TECHNICAL_APPLIED",
        )
    assert pack.frozen is False
    ks.competency_scores["ml"] = [6, 6, 6]
    ks.primary_asked["ml"] = 1
    card = aggregate_rubric_scorecard(ks, _RUBRICS)
    ml = next(row for row in card["rubric_scorecard"] if row["id"] == "ml")
    py = next(row for row in card["rubric_scorecard"] if row["id"] == "py")
    assert ml["sample_count"] == 1
    assert py["sample_count"] == 0


def test_short_skill_name_does_not_absorb_another_topic():
    from tech_pool_manager import TechPoolManager

    pool = TechPoolManager(["AI/ML", "Java", "Python", "C"])
    assert pool.focus_on("machine learning") == "AI/ML"
    assert pool.active_index == 0
    assert pool.focus_on("Python") == "Python"
    assert pool.active_index == 2


_PROJECTS = (
    "MediVault Healthcare Management Platform (Django, React, LLM/RAG)\n"
    "Vision pipeline for medical scans using OpenCV and image processing\n"
    "CNN classifier for chest X-rays with deep learning"
)


def test_resume_anchor_follows_the_rubric():
    ctx = {"resume_projects": _PROJECTS}
    ml = pick_resume_anchor(ctx, rubric_label="Machine Learning") or ""
    python = pick_resume_anchor(ctx, rubric_label="Python") or ""
    opencv = pick_resume_anchor(ctx, rubric_label="OpenCV") or ""
    deep = pick_resume_anchor(ctx, rubric_label="Deep Learning") or ""
    assert "MediVault" in ml
    assert "MediVault" in python
    assert "OpenCV" in opencv
    assert "MediVault" not in opencv
    assert "deep learning" in deep.casefold()
    assert "MediVault" not in deep
    stuck = pick_resume_anchor(
        ctx,
        existing="MediVault Healthcare Management Platform (Django, React, LLM/RAG)",
        rubric_label="OpenCV",
    )
    assert stuck and "OpenCV" in stuck
    question = (
        "Thanks. On MediVault Healthcare Management Platform, how did you use open cv in your work?"
    )
    assert resume_question_uses_unrelated_project(question, "OpenCV", ctx) is True
    assert resume_question_uses_unrelated_project(question, "Python", ctx) is False
    fallback = build_resume_fallback_question(
        resume_anchor="MediVault Healthcare Management Platform (Django, React, LLM/RAG)",
        current_tech="OpenCV",
        job_profile_context=ctx,
    )
    assert "OpenCV" in fallback or fallback == ""
    assert "MediVault" not in fallback


def test_numbered_resume_bullets_become_project_titles_and_rotate():
    ctx = {
        "resume_projects": (
            "1. MediVault Healthcare Management Platform: Developed an AI-powered platform "
            "using Django, React, PostgreSQL, and LangChain.\n"
            "2. AI Face Recognition Attendance System: Built a system using Django, FastAPI, and ArcFace.\n"
            "3. Fake News Detection System: Created a Dual-Branch LSTM model using TensorFlow/Keras."
        )
    }
    spoken = pick_resume_anchor(ctx, rubric_label="Python") or ""
    assert spoken in {
        "MediVault Healthcare Management Platform",
        "AI Face Recognition Attendance System",
    }
    assert "1." not in spoken
    assert "Developed" not in spoken
    other = pick_resume_anchor(ctx, rubric_label="Python", avoid=[spoken]) or ""
    assert other in {
        "MediVault Healthcare Management Platform",
        "AI Face Recognition Attendance System",
    }
    assert other != spoken
    deep = pick_resume_anchor(ctx, rubric_label="Deep Learning") or ""
    assert "Fake News" in deep
    assert "MediVault" not in deep
    fallback = build_resume_fallback_question(
        resume_anchor="1. MediVault Healthcare Management Platform: Developed an AI-powered platform using Django",
        current_tech="Python",
        job_profile_context=ctx,
    )
    assert "1." not in fallback
    assert "Developed an AI-powered" not in fallback
    assert "MediVault Healthcare Management Platform" in fallback or "Face Recognition" in fallback


def test_split_score_keys_are_all_counted():
    from final_evaluation import aggregate_rubric_scorecard

    ks = CandidateKnowledgeState()
    ks.competency_scores["17919577868470910"] = [6]
    ks.competency_scores["machine learning"] = [8, 4, 6]
    ks.primary_asked["17919577868470910"] = 4
    card = aggregate_rubric_scorecard(
        ks,
        [{"id": "17919577868470910", "label": "Machine Learning", "weight_pct": 100, "target_score": 8}],
    )
    row = card["rubric_scorecard"][0]
    assert row["justification"].startswith("Mean 6.0/10 across 4 scored answer(s)")


def test_clarify_and_non_answer_are_not_scored_replies():
    from orchestrator_llm import is_clarify_request, is_non_answer

    assert is_clarify_request("Could you please explain the question in simpler terms?")
    assert is_non_answer("Actually I don't know this answer")
    assert is_non_answer("I don't know") is True
    longer = (
        "Yes, I use some machine learning models, mainly classification models, "
        "but I don't remember the exact model names right now."
    )
    assert is_non_answer(longer) is False
    bad = {
        "concept_tested": "retrieval",
        "understanding_level": "NO_KNOWLEDGE",
        "internal_score_10": "N/A",
        "evidence": "not a number",
    }
    coerce_invalid_eval_field(bad, "internal_score_10")
    result = EvaluationResult(**bad)
    assert result.internal_score_10 is None
    assert result.eval_status == "unscored"


def test_score_json_is_read_from_reasoning_content():
    class Message:
        content = ""
        reasoning_content = '{"evaluation": {"internal_score_10": 6}}'

    class Choice:
        finish_reason = "stop"
        message = Message()

    text, _ = _extract_completion_text(Choice(), purpose="score")
    assert "internal_score_10" in text
    spoken, _ = _extract_completion_text(Choice(), purpose="generate")
    assert spoken == ""


if __name__ == "__main__":
    test_junior_turn_cap_and_seniority_band()
    test_unscored_fallback_does_not_enter_scores()
    test_intro_note_is_not_rubric_evidence()
    test_parse_json_loose_and_message_merge()
    test_short_yes_is_not_muffled_when_confident()
    test_seniority_stays_fixed_when_answers_change()
    test_department_and_seniority_reach_the_question_prompt()
    test_empty_completion_is_retryable_and_json_cases()
    test_unscored_turns_do_not_rank()
    test_scripted_openers_and_concept_nameerror_are_gone()
    test_plan_follows_seniority_and_one_followup()
    test_primary_cap_and_scorecard_ignore_followups()
    test_short_skill_name_does_not_absorb_another_topic()
    test_resume_anchor_follows_the_rubric()
    test_clarify_and_non_answer_are_not_scored_replies()
    test_score_json_is_read_from_reasoning_content()
    print("ok")
