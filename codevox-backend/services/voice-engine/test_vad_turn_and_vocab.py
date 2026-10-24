"""VAD silence, turn endpointing, and STT vocabulary hints."""

import pytest

from vad_turn import (
    candidate_audio_enabled,
    interview_turn_handling,
    interview_vad_options,
)
from llm_engine import normalize_stt_text
from session_config.candidate_defaults import (
    build_stt_vocabulary_prompt,
    candidate_runtime_config,
)
from session_config.types import SttConfig


def test_stt_config_carries_tech_stack_prompt():
    runtime = candidate_runtime_config(
        tech_stack="Python, React",
        resume_skills=["Docker", "Kubernetes", "PostgreSQL", "Python"],
    )
    prompt = runtime.stt.prompt or ""
    assert isinstance(runtime.stt, SttConfig)
    assert runtime.stt.model == "saaras:v3"
    assert "CTC" in prompt
    assert "notice period" in prompt
    assert "Python" in prompt
    assert "Kubernetes" in prompt
    assert "PostgreSQL" in prompt
    assert prompt.count("Python") == 1
    bare = build_stt_vocabulary_prompt()
    assert "ATS" in bare
    assert "Kubernetes" not in bare


def test_endpointing_stays_at_three_seconds(monkeypatch):
    monkeypatch.setenv("INTERVIEW_SILENCE_TIMEOUT_SEC", "3.0")
    handling = interview_turn_handling()
    assert handling["turn_detection"] == "vad"
    assert handling["endpointing"] == {"min_delay": 3.0, "max_delay": 3.0}
    options = interview_vad_options()
    assert options["min_silence_duration"] == 3.0
    assert 0.15 <= options["min_speech_duration"] <= 0.25
    assert 0.3 <= options["prefix_padding_duration"] <= 0.5
    assert options["activation_threshold"] < 0.5
    assert options["deactivation_threshold"] < options["activation_threshold"]


def test_interview_vad_loads_without_falling_back(monkeypatch):
    pytest.importorskip("livekit.plugins.silero")
    monkeypatch.setenv("INTERVIEW_SILENCE_TIMEOUT_SEC", "3.0")
    import interview_agent_session as mod

    mod._VAD_LOAD_ATTEMPTED = False
    mod._CACHED_VAD = None
    vad = mod._interview_vad()
    assert vad is not None
    assert vad.min_silence_duration == 3.0
    assert abs(vad._opts.activation_threshold - 0.3) < 1e-6


def test_mic_stays_open_while_candidate_is_still_speaking():
    assert candidate_audio_enabled("speaking", "speaking") is None
    assert candidate_audio_enabled("speaking", "listening") is False
    assert candidate_audio_enabled("listening", "listening") is True


def test_tech_stt_normalizations():
    assert normalize_stt_text("we used post gray and pie torch") == "we used PostgreSQL and PyTorch"
    assert normalize_stt_text("cooper neatness on next js") == "Kubernetes on Next.js"
    assert normalize_stt_text("my ectc is 12") == "my ECTC is 12"
