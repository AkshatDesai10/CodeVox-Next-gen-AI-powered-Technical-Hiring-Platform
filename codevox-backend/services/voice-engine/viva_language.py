"""Mid-session language hot-swap for viva STT/TTS."""

from __future__ import annotations

import asyncio
import logging

import aiohttp
from session_config.types import load_runtime_config

from viva_language_util import localize_examiner_text, requires_localization
from viva_session_state import VivaSessionState

logger = logging.getLogger("viva-language")


async def apply_pending_language(
    state: VivaSessionState,
    *,
    http_session: aiohttp.ClientSession | None = None,
) -> str | None:
    lang = (state.pending_language or "").strip()
    if not lang or lang == state.active_language:
        state.pending_language = None
        return None

    state.pending_language = None
    sarvam_model = state.runtime.llm.sarvam_model if state.runtime else "sarvam-105b-conversations"
    state.runtime = load_runtime_config(
        "student_viva",
        language_preference=lang,
        sarvam_llm_model=sarvam_model,
    )
    state.active_language = lang

    source = state.question_source
    if requires_localization(lang):
        if source.last_question_asked:
            source.last_question_asked = await localize_examiner_text(
                state.engine,
                source.last_question_asked,
                lang,
            )
        if state.opening_reply:
            state.opening_reply = await localize_examiner_text(
                state.engine,
                state.opening_reply,
                lang,
            )

    session = state.session
    if session is None:
        logger.info("Language queued token=%s lang=%s (session not ready)", state.viva_token, lang)
        return lang

    try:
        await session.wait_for_idle()
    except Exception:
        pass

    try:
        from viva_agent_session import VivaInterviewAgent

        session.update_agent(
            VivaInterviewAgent(
                state,
                http_session=http_session or state.http_session,
            ),
        )
        logger.info("Viva language applied token=%s lang=%s", state.viva_token, lang)
    except Exception as exc:
        logger.warning(
            "Viva language swap failed token=%s lang=%s: %s",
            state.viva_token,
            lang,
            exc,
        )
    return lang


async def refresh_session_language(
    state: VivaSessionState,
    *,
    http_session: aiohttp.ClientSession | None = None,
) -> str | None:
    """Pull latest language preference from Nest (source of truth for UI switches)."""
    from handoff_viva import fetch_viva_session_language

    try:
        lang = await fetch_viva_session_language(state.viva_token)
    except Exception as exc:
        logger.debug(
            "Viva language refresh failed token=%s: %s",
            state.viva_token,
            exc,
        )
        return None
    if not lang or lang == state.active_language:
        return None
    state.pending_language = lang
    return await apply_pending_language(state, http_session=http_session)


async def run_viva_language_watchdog(
    state: VivaSessionState,
    *,
    http_session: aiohttp.ClientSession | None = None,
) -> None:
    while not state.completion_event.is_set():
        if state.pending_language:
            await apply_pending_language(state, http_session=http_session)
        await asyncio.sleep(0.25)
