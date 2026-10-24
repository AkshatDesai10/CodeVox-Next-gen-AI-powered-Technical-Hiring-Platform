"""HTTP chat turn handler — browser STT/TTS + LLM (no LiveKit)."""
from __future__ import annotations

import logging
import os
from typing import Any, Literal

from llm_engine import LlmEngine

logger = logging.getLogger("chat-turn")

INTRO_MIN_TURNS = int(os.getenv("INTRO_MIN_TURNS", "3"))
INTRO_MAX_TURNS = int(os.getenv("INTRO_MAX_TURNS", "50"))
HR_MIN_TURNS = int(os.getenv("HR_MIN_TURNS", "3"))
HR_MAX_TURNS = int(os.getenv("HR_MAX_TURNS", "8"))

Phase = Literal["intro_verbal", "hr_verbal"]


def _assistant_turns(history: list[dict[str, Any]]) -> int:
    return sum(1 for entry in history if entry.get("role") == "assistant")


def _user_turns(history: list[dict[str, Any]]) -> int:
    return sum(1 for entry in history if entry.get("role") == "user")


def _hydrate_history(llm: LlmEngine, chat_history: list[dict[str, Any]]) -> None:
    llm.chat_history = [
        {"role": str(entry["role"]), "content": str(entry["content"])}
        for entry in chat_history
        if entry.get("role") in ("user", "assistant", "developer") and entry.get("content")
    ]


async def _intro_complete(llm: LlmEngine, assistant_turns: int) -> bool:
    if assistant_turns >= INTRO_MAX_TURNS:
        return True
    if assistant_turns < INTRO_MIN_TURNS:
        return False
    return await llm.should_conclude_intro(INTRO_MIN_TURNS)


async def _hr_complete(llm: LlmEngine, assistant_turns: int) -> bool:
    if assistant_turns >= HR_MAX_TURNS:
        return True
    if assistant_turns < HR_MIN_TURNS:
        return False
    return await llm.should_conclude_hr(HR_MIN_TURNS)


async def run_chat_turn(
    *,
    tech_stack: str,
    phase: Phase,
    message: str | None,
    chat_history: list[dict[str, Any]],
) -> dict[str, Any]:
    is_hr = phase == "hr_verbal"
    min_turns = HR_MIN_TURNS if is_hr else INTRO_MIN_TURNS
    max_turns = HR_MAX_TURNS if is_hr else INTRO_MAX_TURNS

    llm = LlmEngine(tech_stack, phase)
    _hydrate_history(llm, chat_history)

    completed = _assistant_turns(llm.chat_history)
    if completed >= max_turns:
        return {
            "reply": "",
            "chat_history": llm.history_payload(),
            "agent_turns": completed,
            "user_turns": _user_turns(llm.chat_history),
            "min_turns": min_turns,
            "max_turns": max_turns,
            "complete": True,
            "depth_score": 5,
        }

    turn = completed + 1
    user_text = (message or "").strip()
    if turn > 1 and not user_text:
        raise ValueError("Candidate message is required after the opening question")

    reply = await llm.generate_response(
        user_text,
        turn=turn,
        min_turns=min_turns,
        max_turns=max_turns,
    )
    completed = _assistant_turns(llm.chat_history)
    complete = completed >= max_turns
    depth_score = 5
    if complete:
        depth_score = await llm.score_depth()

    logger.info(
        "Chat turn complete phase=%s assistant_turns=%s user_turns=%s complete=%s",
        phase,
        completed,
        _user_turns(llm.chat_history),
        complete,
    )
    return {
        "reply": reply,
        "chat_history": llm.history_payload(),
        "agent_turns": completed,
        "user_turns": _user_turns(llm.chat_history),
        "min_turns": min_turns,
        "max_turns": max_turns,
        "complete": complete,
        "depth_score": depth_score,
    }
