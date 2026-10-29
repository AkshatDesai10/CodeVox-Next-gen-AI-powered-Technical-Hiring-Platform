"""Defaults for viva session."""

from __future__ import annotations

from session_config.types import AgentRuntimeConfig, LlmConfig, SttConfig, TtsConfig


def viva_runtime_config(
    *,
    language_preference: str | None = None,
    sarvam_llm_model: str | None = None,
) -> AgentRuntimeConfig:
    return AgentRuntimeConfig(
        session_type="student_viva",
        stt=SttConfig(),
        tts=TtsConfig(),
        llm=LlmConfig(),
        agent_display_name="Viva Examiner",
    )
