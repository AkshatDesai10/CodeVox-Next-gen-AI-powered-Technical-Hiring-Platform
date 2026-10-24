"""Defaults for student viva sessions — Sarvam STT/TTS/LLM via LiveKit plugin."""

from __future__ import annotations

import os

from session_config.types import (
    AgentRuntimeConfig,
    LlmConfig,
    SttConfig,
    TtsConfig,
    resolve_sarvam_tts_pace,
)


def viva_runtime_config(
    *,
    language_preference: str | None = None,
    sarvam_llm_model: str | None = None,
) -> AgentRuntimeConfig:
    lang = (language_preference or os.getenv("VIVA_DEFAULT_LANGUAGE", "en-IN")).strip()
    model = (sarvam_llm_model or os.getenv("VIVA_SARVAM_LLM_MODEL", "sarvam-30b")).strip()
    return AgentRuntimeConfig(
        session_type="student_viva",
        stt=SttConfig(
            provider="sarvam",
            model="saaras:v3",
            mode="codemix",
            language=lang,
        ),
        tts=TtsConfig(
            provider="sarvam",
            model="bulbul:v3",
            target_language_code=lang,
            speaker=os.getenv("SARVAM_TTS_SPEAKER", "shubh"),
            pace=resolve_sarvam_tts_pace(os.getenv("VIVA_TTS_PACE") or os.getenv("SARVAM_TTS_PACE")),
        ),
        llm=LlmConfig(backend="sarvam_plugin", sarvam_model=model),
        agent_display_name="Viva Examiner",
    )
