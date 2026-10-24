"""LLM prompt templates for AI Behavioural — generation and extraction only."""

from __future__ import annotations

from typing import Any


SYSTEM_HR = (
    "You are an expert HR interviewer. Speak naturally in 2-4 short sentences. "
    "Ask exactly ONE question. Never decide hiring outcomes or PASS/FAIL. "
    "Never ask deep technical algorithm/system-design questions."
)


def prompt_generate_question(
    *,
    track: str,
    intent: str,
    competency_name: str | None = None,
    targets: list[str] | None = None,
    resume_anchor: str | None = None,
    job_title: str | None = None,
    is_followup: bool = False,
    rejection_errors: list[str] | None = None,
    interview_language: str | None = None,
) -> list[dict[str, str]]:
    targets_list = targets or []
    extra = ""
    if rejection_errors:
        extra = (
            f"\nPrevious proposal was rejected: {', '.join(rejection_errors)}. "
            "Propose a different question that fixes those issues."
        )
    coverage_line = ""
    if targets_list and not is_followup:
        coverage_line = (
            f"\nYour question must invite the candidate to cover: {targets_list}. "
            "Do not omit any of these from the question, even implicitly "
            "(e.g. always ask for the outcome/result if 'result' is in the list)."
        )
    elif targets_list and is_followup:
        coverage_line = (
            f"\nThis is a follow-up - focus on the missing targets only: {targets_list}."
        )
    user = f"""Track: {track}
Job title: {job_title or 'N/A'}
Competency: {competency_name or 'N/A'}
Intent: {intent}
Targets evidence: {targets_list}
Resume anchor: {resume_anchor or 'none'}
Follow-up: {is_followup}
{coverage_line}
{extra}

Return JSON only:
{{"text": "spoken question", "type": "behavioral|situational|cv_probe|hr_screening|profile|followup"}}
"""
    from prompts import conduct_language_rule

    return [
        {"role": "system", "content": SYSTEM_HR + "\n" + conduct_language_rule(interview_language)},
        {"role": "user", "content": user},
    ]


def prompt_extract_star(answer: str, evidence_ids: list[str]) -> list[dict[str, str]]:
    user = f"""Extract STAR-style evidence from the candidate answer.
The answer may be Hindi, English, or a mix. Grade the meaning, not the language.
Evidence ids to consider: {evidence_ids}

Quality grading anchors (apply per evidence_id independently):
- "strong" = specific, concrete details (named techniques, tools, numbers, decisions, or steps)
  that could only come from someone who actually did the thing.
- "medium" = plausible and on-topic but stays generic/high-level; no specific technique/tool/number named.
- "weak" = vague, generic, or largely restates the question without adding new information.

Few-shot calibration (same evidence_id = action):
1) Answer: "I used a simple real-world example and visual flow to explain it."
   -> quality: "medium" (plausible but generic; no named technique/tool/number).
2) Answer: "I tested different pre-processing techniques, adjusted the decision model and thresholds, optimized the pipeline with TensorRT."
   -> quality: "strong" (named techniques, model/threshold decisions, and a specific tool).
3) Answer: "I just handled it somehow and things got better."
   -> quality: "weak" (vague; restates outcome without substance).

Answer:
\"\"\"{answer}\"\"\"

Return JSON only:
{{
  "extracted_evidence": [
    {{
      "evidence_id": "situation|responsibility|action|result|...",
      "present": true,
      "quality": "strong|medium|weak",
      "quote_original": "verbatim snippet from answer",
      "quote_normalized": "English translation of the snippet",
      "confidence": 0.0
    }}
  ]
}}
If a slot is absent, include present=false with null quotes.
quote_original must be verbatim from the answer language; quote_normalized must be English.
Do not inflate quality: prefer "medium" over "strong" when details are generic.
"""
    return [
        {"role": "system", "content": "Extract structured interview evidence. Do not score or decide outcomes."},
        {"role": "user", "content": user},
    ]


def prompt_parse_screening(answer: str, expected_type: str, field: str | None) -> list[dict[str, str]]:
    user = f"""Parse the candidate answer into structured data.
Field: {field or 'unknown'}
Expected type: {expected_type}
Answer: \"\"\"{answer}\"\"\"

Return JSON only for expected_type:
- duration_days: {{"parsed_value": {{"value": <number>, "unit": "days"}}}}
- boolean: {{"parsed_value": true|false}}
- numeric_range: {{"parsed_value": <number>}}
- free_text: {{"parsed_value": "<short string>"}}
If unclear: {{"parsed_value": null}}
Do not decide PASS/FAIL.
"""
    return [
        {"role": "system", "content": "Parse screening answers to JSON values only."},
        {"role": "user", "content": user},
    ]


def prompt_extract_profile(answer: str, requirement_ids: list[str]) -> list[dict[str, str]]:
    user = f"""Extract candidate profile attributes and map to known requirement ids.
Known requirement ids: {requirement_ids}

Answer:
\"\"\"{answer}\"\"\"

Return JSON only:
{{
  "attributes": [
    {{"attribute": "Django", "value": "Django", "confidence": 0.9}}
  ],
  "requirement_mapping": [
    {{"requirement_id": "django_experience", "status": "SUPPORTED|NOT_ESTABLISHED|CONTRADICTED", "confidence": 0.9, "evidence": "short quote"}}
  ]
}}
Only use requirement_ids from the known list. Do not invent new requirement ids.
NOT_ESTABLISHED means not mentioned — not a failure.
"""
    return [
        {"role": "system", "content": "Extract profile attributes for requirement alignment. Do not score competencies."},
        {"role": "user", "content": user},
    ]


def prompt_competency_eval(
    *,
    competency_name: str,
    objective: str,
    evidence_state: dict[str, Any],
    quotes: list[dict[str, Any]],
) -> list[dict[str, str]]:
    quotes_note = (
        "available_quotes is NON-EMPTY. You MUST select the 1-3 most relevant entries "
        "from available_quotes into supporting_quotes (copy evidence_id, turn_id, "
        "quote_original, quote_normalized). Prefer quote_normalized in reasoning and "
        "cite those quotes. NEVER write that quotes are unavailable, missing, or "
        '"not provided" when available_quotes is non-empty.'
        if quotes
        else "available_quotes is empty — supporting_quotes may be [] and you may note "
        "that no quote text was supplied."
    )
    user = f"""Score this soft competency from 1-5 based ONLY on the evidence provided.
Competency: {competency_name}
Objective: {objective}
Evidence state: {evidence_state}
available_quotes: {quotes}

Instructions for quotes:
{quotes_note}

Return JSON only:
{{
  "score": 1,
  "reasoning": "short rationale citing evidence (and available quotes when present)",
  "supporting_quotes": [
    {{
      "evidence_id": "situation|responsibility|action|result|...",
      "turn_id": "...",
      "quote_original": "...",
      "quote_normalized": "..."
    }}
  ],
  "evidence_quality": "high|medium|low"
}}
Do not invent evidence or invent quote text. Cap score if evidence is thin/weak.
Note: evidence_quality may be overwritten by the backend from evidence_state.
"""
    return [
        {"role": "system", "content": "Holistic competency evaluation from evidence only. No hiring decision."},
        {"role": "user", "content": user},
    ]
