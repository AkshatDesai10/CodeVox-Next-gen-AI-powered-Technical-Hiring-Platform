"""Sarvam AI STT/TTS factories for LiveKit AgentSession."""

from __future__ import annotations

import os

import aiohttp
from livekit.plugins import sarvam

from sarvam_stt_resilient import ResilientSarvamSTT


def sarvam_api_key() -> str:
    key = os.getenv("SARVAM_API_KEY", "").strip()
    if not key:
        raise RuntimeError("SARVAM_API_KEY is required for voice interviews")
    return key


def sarvam_stt_sample_rate() -> int:
    return int(os.getenv("SARVAM_STT_SAMPLE_RATE", "16000"))


def sarvam_tts_sample_rate() -> int:
    return int(os.getenv("SARVAM_TTS_SAMPLE_RATE", "24000"))


def sarvam_tts_min_buffer_size() -> int:
    return int(os.getenv("SARVAM_TTS_MIN_BUFFER_SIZE", "80"))


def sarvam_tts_max_chunk_length() -> int:
    return int(os.getenv("SARVAM_TTS_MAX_CHUNK_LENGTH", "200"))


def build_sarvam_stt(
    http_session: aiohttp.ClientSession | None = None,
    *,
    prompt: str | None = None,
) -> sarvam.STT:
    import inspect

    from session_config.candidate_defaults import build_stt_vocabulary_prompt

    kwargs = dict(
        language="unknown",
        model="saaras:v3",
        mode="codemix",
        flush_signal=True,
        sample_rate=sarvam_stt_sample_rate(),
        api_key=sarvam_api_key(),
        http_session=http_session,
    )
    hint = prompt or build_stt_vocabulary_prompt()
    try:
        params = inspect.signature(sarvam.STT.__init__).parameters
    except (TypeError, ValueError):
        params = {}
    if "prompt" in params:
        kwargs["prompt"] = hint
    return ResilientSarvamSTT(**kwargs)


def build_sarvam_tts(http_session: aiohttp.ClientSession | None = None) -> sarvam.TTS:
    sample_rate = sarvam_tts_sample_rate()
    temperature = float(os.getenv("SARVAM_TTS_TEMPERATURE", "0.3"))
    return sarvam.TTS(
        model="bulbul:v3",
        target_language_code="en-IN",
        speaker=os.getenv("SARVAM_TTS_SPEAKER", "meera"),
        speech_sample_rate=sample_rate,
        pace=1.0,
        temperature=temperature,
        max_chunk_length=sarvam_tts_max_chunk_length(),
        min_buffer_size=sarvam_tts_min_buffer_size(),
        output_audio_codec="linear16",
        output_audio_bitrate="192k",
        api_key=sarvam_api_key(),
        http_session=None,
    )