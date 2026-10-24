"""Runtime configuration types for config-driven agent factory."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Literal

SessionType = Literal["candidate_interview", "student_viva"]
LlmBackend = Literal["provider_chain", "sarvam_plugin"]

MIN_BULBUL_PACE = 0.5
MAX_BULBUL_PACE = 2.0
DEFAULT_BULBUL_PACE = 0.90


def validate_bulbul_pace(pace: float) -> float:
    """Validate that speaking pace is within the supported Sarvam Bulbul v3 range [0.5, 2.0]."""
    if not (MIN_BULBUL_PACE <= pace <= MAX_BULBUL_PACE):
        raise ValueError(
            f"Invalid Sarvam TTS pace {pace}: Bulbul v3 supports pace between {MIN_BULBUL_PACE} and {MAX_BULBUL_PACE}"
        )
    return pace


def resolve_sarvam_tts_pace(raw_val: float | str | None = None) -> float:
    """Resolve and validate Sarvam TTS pace from an explicit value or environment."""
    if raw_val is None:
        env_val = os.getenv("SARVAM_TTS_PACE")
        if env_val is None or not env_val.strip():
            return DEFAULT_BULBUL_PACE
        raw_val = env_val.strip()
    try:
        val = float(raw_val)
    except (ValueError, TypeError) as exc:
        raise ValueError(f"Invalid SARVAM_TTS_PACE value {raw_val!r}: must be a float") from exc
    return validate_bulbul_pace(val)


@dataclass(frozen=True)
class SttConfig:
    provider: Literal["sarvam"] = "sarvam"
    model: str = "saaras:v3"
    mode: str = "codemix"
    language: str = "unknown"
    # Optional Saaras hint. None leaves the provider prompt unset.
    prompt: str | None = None


@dataclass(frozen=True)
class TtsConfig:
    provider: Literal["sarvam"] = "sarvam"
    model: str = "bulbul:v3"
    target_language_code: str = "en-IN"
    speaker: str = "shubh"
    pace: float = DEFAULT_BULBUL_PACE

    def __post_init__(self) -> None:
        validate_bulbul_pace(self.pace)


@dataclass(frozen=True)
class LlmConfig:
    backend: LlmBackend = "provider_chain"
    sarvam_model: str = "sarvam-30b"


@dataclass(frozen=True)
class AgentRuntimeConfig:
    session_type: SessionType
    stt: SttConfig = field(default_factory=SttConfig)
    tts: TtsConfig = field(default_factory=TtsConfig)
    llm: LlmConfig = field(default_factory=LlmConfig)
    agent_display_name: str = "Interview Agent"


def load_runtime_config(
    session_type: SessionType,
    *,
    language_preference: str | None = None,
    sarvam_llm_model: str | None = None,
    tech_stack: str | None = None,
    resume_skills: list[str] | None = None,
) -> AgentRuntimeConfig:
    from session_config.candidate_defaults import candidate_runtime_config
    from session_config.viva_defaults import viva_runtime_config

    if session_type == "student_viva":
        return viva_runtime_config(
            language_preference=language_preference,
            sarvam_llm_model=sarvam_llm_model,
        )
    return candidate_runtime_config(
        tech_stack=tech_stack,
        resume_skills=resume_skills,
        language_preference=language_preference,
    )
