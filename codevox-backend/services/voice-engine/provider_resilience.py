"""Thread-safe multi-provider LLM client with mid-session failover.

Chain order (first configured wins at startup; failover walks down):

0. gemini — only when RECRUITMENT_LLM_PROVIDER=gemini, via Gemini's OpenAI-compatible
   endpoint (GEMINI_API_KEY / GOOGLE_API_KEY, else the Gemini TAKEHOME_LLM_KEY;
   model RECRUITMENT_GEMINI_MODEL); Sarvam stays next as failover
1. sarvam_api — Sarvam hosted LLM (SARVAM_API_KEY → https://api.sarvam.ai/v1)
2. provider — generic BYO OpenAI-compatible slot (PROVIDER_*; defaults to Groq URL/model)
3. groq — dedicated Groq slot (GROQ_*); skipped when fingerprint matches slot 2
4. huggingface — tier-2 fallback (HF_*)
5. openai — OPENAI_* (ghp_ tokens are ignored)

PROVIDER_* vs GROQ_*: PROVIDER is a generic override for any compatible endpoint;
GROQ is Groq-specific. When both resolve to the same key+base+model, only one rung is kept.
"""

from __future__ import annotations

import asyncio
import json
import time
import logging
import os
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal

from openai import (
    APIConnectionError,
    APITimeoutError,
    AsyncOpenAI,
    RateLimitError,
)

logger = logging.getLogger("provider-resilience")

Purpose = Literal["generate", "classify", "score"]

HF_QWEN_MODEL = "Qwen/Qwen2.5-7B-Instruct:fastest"
SARVAM_LLM_BASE_URL = "https://api.sarvam.ai/v1"
GEMINI_LLM_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai"
DEFAULT_GEMINI_MODEL = "gemini-3.6-flash"
# 401/403 included so a revoked key on one provider falls through to the next.
RETRYABLE_STATUS_CODES = {401, 403, 429, 500, 502, 503, 504}
_ALLOWED_CHAT_ROLES = frozenset({"system", "user", "assistant", "tool"})

TIER_1 = 1
TIER_2 = 2


def _clean_env(name: str) -> str:
    return os.getenv(name, "").strip()


def _normalize_base_url(url: str) -> str:
    normalized = url.rstrip("/")
    return normalized if normalized.endswith("/v1") else f"{normalized}/v1"


@dataclass(frozen=True)
class ProviderSlot:
    name: str
    api_key: str
    base_url: str
    model: str
    tier: int = TIER_1
    extra_headers: dict[str, str] | None = None

    def create_client(self) -> AsyncOpenAI:
        kwargs: dict[str, Any] = {
            "api_key": self.api_key,
            "base_url": self.base_url,
            "max_retries": 0,
            "timeout": 10.0,
        }
        if self.extra_headers:
            kwargs["default_headers"] = self.extra_headers
        return AsyncOpenAI(**kwargs)


@dataclass(frozen=True)
class ProviderTurnMeta:
    provider_name: str
    model: str
    purpose: Purpose
    tier: int = TIER_1
    slot_index: int = 0
    degraded_from_tier: int | None = None


@dataclass(frozen=True)
class LlmProviderConfig:
    """Backward-compatible single-provider view (first slot in chain)."""

    api_key: str
    base_url: str
    model: str
    provider: str


OnCallResolved = Callable[["ProviderTurnMeta"], Awaitable[None] | None]
OnTierDegraded = Callable[[int, int, "ProviderSlot"], Awaitable[None] | None]


def _slot_fingerprint(slot: ProviderSlot) -> tuple[str, str, str, str]:
    return (slot.name, slot.api_key, slot.base_url, slot.model)


def _provider_fingerprint(api_key: str, base_url: str, model: str) -> tuple[str, str, str]:
    return (api_key, base_url, model)


def _append_unique(slots: list[ProviderSlot], candidate: ProviderSlot) -> None:
    """Skip duplicate provider endpoints (same key + base + model)."""
    cand_fp = _provider_fingerprint(candidate.api_key, candidate.base_url, candidate.model)
    for existing in slots:
        if _provider_fingerprint(existing.api_key, existing.base_url, existing.model) == cand_fp:
            logger.debug(
                "Skipping duplicate provider slot %s (matches %s)",
                candidate.name,
                existing.name,
            )
            return
    slots.append(candidate)


def preferred_llm_provider() -> str:
    """RECRUITMENT_LLM_PROVIDER: 'sarvam' (default) or 'gemini' for interview questions and scoring."""
    return _clean_env("RECRUITMENT_LLM_PROVIDER").lower() or "sarvam"


def _gemini_api_key() -> str:
    key = _clean_env("GEMINI_API_KEY") or _clean_env("GOOGLE_API_KEY")
    if key:
        return key
    # Reuse the Build & Defend scoring key only when that client is configured for Gemini.
    takehome_provider = _clean_env("TAKEHOME_LLM_PROVIDER").lower()
    takehome_is_gemini = takehome_provider in ("gemini", "google") or (
        not takehome_provider
        and "claude" not in _clean_env("TAKEHOME_LLM_MODEL").lower()
        and "anthropic.com" not in _clean_env("TAKEHOME_LLM_URL").lower()
    )
    return _clean_env("TAKEHOME_LLM_KEY") if takehome_is_gemini else ""


def _gemini_slot() -> ProviderSlot | None:
    key = _gemini_api_key()
    if not key:
        return None
    return ProviderSlot(
        name="gemini",
        api_key=key,
        # Gemini's OpenAI-compatible path is /v1beta/openai, so no /v1 normalization.
        base_url=(_clean_env("GEMINI_LLM_BASE_URL") or GEMINI_LLM_BASE_URL).rstrip("/") + "/",
        model=_clean_env("RECRUITMENT_GEMINI_MODEL") or DEFAULT_GEMINI_MODEL,
        tier=TIER_1,
    )


def build_provider_chain(
    *,
    sarvam_llm_model: str | None = None,
) -> list[ProviderSlot]:
    """Build provider slots in strict cascade order."""
    slots: list[ProviderSlot] = []

    preferred = preferred_llm_provider()
    if preferred == "gemini":
        gemini = _gemini_slot()
        if gemini:
            slots.append(gemini)
        else:
            logger.warning(
                "RECRUITMENT_LLM_PROVIDER=gemini but no Gemini API key is set; using next provider",
            )
    elif preferred != "sarvam":
        logger.warning("Unknown RECRUITMENT_LLM_PROVIDER=%s; using sarvam", preferred)

    sarvam_key = _clean_env("SARVAM_API_KEY")
    if sarvam_key:
        model = (
            (sarvam_llm_model or "").strip()
            or _clean_env("VIVA_SARVAM_LLM_MODEL")
            or _clean_env("SARVAM_LLM_MODEL")
            or "sarvam-105b-conversations"
        )
        slots.append(
            ProviderSlot(
                name="sarvam_api",
                api_key=sarvam_key,
                base_url=_normalize_base_url(
                    _clean_env("SARVAM_LLM_BASE_URL") or SARVAM_LLM_BASE_URL,
                ),
                model=model,
                tier=TIER_1,
                extra_headers={"api-subscription-key": sarvam_key},
            ),
        )

    provider_key = _clean_env("PROVIDER_API_KEY")
    if provider_key:
        _append_unique(
            slots,
            ProviderSlot(
                name="provider",
                api_key=provider_key,
                base_url=_normalize_base_url(
                    _clean_env("PROVIDER_BASE_URL") or "https://api.groq.com/openai/v1",
                ),
                model=_clean_env("PROVIDER_MODEL") or "llama-3.3-70b-versatile",
                tier=TIER_1,
            ),
        )

    groq_key = _clean_env("GROQ_API_KEY")
    if groq_key:
        groq_slot = ProviderSlot(
            name="groq",
            api_key=groq_key,
            base_url=_normalize_base_url(
                _clean_env("GROQ_BASE_URL") or "https://api.groq.com/openai/v1",
            ),
            model=_clean_env("GROQ_MODEL")
            or _clean_env("PROVIDER_MODEL")
            or "llama-3.3-70b-versatile",
            tier=TIER_1,
        )
        _append_unique(slots, groq_slot)

    hf_key = _clean_env("HF_ACCESS_TOKEN") or _clean_env("HUGGINGFACE_API_KEY")
    if hf_key:
        _append_unique(
            slots,
            ProviderSlot(
                name="huggingface",
                api_key=hf_key,
                base_url=_normalize_base_url(
                    _clean_env("HF_INFERENCE_BASE_URL") or "https://router.huggingface.co/v1",
                ),
                model=_clean_env("HF_MODEL")
                or _clean_env("HF_INFERENCE_MODEL")
                or HF_QWEN_MODEL,
                tier=TIER_2,
            ),
        )

    openai_key = _clean_env("OPENAI_API_KEY")
    if openai_key.startswith("ghp_"):
        openai_key = ""
    if openai_key:
        _append_unique(
            slots,
            ProviderSlot(
                name="openai",
                api_key=openai_key,
                base_url=_normalize_base_url(
                    _clean_env("OPENAI_BASE_URL") or "https://api.openai.com/v1",
                ),
                model=_clean_env("OPENAI_MODEL") or "gpt-4o-mini",
                tier=TIER_1,
            ),
        )

    if not slots:
        raise RuntimeError(
            "Configure GEMINI_API_KEY, SARVAM_API_KEY, PROVIDER_API_KEY, GROQ_API_KEY, "
            "HF_ACCESS_TOKEN, or a valid OPENAI_API_KEY for voice interviews",
        )
    return slots


def resolve_llm_config(
    *,
    sarvam_llm_model: str | None = None,
) -> LlmProviderConfig:
    """Return the first available provider (backward compatible)."""
    slot = build_provider_chain(sarvam_llm_model=sarvam_llm_model)[0]
    return LlmProviderConfig(
        api_key=slot.api_key,
        base_url=slot.base_url,
        model=slot.model,
        provider=slot.name,
    )


def _sanitize_messages(messages: list[dict[str, str]]) -> list[dict[str, str]]:
    """Map non-OpenAI roles (e.g. developer) for Sarvam and other strict providers."""
    sanitized: list[dict[str, str]] = []
    for msg in messages:
        role = str(msg.get("role") or "user").strip()
        content = str(msg.get("content") or "").strip()
        if not content:
            continue
        if role == "developer":
            sanitized.append({"role": "system", "content": content})
        elif role in _ALLOWED_CHAT_ROLES:
            sanitized.append({"role": role, "content": content})
        else:
            sanitized.append({"role": "user", "content": content})
    return sanitized


sanitize_messages = _sanitize_messages


def _extract_completion_text(
    choice: Any,
    *,
    purpose: Purpose = "generate",
) -> tuple[str, str | None]:
    """Return spoken text and optional finish_reason from a chat completion choice.

    Score and classify calls sometimes put the JSON only in reasoning_content.
    That text is the model output, so evaluation reads it instead of dropping the turn.
    Spoken replies never use reasoning text.
    """
    finish_reason = getattr(choice, "finish_reason", None)
    message = choice.message
    text = (getattr(message, "content", None) or "").strip()
    if text:
        return text, finish_reason
    reasoning = getattr(message, "reasoning_content", None) or ""
    if (
        purpose != "generate"
        and isinstance(reasoning, str)
        and "{" in reasoning
        and "}" in reasoning
    ):
        logger.warning(
            "LLM score/classify content empty (finish_reason=%s); using JSON from reasoning_content",
            finish_reason,
        )
        return reasoning.strip(), finish_reason
    if isinstance(reasoning, str) and reasoning.strip():
        logger.warning(
            "LLM returned empty content with reasoning_content (finish_reason=%s); "
            "increase max_tokens or disable reasoning_effort for Sarvam",
            finish_reason,
        )
    return "", finish_reason


def _completion_create_kwargs(
    slot: ProviderSlot,
    *,
    messages: list[dict[str, str]],
    temperature: float,
    max_tokens: int,
    purpose: Purpose,
) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "model": slot.model,
        "messages": _sanitize_messages(messages),
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if slot.name == "sarvam_api":
        # Sarvam-30B defaults to reasoning mode; low max_tokens yields empty content.
        kwargs["extra_body"] = {"reasoning_effort": None}
        if purpose == "classify" and max_tokens < 64:
            kwargs["max_tokens"] = 64
        elif purpose == "score" and max_tokens < 1024:
            kwargs["max_tokens"] = 1024
        elif purpose == "generate" and max_tokens < 512:
            kwargs["max_tokens"] = max(512, max_tokens)
    elif slot.name == "gemini":
        # Gemini thinking spends max_tokens and adds seconds per turn; "none" keeps
        # short voice replies complete and fast.
        effort = _clean_env("RECRUITMENT_GEMINI_REASONING_EFFORT").lower() or "none"
        kwargs["reasoning_effort"] = effort
        if effort != "none" and max_tokens < 1024:
            kwargs["max_tokens"] = 1024
        # Gemini writes longer score notes; 80 tokens truncates the JSON.
        elif purpose == "score" and max_tokens < 256:
            kwargs["max_tokens"] = 256
    return kwargs


def _strip_code_fence(text: str) -> str:
    """Callers json.loads score/classify output; some models wrap it in ```json fences."""
    stripped = text.strip()
    if not stripped.startswith("```"):
        return text
    body = stripped.split("\n", 1)[1] if "\n" in stripped else ""
    return body.rsplit("```", 1)[0].strip()


class EmptyCompletionError(RuntimeError):
    """Provider returned no text. Safe to try the next provider."""


def parse_json_loose(raw: str) -> Any:
    """Parse the first JSON object, ignoring markdown fences and trailing prose."""
    text = _strip_code_fence(raw or "").strip()
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("No JSON object in model output")
    return json.loads(text[start : end + 1])


def _merge_chat_messages(messages: list[dict[str, str]]) -> list[dict[str, str]]:
    """One leading system message, and no two identical roles in a row."""
    systems: list[str] = []
    merged: list[dict[str, str]] = []
    for message in messages:
        role = str(message.get("role") or "user")
        content = str(message.get("content") or "")
        if role == "system":
            if content.strip():
                systems.append(content.strip())
            continue
        if merged and merged[-1]["role"] == role:
            merged[-1]["content"] = f"{merged[-1]['content']}\n{content}".strip()
        else:
            merged.append({"role": role, "content": content})
    if systems:
        return [{"role": "system", "content": "\n\n".join(systems)}, *merged]
    return merged


def _is_retryable(exc: Exception) -> bool:
    if isinstance(exc, (APITimeoutError, APIConnectionError, RateLimitError, EmptyCompletionError)):
        return True
    status = getattr(exc, "status_code", None)
    if status is None:
        response = getattr(exc, "response", None)
        status = getattr(response, "status_code", None) if response else None
    if status in RETRYABLE_STATUS_CODES:
        return True
    # Exhausted credits (e.g. Sarvam) arrive as 400/402 rather than 429.
    message = str(exc).lower()
    return status in (400, 402) and ("credit" in message or "quota" in message)


async def _invoke_callback(
    callback: Callable[..., Awaitable[None] | None] | None,
    *args: Any,
) -> None:
    if callback is None:
        return
    result = callback(*args)
    if asyncio.iscoroutine(result):
        await result


class ResilientLlmClient:
    """Async OpenAI-compatible client with sequential provider failover."""

    def __init__(
        self,
        slots: list[ProviderSlot] | None = None,
        *,
        sarvam_llm_model: str | None = None,
        on_call_resolved: OnCallResolved | None = None,
        on_tier_degraded: OnTierDegraded | None = None,
    ) -> None:
        self._slots = slots or build_provider_chain(sarvam_llm_model=sarvam_llm_model)
        self._clients = [slot.create_client() for slot in self._slots]
        self._active_index = 0
        self._degraded_at: float | None = None
        self._lock = asyncio.Lock()
        self._intended_tier = self._slots[0].tier if self._slots else TIER_1
        self._on_call_resolved = on_call_resolved
        self._on_tier_degraded = on_tier_degraded
        logger.info(
            "Provider chain: %s (active=%s intended_tier=%s)",
            [s.name for s in self._slots],
            self._slots[0].name,
            self._intended_tier,
        )

    @property
    def active_slot(self) -> ProviderSlot:
        return self._slots[self._active_index]

    @property
    def intended_tier(self) -> int:
        return self._intended_tier

    def model_for_purpose(self, purpose: Purpose) -> str:
        slot = self.active_slot
        if purpose == "classify" and slot.name == "huggingface":
            return _clean_env("HF_MODEL") or _clean_env("HF_INFERENCE_MODEL") or HF_QWEN_MODEL
        return slot.model

    async def _advance_slot(self) -> bool:
        async with self._lock:
            if self._active_index >= len(self._slots) - 1:
                return False
            prev_tier = self._slots[self._active_index].tier
            if self._active_index == 0:
                self._degraded_at = time.monotonic()
            self._active_index += 1
            new_slot = self._slots[self._active_index]
            logger.warning(
                "Failing over to provider=%s model=%s tier=%s",
                new_slot.name,
                new_slot.model,
                new_slot.tier,
            )
            if new_slot.tier > self._intended_tier:
                logger.warning(
                    "event=llm_degradation from_tier=%s to_tier=%s provider=%s model=%s",
                    prev_tier,
                    new_slot.tier,
                    new_slot.name,
                    new_slot.model,
                )
                await _invoke_callback(
                    self._on_tier_degraded,
                    prev_tier,
                    new_slot.tier,
                    new_slot,
                )
            return True

    async def chat_completion(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.7,
        max_tokens: int = 220,
        purpose: Purpose = "generate",
    ) -> tuple[str, ProviderTurnMeta]:
        last_exc: Exception | None = None
        if (
            self._active_index > 0
            and self._degraded_at is not None
            and time.monotonic() - self._degraded_at >= 60
        ):
            logger.info("LLM cooldown elapsed — returning to primary provider")
            self._active_index = 0
            self._degraded_at = None
        start_index = self._active_index
        degraded_from: int | None = None
        if self._active_index > 0 and self._slots[self._active_index].tier > self._intended_tier:
            degraded_from = self._intended_tier

        while True:
            slot = self._slots[self._active_index]
            client = self._clients[self._active_index]
            model = self.model_for_purpose(purpose)

            meta = ProviderTurnMeta(
                provider_name=slot.name,
                model=model,
                purpose=purpose,
                tier=slot.tier,
                slot_index=self._active_index,
                degraded_from_tier=degraded_from
                if slot.tier > self._intended_tier
                else None,
            )
            try:
                create_kwargs = _completion_create_kwargs(
                    slot,
                    messages=_merge_chat_messages(messages),
                    temperature=temperature,
                    max_tokens=max_tokens,
                    purpose=purpose,
                )
                # Score prompts are long. An 8s cap was returning empty turns and
                # leaving the evaluation unscored.
                request_timeout = 10.0 if purpose == "generate" else 20.0
                response = await client.chat.completions.create(
                    **create_kwargs,
                    timeout=request_timeout,
                )
                text, finish_reason = _extract_completion_text(
                    response.choices[0],
                    purpose=purpose,
                )
                if purpose != "generate":
                    text = _strip_code_fence(text)
                if not str(text or "").strip():
                    raise EmptyCompletionError(
                        f"empty completion provider={slot.name} purpose={purpose} "
                        f"finish_reason={finish_reason} max_tokens={create_kwargs.get('max_tokens')}"
                    )
                logger.info(
                    "LLM turn served provider=%s model=%s purpose=%s tier=%s chars=%s",
                    slot.name,
                    model,
                    purpose,
                    slot.tier,
                    len(text),
                )
                await _invoke_callback(self._on_call_resolved, meta)
                return text, meta
            except Exception as exc:
                last_exc = exc
                if not _is_retryable(exc):
                    raise
                logger.warning(
                    "Provider %s failed (%s) purpose=%s — attempting failover",
                    slot.name,
                    exc,
                    purpose,
                )
                if not await self._advance_slot():
                    break
                if self._slots[self._active_index].tier > self._intended_tier:
                    degraded_from = self._intended_tier

        self._active_index = start_index
        raise last_exc or RuntimeError("All LLM providers failed")
