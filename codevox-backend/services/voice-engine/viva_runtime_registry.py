"""Active viva session registry for pause/inject/resume control."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from viva_session_state import VivaSessionState

_active_states: dict[str, "VivaSessionState"] = {}


def register_viva_state(token: str, state: "VivaSessionState") -> None:
    _active_states[token] = state


def unregister_viva_state(token: str) -> None:
    _active_states.pop(token, None)


def get_viva_state(token: str) -> "VivaSessionState | None":
    return _active_states.get(token)


def is_viva_active(token: str) -> bool:
    return token in _active_states
