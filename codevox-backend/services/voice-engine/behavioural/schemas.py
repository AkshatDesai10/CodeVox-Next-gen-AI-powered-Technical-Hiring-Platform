"""AI Behavioural interview schemas — typed dataclasses for orchestrator state."""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Literal


EvidenceQuality = Literal["strong", "medium", "weak"] | None
CoverageStatus = Literal["COVERED", "NOT_COVERED"]
CompetencyStatus = Literal["IN_PROGRESS", "COMPLETE", "COMPLETE_WITH_GAPS"]
DecisionAction = Literal["FOLLOWUP", "COMPLETE", "COMPLETE_WITH_GAPS", "NEXT_COMPETENCY"]
AlignmentStatus = Literal["SUPPORTED", "NOT_ESTABLISHED", "CONTRADICTED"]
EligibilityStatus = Literal["SATISFIED", "NOT_SATISFIED", "UNKNOWN"]
Track = Literal["eligibility", "profile", "behavioral", "informational"]
LevelLabel = Literal["Insufficient", "Weak", "Developing", "Strong", "Exceptional"]

LEVEL_FROM_SCORE: dict[int, LevelLabel] = {
    1: "Insufficient",
    2: "Weak",
    3: "Developing",
    4: "Strong",
    5: "Exceptional",
}

DEFAULT_STAR = [
    {"evidence_id": "situation", "required": True},
    {"evidence_id": "responsibility", "required": True},
    {"evidence_id": "action", "required": True},
    {"evidence_id": "result", "required": False},
]

FALLBACK_BY_EVIDENCE: dict[str, str] = {
    "situation": "Could you briefly describe the situation or context you were in?",
    "responsibility": "What part of that were you personally responsible for?",
    "action": "What specific actions did you take?",
    "result": "What was the outcome of your work?",
}


@dataclass
class EvidenceRequirement:
    evidence_id: str
    required: bool = True


@dataclass
class CompetencyConfig:
    competency_id: str
    name: str
    weight_pct: float = 0.0
    is_core: bool = False
    objective: str = ""
    evidence_requirements: list[EvidenceRequirement] = field(default_factory=list)
    max_questions: int = 3
    max_followups: int = 2
    weight_multiplier: float | None = None
    question_style_default: str = "behavioral"

    def effective_weight(self) -> float:
        base = float(self.weight_pct or 0)
        if self.weight_multiplier is not None:
            return base * float(self.weight_multiplier)
        return base


@dataclass
class JobRequirement:
    requirement_id: str
    name: str
    category: str = "skill"
    importance: str = "MANDATORY"


@dataclass
class ScreeningQuestion:
    question_id: str
    question_text: str
    category: str  # eligibility | background | informational | compensation
    answer_field: str | None = None
    expected_type: str = "free_text"
    requirement_mapping: str | list[str] | None = None
    decision_rule: dict[str, Any] | None = None


@dataclass
class RoundLimits:
    max_total_questions: int = 12
    max_duration_minutes: int = 20


@dataclass
class ScoreThresholds:
    strong_hire_min: float = 3.5
    hire_with_reservations_min: float = 2.5
    core_competency_min_score: float = 2.0


@dataclass
class DecisionPolicy:
    require_all_mandatory_eligibility: bool = True
    require_all_mandatory_requirements_supported: bool = False
    preferred_requirement_soft_weight: float = 0.0


@dataclass
class BehaviouralRoundConfig:
    competencies: list[CompetencyConfig] = field(default_factory=list)
    job_requirements: list[JobRequirement] = field(default_factory=list)
    screening_questions: list[ScreeningQuestion] = field(default_factory=list)
    interview_limits: RoundLimits = field(default_factory=RoundLimits)
    score_thresholds: ScoreThresholds = field(default_factory=ScoreThresholds)
    decision_policy: DecisionPolicy = field(default_factory=DecisionPolicy)

    @staticmethod
    def from_payload(
        round_config: dict[str, Any] | None,
        rubric_criteria: list[dict[str, Any]] | None,
    ) -> BehaviouralRoundConfig:
        rc = round_config or {}
        overrides = rc.get("competency_overrides") or {}
        comps: list[CompetencyConfig] = []
        for r in rubric_criteria or []:
            cid = str(r.get("id") or r.get("competency_id") or "")
            name = str(r.get("label") or r.get("name") or cid)
            ov = overrides.get(cid) or overrides.get(name) or {}
            ev_req = ov.get("evidence_requirements") or DEFAULT_STAR
            comps.append(
                CompetencyConfig(
                    competency_id=cid or name,
                    name=name,
                    weight_pct=float(r.get("weight_pct") or ov.get("weight_pct") or 0),
                    is_core=bool(ov.get("is_core", False)),
                    objective=str(ov.get("objective") or ""),
                    evidence_requirements=[
                        EvidenceRequirement(
                            evidence_id=str(e.get("evidence_id")),
                            required=bool(e.get("required", True)),
                        )
                        for e in ev_req
                    ],
                    max_questions=int(ov.get("max_questions") or 3),
                    max_followups=int(ov.get("max_followups") or 2),
                    weight_multiplier=(
                        float(ov["weight"]) if ov.get("weight") is not None else None
                    ),
                    question_style_default=str(ov.get("question_style_default") or "behavioral"),
                )
            )
        limits = rc.get("interview_limits") or {}
        thr = rc.get("score_thresholds") or {}
        pol = rc.get("decision_policy") or {}
        reqs = [
            JobRequirement(
                requirement_id=str(j.get("requirement_id")),
                name=str(j.get("name") or j.get("requirement_id")),
                category=str(j.get("category") or "skill"),
                importance=str(j.get("importance") or "MANDATORY"),
            )
            for j in (rc.get("job_requirements") or [])
        ]
        screens = [
            ScreeningQuestion(
                question_id=str(s.get("question_id")),
                question_text=str(s.get("question_text") or ""),
                category=str(s.get("category") or "informational"),
                answer_field=s.get("field") or s.get("answer_field"),
                expected_type=str(s.get("expected_type") or "free_text"),
                requirement_mapping=s.get("requirement_mapping"),
                decision_rule=s.get("decision_rule"),
            )
            for s in (rc.get("screening_questions") or [])
        ]
        return BehaviouralRoundConfig(
            competencies=comps,
            job_requirements=reqs,
            screening_questions=screens,
            interview_limits=RoundLimits(
                max_total_questions=int(limits.get("max_total_questions") or 12),
                max_duration_minutes=int(limits.get("max_duration_minutes") or 20),
            ),
            score_thresholds=ScoreThresholds(
                strong_hire_min=float(thr.get("strong_hire_min") or 3.5),
                hire_with_reservations_min=float(thr.get("hire_with_reservations_min") or 2.5),
                core_competency_min_score=float(thr.get("core_competency_min_score") or 2.0),
            ),
            decision_policy=DecisionPolicy(
                require_all_mandatory_eligibility=bool(
                    pol.get("require_all_mandatory_eligibility", True)
                ),
                require_all_mandatory_requirements_supported=bool(
                    pol.get("require_all_mandatory_requirements_supported", False)
                ),
                preferred_requirement_soft_weight=float(
                    pol.get("preferred_requirement_soft_weight") or 0
                ),
            ),
        )


@dataclass
class EvidenceItemState:
    status: CoverageStatus = "NOT_COVERED"
    quality: EvidenceQuality = None
    source_turn: str | None = None


@dataclass
class CompetencyEvidenceState:
    competency_id: str
    evidence_state: dict[str, EvidenceItemState] = field(default_factory=dict)
    followups_used: int = 0
    questions_used: int = 0
    status: CompetencyStatus = "IN_PROGRESS"
    required_ids: list[str] = field(default_factory=list)
    # Soft-probe for optional "result": issued at most once per competency
    result_probed: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "competency_id": self.competency_id,
            "evidence_state": {
                k: asdict(v) for k, v in self.evidence_state.items()
            },
            "followups_used": self.followups_used,
            "questions_used": self.questions_used,
            "status": self.status,
            "result_probed": self.result_probed,
        }


@dataclass
class NextAction:
    action: DecisionAction
    target_evidence: list[str] = field(default_factory=list)
    reason: str = ""


@dataclass
class ExtractedEvidence:
    evidence_id: str
    present: bool
    quality: EvidenceQuality
    quote_original: str | None
    quote_normalized: str | None
    confidence: float | None = None


@dataclass
class QuestionAsk:
    question_id: str
    text: str
    track: Track
    type: str = "behavioral"
    competency_id: str | None = None
    category: str | None = None
    answer_field: str | None = None
    targets_evidence: list[str] = field(default_factory=list)
    is_followup: bool = False
    parent_question_id: str | None = None
    resume_anchor: str | None = None
    screening_question_id: str | None = None


@dataclass
class CompetencyEvaluation:
    competency_id: str
    name: str
    is_core: bool
    weight: float
    score: int | None
    scale: int = 5
    level: LevelLabel | None = None
    evidence_quality: str = "medium"
    completion_status: CompetencyStatus = "COMPLETE"
    reasoning: str = ""
    supporting_quotes: list[dict[str, Any]] = field(default_factory=list)
    gaps: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ScreeningCapture:
    question_id: str
    category: str
    answer_field: str | None
    raw_answer_final: str
    parsed_value: Any = None
    requirement_mapping: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["field"] = d.pop("answer_field", None)
        return d


@dataclass
class RequirementAlignment:
    requirement_id: str
    status: AlignmentStatus
    source_turn: str | None = None
    evidence: str | None = None
    confidence: float | None = None
    importance: str = "MANDATORY"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def score_to_level(score: int) -> LevelLabel:
    return LEVEL_FROM_SCORE.get(max(1, min(5, int(score))), "Developing")
