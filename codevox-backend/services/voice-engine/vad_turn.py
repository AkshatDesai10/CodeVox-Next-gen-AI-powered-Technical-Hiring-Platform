"""Silence and microphone rules for candidate turns. No LiveKit imports."""

from __future__ import annotations

import os


def interview_silence_timeout() -> float:
    """Seconds of genuine silence before the candidate turn may end. Default 3.0."""
    return float(os.getenv("INTERVIEW_SILENCE_TIMEOUT_SEC", "3.0"))


def interview_vad_options(silence_timeout: float | None = None) -> dict[str, float]:
    """Silero options. min_silence_duration is the 3s pause, not a 100ms breath.

    LiveKit measures endpointing from the last speech frame and subtracts the
    silence already observed, so this 3s VAD window does not add a second 3s wait.
    A lower deactivation threshold keeps soft continuous speech in the speech state.
    """
    timeout = interview_silence_timeout() if silence_timeout is None else silence_timeout
    min_speech = float(os.getenv("INTERVIEW_VAD_MIN_SPEECH_DURATION", "0.25"))
    activation = float(os.getenv("INTERVIEW_VAD_ACTIVATION_THRESHOLD", "0.30"))
    return {
        "min_speech_duration": min_speech,
        "min_silence_duration": timeout,
        "prefix_padding_duration": 0.5,
        "activation_threshold": activation,
        "deactivation_threshold": 0.15,
    }


def interview_turn_handling(*, allow_interruptions: bool = False) -> dict:
    silence_timeout = interview_silence_timeout()
    return {
        "turn_detection": "vad",
        "endpointing": {"min_delay": silence_timeout, "max_delay": silence_timeout},
        "interruption": {"enabled": allow_interruptions},
        "preemptive_generation": {"enabled": False},
    }


def candidate_audio_enabled(agent_state: str, user_state: str) -> bool | None:
    """Whether the candidate mic should be open.

    Mute only while the agent is speaking and the candidate turn has already
    ended. Muting during active speech cuts the answer and spills the rest
    onto the next question. None means leave the mic as it is.
    """
    if agent_state == "speaking":
        if user_state == "speaking":
            return None
        return False
    if agent_state == "listening":
        return True
    return None
