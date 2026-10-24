"""Step 3.5 — session-scoped concept-area cache per rubric.

One optional LLM call per rubric per session; deterministic keyword fallback
if the call fails. Fuzzy matching marks areas as touched from concept_tested.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Literal

logger = logging.getLogger("concept-area-cache")

RubricKind = Literal["technical", "behavioral"]


def _extract_json_object(raw: str) -> str:
    text = raw or ""
    start = text.find("{")
    if start < 0:
        # Also allow a bare JSON array.
        astart = text.find("[")
        if astart < 0:
            raise ValueError("No JSON found")
        depth = 0
        in_str = False
        escape = False
        for i in range(astart, len(text)):
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
            elif ch == "[":
                depth += 1
            elif ch == "]":
                depth -= 1
                if depth == 0:
                    return text[astart : i + 1]
        raise ValueError("Unbalanced JSON array")
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
    raise ValueError("Unbalanced JSON object")


_BEHAVIORAL_KEYWORDS = (
    "communication",
    "leadership",
    "collaboration",
    "teamwork",
    "soft skill",
    "behavioral",
    "culture",
    "stakeholder",
)

_FALLBACK_CONCEPTS: dict[str, list[str]] = {
    "database": [
        "normalization",
        "indexing",
        "joins and queries",
        "transactions isolation and locks",
        "schema design",
        "query optimization",
    ],
    "sql": [
        "normalization",
        "indexing",
        "joins and queries",
        "transactions isolation and locks",
        "schema design",
        "query optimization",
    ],
    "php": [
        "request lifecycle",
        "routing and controllers",
        "authentication",
        "API design",
        "error handling",
        "performance",
    ],
    "backend": [
        "API design",
        "service boundaries",
        "data modeling",
        "caching",
        "failure handling",
        "concurrency",
    ],
    "ai": [
        "model training basics",
        "inference pipeline",
        "feature engineering",
        "evaluation metrics",
        "overfitting",
        "deployment",
    ],
    "ml": [
        "model training basics",
        "inference pipeline",
        "feature engineering",
        "evaluation metrics",
        "overfitting",
        "deployment",
    ],
    "llm": [
        "prompt design",
        "RAG retrieval",
        "tool calling",
        "hallucination handling",
        "latency cost trade-offs",
        "evaluation",
    ],
    "git": [
        "branching strategy",
        "merge vs rebase",
        "conflict resolution",
        "code review workflow",
        "commit hygiene",
        "CI integration",
    ],
    "problem": [
        "problem decomposition",
        "trade-off analysis",
        "edge cases",
        "complexity",
        "debugging approach",
        "validation",
    ],
    "communication": [
        "explaining trade-offs",
        "structuring an answer",
        "audience awareness",
        "clarifying requirements",
        "handling ambiguity",
        "written vs verbal clarity",
    ],
    "default_technical": [
        "core fundamentals",
        "practical application",
        "trade-offs",
        "failure modes",
        "performance",
        "testing and validation",
    ],
    "default_behavioral": [
        "explaining trade-offs",
        "structuring an answer",
        "audience awareness",
        "clarifying requirements",
        "handling ambiguity",
        "collaboration scenario",
    ],
}


def infer_rubric_kind(label: str | None) -> RubricKind:
    text = (label or "").casefold()
    if any(k in text for k in _BEHAVIORAL_KEYWORDS):
        return "behavioral"
    return "technical"


def _normalize_concept_key(value: str) -> str:
    text = (value or "").casefold()
    text = re.sub(r"[^a-z0-9\s/+-]+", " ", text)
    text = text.replace("-", " ").replace("/", " ").replace("+", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def concept_area_matches(concept_tested: str | None, area: str) -> bool:
    """Fuzzy match: normalized equality, containment, or shared significant tokens."""
    a = _normalize_concept_key(concept_tested or "")
    b = _normalize_concept_key(area)
    if not a or not b:
        return False
    if a == b or a in b or b in a:
        return True
    stop = {"and", "or", "the", "a", "an", "of", "in", "to", "for", "with", "vs"}
    ta = {t for t in a.replace("/", " ").split() if len(t) > 2 and t not in stop}
    tb = {t for t in b.replace("/", " ").split() if len(t) > 2 and t not in stop}
    if not ta or not tb:
        return False
    overlap = ta & tb
    # v1: any shared significant token is enough (concept labels are short).
    return bool(overlap)


def deterministic_concept_areas(label: str | None) -> list[str]:
    """Keyword fallback — never calls an LLM."""
    text = (label or "").casefold()
    kind = infer_rubric_kind(label)
    for key, areas in _FALLBACK_CONCEPTS.items():
        if key.startswith("default_"):
            continue
        if key in text:
            return list(areas)[:6]
    if kind == "behavioral":
        return list(_FALLBACK_CONCEPTS["default_behavioral"])
    return list(_FALLBACK_CONCEPTS["default_technical"])


def parse_concept_areas_payload(raw: str) -> list[str]:
    text = _extract_json_object(raw if isinstance(raw, str) else str(raw))
    parsed = json.loads(text)
    areas: list[Any]
    if isinstance(parsed, list):
        areas = parsed
    elif isinstance(parsed, dict):
        areas = parsed.get("concept_areas") or parsed.get("areas") or []
    else:
        areas = []
    cleaned: list[str] = []
    for item in areas:
        s = str(item or "").strip()
        if s and s not in cleaned:
            cleaned.append(s)
        if len(cleaned) >= 6:
            break
    if len(cleaned) < 4:
        raise ValueError("concept area list too short")
    return cleaned[:6]


async def generate_concept_areas_for_rubric(
    client: Any | None,
    *,
    rubric_label: str,
    job_title: str = "",
    job_blurb: str = "",
) -> tuple[list[str], str]:
    """Return (areas, source) where source is 'llm' or 'fallback'."""
    fallback = deterministic_concept_areas(rubric_label)
    if client is None:
        return fallback, "fallback"
    prompt = (
        f"Rubric competency: {rubric_label}\n"
        f"Job title: {job_title or '(unspecified)'}\n"
        f"Job context: {(job_blurb or '')[:500]}\n\n"
        "Return JSON only: {\"concept_areas\": [\"...\", ...]} with 4 to 6 short "
        "interviewable concept areas for this competency. No resume projects."
    )
    try:
        raw, _meta = await client.chat_completion(
            [
                {
                    "role": "system",
                    "content": (
                        "You list interview concept areas for one competency. "
                        "Respond with JSON only."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            max_tokens=220,
            purpose="score",
        )
        areas = parse_concept_areas_payload(raw if isinstance(raw, str) else str(raw))
        return areas, "llm"
    except Exception as exc:
        logger.warning(
            "Concept-area LLM failed for %r (%s) — using deterministic fallback",
            rubric_label,
            exc,
        )
        return fallback, "fallback"


class ConceptAreaCache:
    """In-memory per-session cache: rubric_key → concept area list."""

    def __init__(self) -> None:
        self._areas: dict[str, list[str]] = {}
        self._source: dict[str, str] = {}
        self._generate_calls: int = 0

    @property
    def generate_call_count(self) -> int:
        """How many times ensure_areas attempted generation (incl. cache hits? no — only misses)."""
        return self._generate_calls

    def get(self, rubric_key: str) -> list[str] | None:
        key = (rubric_key or "").strip()
        return list(self._areas[key]) if key in self._areas else None

    def seed(self, rubric_key: str, areas: list[str], *, source: str = "seed") -> None:
        key = (rubric_key or "").strip()
        if not key:
            return
        self._areas[key] = list(areas)[:6]
        self._source[key] = source

    async def ensure_areas(
        self,
        rubric_key: str,
        *,
        rubric_label: str,
        client: Any | None = None,
        job_title: str = "",
        job_blurb: str = "",
    ) -> list[str]:
        key = (rubric_key or rubric_label or "").strip()
        if not key:
            return deterministic_concept_areas(rubric_label)
        if key in self._areas:
            return list(self._areas[key])
        self._generate_calls += 1
        areas, source = await generate_concept_areas_for_rubric(
            client,
            rubric_label=rubric_label or key,
            job_title=job_title,
            job_blurb=job_blurb,
        )
        self._areas[key] = areas
        self._source[key] = source
        return list(areas)

    def touched_areas(
        self,
        rubric_key: str,
        concept_tested_values: list[str],
    ) -> list[str]:
        areas = self.get(rubric_key) or []
        touched: list[str] = []
        for area in areas:
            if any(concept_area_matches(c, area) for c in concept_tested_values):
                touched.append(area)
        return touched

    def untested_areas(
        self,
        rubric_key: str,
        concept_tested_values: list[str],
    ) -> list[str]:
        areas = self.get(rubric_key) or []
        touched = set(self.touched_areas(rubric_key, concept_tested_values))
        return [a for a in areas if a not in touched]
