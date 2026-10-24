"""Unit tests for Sarvam TTS pace configuration and validation."""

import os
from unittest.mock import MagicMock, patch

import pytest

from session_config.types import (
    DEFAULT_BULBUL_PACE,
    MAX_BULBUL_PACE,
    MIN_BULBUL_PACE,
    TtsConfig,
    resolve_sarvam_tts_pace,
    validate_bulbul_pace,
)
from session_config.candidate_defaults import candidate_runtime_config
from session_config.viva_defaults import viva_runtime_config


def test_bulbul_pace_constants():
    assert MIN_BULBUL_PACE == 0.5
    assert MAX_BULBUL_PACE == 2.0
    assert DEFAULT_BULBUL_PACE == 0.90


def test_validate_bulbul_pace_valid():
    assert validate_bulbul_pace(0.5) == 0.5
    assert validate_bulbul_pace(0.9) == 0.9
    assert validate_bulbul_pace(1.0) == 1.0
    assert validate_bulbul_pace(2.0) == 2.0


def test_validate_bulbul_pace_out_of_bounds():
    with pytest.raises(ValueError, match="Bulbul v3 supports pace between 0.5 and 2.0"):
        validate_bulbul_pace(0.49)

    with pytest.raises(ValueError, match="Bulbul v3 supports pace between 0.5 and 2.0"):
        validate_bulbul_pace(2.01)

    with pytest.raises(ValueError, match="Bulbul v3 supports pace between 0.5 and 2.0"):
        validate_bulbul_pace(-1.0)


def test_tts_config_validation():
    cfg = TtsConfig(pace=0.88)
    assert cfg.pace == 0.88

    default_cfg = TtsConfig()
    assert default_cfg.pace == 0.90

    with pytest.raises(ValueError, match="Bulbul v3 supports pace"):
        TtsConfig(pace=0.2)

    with pytest.raises(ValueError, match="Bulbul v3 supports pace"):
        TtsConfig(pace=3.5)


def test_resolve_sarvam_tts_pace_env_unset():
    with patch.dict(os.environ, {}, clear=True):
        assert resolve_sarvam_tts_pace() == 0.90


def test_resolve_sarvam_tts_pace_env_set():
    with patch.dict(os.environ, {"SARVAM_TTS_PACE": "0.85"}):
        assert resolve_sarvam_tts_pace() == 0.85


def test_resolve_sarvam_tts_pace_invalid_format():
    with patch.dict(os.environ, {"SARVAM_TTS_PACE": "fast"}):
        with pytest.raises(ValueError, match="must be a float"):
            resolve_sarvam_tts_pace()


def test_candidate_runtime_config_picks_env_pace():
    with patch.dict(os.environ, {"SARVAM_TTS_PACE": "0.88"}):
        runtime = candidate_runtime_config()
        assert runtime.tts.pace == 0.88


def test_viva_runtime_config_picks_env_pace():
    with patch.dict(os.environ, {"SARVAM_TTS_PACE": "0.92"}):
        runtime = viva_runtime_config()
        assert runtime.tts.pace == 0.92


def test_viva_runtime_config_picks_viva_override():
    with patch.dict(os.environ, {"SARVAM_TTS_PACE": "0.92", "VIVA_TTS_PACE": "0.85"}):
        runtime = viva_runtime_config()
        assert runtime.tts.pace == 0.85


def test_build_tts_from_config_passes_pace():
    mock_sarvam = MagicMock()
    with patch.dict(os.environ, {"SARVAM_API_KEY": "dummy_test_key"}):
        with patch.dict("sys.modules", {"livekit.plugins": MagicMock(sarvam=mock_sarvam)}):
            from media_factory import build_tts_from_config

            cfg = TtsConfig(pace=0.88)
            build_tts_from_config(cfg)
            assert mock_sarvam.TTS.called
            call_kwargs = mock_sarvam.TTS.call_args.kwargs
            assert call_kwargs["pace"] == 0.88
