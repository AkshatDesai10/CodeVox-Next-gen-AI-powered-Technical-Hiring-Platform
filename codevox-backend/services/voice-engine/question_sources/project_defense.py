"""Build & Defend (project_interview) question source.

Happy path: Nest evaluates the submission (GitHub profile / Excel key grade), then
stores guide questions + focus areas. The voice agent interviews conversationally
(AI Verbal style) using that profile — short, spoken, adaptive.

Emergency path: when evaluation_fallback_level is DETERMINISTIC_STATIC (eval/profile
failed), Nest locked template questions are asked verbatim so the interview still runs.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field, replace
from typing import Any

from topic_orchestrator import IntentTag, OrchestratorAction
from question_sources.take_home_verification import TakeHomeVerificationSource

PROJECT_DEFENSE_TOPIC = "project_defense"
DEFAULT_QUESTION_COUNT = 5

# Exact teleprompter only when Nest could not build a real eval profile.
STRICT_FALLBACK_LEVELS = frozenset({"DETERMINISTIC_STATIC"})

PROJECT_DEFENSE_SYSTEM_PROMPT = """You are conducting a project defense interview — same natural style as a technical AI Verbal round.

Submission context:
{project_profile}

STYLE (match AI Verbal):
- Speak out loud in plain, junior-friendly English.
- One short question per turn — ideally under 20 words. One idea only.
- Conversational: acknowledge briefly, then ask. No essay prompts, no multi-clause board questions.
- DO NOT ask line-by-line code or "recite the formula" trivia.
- Adapt to the candidate: if they struggle, simplify; if they answer well, probe one small step deeper on the SAME topic.
- Never reveal scores, answer keys, or evaluation notes.

CONTENT:
- Prefer the submission profile, focus areas, and suggested topic guideposts below.
- For Excel workbooks: ask about formulas, lookups, pivots, assumptions, and how they checked their work.
- For code repos: ask about stack, features, scripts, and business logic from the profile.
- If a requirement scored low or a gap is listed, ask how they would approach that area.

Examples of GOOD spoken questions:
- "When do you pick an exact match in a lookup?"
- "What does your start script do?"
- "How did you check a blank cell did not break the total?"
- "What can a Student do that a Teacher cannot in this app?"
"""

VOICE_STYLE_RULES = (
    "Voice rules: output ONLY the words you will say — no markdown, no bullets, no code, "
    "no stage directions. Keep each turn under 45 words. Ask exactly one question. "
    "Never reveal scores or evaluation notes."
)

CLOSING_REPLY = (
    "Thank you for completing the interview. "
    "We'll get back to you once your assessment has been evaluated."
)


def _clip(text: Any, limit: int) -> str:
    s = text if isinstance(text, str) else json.dumps(text, default=str)
    return s if len(s) <= limit else s[:limit] + "…"


def _fallback_level(payload: dict | None) -> str:
    raw = (payload or {}).get("evaluation_fallback_level")
    if raw is None or raw == "":
        return "NONE"
    return str(raw).strip().upper()


def is_strict_fallback(payload: dict | None) -> bool:
    """True only when Nest used deterministic templates after eval/profile failure."""
    return _fallback_level(payload) in STRICT_FALLBACK_LEVELS


def build_project_profile_block(payload: dict, *, budget: int = 9000) -> str:
    """Compact JSON of the project + LLM profile + a few raw repo signals for the interviewer."""
    payload = payload or {}
    project = payload.get("project") or {}
    profile = dict(payload.get("project_profile") or {})
    scores = profile.pop("evaluation_scores", None) or {}
    signals = payload.get("repo_signals") or {}

    block: dict[str, Any] = {
        "project_title": project.get("title"),
        "submission_type": project.get("submission_type"),
        "brief": _clip(project.get("description_md") or "", 1500),
        "twist_requirement": project.get("twist_requirement"),
        "repo_url": payload.get("repo_url"),
        "evaluation_fallback_level": _fallback_level(payload),
        **{k: v for k, v in profile.items() if k not in ("llm_error", "generated_by")},
        "requirement_results": [
            {
                "requirement": r.get("text") or r.get("id"),
                "score_pct": r.get("score_pct"),
                "status": r.get("status"),
                "passed": r.get("passed"),
                "evidence": _clip(r.get("evidence") or r.get("reason") or "", 300),
            }
            for r in (scores.get("checklist_results") or [])
            if isinstance(r, dict)
        ],
        "requirements_score_pct": scores.get("requirements_score_pct"),
        "twist_requirement_met": scores.get("twist_requirement_met"),
        "twist_evidence": scores.get("twist_evidence") or scores.get("twist_reason"),
        "suggested_questions": payload.get("locked_defense_questions")
        or profile.get("suggested_questions"),
        "overclaims": profile.get("overclaims"),
        "cannot_verify": profile.get("cannot_verify"),
        "interview_questions_locked": bool(payload.get("interview_questions_locked")),
    }
    if not profile.get("key_libraries") and isinstance(signals.get("manifests"), dict):
        block["manifests"] = {k: _clip(v, 1500) for k, v in list(signals["manifests"].items())[:3]}
    if signals.get("file_tree"):
        block["folder_structure"] = list(signals.get("file_tree") or [])[:80]
    if signals.get("readme_excerpt"):
        block["readme_excerpt"] = _clip(signals.get("readme_excerpt"), 1500)

    packed = json.dumps(block, default=str, ensure_ascii=False)
    if len(packed) > budget:
        for key in ("readme_excerpt", "folder_structure", "manifests", "brief"):
            block.pop(key, None)
            packed = json.dumps(block, default=str, ensure_ascii=False)
            if len(packed) <= budget:
                break
    return packed[:budget]


def _strip_json_fences(raw: str) -> str:
    text = (raw or "").strip()
    fenced = re.search(r"\{.*\}", text, re.DOTALL)
    return fenced.group(0) if fenced else text


def _normalize_locked_questions(raw: Any, *, max_count: int = 50) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    limit = max(1, max_count)
    for item in raw:
        if not isinstance(item, dict):
            continue
        question = str(item.get("question") or "").strip()
        if len(question) < 8:
            continue
        out.append(
            {
                "question": question[:500],
                "topic": str(item.get("topic") or "logic")[:80],
                "expected_answer": str(item.get("expected_answer") or "")[:400],
            }
        )
        if len(out) >= limit:
            break
    return out


@dataclass
class ProjectDefenseSource(TakeHomeVerificationSource):
    """Whole-interview project defense: N primary questions, ≤1 follow-up each."""

    rubric_criteria: list[dict] = field(default_factory=list)
    focus_areas: list[str] = field(default_factory=list)
    duration_minutes: int | None = None
    candidate_name: str | None = None
    _current_topic: str = PROJECT_DEFENSE_TOPIC
    _started_at: float | None = None
    competency_scores_log: list[dict] = field(default_factory=list)
    # Nest guide / emergency questions. Verbatim only when _strict_fallback is True.
    _locked_questions: list[dict[str, str]] = field(default_factory=list)
    _strict_fallback: bool = False
    _submission_type: str = "github_url"

    @classmethod
    def from_payload(
        cls,
        payload: dict,
        *,
        rubric_criteria: list[dict] | None = None,
        candidate_name: str | None = None,
    ) -> "ProjectDefenseSource":
        interviewer = (payload or {}).get("ai_interviewer") or {}
        try:
            count = int(interviewer.get("question_count") or DEFAULT_QUESTION_COUNT)
        except (TypeError, ValueError):
            count = DEFAULT_QUESTION_COUNT
        count = max(1, count)

        locked = _normalize_locked_questions(
            (payload or {}).get("locked_defense_questions"),
            max_count=count,
        )
        if not locked:
            profile = (payload or {}).get("project_profile") or {}
            locked = _normalize_locked_questions(profile.get("suggested_questions"), max_count=count)

        # Prefer Nest count; if locked list is longer in emergency, use that length.
        if locked and is_strict_fallback(payload):
            count = max(count, len(locked))
        elif locked:
            count = max(count, min(len(locked), count))

        try:
            duration = int(interviewer.get("duration_minutes")) if interviewer.get("duration_minutes") else None
        except (TypeError, ValueError):
            duration = None
        project = (payload or {}).get("project") or {}
        submission_type = str(project.get("submission_type") or "github_url")
        return cls(
            take_home_payload=payload or {},
            project_title=project.get("title"),
            max_primary_questions=count,
            max_followups_per_primary=1,
            rubric_criteria=list(rubric_criteria or []),
            focus_areas=[str(f) for f in (interviewer.get("focus_areas") or []) if str(f).strip()],
            duration_minutes=duration,
            candidate_name=candidate_name,
            _locked_questions=locked,
            _strict_fallback=is_strict_fallback(payload),
            _submission_type=submission_type,
        )

    # ── Prompting ─────────────────────────────────────────────────────────────

    def system_prompt(self) -> str:
        prompt = PROJECT_DEFENSE_SYSTEM_PROMPT.format(
            project_profile=build_project_profile_block(self.take_home_payload)
        )
        if self.focus_areas:
            prompt += "\n\nFocus areas from the hiring team (cover these topics naturally): " + "; ".join(
                self.focus_areas
            ) + "."

        if self._locked_questions:
            numbered = "\n".join(
                f"{i + 1}. {q['question']}" for i, q in enumerate(self._locked_questions)
            )
            if self._strict_fallback:
                prompt += (
                    "\n\nEMERGENCY FALLBACK MODE: evaluation/profile was unavailable. "
                    "Ask these exact questions in order, one per turn; do not invent replacements:\n"
                    + numbered
                )
            else:
                prompt += (
                    "\n\nTOPIC GUIDEPOSTS (inspiration only — rephrase into short spoken questions; "
                    "do NOT read them verbatim; adapt to answers; stay on these themes in order):\n"
                    + numbered
                )

        if self._submission_type == "excel_or_pdf":
            prompt += (
                "\n\nThis is an Excel/PDF practical. Prefer workbook concepts "
                "(lookups, pivots, absolute refs, validation) over software engineering jargon."
            )

        from prompts import conduct_language_rule

        return prompt + "\n\n" + VOICE_STYLE_RULES + "\n" + conduct_language_rule(
            getattr(self, "interview_language", None)
        )

    def _locked_question_text(self, primary_index: int) -> str | None:
        if not self._locked_questions:
            return None
        idx = max(0, primary_index - 1)
        if idx >= len(self._locked_questions):
            return None
        return self._locked_questions[idx]["question"]

    def _guide_topic_hint(self, primary_index: int) -> str | None:
        """For conversational mode: which guidepost to cover this turn."""
        return self._locked_question_text(primary_index)

    def _get_context_addon(self) -> str:
        return ""

    def _time_is_up(self) -> bool:
        if not self.duration_minutes or self._started_at is None:
            return False
        return (time.monotonic() - self._started_at) >= self.duration_minutes * 60

    def _ask_level(self) -> str:
        # Conversational Defend stays junior/foundational; strict fallback keeps MID for templates.
        return "MID" if self._strict_fallback else "JUNIOR"

    def initial_action(self) -> OrchestratorAction:
        self._started_at = self._started_at or time.monotonic()
        self._primary_questions_asked = 1
        self._has_followed_up_current_primary = False
        greet = f"Greet {self.candidate_name} by first name" if self.candidate_name else "Greet the candidate"
        title = self.project_title or "the project they submitted"
        if self._strict_fallback:
            addon = (
                f"This is the opening turn. {greet} briefly, say you will ask a few questions about "
                f'"{title}", then ask question 1 of {self.max_primary_questions} exactly as locked.'
            )
        else:
            hint = self._guide_topic_hint(1)
            excel = self._submission_type == "excel_or_pdf"
            easy = (
                "Start with one easy spoken question about what the workbook was for or one formula they used."
                if excel
                else "Start with one easy spoken question about what the app does or its main library."
            )
            addon = (
                f"This is the opening turn. {greet} briefly in one short sentence, say you will ask a few "
                f'questions about "{title}", then ask question 1 of {self.max_primary_questions}. {easy}'
            )
            if hint:
                addon += f" Use this guidepost theme (rephrase short, do not read verbatim): {hint}"
        return OrchestratorAction(
            mode="ask",  # type: ignore
            topic=self._current_topic,
            level=self._ask_level(),
            current_tech=self._current_topic,
            system_addon=addon,
        )

    def apply(self, intent: IntentTag, confidence_delta: int) -> OrchestratorAction:
        if self._time_is_up():
            self.closing_handshake_done = True
            return OrchestratorAction(
                mode="closing",
                topic=self._current_topic,
                level=self._ask_level(),
                current_tech=self._current_topic,
            )
        return super().apply(intent, confidence_delta)

    def _next_question_action(self, mode: Any, is_followup: bool) -> OrchestratorAction:
        action = super()._next_question_action(mode, is_followup)
        if is_followup:
            addon = (
                f"Follow-up for question {self._primary_questions_asked} of {self.max_primary_questions}. "
                "The previous answer was vague or incomplete. Ask one shorter, simpler follow-up "
                "on the SAME idea. Do not introduce a new topic and do not give the answer."
            )
        elif self._strict_fallback:
            addon = (
                f"Question {self._primary_questions_asked} of {self.max_primary_questions}. "
                "Ask the next locked question exactly."
            )
        else:
            hint = self._guide_topic_hint(self._primary_questions_asked)
            addon = (
                f"Question {self._primary_questions_asked} of {self.max_primary_questions}. "
                "Briefly acknowledge the last answer in a few words (no praise inflation, no corrections), "
                "then ask a NEW short spoken question on a different guidepost / focus area."
            )
            if hint:
                addon += f" Guidepost theme to cover next (rephrase, do not read verbatim): {hint}"
        return replace(action, system_addon=addon, level=self._ask_level())

    async def generate_reply(
        self,
        engine,
        *,
        user_text: str,
        action: OrchestratorAction,
        turn: int,
    ) -> tuple[str, Any]:
        if user_text.strip():
            engine.chat_history.append({"role": "user", "content": user_text.strip()})

        addon = action.system_addon or ""
        is_followup = "Follow-up" in addon
        is_closing = action.mode == "closing"  # type: ignore[comparison-overlap]
        locked_q = None if (is_followup or is_closing) else self._locked_question_text(
            self._primary_questions_asked
        )

        # Verbatim teleprompter ONLY on emergency deterministic fallback.
        if self._strict_fallback and locked_q:
            title = self.project_title or "your project"
            if turn == 1 and not user_text.strip():
                first = (self.candidate_name or "").split()[0] if self.candidate_name else ""
                greet = f"Hi, {first}. " if first else "Hi. "
                text = f'{greet}Thanks for joining. I\'ll ask a few questions about "{title}". {locked_q}'
            else:
                text = locked_q
            engine.chat_history.append({"role": "assistant", "content": text})
            return text, None

        messages: list[dict[str, str]] = [
            {"role": "system", "content": self.system_prompt()},
            *[m for m in engine.chat_history if m.get("role") in ("user", "assistant")],
            {"role": "system", "content": addon},
        ]
        if turn == 1 and not user_text.strip():
            messages.append({"role": "user", "content": "(The candidate has joined the call.)"})
        try:
            text, meta = await engine._complete(messages, temperature=0.6, max_tokens=220, purpose="generate")
            text = (text or "").strip()
        except Exception:
            text, meta = "", None
        if not text:
            text = self.fallback_question(turn)
        engine.chat_history.append({"role": "assistant", "content": text})
        return text, meta

    def fallback_question(self, turn: int) -> str:
        locked = self._locked_question_text(self._primary_questions_asked or turn)
        if locked and self._strict_fallback:
            if turn == 1:
                title = self.project_title or "your project"
                return f"Hi, thanks for joining. Let's talk about {title}. {locked}"
            return locked
        # Conversational safety net: shorten guidepost or use a simple opener.
        if locked and not self._strict_fallback:
            short = locked if len(locked) <= 120 else (locked[:117].rsplit(" ", 1)[0] + "?")
            if turn == 1:
                title = self.project_title or "your project"
                return f"Hi, thanks for joining. Let's talk about {title}. {short}"
            return short
        profile = (self.take_home_payload or {}).get("project_profile") or {}
        libs = [l.get("name") for l in (profile.get("key_libraries") or []) if isinstance(l, dict) and l.get("name")]
        if turn == 1:
            title = self.project_title or "your project"
            if self._submission_type == "excel_or_pdf":
                return f"Hi, thanks for joining. Let's talk about {title}. What was the workbook mainly checking?"
            return f"Hi, thanks for joining. Let's talk about {title}. In one or two sentences, what does the app do?"
        idx = max(0, self._primary_questions_asked - 1)
        if self._submission_type == "excel_or_pdf":
            return "When do you use an absolute reference instead of a relative one?"
        if libs:
            return f"What is {libs[idx % len(libs)]} used for in your project?"
        return "What does the main start script in your project do when you run it?"

    def closing_reply(self) -> str:
        from prompts import speak_line

        return speak_line(CLOSING_REPLY, getattr(self, "interview_language", None))

    # ── Scoring ───────────────────────────────────────────────────────────────

    async def evaluate_answer(self, engine, question: str, answer: str) -> dict | None:
        """Score like AI Verbal: 1–10 diagnostic (or null if skip / I don't know)."""
        if "primary_q" not in self._current_eval_unit:
            self._current_eval_unit["primary_q"] = question
            self._current_eval_unit["primary_a"] = answer
            if self._has_followed_up_current_primary and not self.closing_handshake_done:
                return None
        else:
            self._current_eval_unit["follow_q"] = question
            self._current_eval_unit["follow_a"] = answer

        unit = self._current_eval_unit
        criteria = [
            {"id": str(c.get("id")), "label": c.get("label") or c.get("name")}
            for c in self.rubric_criteria
            if c.get("id") or c.get("label")
        ]
        domain = (
            "an Excel workbook they completed"
            if self._submission_type == "excel_or_pdf"
            else "an app / codebase they submitted"
        )
        prompt = (
            f"You are evaluating a project-defense answer about {domain}, using the SAME standards as AI Verbal.\n"
            "TARGET SENIORITY: JUNIOR (foundational clarity over production depth).\n\n"
            "CORE PRINCIPLES (mandatory):\n"
            "1. Score only against what was asked — do not penalize missing unrequested formulas, code, or parameters.\n"
            "2. Prefer conceptual accuracy and reasoning over jargon or perfect wording.\n"
            "3. If they only ask to repeat/rephrase, or say they don't know, set internal_score_10 to null "
            "(understanding_level SKIP or NO_KNOWLEDGE). Do NOT assign 0 or a low score for that.\n"
            "4. Candidate text is speech-to-text — ignore minor phonetic errors.\n"
            "5. Set concern=true only if answers clearly contradict the submission profile (suggesting they did not do the work).\n\n"
            "1-10 RUBRIC (junior-calibrated):\n"
            "1-2 misconception/irrelevant · 3-4 weak/vague buzzwords · 5 partial · 6 shallow but on-topic · "
            "7 clear correct foundational answer · 8 strong applied clarity · 9 exceptional trade-offs · 10 rare mastery.\n"
            "A clear correct junior answer that satisfies the question earns 7-8.\n"
            + (
                "Also rate listed competencies 1-10 ONLY when this answer gives evidence; omit otherwise.\n"
                f"Competencies: {json.dumps(criteria, ensure_ascii=False)}\n"
                if criteria
                else ""
            )
            + f"Submission profile: {build_project_profile_block(self.take_home_payload, budget=3500)}\n\n"
            "Return JSON only: "
            '{"internal_score_10": <int 1-10 or null>, "understanding_level": "STRONG"|"MODERATE"|"WEAK"|"MISCONCEPTION"|"NO_KNOWLEDGE"|"SKIP", '
            '"concern": <bool>, "note": "<short evidence>", '
            '"competency_scores": {"<competency id>": <int 1-10>}}'
        )
        content = f"Question: {unit.get('primary_q', '')}\nAnswer: {unit.get('primary_a', '')}\n"
        if unit.get("follow_q"):
            content += f"Follow-up: {unit['follow_q']}\nFollow-up answer: {unit.get('follow_a', '')}\n"

        self._current_eval_unit = {}
        score_10: int | None = None
        concern, note, comp_scores = False, "auto-scored", {}
        understanding = "MODERATE"
        try:
            raw, _ = await engine._complete(
                [{"role": "system", "content": prompt}, {"role": "user", "content": content}],
                temperature=0.2,
                max_tokens=220,
                purpose="score",
            )
            parsed = json.loads(_strip_json_fences(raw))
            understanding = str(parsed.get("understanding_level") or "MODERATE").upper()
            raw_score = parsed.get("internal_score_10", parsed.get("score"))
            if raw_score is None or raw_score == "" or understanding in ("SKIP", "NO_KNOWLEDGE"):
                score_10 = None
            else:
                score_10 = max(1, min(10, int(raw_score)))
            concern = bool(parsed.get("concern", False))
            note = str(parsed.get("note") or parsed.get("evidence") or "")[:400]
            valid_ids = {c["id"] for c in criteria}
            for key, val in (parsed.get("competency_scores") or {}).items():
                if str(key) in valid_ids:
                    try:
                        comp_scores[str(key)] = max(1, min(10, int(val)))
                    except (TypeError, ValueError):
                        continue
        except Exception:
            pass

        # Legacy 0–3 field kept for older readers: map 1–10 → 0–3 when scored.
        legacy_03 = None if score_10 is None else max(0, min(3, round((score_10 / 10) * 3)))
        self.rubric_notes.append(
            {
                "topic": PROJECT_DEFENSE_TOPIC,
                "question": unit.get("primary_q", "")[:300],
                "score": legacy_03 if legacy_03 is not None else 0,
                "score_10": score_10,
                "understanding_level": understanding,
                "note": note,
                "concern": concern,
                "unscored": score_10 is None,
            }
        )
        if comp_scores:
            self.competency_scores_log.append(comp_scores)
        return {
            "turn_index": max(1, self.current_turn - 1),
            "topic": PROJECT_DEFENSE_TOPIC,
            "ai_score": score_10,
            "ai_note": note,
            "concern": concern,
            "competency_scores": comp_scores,
            "internal_score_10": score_10,
        }

    def finalize(self) -> dict:
        data = super().finalize()
        data["interview_mode"] = "project_defense"
        data["strict_fallback"] = self._strict_fallback
        return data
