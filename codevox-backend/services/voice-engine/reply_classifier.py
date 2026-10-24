"""Low-temperature reply intent classification with fail-safe validation."""

from __future__ import annotations

import logging
import re

from llm_engine import DEFLECTION_RE, is_deflection, is_muffled
from provider_resilience import ResilientLlmClient
from topic_orchestrator import IntentTag

logger = logging.getLogger("reply-classifier")

VALID_INTENTS: frozenset[IntentTag] = frozenset(
    {"ANSWERED", "ANALOGOUS_REDIRECT", "SKIP", "UNKNOWN", "OFFTOPIC"},
)

CLASSIFIER_SYSTEM = """You classify candidate interview replies into exactly one tag.
Respond with ONLY the tag name on a single line (e.g. ANSWERED). No punctuation or explanation.

Tags:
- ANSWERED: Direct substantive answer to the question.
- ANALOGOUS_REDIRECT: Candidate has not used the exact tool/framework asked but describes achieving the same outcome via a parallel approach (e.g. "I haven't used Redis but I used Memcached for caching").
- SKIP: Candidate explicitly wants to skip or move on (e.g. "pass", "next question", "skip this").
- UNKNOWN: Candidate admits ignorance (e.g. "no idea", "not sure", "I don't know", "can't recall"). Honest ignorance only.
- OFFTOPIC: Rambling, unrelated, or non-contextual statement that does not address the question.

Rules:
- Treat direct ignorance as UNKNOWN, never OFFTOPIC.
- Do not penalize UNKNOWN harder than a wrong guess.
- Legitimate engineering redirections are ANALOGOUS_REDIRECT, not SKIP or OFFTOPIC."""

TAG_RE = re.compile(
    r"\b(ANSWERED|ANALOGOUS_REDIRECT|SKIP|UNKNOWN|OFFTOPIC)\b",
    re.I,
)

PASS_RE = re.compile(r"\b(pass|skip|next question|move on)\b", re.I)
LIMITED_EXPOSURE_RE = re.compile(
    r"\b(limited exposure|haven'?t used much|have not used much|barely used|"
    r"not much experience|minimal experience|only heard of)\b",
    re.I,
)


def _normalize_tag(raw: str) -> IntentTag | None:
    upper = raw.strip().upper().replace(" ", "_")
    if upper in VALID_INTENTS:
        return upper  # type: ignore[return-value]
    match = TAG_RE.search(raw)
    if match:
        tag = match.group(1).upper()
        if tag in VALID_INTENTS:
            return tag  # type: ignore[return-value]
    return None


def confidence_delta_for(intent: IntentTag, *, in_recovery: bool) -> int:
    if intent in ("ANSWERED", "ANALOGOUS_REDIRECT"):
        return 1
    if intent == "UNKNOWN":
        return 0
    if intent in ("SKIP", "OFFTOPIC"):
        return -1 if in_recovery else 0
    return 0


async def classify_reply_safe(
    client: ResilientLlmClient,
    reply_text: str,
    *,
    topic: str,
    question_asked: str,
    confidence: float = 1.0,
    in_recovery: bool = False,
) -> tuple[IntentTag, int]:
    text = reply_text.strip()

    if PASS_RE.search(text) or LIMITED_EXPOSURE_RE.search(text):
        intent = "SKIP"
        return intent, confidence_delta_for(intent, in_recovery=in_recovery)

    if is_deflection(text) or DEFLECTION_RE.search(text):
        intent = "UNKNOWN"
        return intent, confidence_delta_for(intent, in_recovery=in_recovery)

    if not text or is_muffled(text, confidence):
        intent: IntentTag = "UNKNOWN"
        return intent, confidence_delta_for(intent, in_recovery=in_recovery)

    user_prompt = (
        f"Topic: {topic}\n"
        f"Question asked: {question_asked or '(opening)'}\n"
        f"Candidate reply: {text}\n"
        "Tag:"
    )
    messages = [
        {"role": "system", "content": CLASSIFIER_SYSTEM},
        {"role": "user", "content": user_prompt},
    ]

    temperatures = (0.0, 0.1, 0.2)
    for attempt, temp in enumerate(temperatures, start=1):
        try:
            raw, meta = await client.chat_completion(
                messages,
                temperature=temp,
                max_tokens=32,
                purpose="classify",
            )
            tag = _normalize_tag(raw)
            if tag:
                logger.debug(
                    "Classified intent=%s provider=%s attempt=%s",
                    tag,
                    meta.provider_name,
                    attempt,
                )
                return tag, confidence_delta_for(tag, in_recovery=in_recovery)
            if not raw.strip():
                logger.warning("Classifier returned empty tag attempt=%s", attempt)
                break
            logger.warning("Classifier returned invalid tag %r attempt=%s", raw, attempt)
        except Exception as exc:
            logger.warning("Classifier attempt %s failed: %s", attempt, exc)

    logger.warning("Classifier exhausted retries — defaulting to UNKNOWN")
    intent = "UNKNOWN"
    return intent, confidence_delta_for(intent, in_recovery=in_recovery)
