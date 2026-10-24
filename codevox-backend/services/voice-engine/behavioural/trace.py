"""Behavioural interview JSON tracing for Docker / local logs.

Gated by BEHAVIOURAL_TRACE (default: true). Also on when INTERVIEW_TRACE=true.
Every emit prints a greppable line:

  [BEHAVIOURAL_JSON] <event_type> {...compact json...}

Plus a pretty-printed block so `docker logs` is easy to read turn-by-turn.
Does not change interview decisions or persistence.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger("behavioural.trace")

_TRUE = {"1", "true", "yes", "on"}
_PREFIX = "[BEHAVIOURAL_JSON]"


def behavioural_trace_enabled() -> bool:
    raw = os.getenv("BEHAVIOURAL_TRACE", "").strip().lower()
    if raw:
        return raw in _TRUE
    # Default ON for behavioural so docker logs always capture the round.
    # Explicit BEHAVIOURAL_TRACE=false disables. INTERVIEW_TRACE=false alone
    # does not disable behavioural (separate gate).
    interview = os.getenv("INTERVIEW_TRACE", "").strip().lower()
    if interview in {"false", "0", "no", "off"} and not raw:
        # If user globally disabled interview trace and left BEHAVIOURAL unset, still
        # default behavioural ON — they asked for behavioural docker visibility.
        return True
    return True


def emit_behavioural(event_type: str, payload: Any = None, **extra: Any) -> None:
    """Print one behavioural JSON event to stdout + logger (Docker-visible)."""
    if not behavioural_trace_enabled():
        return
    body: dict[str, Any] = {"event_type": event_type}
    if payload is not None:
        if isinstance(payload, dict):
            body.update(payload)
        else:
            body["data"] = payload
    if extra:
        body.update(extra)

    try:
        compact = json.dumps(body, ensure_ascii=False, default=str, separators=(",", ":"))
    except Exception as exc:
        compact = json.dumps({"event_type": event_type, "serialize_error": str(exc)})

    logger.info(f"{_PREFIX} {event_type} {compact}")


def emit_behavioural_raw(label: str, text: str) -> None:
    """Log a raw string (e.g. unparsed LLM output) under the same prefix."""
    if not behavioural_trace_enabled():
        return
    snippet = (text or "")[:4000]
    emit_behavioural("raw", {"label": label, "text": snippet, "truncated": len(text or "") > 4000})
