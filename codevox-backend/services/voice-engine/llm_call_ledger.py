"""Append-only per-session LLM resolution audit trail."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from provider_resilience import ProviderSlot, ProviderTurnMeta


@dataclass
class LlmDegradationEvent:
    from_tier: int
    to_tier: int
    provider_name: str
    model: str
    ts: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> dict[str, Any]:
        return {
            "from_tier": self.from_tier,
            "to_tier": self.to_tier,
            "provider_name": self.provider_name,
            "model": self.model,
            "ts": self.ts,
        }


@dataclass
class LlmCallLedger:
    intended_llm_model: str | None = None
    calls: list[dict[str, Any]] = field(default_factory=list)
    degradations: list[LlmDegradationEvent] = field(default_factory=list)
    _pending_sync: list[dict[str, Any]] = field(default_factory=list)
    _pending_degradations: list[dict[str, Any]] = field(default_factory=list)

    def record_call(self, meta: ProviderTurnMeta) -> None:
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "purpose": meta.purpose,
            "provider_name": meta.provider_name,
            "model": meta.model,
            "tier": meta.tier,
            "slot_index": meta.slot_index,
            "degraded": meta.degraded_from_tier is not None,
            "degraded_from_tier": meta.degraded_from_tier,
        }
        self.calls.append(entry)
        self._pending_sync.append(entry)

    def record_degradation(self, from_tier: int, to_tier: int, slot: ProviderSlot) -> None:
        event = LlmDegradationEvent(
            from_tier=from_tier,
            to_tier=to_tier,
            provider_name=slot.name,
            model=slot.model,
        )
        self.degradations.append(event)
        payload = event.to_dict()
        self._pending_degradations.append(payload)

    def drain_pending_calls(self) -> list[dict[str, Any]]:
        pending = list(self._pending_sync)
        self._pending_sync.clear()
        return pending

    def drain_pending_degradations(self) -> list[dict[str, Any]]:
        pending = list(self._pending_degradations)
        self._pending_degradations.clear()
        return pending

    def to_audit_payload(self) -> dict[str, Any]:
        return {
            "intended_llm_model": self.intended_llm_model,
            "llm_calls": list(self.calls),
            "llm_degradation_events": [e.to_dict() for e in self.degradations],
        }
