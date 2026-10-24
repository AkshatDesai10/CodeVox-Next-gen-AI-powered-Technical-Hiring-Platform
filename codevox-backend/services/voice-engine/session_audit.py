"""Post-session audit ledger for HR review."""



from __future__ import annotations



import json

import logging

import os

from dataclasses import dataclass, field

from datetime import datetime, timezone

from pathlib import Path

from typing import Any



from provider_resilience import ProviderTurnMeta



logger = logging.getLogger("session-audit")



AUDIT_DIR = Path(__file__).resolve().parent / "audit_logs"





@dataclass

class TurnRecord:

    turn_index: int

    topic_domain: str

    level: str

    question_asked: str

    candidate_reply: str

    intent_label: str

    confidence_delta: int

    active_provider: str

    model: str

    action_mode: str = "ask"

    resume_tech: str = ""

    strike_count: int = 0

    tech_index: int = 0

    concept_tested: str = ""

    understanding_level: str = ""

    internal_score_10: int | None = None

    evidence: str = ""

    forced_override_reason: str | None = None
    
    stt_mitigation_applied: bool = False





@dataclass

class SessionAuditLedger:

    session_id: str

    tech_stack: str

    file_prefix: str = ""

    resume_skills: list[str] = field(default_factory=list)

    turns: list[TurnRecord] = field(default_factory=list)

    covered_topics: list[str] = field(default_factory=list)

    skipped_topics: list[str] = field(default_factory=list)

    _provider_counts: dict[str, int] = field(default_factory=dict)



    def record_turn(

        self,

        *,

        turn_index: int,

        topic_domain: str,

        level: str,

        question_asked: str,

        candidate_reply: str,

        intent_label: str,

        confidence_delta: int,

        provider_meta: ProviderTurnMeta | None,

        action_mode: str = "ask",

        resume_tech: str = "",

        strike_count: int = 0,

        tech_index: int = 0,

        concept_tested: str = "",

        understanding_level: str = "",

        internal_score_10: int | None = None,

        evidence: str = "",

        forced_override_reason: str | None = None,
        
        stt_mitigation_applied: bool = False,

    ) -> None:

        provider = provider_meta.provider_name if provider_meta else "unknown"

        model = provider_meta.model if provider_meta else "unknown"

        self.turns.append(

            TurnRecord(

                turn_index=turn_index,

                topic_domain=topic_domain,

                level=level,

                question_asked=question_asked,

                candidate_reply=candidate_reply,

                intent_label=intent_label,

                confidence_delta=confidence_delta,

                active_provider=provider,

                model=model,

                action_mode=action_mode,

                resume_tech=resume_tech,

                strike_count=strike_count,

                tech_index=tech_index,

                concept_tested=concept_tested,

                understanding_level=understanding_level,

                internal_score_10=internal_score_10,

                evidence=evidence,

                forced_override_reason=forced_override_reason,
                
                stt_mitigation_applied=stt_mitigation_applied,

            ),

        )

        self._provider_counts[provider] = self._provider_counts.get(provider, 0) + 1



    def sync_topics(self, covered: list[str], skipped: list[str]) -> None:

        self.covered_topics = list(covered)

        self.skipped_topics = list(skipped)



    def finalize(
        self,
        depth_score: int,
        *,
        resume_alignment: dict[str, Any] | None = None,
        llm_audit: dict[str, Any] | None = None,
        knowledge_state: dict[str, Any] | None = None,
        rubric_evaluation: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "session_id": self.session_id,
            "tech_stack": self.tech_stack,
            "resume_skills": self.resume_skills,
            "covered_topics": self.covered_topics,
            "skipped_topics": self.skipped_topics,
            "turns": [
                {
                    "turn_index": t.turn_index,
                    "topic_domain": t.topic_domain,
                    "level": t.level,
                    "question_asked": t.question_asked,
                    "candidate_reply": t.candidate_reply,
                    "intent_label": (
                        "ANSWERED"
                        if (t.intent_label == "SKIP" and t.internal_score_10 is not None)
                        else (
                            "UNKNOWN"
                            if t.intent_label == "PENDING" and not (t.candidate_reply or "").strip()
                            else ("ANSWERED" if t.intent_label == "PENDING" and (t.candidate_reply or "").strip() else t.intent_label)
                        )
                    ),
                    "confidence_delta": t.confidence_delta,
                    "active_provider": t.active_provider,
                    "model": t.model,
                    "action_mode": t.action_mode,
                    "resume_tech": t.resume_tech,
                    "strike_count": t.strike_count,
                    "tech_index": t.tech_index,
                    "concept_tested": t.concept_tested,
                    "understanding_level": t.understanding_level,
                    "internal_score_10": t.internal_score_10,
                    "evidence": t.evidence,
                }
                for t in self.turns
            ],
            "depth_score": depth_score,
            "provider_summary": dict(self._provider_counts),
            "finalized_at": datetime.now(timezone.utc).isoformat(),
        }
        if resume_alignment is not None:
            payload["resume_alignment"] = resume_alignment
        if llm_audit is not None:
            payload["intended_llm_model"] = llm_audit.get("intended_llm_model")
            payload["llm_calls"] = llm_audit.get("llm_calls", [])
            payload["llm_degradation_events"] = llm_audit.get("llm_degradation_events", [])
        if knowledge_state is not None:
            payload["candidate_knowledge_state"] = knowledge_state
        if rubric_evaluation is not None:
            payload["rubric_scorecard"] = rubric_evaluation.get("rubric_scorecard", [])
            payload["weighted_overall_10"] = rubric_evaluation.get("weighted_overall_10")
            payload["weighted_overall_rounded"] = rubric_evaluation.get("weighted_overall_rounded")
        return payload



    def write_to_disk(self, payload: dict[str, Any]) -> Path | None:
        save_disk = os.getenv("SAVE_AUDIT_LOGS_TO_DISK", "false").lower() in ("true", "1", "yes")
        if not save_disk:
            logger.info("Session audit disk saving is disabled (SAVE_AUDIT_LOGS_TO_DISK=false). Audit payload is sent directly to MySQL database.")
            return None

        AUDIT_DIR.mkdir(parents=True, exist_ok=True)

        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

        safe_token = self.session_id.replace("/", "_")[:64]

        path = AUDIT_DIR / f"{self.file_prefix}{safe_token}_{stamp}.json"

        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

        logger.info("Wrote session audit to %s", path)

        return path


