"""Frozen defaults for candidate interview — must match pre-refactor behavior."""

from __future__ import annotations

import os
import re

from session_config.types import (
    AgentRuntimeConfig,
    LlmConfig,
    SttConfig,
    TtsConfig,
    resolve_sarvam_tts_pace,
)

_HIRING_TERMS = "CTC, ECTC, notice period, ATS, Naukri"
_MAX_STT_TERMS = 40


def build_stt_vocabulary_prompt(
    tech_stack: str | None = None,
    resume_skills: list[str] | None = None,
) -> str:
    """Hiring terms plus this candidate's stack, for the Sarvam Saaras prompt."""
    terms: list[str] = []
    seen: set[str] = set()

    def add(raw: str | None) -> None:
        if not raw:
            return
        for part in re.split(r"[,;/|]", raw):
            term = re.sub(r"\s+", " ", part).strip()
            if len(term) < 2 or len(term) > 48:
                continue
            key = term.casefold()
            if key in seen:
                continue
            seen.add(key)
            terms.append(term)

    add(_HIRING_TERMS)
    add(tech_stack)
    for skill in resume_skills or []:
        add(str(skill))
    return "Indian hiring and technical terms to recognize: " + ", ".join(terms[:_MAX_STT_TERMS]) + "."


def candidate_runtime_config(
    *,
    tech_stack: str | None = None,
    resume_skills: list[str] | None = None,
    language_preference: str | None = None,
) -> AgentRuntimeConfig:
    from prompts import normalize_interview_language

    spoken = normalize_interview_language(language_preference)
    return AgentRuntimeConfig(
        session_type="candidate_interview",
        stt=SttConfig(
            provider="sarvam",
            model="saaras:v3",
            mode="codemix",
            language="unknown",
            prompt=build_stt_vocabulary_prompt(tech_stack, resume_skills),
        ),
        tts=TtsConfig(
            provider="sarvam",
            model="bulbul:v3",
            target_language_code=spoken,
            speaker=os.getenv("SARVAM_TTS_SPEAKER", "meera"),
            pace=resolve_sarvam_tts_pace(),
        ),
        llm=LlmConfig(backend="provider_chain"),
        agent_display_name="Interview Agent",
    )
