"""AI Screening voice-engine package."""

__all__ = ["run_ai_screening_interview"]


def run_ai_screening_interview(*args, **kwargs):
    from ai_screening.livekit_adapter import run_ai_screening_interview as _run

    return _run(*args, **kwargs)
