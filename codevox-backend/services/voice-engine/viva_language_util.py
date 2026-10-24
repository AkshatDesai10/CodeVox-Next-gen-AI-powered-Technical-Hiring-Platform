"""Session language helpers for viva examiner speech."""

from __future__ import annotations

import logging
import re

logger = logging.getLogger("viva-language-util")

_LANGUAGE_LABELS: dict[str, str] = {
    "en-IN": "English (India)",
    "hi-IN": "Hindi (Devanagari script)",
}

_DEVANAGARI_RE = re.compile(r"[\u0900-\u097F]")


def normalize_language(lang: str | None) -> str:
    return (lang or "en-IN").strip() or "en-IN"


def requires_localization(lang: str | None) -> bool:
    return not normalize_language(lang).lower().startswith("en")


def language_label(lang: str | None) -> str:
    code = normalize_language(lang)
    return _LANGUAGE_LABELS.get(code, code)


def examiner_language_instruction(lang: str | None) -> str:
    code = normalize_language(lang).lower()
    if code.startswith("hi"):
        return (
            "You MUST speak entirely in Hindi using Devanagari script. "
            "Standard CS/technical terms (SQL, TCP, HTTP, ER model, etc.) may stay in English."
        )
    return "Speak in clear Indian English."


def text_looks_localized(text: str, lang: str | None) -> bool:
    code = normalize_language(lang).lower()
    if code.startswith("hi"):
        return bool(_DEVANAGARI_RE.search(text))
    return True


async def localize_examiner_text(engine, text: str, lang: str | None) -> str:
    """Translate fixed English examiner lines into the session language."""
    cleaned = text.strip()
    if not cleaned or not requires_localization(lang):
        return cleaned
    if text_looks_localized(cleaned, lang):
        return cleaned

    label = language_label(lang)
    messages = [
        {
            "role": "system",
            "content": (
                f"Translate this university viva examiner utterance into {label}. "
                "Output ONLY the translated text — no quotes, labels, or explanation. "
                "Keep exactly one question if the source has one. "
                "Preserve technical CS terms where standard in English."
            ),
        },
        {"role": "user", "content": cleaned},
    ]
    try:
        translated, _meta = await engine._complete(
            messages,
            temperature=0.2,
            max_tokens=220,
            purpose="translate",
        )
        out = (translated or "").strip()
        if out:
            return out
    except Exception as exc:
        logger.warning("Viva localize failed lang=%s: %s", lang, exc)
    return cleaned
