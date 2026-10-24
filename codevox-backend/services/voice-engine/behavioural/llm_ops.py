"""LLM helpers for behavioural interview — JSON extraction only."""

from __future__ import annotations

import json
import logging
from typing import Any

from behavioural.prompts import (
    prompt_competency_eval,
    prompt_extract_profile,
    prompt_extract_star,
    prompt_generate_question,
    prompt_parse_screening,
)
from behavioural.trace import emit_behavioural, emit_behavioural_raw
from provider_resilience import ResilientLlmClient

logger = logging.getLogger("behavioural.llm")


def _extract_json_object(raw: str) -> str:
    text = raw or ""
    start = text.find("{")
    if start < 0:
        raise ValueError("No JSON object in LLM output")
    depth = 0
    in_str = False
    escape = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    raise ValueError("Unbalanced JSON in LLM output")


async def _chat_json(
    client: ResilientLlmClient,
    messages: list[dict[str, str]],
    *,
    purpose: str,
    max_tokens: int = 500,
) -> dict[str, Any]:
    emit_behavioural(
        "llm_request",
        {
            "purpose": purpose,
            "messages": messages,
            "max_tokens": max_tokens,
        },
    )
    raw, meta = await client.chat_completion(
        messages,
        temperature=0.3,
        max_tokens=max_tokens,
        purpose="generate",
    )
    raw_str = raw if isinstance(raw, str) else str(raw)
    emit_behavioural_raw(f"llm_raw_{purpose}", raw_str)
    if meta:
        emit_behavioural("llm_meta", {"purpose": purpose, "meta": meta})
    try:
        parsed = json.loads(_extract_json_object(raw_str))
        emit_behavioural("llm_parsed", {"purpose": purpose, "parsed": parsed})
        return parsed
    except Exception as exc:
        logger.warning("behavioural LLM JSON parse failed: %s raw=%s", exc, (raw_str or "")[:300])
        emit_behavioural(
            "llm_parse_failed",
            {"purpose": purpose, "error": str(exc), "raw_preview": (raw_str or "")[:500]},
        )
        return {}


async def generate_question_text(
    client: ResilientLlmClient,
    **kwargs: Any,
) -> dict[str, Any]:
    return await _chat_json(
        client,
        prompt_generate_question(**kwargs),
        purpose="generate_question",
    )


async def extract_star(
    client: ResilientLlmClient,
    answer: str,
    evidence_ids: list[str],
) -> list[dict[str, Any]]:
    data = await _chat_json(
        client,
        prompt_extract_star(answer, evidence_ids),
        purpose="extract_star",
    )
    items = data.get("extracted_evidence")
    return items if isinstance(items, list) else []


async def parse_screening_value(
    client: ResilientLlmClient,
    answer: str,
    expected_type: str,
    field: str | None,
) -> Any:
    data = await _chat_json(
        client,
        prompt_parse_screening(answer, expected_type, field),
        purpose="parse_screening",
        max_tokens=200,
    )
    return data.get("parsed_value")


async def extract_profile(
    client: ResilientLlmClient,
    answer: str,
    requirement_ids: list[str],
) -> dict[str, Any]:
    return await _chat_json(
        client,
        prompt_extract_profile(answer, requirement_ids),
        purpose="extract_profile",
    )


async def evaluate_competency(
    client: ResilientLlmClient,
    *,
    competency_name: str,
    objective: str,
    evidence_state: dict[str, Any],
    quotes: list[dict[str, Any]],
) -> dict[str, Any]:
    return await _chat_json(
        client,
        prompt_competency_eval(
            competency_name=competency_name,
            objective=objective,
            evidence_state=evidence_state,
            quotes=quotes,
        ),
        purpose="evaluate_competency",
    )
