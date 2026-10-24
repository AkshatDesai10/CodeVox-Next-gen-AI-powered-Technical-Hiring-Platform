"""Reconnect Sarvam STT WebSockets that drop with retryable close codes.

livekit-plugins-sarvam 1.6.3 runs a single WebSocket per SpeechStream._run() and
raises APIStatusError on unexpected close (including aiohttp 1006 keepalive ping
timeout). LiveKit AgentSession then treats the first non-recoverable STT error as
fatal — there is no session-level STT retry counter.

This wrapper:
- disables aiohttp total/heartbeat timeouts that kill long interviews
- reconnects the STT stream on transient WS drops before giving up
- converts send-path connection resets into retryable APIConnectionError
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
import time
from typing import Any

import aiohttp
from livekit.agents import APIConnectionError, APIStatusError, APITimeoutError
from livekit.agents.types import APIConnectOptions, DEFAULT_API_CONNECT_OPTIONS
from livekit.plugins import sarvam

logger = logging.getLogger("sarvam-stt-resilient")

TRANSIENT_WS_CLOSE_CODES = {1001, 1006, 1011, -1}

_TRANSIENT_TEXT = (
    "keepalive ping timeout",
    "closed unexpectedly",
    "connection reset",
    "server disconnected",
    "websocket closed",
    "transport closed",
)


def stt_max_reconnects() -> int:
    return max(1, int(os.getenv("SARVAM_STT_MAX_RECONNECTS", "8")))


def stt_reconnect_base_sec() -> float:
    return max(0.1, float(os.getenv("SARVAM_STT_RECONNECT_BASE_SEC", "0.4")))


class NoHeartbeatClientSession(aiohttp.ClientSession):
    """Long-lived session: no 5-minute total timeout, no WS protocol pings.

    Sarvam often does not answer aiohttp heartbeat pings; the default ping then
    closes the socket with 1006 'keepalive ping timeout' during TTS (we mute
    mic input, so the STT socket looks idle).
    """

    async def ws_connect(self, url, **kwargs):  # type: ignore[override]
        kwargs["heartbeat"] = None
        kwargs["autoping"] = False
        return await super().ws_connect(url, **kwargs)


def long_lived_http_session() -> aiohttp.ClientSession:
    timeout = aiohttp.ClientTimeout(total=None, connect=30, sock_connect=30, sock_read=None)
    return NoHeartbeatClientSession(timeout=timeout)


def is_quota_exhausted_stt_failure(exc: BaseException) -> bool:
    """True when Sarvam (or similar) rejected the stream for billing/credits."""
    text = str(exc).lower()
    return any(
        token in text
        for token in (
            "credits exhausted",
            "add credits",
            "insufficient credits",
            "quota exceeded",
            "payment required",
            "out of credits",
        )
    )


def is_transient_stt_failure(exc: BaseException) -> bool:
    # Billing/quota failures are permanent for this key — never burn reconnect budget.
    if is_quota_exhausted_stt_failure(exc):
        return False
    text = str(exc).lower()
    if any(token in text for token in _TRANSIENT_TEXT):
        return True
    if isinstance(exc, (ConnectionError, TimeoutError, asyncio.TimeoutError, aiohttp.ClientError)):
        return True
    if isinstance(exc, (APIConnectionError, APITimeoutError)):
        return True
    if isinstance(exc, APIStatusError):
        code = int(getattr(exc, "status_code", -1) or -1)
        # Sarvam WS close_code 1003 = unsupported/data error; often used for credits.
        if code == 1003 and is_quota_exhausted_stt_failure(exc):
            return False
        if 400 <= code < 500 and code not in (408, 429, 499):
            return False
        if code in TRANSIENT_WS_CLOSE_CODES or code < 400 or code >= 500:
            return bool(getattr(exc, "retryable", True))
        return bool(getattr(exc, "retryable", False))
    return False


def _reconnect_delay(attempt: int) -> float:
    base = stt_reconnect_base_sec()
    delay = min(base * (2 ** max(0, attempt - 1)), 4.0)
    return delay + random.uniform(0, 0.15)


def wrap_stt_stream(stream: Any, *, max_reconnects: int | None = None) -> Any:
    """Patch a LiveKit Sarvam SpeechStream so transient WS drops reconnect."""
    original_run = stream._run
    original_audio = getattr(stream, "_process_audio", None)
    limit = stt_max_reconnects() if max_reconnects is None else max_reconnects

    if original_audio is not None:

        async def _process_audio_retryable(ws: Any) -> None:
            try:
                await original_audio(ws)
            except (APIStatusError, APIConnectionError, APITimeoutError):
                raise
            except Exception as exc:
                if is_transient_stt_failure(exc):
                    raise APIConnectionError(
                        f"Sarvam STT send path dropped: {exc}",
                    ) from exc
                raise

        stream._process_audio = _process_audio_retryable

    async def _run_with_reconnect() -> None:
        attempts = 0
        while True:
            started = time.monotonic()
            try:
                await original_run()
                return
            except Exception as exc:
                elapsed = time.monotonic() - started
                if elapsed > 5.0:
                    attempts = 0
                if not is_transient_stt_failure(exc):
                    if is_quota_exhausted_stt_failure(exc):
                        logger.error(
                            "Sarvam STT credits/quota exhausted — not reconnecting: %s",
                            exc,
                        )
                    raise
                attempts += 1
                if attempts > limit:
                    logger.error(
                        "Sarvam STT reconnect budget exhausted after %s drops: %s",
                        limit,
                        exc,
                    )
                    raise
                delay = _reconnect_delay(attempts)
                logger.warning(
                    "Sarvam STT WebSocket dropped (%s); reconnecting in %.2fs (%s/%s)",
                    exc,
                    delay,
                    attempts,
                    limit,
                )
                await asyncio.sleep(delay)

    stream._run = _run_with_reconnect
    return stream


class ResilientSarvamSTT(sarvam.STT):
    def stream(self, *args: Any, **kwargs: Any):  # type: ignore[override]
        conn_options = kwargs.get("conn_options", DEFAULT_API_CONNECT_OPTIONS)
        if isinstance(conn_options, APIConnectOptions):
            kwargs["conn_options"] = APIConnectOptions(
                max_retry=max(conn_options.max_retry, stt_max_reconnects()),
                retry_interval=min(conn_options.retry_interval, 0.5),
                timeout=max(conn_options.timeout, 30.0),
            )
        stream = super().stream(*args, **kwargs)
        return wrap_stt_stream(stream)


def build_session_conn_options() -> Any | None:
    """Raise STT retry budget on AgentSession if this livekit-agents version supports it."""
    stt_opts = APIConnectOptions(
        max_retry=stt_max_reconnects(),
        retry_interval=0.5,
        timeout=30.0,
    )
    try:
        from livekit.agents.voice.agent_session import SessionConnectOptions
    except ImportError:
        return None
    try:
        return SessionConnectOptions(
            stt_conn_options=stt_opts,
            max_unrecoverable_errors=5,
        )
    except TypeError:
        return SessionConnectOptions(stt_conn_options=stt_opts)
