"""Spoken-output helpers for academic viva turns."""

from __future__ import annotations

import re

_REPEAT_RE = re.compile(
    r"\b("
    r"repeat|say again|say that again|come again|pardon|"
    r"could you repeat|can you repeat|didn'?t catch|did not catch|"
    r"what was the question|please repeat"
    r")\b",
    re.IGNORECASE,
)


def is_repeat_request(text: str) -> bool:
    return bool(_REPEAT_RE.search(text.strip()))


def first_spoken_question(text: str) -> str:
    """Keep a single examiner utterance when the model dumps multiple questions."""
    cleaned = text.strip()
    if not cleaned:
        return cleaned

    # Drop leaked classifier / meta lines.
    lines = [
        ln.strip()
        for ln in cleaned.splitlines()
        if ln.strip()
        and not ln.strip().lower().startswith("candidate intent classified")
    ]
    if not lines:
        return cleaned
    block = lines[0]
    if len(lines) > 1 and "?" not in block:
        block = "\n".join(lines)

    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", block) if p.strip()]
    first = paragraphs[0] if paragraphs else block

    if first.count("?") > 1:
        end = first.find("?")
        return first[: end + 1].strip()

    sentences = re.split(r"(?<=[.!?])\s+", first)
    for sentence in sentences:
        if "?" in sentence:
            return sentence.strip()

    return first.strip()


def build_icebreaker(
    project_title: str | None,
    course_code: str,
    language: str | None = None,
) -> str:
    project = (project_title or "your course project").strip()
    lang = (language or "en-IN").strip().lower()
    if lang.startswith("hi"):
        proj = project if project != "your course project" else "अपने कोर्स प्रोजेक्ट"
        return (
            f"आपके {course_code} वाइवा में आपका स्वागत है। "
            f"कृपया संक्षेप में {proj} का परिचय दें और बताएं कि आपने इसमें कौन सा पाठ्यक्रम विषय लागू किया।"
        )
    return (
        f"Welcome to your {course_code} viva. "
        f"Please briefly introduce {project} and one syllabus concept you applied while building it."
    )


def build_recovery_reply(
    *,
    last_question: str,
    topic: str,
    follow_up_hint: str | None = None,
    language: str | None = None,
) -> str:
    lang = (language or "en-IN").strip().lower()
    if lang.startswith("hi"):
        if follow_up_hint:
            return (
                f"मैं इसे सरल करता हूँ। {topic} पर ध्यान दें: {follow_up_hint} "
                "आपने इसे अपने प्रोजेक्ट में कैसे लागू किया?"
            )
        if last_question:
            return f"ज़रूर। {first_spoken_question(last_question)}"
        return f"क्या आप {topic} से जुड़ा अपने प्रोजेक्ट का एक ठोस उदाहरण साझा कर सकते हैं?"
    if follow_up_hint:
        return (
            f"Let me simplify that. Focusing on {topic}: {follow_up_hint} "
            "How did you apply that in your project?"
        )
    if last_question:
        simplified = first_spoken_question(last_question)
        return f"Of course. {simplified}"
    return f"Could you share a concrete example from your project related to {topic}?"
