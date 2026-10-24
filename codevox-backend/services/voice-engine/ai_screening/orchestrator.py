"""Neutral AI Screening interviewer — question + structured state delta per turn."""

from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any

from ai_screening.schemas import (
    MAX_FOLLOWUPS_PER_TOPIC,
    TOPIC_REQUIREMENT_HINTS,
    ScreeningConversationState,
    ScreeningRequirement,
    ScreeningRoundConfig,
    ScreeningTopic,
    TopicCoverageStatus,
    TopicState,
)
from provider_resilience import ResilientLlmClient

logger = logging.getLogger("ai_screening.orchestrator")


SYSTEM_PROMPT = """You are a neutral AI Screening interviewer for a hiring pipeline.

Rules:
- Be conversational, warm, and professional. Ask ONE question at a time.
- Topics define what you should discuss. Screening requirements list information that should be collected when possible.
- Do NOT score, judge, pass, fail, flag, hire, or reject candidates. Never say PASS/FLAG/Strong Hire/No Hire or imply suitability.
- Do NOT calculate or mention scores, competency ratings, or hiring recommendations.
- Use screening requirements only as collection context (what facts are useful to gather) — never as live pass/fail rules.
- Before finishing, ask each question in unasked_screening_requirements (use that question wording). Do not skip them while max_questions and time remain. Topic follow-ups are unchanged.
- DEDUPLICATION & OVERLAP: If a Screening Requirement matches or overlaps with an enabled Screening Topic (e.g. compensation, notice period, work mode/location, education), address it under that topic. Once the candidate provides that information, consider BOTH the topic and the requirement fulfilled. NEVER ask a second question asking for the same details.
- Never ask for information already present in extracted_facts, topic evidence, or resume context unless a brief clarification is truly needed.
- If the candidate already answered a later topic, record evidence/facts for that topic and mark it COVERED when evidence is present — do not re-ask.
- Prefer a natural follow-up when the current topic still lacks usable evidence; otherwise move to the next uncovered topic.
- Respect follow-up limits in context: never exceed max_followups_per_topic on the same topic. When a topic is in must_move_topics, ask about a different uncovered topic.
- For Personal/Family Background (if enabled): remain neutral; avoid unnecessary sensitive probing; no negative inferences.
- When finishing, set done=true and use exactly this closing message: "Thank you for your time. You can now continue to the next rounds for the recruitment." (no evaluation language).

Respond with ONLY valid JSON:
{
  "spoken_reply": "what you say to the candidate",
  "done": false,
  "focus_topic_id": "topic_id being addressed by this question, or null if closing",
  "turn_kind": "primary|follow_up|closing",
  "state_delta": {
    "extracted_facts": { "key": "value" },
    "topics": {
      "topic_id": {
        "status": "NOT_STARTED|IN_PROGRESS|COVERED",
        "evidence_snippets": ["short quote or paraphrase of candidate evidence"]
      }
    }
  }
}

Coverage guidance for state_delta (runtime will validate):
- Only mark COVERED when you include at least one concrete evidence_snippet for that topic.
- If a topic has linked_requirement_ids in context, evidence/facts should address those requirements before COVERED.
- Topics without linked requirements: one substantive topic-relevant evidence snippet is enough for COVERED.
- Use IN_PROGRESS when discussion started but evidence is still thin.
"""


@dataclass
class ScreeningTurnResult:
    spoken_reply: str
    done: bool = False
    state_delta: dict[str, Any] = field(default_factory=dict)


_STANDARD_CLOSING = (
    "Thank you — that covers what we needed for screening today. "
    "We'll continue with the next steps of the interview shortly."
)
_HANDOFF_TO_VERBAL_CLOSING = (
    "Thanks — that covers the screening questions. "
    "Next, I'd like to dig into the technical side of your experience "
    "and walk through how you approach engineering problems."
)


class ScreeningOrchestrator:
    def __init__(
        self,
        *,
        config: ScreeningRoundConfig,
        client: ResilientLlmClient,
        job_profile_context: dict[str, Any] | None = None,
        candidate_name: str | None = None,
        resume_skills: list[str] | None = None,
        handoff_to_verbal: bool = False,
    ) -> None:
        self.config = config
        self.client = client
        self.job_profile_context = job_profile_context or {}
        self.candidate_name = candidate_name
        self.resume_skills = resume_skills or []
        self.handoff_to_verbal = handoff_to_verbal
        self.interview_language = "en-IN"
        self.state = ScreeningConversationState.from_enabled_topics(config.enabled_topics())
        self.started_at = time.monotonic()
        self.chat_history: list[dict[str, Any]] = []
        self._opening_sent = False
        loaded = config.configured_requirements()
        logger.info(
            "AI Screening requirements loaded count=%s ids=%s handoff_to_verbal=%s",
            len(loaded),
            [r.id for r in loaded],
            handoff_to_verbal,
        )

    def _enabled(self) -> list[ScreeningTopic]:
        return self.config.enabled_topics()

    def _closing_message(self) -> str:
        """Organic bridge into technical verbal when merging; otherwise standard screening close."""
        raw = _HANDOFF_TO_VERBAL_CLOSING if self.handoff_to_verbal else _STANDARD_CLOSING
        return self._spoken(raw)

    def _time_exceeded(self) -> bool:
        return (time.monotonic() - self.started_at) >= self.config.max_time_minutes * 60

    def _credit_known_requirements(self) -> None:
        """Credit requirements whose answers are already known from extracted facts or covered topic evidence."""
        for req in self.config.configured_requirements():
            if req.id in self.state.satisfied_requirement_ids:
                continue
            fact = self.state.extracted_facts.get(req.id)
            if fact is not None and str(fact).strip():
                self.state.satisfied_requirement_ids.append(req.id)
                if req.id not in self.state.asked_requirement_ids:
                    self.state.asked_requirement_ids.append(req.id)
                continue
            # Check linked topics
            for t in self.config.topics:
                hints = TOPIC_REQUIREMENT_HINTS.get(t.id, [])
                if req.id in hints:
                    ts = self.state.topics.get(t.id)
                    if ts and ts.status == TopicCoverageStatus.COVERED and ts.evidence_snippets:
                        self.state.satisfied_requirement_ids.append(req.id)
                        if req.id not in self.state.asked_requirement_ids:
                            self.state.asked_requirement_ids.append(req.id)
                        break

    def _outstanding_requirements(self) -> list[ScreeningRequirement]:
        self._credit_known_requirements()
        asked = set(self.state.asked_requirement_ids)
        satisfied = set(self.state.satisfied_requirement_ids)
        return [
            r for r in self.config.configured_requirements()
            if r.id not in asked and r.id not in satisfied
        ]

    def _unasked_requirements(self) -> list[ScreeningRequirement]:
        return self._outstanding_requirements()

    def should_stop(self) -> bool:
        if self.state.questions_asked >= self.config.max_questions:
            return True
        if self._time_exceeded():
            return True
        enabled_ids = [t.id for t in self._enabled()]
        if self.state.all_enabled_covered(enabled_ids) and not self._outstanding_requirements():
            return True
        return False

    def _topic_still_open(self, topic_id: str | None) -> bool:
        if not topic_id:
            return False
        ts = self.state.topics.get(topic_id)
        if not ts or ts.status == TopicCoverageStatus.COVERED:
            return False
        if ts.follow_ups_asked >= MAX_FOLLOWUPS_PER_TOPIC:
            return False
        return ts.status == TopicCoverageStatus.IN_PROGRESS or bool(ts.evidence_snippets)

    def _extract_early_facts(self, user_text: str) -> None:
        """Scan candidate answers for facts that satisfy upcoming topics or requirements."""
        text = (user_text or "").strip()
        if not text:
            return
        lower = text.lower()

        # Education detection
        edu_tokens = [
            "b.tech", "btech", "m.tech", "mtech", "bachelor", "master", "phd", "mba",
            "degree", "diploma", "graduate", "iit", "nit", "bits", "university", "college"
        ]
        if any(tok in lower for tok in edu_tokens):
            if not self.state.extracted_facts.get("highest_education"):
                self.state.extracted_facts["highest_education"] = text[:150]
            if "highest_education" not in self.state.satisfied_requirement_ids:
                self.state.satisfied_requirement_ids.append("highest_education")
            if "highest_education" not in self.state.asked_requirement_ids:
                self.state.asked_requirement_ids.append("highest_education")
            edu_ts = self.state.topics.setdefault("education_background", TopicState())
            if text[:280] not in edu_ts.evidence_snippets:
                edu_ts.evidence_snippets.append(text[:280])
            edu_ts.status = TopicCoverageStatus.COVERED

        # Compensation detection
        comp_tokens = ["lpa", "ctc", "per annum", "fixed", "variable", "inr", "package"]
        if any(tok in lower for tok in comp_tokens) and any(char.isdigit() for char in lower):
            if not self.state.extracted_facts.get("expected_compensation"):
                self.state.extracted_facts["expected_compensation"] = text[:150]
            if "expected_compensation" not in self.state.satisfied_requirement_ids:
                self.state.satisfied_requirement_ids.append("expected_compensation")
            if "expected_compensation" not in self.state.asked_requirement_ids:
                self.state.asked_requirement_ids.append("expected_compensation")
            comp_ts = self.state.topics.setdefault("compensation", TopicState())
            if text[:280] not in comp_ts.evidence_snippets:
                comp_ts.evidence_snippets.append(text[:280])
            comp_ts.status = TopicCoverageStatus.COVERED

        # Notice period detection
        notice_tokens = ["notice period", "days notice", "immediate joiner", "available immediately", "weeks notice", "month notice"]
        if any(tok in lower for tok in notice_tokens):
            if not self.state.extracted_facts.get("notice_period"):
                self.state.extracted_facts["notice_period"] = text[:150]
            if "notice_period" not in self.state.satisfied_requirement_ids:
                self.state.satisfied_requirement_ids.append("notice_period")
            if "notice_period" not in self.state.asked_requirement_ids:
                self.state.asked_requirement_ids.append("notice_period")
            np_ts = self.state.topics.setdefault("notice_period_availability", TopicState())
            if text[:280] not in np_ts.evidence_snippets:
                np_ts.evidence_snippets.append(text[:280])
            np_ts.status = TopicCoverageStatus.COVERED

    def _consume_next_requirement_question(
        self,
        answered_topic_id: str | None,
        next_topic_id: str | None = None,
    ) -> tuple[str | None, str | None]:
        self._credit_known_requirements()
        outstanding = self._outstanding_requirements()
        if not outstanding:
            return None, None
        if self.state.questions_asked >= self.config.max_questions or self._time_exceeded():
            return None, None

        # 1. If answered_topic_id has a linked requirement that is still outstanding, ask it now
        if answered_topic_id:
            linked = self.config.configured_requirements_for_topic(answered_topic_id)
            unasked_linked = [r for r in linked if r in outstanding]
            if unasked_linked:
                req = unasked_linked[0]
                self.state.asked_requirement_ids.append(req.id)
                logger.info("Asking linked screening requirement id=%s for topic=%s", req.id, answered_topic_id)
                return req.question, answered_topic_id

        # 2. Check if all enabled topics are covered
        enabled_ids = [t.id for t in self._enabled()]
        if not self.state.all_enabled_covered(enabled_ids):
            # Still have topics to cover, do not ask unlinked requirements yet!
            return None, None

        # 3. All topics covered: ask the next outstanding requirement
        req = outstanding[0]
        self.state.asked_requirement_ids.append(req.id)
        linked_topic_id = None
        for t in self.config.topics:
            hints = TOPIC_REQUIREMENT_HINTS.get(t.id, [])
            if req.id in hints:
                linked_topic_id = t.id
                break
        logger.info("Asking outstanding screening requirement id=%s", req.id)
        return req.question, linked_topic_id

    def _topics_at_followup_limit(self) -> list[str]:
        out: list[str] = []
        for t in self._enabled():
            ts = self.state.topics.get(t.id)
            if ts and ts.follow_ups_asked >= MAX_FOLLOWUPS_PER_TOPIC:
                out.append(t.id)
        return out

    def _next_uncovered_topic_id(self, exclude: str | None = None) -> str | None:
        for t in self._enabled():
            if exclude and t.id == exclude:
                continue
            ts = self.state.topics.get(t.id)
            if not ts or ts.status != TopicCoverageStatus.COVERED:
                return t.id
        return None

    def _context_block(self) -> str:
        enabled = self._enabled()
        must_move = self._topics_at_followup_limit()
        topics_payload = []
        for t in enabled:
            ts = self.state.topics.get(t.id) or TopicState()
            linked = self.config.configured_requirements_for_topic(t.id)
            topics_payload.append(
                {
                    "id": t.id,
                    "label": t.label,
                    "coverage": ts.status.value,
                    "evidence_snippets": list(ts.evidence_snippets),
                    "follow_ups_asked": ts.follow_ups_asked,
                    "max_followups": MAX_FOLLOWUPS_PER_TOPIC,
                    "linked_requirement_ids": [r.id for r in linked],
                }
            )

        requirements_payload = [
            {
                "id": r.id,
                "question": r.question,
                "expected_answer": r.expected_answer,
            }
            for r in self.config.configured_requirements()
        ]

        return json.dumps(
            {
                "candidate_name": self.candidate_name,
                "job_profile": self.job_profile_context,
                "resume_skills": self.resume_skills,
                "max_questions": self.config.max_questions,
                "max_time_minutes": self.config.max_time_minutes,
                "max_followups_per_topic": MAX_FOLLOWUPS_PER_TOPIC,
                "questions_asked": self.state.questions_asked,
                "current_focus_topic_id": self.state.current_focus_topic_id,
                "must_move_topics": must_move,
                "preferred_next_topic_id": self._next_uncovered_topic_id(
                    exclude=must_move[0] if must_move else None
                ),
                "enabled_topics": topics_payload,
                "screening_requirements": requirements_payload,
                "unasked_screening_requirements": [
                    {"id": r.id, "question": r.question}
                    for r in self._unasked_requirements()
                ],
                "extracted_facts": self.state.extracted_facts,
                "should_wrap_up": self.should_stop(),
            },
            ensure_ascii=False,
            default=str,
        )

    def _spoken(self, english: str) -> str:
        from prompts import speak_line

        return speak_line(english, getattr(self, "interview_language", None))

    def opening(self) -> ScreeningTurnResult:
        from prompts import normalize_interview_language

        name = (self.candidate_name or "").strip()
        title = str(self.job_profile_context.get("title") or "this role")
        first = self._enabled()[0] if self._enabled() else None
        topic_hint = (first.label if first else "your background").lower()
        if normalize_interview_language(getattr(self, "interview_language", None)) == "hi-IN":
            greet = f"नमस्ते {name}, " if name else "नमस्ते, "
            reply = (
                f"{greet}जुड़ने के लिए धन्यवाद। मैं {title} के लिए एक छोटा AI Screening लूँगा। "
                f"इसमें आपके background और logistics पर कुछ बातचीत वाले सवाल होंगे। "
                f"क्या हम {topic_hint} के एक छोटे overview से शुरू करें?"
            )
        else:
            reply = (
                f"Hi {name or 'there'}, thanks for joining. I'll run a short AI Screening for {title} — "
                f"a few conversational questions about your background and logistics. "
                f"Shall we begin with a quick overview of {topic_hint}?"
            )
        self._opening_sent = True
        self.state.questions_asked += 1
        self.chat_history.append({"role": "assistant", "content": reply})
        if first and first.id in self.state.topics:
            self.state.topics[first.id].status = TopicCoverageStatus.IN_PROGRESS
            self.state.current_focus_topic_id = first.id
        return ScreeningTurnResult(spoken_reply=reply, done=False)

    async def process_candidate_answer(self, user_text: str) -> ScreeningTurnResult:
        text = (user_text or "").strip()
        if text:
            self.chat_history.append({"role": "user", "content": text})

        self._extract_early_facts(text)

        if self.should_stop() and self.state.questions_asked > 0:
            closing = self._closing_message()
            self.chat_history.append({"role": "assistant", "content": closing})
            return ScreeningTurnResult(spoken_reply=closing, done=True)

        # Topic the candidate just answered (NOT the next question's focus).
        answered_topic_id = self.state.current_focus_topic_id

        data = await self._llm_turn()
        data = await self._enforce_followup_limit(data)

        reply = str(data.get("spoken_reply") or data.get("reply") or "").strip()
        if not reply:
            reply = self._spoken("Thanks for sharing. Could you tell me a little more?")
        done = bool(data.get("done"))
        turn_kind = str(data.get("turn_kind") or "primary").lower().strip()
        focus = data.get("focus_topic_id") or data.get("focusTopicId")
        focus_id = str(focus).strip() if focus else None
        if focus_id == "null":
            focus_id = None

        delta = data.get("state_delta") if isinstance(data.get("state_delta"), dict) else {}
        self.state.apply_delta(delta)
        self._record_answer_evidence(text, answered_topic_id, delta)
        self._enforce_coverage_rules()
        self._credit_known_requirements()
        self._track_followup(turn_kind, focus_id)

        # Enforce natural topic order: if LLM tries to skip ahead to a later topic while earlier enabled topics remain uncovered
        expected_next = self._next_uncovered_topic_id(exclude=answered_topic_id if not self._topic_still_open(answered_topic_id) else None)
        if expected_next and focus_id != expected_next and not self._topic_still_open(answered_topic_id):
            enabled_ids = [t.id for t in self._enabled()]
            if focus_id not in enabled_ids or (
                focus_id in enabled_ids
                and expected_next in enabled_ids
                and enabled_ids.index(focus_id) > enabled_ids.index(expected_next)
            ):
                focus_id = expected_next
                label = next((t.label for t in self._enabled() if t.id == expected_next), expected_next.replace("_", " "))
                reply = self._spoken(f"Thanks. Next, could you tell me about your {label.lower()}?")

        forced_requirement, req_focus = self._consume_next_requirement_question(answered_topic_id, next_topic_id=focus_id)
        if forced_requirement:
            reply = forced_requirement
            done = False
            turn_kind = "primary"
            focus_id = req_focus
        elif self.should_stop() and not done:
            done = True
            turn_kind = "closing"
            focus_id = None
            reply = self._closing_message()

        if focus_id and focus_id in self.state.topics and not done:
            self.state.current_focus_topic_id = focus_id
            if self.state.topics[focus_id].status == TopicCoverageStatus.NOT_STARTED:
                self.state.topics[focus_id].status = TopicCoverageStatus.IN_PROGRESS

        if not done:
            self.state.questions_asked += 1
        self.chat_history.append({"role": "assistant", "content": reply})

        return ScreeningTurnResult(spoken_reply=reply, done=done, state_delta=delta or {})

    async def _llm_turn(self, extra_instruction: str | None = None) -> dict[str, Any]:
        content = (
            "Screening context:\n"
            + self._context_block()
            + "\n\nRecent conversation:\n"
            + json.dumps(self.chat_history[-12:], ensure_ascii=False)
            + "\n\nProduce the next JSON turn."
        )
        if extra_instruction:
            content += "\n\nRuntime override:\n" + extra_instruction

        from prompts import conduct_language_rule, speak_line

        closing_rule = ""
        if getattr(self, "interview_language", "en-IN") == "hi-IN":
            hindi_close = speak_line(
                _HANDOFF_TO_VERBAL_CLOSING if self.handoff_to_verbal else _STANDARD_CLOSING,
                "hi-IN",
            )
            closing_rule = (
                f"\n{conduct_language_rule('hi-IN')}\n"
                f'When finishing, the spoken message must be exactly: "{hindi_close}"'
            )
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT + closing_rule},
            {"role": "user", "content": content},
        ]
        try:
            raw, _meta = await self.client.chat_completion(
                messages,
                temperature=0.4,
                max_tokens=800,
                purpose="generate",
            )
            raw_str = raw if isinstance(raw, str) else str(raw)
            data = json.loads(_extract_json_object(raw_str))
        except Exception:
            logger.exception("Screening interviewer LLM failed")
            data = {
                "spoken_reply": self._spoken("Could you tell me a bit more about that?"),
                "done": False,
                "turn_kind": "follow_up",
                "focus_topic_id": self.state.current_focus_topic_id,
                "state_delta": {},
            }

        if not isinstance(data, dict):
            return {
                "spoken_reply": self._spoken("Thanks — could you expand on that briefly?"),
                "done": False,
                "turn_kind": "follow_up",
                "focus_topic_id": self.state.current_focus_topic_id,
                "state_delta": {},
            }
        return data

    async def _enforce_followup_limit(self, data: dict[str, Any]) -> dict[str, Any]:
        """If LLM tries another follow-up past the per-topic cap, force a topic move (one retry)."""
        turn_kind = str(data.get("turn_kind") or "primary").lower().strip()
        focus = data.get("focus_topic_id") or data.get("focusTopicId")
        focus_id = str(focus).strip() if focus else None
        if not focus_id or focus_id == "null" or turn_kind != "follow_up":
            return data

        ts = self.state.topics.get(focus_id)
        if not ts or ts.follow_ups_asked < MAX_FOLLOWUPS_PER_TOPIC:
            return data

        next_id = self._next_uncovered_topic_id(exclude=focus_id)
        if not next_id:
            if self._unasked_requirements():
                return data
            data["turn_kind"] = "closing"
            data["done"] = True
            if not str(data.get("spoken_reply") or "").strip():
                data["spoken_reply"] = self._closing_message()
            return data

        logger.info(
            "Follow-up cap reached for topic=%s; forcing move to %s",
            focus_id,
            next_id,
        )
        retried = await self._llm_turn(
            extra_instruction=(
                f"Topic '{focus_id}' already has {MAX_FOLLOWUPS_PER_TOPIC} follow-ups. "
                f"Do NOT follow up on it. Ask a primary question about '{next_id}'. "
                f'Set turn_kind="primary" and focus_topic_id="{next_id}".'
            )
        )
        # Hard-enforce focus even if retry still misbehaves.
        retried["turn_kind"] = "primary"
        retried["focus_topic_id"] = next_id
        retried["done"] = bool(retried.get("done"))
        if not str(retried.get("spoken_reply") or "").strip():
            label = next(
                (t.label for t in self._enabled() if t.id == next_id),
                next_id.replace("_", " "),
            )
            from prompts import normalize_interview_language

            if normalize_interview_language(getattr(self, "interview_language", None)) == "hi-IN":
                retried["spoken_reply"] = (
                    f"धन्यवाद। अब क्या आप अपने {label.lower()} के बारे में बता सकते हैं?"
                )
            else:
                retried["spoken_reply"] = (
                    f"Thanks. Next, could you tell me about your {label.lower()}?"
                )
        return retried

    def _track_followup(self, turn_kind: str, focus_id: str | None) -> None:
        if turn_kind != "follow_up" or not focus_id:
            return
        ts = self.state.topics.setdefault(focus_id, TopicState())
        if ts.follow_ups_asked < MAX_FOLLOWUPS_PER_TOPIC:
            ts.follow_ups_asked += 1

    def _record_answer_evidence(
        self,
        last_answer: str,
        answered_topic_id: str | None,
        delta: dict[str, Any],
    ) -> None:
        """Persist candidate answer as evidence for the topic just discussed (prior focus)."""
        answer = (last_answer or "").strip()
        if not answer or not answered_topic_id:
            return
        if answered_topic_id not in self.state.topics:
            return
        ts = self.state.topics[answered_topic_id]

        # Prefer evidence already supplied in this turn's delta for the answered topic.
        topic_delta = {}
        raw_topics = delta.get("topics") if isinstance(delta, dict) else None
        if isinstance(raw_topics, dict):
            topic_delta = raw_topics.get(answered_topic_id) or {}
        delta_snips = topic_delta.get("evidence_snippets") or topic_delta.get("evidenceSnippets") or []
        if isinstance(delta_snips, list) and any(str(s).strip() for s in delta_snips):
            if ts.status == TopicCoverageStatus.NOT_STARTED:
                ts.status = TopicCoverageStatus.IN_PROGRESS
            return

        if answer not in ts.evidence_snippets:
            ts.evidence_snippets.append(answer[:280])
        if ts.status == TopicCoverageStatus.NOT_STARTED:
            ts.status = TopicCoverageStatus.IN_PROGRESS

    def _enforce_coverage_rules(self) -> None:
        """Gate COVERED on persisted evidence (and requirement relevance when linked)."""
        for topic in self._enabled():
            ts = self.state.topics.setdefault(topic.id, TopicState())
            linked = self.config.configured_requirements_for_topic(topic.id)

            if linked:
                if self._has_requirement_relevant_evidence(topic.id, linked, ts):
                    self._ensure_evidence_from_facts(topic.id, linked, ts)
                    ts.status = TopicCoverageStatus.COVERED
                    for req in linked:
                        if req.id not in self.state.satisfied_requirement_ids:
                            self.state.satisfied_requirement_ids.append(req.id)
                        if req.id not in self.state.asked_requirement_ids:
                            self.state.asked_requirement_ids.append(req.id)
                elif ts.evidence_snippets or self._facts_touch_topic(topic.id, linked):
                    if ts.status == TopicCoverageStatus.COVERED:
                        ts.status = TopicCoverageStatus.IN_PROGRESS
                    elif ts.status == TopicCoverageStatus.NOT_STARTED:
                        ts.status = TopicCoverageStatus.IN_PROGRESS
                else:
                    if ts.status == TopicCoverageStatus.COVERED:
                        ts.status = TopicCoverageStatus.NOT_STARTED
                continue

            # Topic without configured requirement: one substantive evidence snippet is enough.
            if self._has_substantive_evidence(ts):
                ts.status = TopicCoverageStatus.COVERED
            elif ts.evidence_snippets:
                if ts.status == TopicCoverageStatus.COVERED:
                    ts.status = TopicCoverageStatus.IN_PROGRESS
                elif ts.status == TopicCoverageStatus.NOT_STARTED:
                    ts.status = TopicCoverageStatus.IN_PROGRESS
            else:
                if ts.status == TopicCoverageStatus.COVERED:
                    ts.status = TopicCoverageStatus.NOT_STARTED

    def _facts_touch_topic(
        self,
        topic_id: str,
        linked: list[ScreeningRequirement],
    ) -> bool:
        for req in linked:
            if self.state.extracted_facts.get(req.id):
                return True
        # Also accept facts keyed like the topic id
        return bool(self.state.extracted_facts.get(topic_id))

    def _ensure_evidence_from_facts(
        self,
        topic_id: str,
        linked: list[ScreeningRequirement],
        ts: TopicState,
    ) -> None:
        if ts.evidence_snippets:
            return
        for req in linked:
            val = self.state.extracted_facts.get(req.id)
            if val is not None and str(val).strip():
                ts.evidence_snippets.append(f"{req.id}: {val}"[:280])
                return
        val = self.state.extracted_facts.get(topic_id)
        if val is not None and str(val).strip():
            ts.evidence_snippets.append(str(val)[:280])

    def _has_requirement_relevant_evidence(
        self,
        topic_id: str,
        linked: list[ScreeningRequirement],
        ts: TopicState,
    ) -> bool:
        for req in linked:
            fact = self.state.extracted_facts.get(req.id)
            if fact is not None and str(fact).strip():
                return True
            if self._snippets_relevant_to_requirement(ts.evidence_snippets, req):
                return True
        # Early answer recorded under topic id
        fact = self.state.extracted_facts.get(topic_id)
        if fact is not None and str(fact).strip() and ts.evidence_snippets:
            return True
        return False

    @staticmethod
    def _snippets_relevant_to_requirement(
        snippets: list[str],
        req: ScreeningRequirement,
    ) -> bool:
        if not snippets:
            return False
        tokens = _meaningful_tokens(req.question + " " + (req.expected_answer or ""))
        # Domain keywords by requirement id as a light relevance assist
        domain = {
            "expected_compensation": {
                "lpa",
                "salary",
                "ctc",
                "compensation",
                "expect",
                "package",
                "rupee",
                "inr",
                "₹",
            },
            "highest_education": {
                "degree",
                "btech",
                "mtech",
                "bachelor",
                "master",
                "mba",
                "phd",
                "graduate",
                "university",
                "college",
                "qualification",
            },
            "notice_period": {"notice", "days", "weeks", "month", "available", "joining"},
            "work_location_mode": {
                "office",
                "remote",
                "hybrid",
                "onsite",
                "wfh",
                "location",
                "relocate",
                "bangalore",
                "bengaluru",
            },
            "relocate_if_required": {"relocate", "relocation", "move", "willing", "yes", "no"},
        }.get(req.id, set())
        tokens |= domain

        for snip in snippets:
            s = snip.lower()
            if tokens and any(tok in s for tok in tokens):
                return True
            # Numeric compensation / notice answers still count as evidence
            if req.id in {"expected_compensation", "notice_period"} and re.search(r"\d", snip):
                return True
        return False

    @staticmethod
    def _has_substantive_evidence(ts: TopicState) -> bool:
        for snip in ts.evidence_snippets:
            words = [w for w in re.split(r"\s+", snip.strip()) if w]
            if len(words) >= 3:
                return True
        return False


def _meaningful_tokens(text: str) -> set[str]:
    stop = {
        "what",
        "your",
        "you",
        "are",
        "the",
        "and",
        "for",
        "from",
        "with",
        "this",
        "that",
        "have",
        "will",
        "would",
        "required",
        "willing",
        "about",
        "a",
        "an",
        "to",
        "of",
        "in",
        "is",
        "if",
    }
    out: set[str] = set()
    for raw in re.split(r"[^a-zA-Z0-9₹]+", (text or "").lower()):
        tok = raw.strip()
        if len(tok) >= 4 and tok not in stop:
            out.add(tok)
    return out


def _extract_json_object(raw: str) -> str:
    text = raw or ""
    start = text.find("{")
    if start < 0:
        raise ValueError("No JSON object in LLM output")
    depth = 0
    in_str = False
    escape = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    raise ValueError("Unbalanced JSON object in LLM output")
