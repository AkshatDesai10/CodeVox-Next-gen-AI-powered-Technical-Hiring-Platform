"""AI Screening schemas — config, conversation state, analyzer results."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class TopicCoverageStatus(str, Enum):
    NOT_STARTED = "NOT_STARTED"
    IN_PROGRESS = "IN_PROGRESS"
    COVERED = "COVERED"


class AnalyzerStatus(str, Enum):
    PENDING = "PENDING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class CheckStatus(str, Enum):
    PASS = "PASS"
    FLAG = "FLAG"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class FlagSeverity(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


# Soft internal hints only — HR does not configure topic↔requirement mapping.
TOPIC_REQUIREMENT_HINTS: dict[str, list[str]] = {
    "compensation": ["expected_compensation"],
    "education_background": ["highest_education"],
    "notice_period_availability": ["notice_period"],
    "work_location_work_mode": ["work_location_mode", "relocate_if_required"],
}

MAX_FOLLOWUPS_PER_TOPIC = 2


DEFAULT_TOPIC_CATALOG: list[dict[str, Any]] = [
    {"id": "professional_background", "label": "Professional Background", "default_enabled": True},
    {"id": "education_background", "label": "Education Background", "default_enabled": True},
    {"id": "previous_employment", "label": "Previous Employment", "default_enabled": False},
    {"id": "reason_for_leaving", "label": "Reason for Leaving", "default_enabled": True},
    {"id": "career_motivation", "label": "Career Motivation", "default_enabled": True},
    {"id": "compensation", "label": "Compensation", "default_enabled": True},
    {"id": "notice_period_availability", "label": "Notice Period & Availability", "default_enabled": True},
    {"id": "work_location_work_mode", "label": "Work Location & Work Mode", "default_enabled": True},
    {"id": "work_authorization", "label": "Work Authorization", "default_enabled": False},
    {"id": "career_goals", "label": "Career Goals", "default_enabled": False},
    {"id": "behavioral_situational", "label": "Behavioral / Situational", "default_enabled": False},
    {"id": "leadership_ownership", "label": "Leadership / Ownership", "default_enabled": False},
    {"id": "strengths_development", "label": "Strengths & Development", "default_enabled": False},
    {"id": "future_expectations", "label": "Future Expectations", "default_enabled": False},
    {"id": "personal_family_background", "label": "Personal / Family Background", "default_enabled": False},
]

PREDEFINED_REQUIREMENTS: list[dict[str, str]] = [
    {"id": "expected_compensation", "question": "What is your expected compensation?"},
    {"id": "highest_education", "question": "What is your highest level of education?"},
    {"id": "notice_period", "question": "How soon can you join?"},
    {
        "id": "work_location_mode",
        "question": "What work mode/location are you comfortable with?",
    },
    {
        "id": "relocate_if_required",
        "question": "Are you open to relocation if required?",
    },
]


@dataclass
class ScreeningTopic:
    id: str
    label: str
    enabled: bool = True


@dataclass
class ScreeningRequirement:
    id: str
    question: str
    expected_answer: str = ""
    predefined: bool = False

    @property
    def is_configured(self) -> bool:
        return bool((self.expected_answer or "").strip())


@dataclass
class ScreeningRoundConfig:
    max_questions: int = 10
    max_time_minutes: int = 15
    topics: list[ScreeningTopic] = field(default_factory=list)
    screening_requirements: list[ScreeningRequirement] = field(default_factory=list)

    @classmethod
    def from_payload(cls, raw: dict[str, Any] | None) -> "ScreeningRoundConfig":
        raw = raw or {}
        max_q = int(raw.get("maxQuestions") or raw.get("max_questions") or 10)
        max_t = int(raw.get("maxTimeMinutes") or raw.get("max_time_minutes") or 15)
        by_id: dict[str, dict[str, Any]] = {}
        for item in raw.get("topics") or []:
            if isinstance(item, dict) and item.get("id"):
                by_id[str(item["id"])] = item
        topics: list[ScreeningTopic] = []
        for cat in DEFAULT_TOPIC_CATALOG:
            prev = by_id.get(cat["id"], {})
            topics.append(
                ScreeningTopic(
                    id=cat["id"],
                    label=str(prev.get("label") or cat["label"]),
                    enabled=bool(prev["enabled"]) if "enabled" in prev else bool(cat["default_enabled"]),
                )
            )
        known = {t.id for t in topics}
        for tid, prev in by_id.items():
            if tid in known:
                continue
            topics.append(
                ScreeningTopic(
                    id=tid,
                    label=str(prev.get("label") or tid),
                    enabled=bool(prev.get("enabled", True)),
                )
            )

        requirements = _parse_requirements(raw)
        return cls(
            max_questions=max(1, max_q),
            max_time_minutes=max(1, max_t),
            topics=topics,
            screening_requirements=requirements,
        )

    def enabled_topics(self) -> list[ScreeningTopic]:
        return [t for t in self.topics if t.enabled]

    def configured_requirements(self) -> list[ScreeningRequirement]:
        enabled_topic_ids = {t.id for t in self.enabled_topics()}
        out = []
        for r in self.screening_requirements:
            if not r.is_configured:
                continue
            linked_topics = [
                tid for tid, req_ids in TOPIC_REQUIREMENT_HINTS.items()
                if r.id in req_ids
            ]
            if linked_topics and not any(tid in enabled_topic_ids for tid in linked_topics):
                continue
            out.append(r)
        return out

    def configured_requirements_for_topic(self, topic_id: str) -> list[ScreeningRequirement]:
        """Internal soft association — not an HR configuration step."""
        hint_ids = set(TOPIC_REQUIREMENT_HINTS.get(topic_id, []))
        if not hint_ids:
            return []
        return [r for r in self.configured_requirements() if r.id in hint_ids]


def _parse_requirements(raw: dict[str, Any]) -> list[ScreeningRequirement]:
    base = {
        r["id"]: ScreeningRequirement(
            id=r["id"],
            question=r["question"],
            expected_answer="",
            predefined=True,
        )
        for r in PREDEFINED_REQUIREMENTS
    }
    customs: list[ScreeningRequirement] = []
    items = raw.get("screeningRequirements") or raw.get("screening_requirements")
    if isinstance(items, list):
        for item in items:
            if not isinstance(item, dict):
                continue
            rid = str(item.get("id") or "")
            question = str(item.get("question") or "")
            expected = str(
                item.get("expectedAnswer")
                or item.get("expected_answer")
                or item.get("requirement")
                or ""
            )
            if not rid and not question:
                continue
            if rid in base:
                base[rid].question = question or base[rid].question
                base[rid].expected_answer = expected
            else:
                customs.append(
                    ScreeningRequirement(
                        id=rid or f"custom_{len(customs) + 1}",
                        question=question or "Custom screening question",
                        expected_answer=expected,
                        predefined=False,
                    )
                )
    else:
        # Legacy: migrate topic.requirement into predefined slots
        legacy_map = {
            "compensation": "expected_compensation",
            "education_background": "highest_education",
            "notice_period_availability": "notice_period",
            "work_location_work_mode": "work_location_mode",
        }
        for item in raw.get("topics") or []:
            if not isinstance(item, dict):
                continue
            tid = str(item.get("id") or "")
            req = str(item.get("requirement") or "").strip()
            if not req:
                continue
            mapped = legacy_map.get(tid)
            if mapped and mapped in base:
                base[mapped].expected_answer = req
            else:
                customs.append(
                    ScreeningRequirement(
                        id=f"legacy_{tid or len(customs) + 1}",
                        question=str(item.get("label") or tid),
                        expected_answer=req,
                        predefined=False,
                    )
                )
    return list(base.values()) + customs


@dataclass
class TopicState:
    status: TopicCoverageStatus = TopicCoverageStatus.NOT_STARTED
    evidence_snippets: list[str] = field(default_factory=list)
    follow_ups_asked: int = 0


@dataclass
class ScreeningConversationState:
    extracted_facts: dict[str, Any] = field(default_factory=dict)
    topics: dict[str, TopicState] = field(default_factory=dict)
    questions_asked: int = 0
    current_focus_topic_id: str | None = None
    asked_requirement_ids: list[str] = field(default_factory=list)
    satisfied_requirement_ids: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "extractedFacts": self.extracted_facts,
            "topics": {
                tid: {
                    "status": ts.status.value,
                    "evidenceSnippets": list(ts.evidence_snippets),
                    "followUpsAsked": ts.follow_ups_asked,
                }
                for tid, ts in self.topics.items()
            },
            "questionsAsked": self.questions_asked,
            "currentFocusTopicId": self.current_focus_topic_id,
            "askedRequirementIds": list(self.asked_requirement_ids),
            "satisfiedRequirementIds": list(self.satisfied_requirement_ids),
        }

    @classmethod
    def from_enabled_topics(cls, topics: list[ScreeningTopic]) -> "ScreeningConversationState":
        return cls(topics={t.id: TopicState() for t in topics})

    def apply_delta(self, delta: dict[str, Any] | None) -> None:
        """Persist LLM-proposed facts/evidence/status. Coverage gating happens in the orchestrator."""
        if not delta or not isinstance(delta, dict):
            return
        facts = delta.get("extracted_facts") or delta.get("extractedFacts")
        if isinstance(facts, dict):
            for k, v in facts.items():
                if v is not None and v != "":
                    self.extracted_facts[str(k)] = v
        topic_deltas = delta.get("topics") or {}
        if isinstance(topic_deltas, dict):
            for tid, td in topic_deltas.items():
                if tid not in self.topics:
                    self.topics[tid] = TopicState()
                if not isinstance(td, dict):
                    continue
                status = td.get("status")
                if status in {s.value for s in TopicCoverageStatus}:
                    self.topics[tid].status = TopicCoverageStatus(status)
                snippets = td.get("evidence_snippets") or td.get("evidenceSnippets") or []
                if isinstance(snippets, list):
                    for s in snippets:
                        text = str(s).strip()
                        if text and text not in self.topics[tid].evidence_snippets:
                            self.topics[tid].evidence_snippets.append(text)
                fu = td.get("follow_ups_asked") or td.get("followUpsAsked")
                if isinstance(fu, int) and fu >= 0:
                    self.topics[tid].follow_ups_asked = max(
                        self.topics[tid].follow_ups_asked, fu
                    )

    def all_enabled_covered(self, enabled_ids: list[str]) -> bool:
        if not enabled_ids:
            return True
        for tid in enabled_ids:
            ts = self.topics.get(tid)
            if not ts or ts.status != TopicCoverageStatus.COVERED:
                return False
        return True


def coerce_severity(value: Any) -> str:
    raw = str(value or "MEDIUM").upper().strip()
    if raw in {s.value for s in FlagSeverity}:
        return raw
    return FlagSeverity.MEDIUM.value


def coerce_check_status(value: Any) -> str:
    raw = str(value or "INSUFFICIENT_EVIDENCE").upper().strip()
    if raw in {s.value for s in CheckStatus}:
        return raw
    return CheckStatus.INSUFFICIENT_EVIDENCE.value
