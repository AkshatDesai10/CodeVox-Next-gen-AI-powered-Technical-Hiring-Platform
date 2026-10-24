"""Wire LLM call ledger to ResilientLlmClient and Nest sync."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from llm_call_ledger import LlmCallLedger
from provider_resilience import ProviderSlot, ProviderTurnMeta, ResilientLlmClient

if TYPE_CHECKING:
    from viva_session_state import VivaSessionState

logger = logging.getLogger("viva-llm-sync")


def build_viva_llm_client(
    ledger: LlmCallLedger,
    *,
    sarvam_llm_model: str | None = None,
) -> ResilientLlmClient:
    async def on_call_resolved(meta: ProviderTurnMeta) -> None:
        ledger.record_call(meta)

    async def on_tier_degraded(from_tier: int, to_tier: int, slot: ProviderSlot) -> None:
        ledger.record_degradation(from_tier, to_tier, slot)

    return ResilientLlmClient(
        sarvam_llm_model=sarvam_llm_model,
        on_call_resolved=on_call_resolved,
        on_tier_degraded=on_tier_degraded,
    )


async def flush_llm_audit_to_nest(state: "VivaSessionState") -> None:
    ledger = state.llm_ledger
    if ledger is None:
        return
    calls = ledger.drain_pending_calls()
    degradations = ledger.drain_pending_degradations()
    if not calls and not degradations:
        return
    from handoff_viva import post_viva_llm_audit_sync

    try:
        await post_viva_llm_audit_sync(
            state.viva_token,
            llm_calls=calls or None,
            llm_degradation_events=degradations or None,
        )
    except Exception as exc:
        logger.warning(
            "LLM audit sync failed token=%s: %s",
            state.viva_token,
            exc,
        )
        ledger._pending_sync.extend(calls)
        ledger._pending_degradations.extend(degradations)
