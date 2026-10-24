"""Build STT/TTS from session runtime config."""

from __future__ import annotations

import inspect
import os

import aiohttp
from livekit.plugins import sarvam

from sarvam_media import (
    sarvam_api_key,
    sarvam_stt_sample_rate,
    sarvam_tts_max_chunk_length,
    sarvam_tts_min_buffer_size,
    sarvam_tts_sample_rate,
)
from sarvam_stt_resilient import ResilientSarvamSTT
from session_config.types import AgentRuntimeConfig, SttConfig, TtsConfig


def build_stt_from_config(
    config: SttConfig,
    *,
    http_session: aiohttp.ClientSession | None = None,
) -> sarvam.STT:
    kwargs = dict(
        language=config.language,
        model=config.model,
        mode=config.mode,
        flush_signal=True,
        sample_rate=sarvam_stt_sample_rate(),
        api_key=sarvam_api_key(),
        http_session=http_session,
    )
    if config.prompt:
        try:
            params = inspect.signature(sarvam.STT.__init__).parameters
        except (TypeError, ValueError):
            params = {}
        if "prompt" in params:
            kwargs["prompt"] = config.prompt
    return ResilientSarvamSTT(**kwargs)


def build_tts_from_config(
    config: TtsConfig,
    *,
    http_session: aiohttp.ClientSession | None = None,
) -> sarvam.TTS:
    sample_rate = sarvam_tts_sample_rate()
    temperature = float(os.getenv("SARVAM_TTS_TEMPERATURE", "0.3"))
    return sarvam.TTS(
        model=config.model,
        target_language_code=config.target_language_code,
        speaker=config.speaker,
        speech_sample_rate=sample_rate,
        pace=config.pace,
        temperature=temperature,
        max_chunk_length=sarvam_tts_max_chunk_length(),
        min_buffer_size=sarvam_tts_min_buffer_size(),
        output_audio_codec="linear16",
        output_audio_bitrate="192k",
        api_key=sarvam_api_key(),
        http_session=None,
    )


def build_media_from_runtime(
    runtime: AgentRuntimeConfig,
    *,
    http_session: aiohttp.ClientSession | None = None,
) -> tuple[sarvam.STT, sarvam.TTS]:
    return (
        build_stt_from_config(runtime.stt, http_session=http_session),
        build_tts_from_config(runtime.tts, http_session=http_session),
    )


def groq_stt_available() -> bool:
    return bool(os.getenv("GROQ_API_KEY", "").strip())


def build_groq_whisper_stt():
    """Speech-to-text when Sarvam credits are exhausted.

    Groq exposes an OpenAI-compatible Whisper endpoint. Returns None when
    GROQ_API_KEY is not set.
    """
    key = os.getenv("GROQ_API_KEY", "").strip()
    if not key:
        return None
    from livekit.plugins import openai

    return openai.STT(
        model=os.getenv("GROQ_STT_MODEL", "whisper-large-v3-turbo"),
        base_url=os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1"),
        api_key=key,
        language="en",
    )
