"""Post-session Screening Analyzer — sole owner of PASS/FLAG/INSUFFICIENT_EVIDENCE/NOT_APPLICABLE.

Live interview must NEVER call this. Validation runs only after the screening conversation ends.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from ai_screening.schemas import coerce_check_status, coerce_severity
from provider_resilience import ResilientLlmClient

logger = logging.getLogger("ai_screening.analyzer")

ANALYZER_PROMPT = """You are the AI Screening Requirement Validator for hiring.

CRITICAL TIMING: You run ONLY after the full screening interview is finished.
You are NOT the live interviewer. Do not invent live flags. Evaluate from the finished transcript + conversation state only.

You receive:
1. Full screening transcript (agent/candidate turns)
2. Structured conversation state (extracted facts + topic evidence)
3. Configured screening requirements ONLY — each has requirementId, question, and requirement (the expected answer / condition HR configured)
4. Optional job / candidate context

Your job for EACH configured requirement independently:
1. Understand the configured requirement/condition SEMANTICALLY (not keyword-only).
2. Find what the candidate actually said about that topic (transcript + conversation_state).
3. Decide whether the candidate's answer SATISFIES the configured requirement.
4. Emit exactly one check per requirementId.

Return ONLY valid JSON:
{
  "checks": [
    {
      "status": "PASS|FLAG|INSUFFICIENT_EVIDENCE|NOT_APPLICABLE",
      "category": "SHORT_CATEGORY",
      "requirementId": "requirement_id",
      "severity": "LOW|MEDIUM|HIGH",
      "requirement": "exact configured expected-answer / condition text",
      "question": "the screening question",
      "candidate_evidence": "short quote or paraphrase from the candidate, or null",
      "reason": "one or two sentences explaining satisfy vs violate vs insufficient",
      "confidence": 0.0
    }
  ]
}

STATUS RULES (mandatory — follow exactly):
- PASS → Candidate provided usable evidence AND that evidence SATISFIES the configured requirement/condition.
- FLAG → Candidate provided usable evidence AND that evidence CONTRADICTS, violates, or does NOT satisfy the configured requirement/condition.
- INSUFFICIENT_EVIDENCE → Candidate never answered this topic, answer is too vague, or you cannot determine whether the requirement is satisfied. Prefer this over guessing PASS or FLAG.
- NOT_APPLICABLE → Rare; use only when the requirement is clearly not applicable to this candidate/context.

HARD RULES:
- Merely asking the question, covering a topic, or the candidate giving ANY answer is NOT automatic PASS.
- PASS only when the answer meets the configured condition.
- FLAG when the answer fails the configured condition (even if the candidate answered clearly and politely).
- Never invent candidate evidence. Quote or paraphrase only what appears in transcript/state.
- Evaluate only the listed requirements (non-empty expected answers). One check per requirementId.
- Soft review only: never recommend auto-reject, auto-pass, Strong Hire, Hire, or No Hire.
- Do not invent overall scores or competency scores.
- severity: LOW | MEDIUM | HIGH only. Use HIGH for clear hard-condition violations (budget, join date, mandatory qualification); MEDIUM for clear soft mismatches; LOW when borderline but still a FLAG.
- Personal/family topics: be cautious; prefer INSUFFICIENT_EVIDENCE / NOT_APPLICABLE unless an explicit lawful requirement was configured.

SEMANTIC COMPARISON GUIDANCE (examples — apply the same reasoning to similar cases):

Compensation / numeric ceilings & floors:
- Requirement "less than ₹10,000" / "≤ 10000" / "under 10k" and candidate says ₹15,000 or "15–20k" → FLAG.
- Requirement "less than ₹10,000" and candidate says ₹8,000 or "around 9k" → PASS.
- Requirement "₹10–15 LPA" and candidate says "12 LPA" → PASS; says "25 LPA" → FLAG.
- If candidate gives no number and no clear band → INSUFFICIENT_EVIDENCE.

Notice / joining:
- Requirement "immediate joining" / "can join immediately" / "0 notice" and candidate says "30 days notice" / "1 month" → FLAG.
- Requirement "within 15 days" and candidate says "I can join next week" → PASS.
- Requirement "≤ 60 days notice" and candidate says "60 days" → PASS; "90 days" → FLAG.
- Vague "depends" / "not sure" with no usable timeline → INSUFFICIENT_EVIDENCE.

Education / qualification:
- Requirement "must have B.Tech" / "B.Tech required" and candidate says "I have completed B.Tech" → PASS.
- Requirement "must have B.Tech" and candidate says "I am currently pursuing B.Tech" / "final year B.Tech" → FLAG (not yet completed unless requirement allows pursuing).
- Requirement "B.Tech or equivalent" and candidate says "B.E. Computer Science" → PASS.
- Requirement "B.Tech CS" and candidate says only "I studied engineering" with no degree clarity → INSUFFICIENT_EVIDENCE.

Location / relocation / work mode:
- Requirement "Bangalore only" / "must work from Bangalore" and candidate says "I can only work from Pune" → FLAG.
- Requirement "open to relocation" = Yes and candidate says "I cannot relocate" → FLAG.
- Requirement "hybrid OK" and candidate says "hybrid is fine" → PASS.

Yes/No style conditions:
- Interpret yes/no, willing/not willing, can/cannot against the configured expectation.
- Affirmative when required → PASS; refusal when required → FLAG.

Always fill candidate_evidence when status is PASS or FLAG. Use null only for INSUFFICIENT_EVIDENCE / NOT_APPLICABLE when no usable quote exists.
"""


async def run_screening_analyzer(
    *,
    client: ResilientLlmClient,
    transcript: list[dict[str, Any]],
    conversation_state: dict[str, Any],
    requirements: list[dict[str, str]],
    job_profile_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """requirements: [{requirementId, question, requirement}] non-empty expected answers only."""
    if not requirements:
        return {"checks": []}

    messages = [
        {"role": "system", "content": ANALYZER_PROMPT},
        {
            "role": "user",
            "content": json.dumps(
                {
                    "instruction": (
                        "Evaluate each requirement: does the candidate answer SATISFY the "
                        "configured condition? PASS only if yes, FLAG if no, "
                        "INSUFFICIENT_EVIDENCE if unclear. Merely answering is not PASS."
                    ),
                    "transcript": transcript,
                    "conversation_state": conversation_state,
                    "requirements": requirements,
                    "job_profile_context": job_profile_context or {},
                },
                ensure_ascii=False,
                default=str,
            ),
        },
    ]

    raw, _meta = await client.chat_completion(
        messages,
        temperature=0.1,
        max_tokens=2000,
        purpose="generate",
    )
    data = json.loads(raw) if isinstance(raw, str) else raw
    if not isinstance(data, dict):
        raise ValueError("Analyzer returned non-object")

    checks_in = data.get("checks") if isinstance(data.get("checks"), list) else []
    allowed_ids = {
        r.get("requirementId") or r.get("topicId")
        for r in requirements
        if r.get("requirementId") or r.get("topicId")
    }
    req_by_id = {
        (r.get("requirementId") or r.get("topicId")): r
        for r in requirements
        if r.get("requirementId") or r.get("topicId")
    }

    checks: list[dict[str, Any]] = []
    for item in checks_in:
        if not isinstance(item, dict):
            continue
        requirement_id = str(
            item.get("requirementId")
            or item.get("requirement_id")
            or item.get("topicId")
            or item.get("topic_id")
            or ""
        )
        if requirement_id and requirement_id not in allowed_ids:
            continue
        meta = req_by_id.get(requirement_id) or {}
        req_text = str(item.get("requirement") or meta.get("requirement") or "").strip()
        if not req_text:
            continue
        evidence = item.get("candidate_evidence")
        if evidence is not None:
            evidence = str(evidence)
        conf = item.get("confidence")
        try:
            confidence = float(conf) if conf is not None else 0.5
        except (TypeError, ValueError):
            confidence = 0.5
        confidence = max(0.0, min(1.0, confidence))
        checks.append(
            {
                "status": coerce_check_status(item.get("status")),
                "category": str(item.get("category") or "GENERAL").upper()[:64],
                "requirementId": requirement_id,
                "topicId": requirement_id,
                "severity": coerce_severity(item.get("severity")),
                "requirement": req_text,
                "question": str(item.get("question") or meta.get("question") or ""),
                "candidate_evidence": evidence,
                "reason": str(item.get("reason") or ""),
                "confidence": confidence,
            }
        )

    seen = {c["requirementId"] for c in checks if c.get("requirementId")}
    for r in requirements:
        rid = r.get("requirementId") or r.get("topicId") or ""
        if rid and rid not in seen:
            checks.append(
                {
                    "status": "INSUFFICIENT_EVIDENCE",
                    "category": "GENERAL",
                    "requirementId": rid,
                    "topicId": rid,
                    "severity": "LOW",
                    "requirement": r.get("requirement", ""),
                    "question": r.get("question", ""),
                    "candidate_evidence": None,
                    "reason": "No analyzer row returned for this configured requirement.",
                    "confidence": 0.4,
                }
            )

    return {"checks": checks}
