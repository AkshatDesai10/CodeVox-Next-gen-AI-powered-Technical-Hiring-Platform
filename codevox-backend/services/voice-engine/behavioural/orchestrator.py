"""BehaviouralOrchestrator — three tracks, backend-owned control flow."""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from behavioural import llm_ops
from behavioural.planner import InterviewPlanner
from behavioural.rules import (
    apply_extracted_evidence,
    apply_screening_rule,
    build_competency_evaluation,
    decide_next_action,
    final_automated_decision,
    question_covers_evidence,
    resolve_supporting_quotes,
)
from behavioural.schemas import (
    BehaviouralRoundConfig,
    CompetencyEvidenceState,
    EvidenceItemState,
    QuestionAsk,
    RequirementAlignment,
    ScreeningCapture,
)
from behavioural.trace import emit_behavioural
from provider_resilience import ResilientLlmClient, build_provider_chain

logger = logging.getLogger("behavioural.orchestrator")


@dataclass
class OrchestratorStep:
    speak: str | None
    complete: bool = False
    event: dict[str, Any] | None = None


def _ask_dict(ask: QuestionAsk | None) -> dict[str, Any] | None:
    if ask is None:
        return None
    return dict(ask.__dict__)


def _step_dict(step: OrchestratorStep) -> dict[str, Any]:
    return {
        "speak": step.speak,
        "complete": step.complete,
        "event": step.event,
    }


@dataclass
class BehaviouralOrchestrator:
    config: BehaviouralRoundConfig
    job_title: str | None = None
    resume_projects: str | None = None
    client: ResilientLlmClient | None = None
    planner: InterviewPlanner = field(init=False)
    evidence_by_comp: dict[str, CompetencyEvidenceState] = field(default_factory=dict)
    evaluations: list[Any] = field(default_factory=list)
    screening_captures: list[ScreeningCapture] = field(default_factory=list)
    alignments: dict[str, RequirementAlignment] = field(default_factory=dict)
    turns: list[dict[str, Any]] = field(default_factory=list)
    pending_ask: QuestionAsk | None = None
    started_at: float = field(default_factory=time.time)
    final_report: dict[str, Any] | None = None
    hard_rejected: bool = False
    _pending_followup_gaps: list[str] | None = None
    _stt_reask_used: bool = False
    interview_language: str = "en-IN"
    _ack_index: int = 0

    _ACK_PHRASES: tuple[str, ...] = (
        "Thanks for sharing that.",
        "Got it, thank you.",
        "That's helpful - thank you.",
        "Appreciate the detail there.",
    )

    def _next_ack_phrase(self) -> str:
        from prompts import speak_line

        phrase = self._ACK_PHRASES[self._ack_index % len(self._ACK_PHRASES)]
        self._ack_index += 1
        return speak_line(phrase, self.interview_language)

    def _line(self, english: str) -> str:
        from prompts import speak_line

        return speak_line(english, self.interview_language)

    def __post_init__(self) -> None:
        self.planner = InterviewPlanner(self.config)
        for comp in self.config.competencies:
            required = [e.evidence_id for e in comp.evidence_requirements if e.required]
            state = CompetencyEvidenceState(
                competency_id=comp.competency_id,
                required_ids=required,
            )
            for e in comp.evidence_requirements:
                state.evidence_state[e.evidence_id] = EvidenceItemState()
            self.evidence_by_comp[comp.competency_id] = state
        for req in self.config.job_requirements:
            self.alignments[req.requirement_id] = RequirementAlignment(
                requirement_id=req.requirement_id,
                status="NOT_ESTABLISHED",
                importance=req.importance,
            )
        if self.client is None:
            self.client = ResilientLlmClient(build_provider_chain())
        emit_behavioural(
            "session_init",
            {
                "job_title": self.job_title,
                "competency_ids": [c.competency_id for c in self.config.competencies],
                "screening_question_ids": [s.question_id for s in self.config.screening_questions],
                "job_requirement_ids": [r.requirement_id for r in self.config.job_requirements],
                "interview_limits": {
                    "max_total_questions": self.config.interview_limits.max_total_questions,
                    "max_duration_minutes": self.config.interview_limits.max_duration_minutes,
                },
                "score_thresholds": {
                    "strong_hire_min": self.config.score_thresholds.strong_hire_min,
                    "hire_with_reservations_min": self.config.score_thresholds.hire_with_reservations_min,
                    "core_competency_min_score": self.config.score_thresholds.core_competency_min_score,
                },
                "decision_policy": {
                    "require_all_mandatory_eligibility": (
                        self.config.decision_policy.require_all_mandatory_eligibility
                    ),
                    "require_all_mandatory_requirements_supported": (
                        self.config.decision_policy.require_all_mandatory_requirements_supported
                    ),
                },
            },
        )

    def _time_exceeded(self) -> bool:
        mins = (time.time() - self.started_at) / 60.0
        return mins >= self.config.interview_limits.max_duration_minutes

    def _qid(self) -> str:
        return f"q_{uuid.uuid4().hex[:8]}"

    def _tid(self) -> str:
        return f"t_{uuid.uuid4().hex[:8]}"

    async def get_opening_utterance(self) -> OrchestratorStep:
        ask = await self._next_ask()
        if not ask:
            report = self.generate_final_report()
            step = OrchestratorStep(
                speak=self._line("Thank you. That concludes this interview."),
                complete=True,
                event={"event": "SESSION_COMPLETE", "final_report": report},
            )
            emit_behavioural("opening_empty_complete", _step_dict(step))
            return step
        self.pending_ask = ask
        self.planner.commit_ask(ask)
        step = OrchestratorStep(
            speak=ask.text,
            event={
                "event": "ASK",
                "question": ask.__dict__,
                "planner_snapshot": self.planner.snapshot(),
            },
        )
        emit_behavioural(
            "opening_ask",
            {
                "speak": step.speak,
                "question": _ask_dict(ask),
                "planner_snapshot": self.planner.snapshot(),
            },
        )
        return step

    async def handle_answer(
        self,
        raw_text: str,
        stt_confidence: float | None = None,
    ) -> OrchestratorStep:
        emit_behavioural(
            "candidate_answer",
            {
                "raw_text": raw_text,
                "stt_confidence": stt_confidence,
                "pending_ask": _ask_dict(self.pending_ask),
                "planner_snapshot": self.planner.snapshot(),
            },
        )
        if self.hard_rejected or self.final_report:
            step = OrchestratorStep(speak=None, complete=True)
            emit_behavioural("already_complete", _step_dict(step))
            return step

        ask = self.pending_ask
        if not ask:
            return await self.get_opening_utterance()

        # Low STT confidence: one re-ask max, else accept + flag
        if (
            stt_confidence is not None
            and stt_confidence < 0.55
            and not self._stt_reask_used
            and not ask.is_followup
        ):
            self._stt_reask_used = True
            step = OrchestratorStep(
                speak="Sorry, I didn't catch that clearly. Could you please repeat your answer?",
                event={
                    "event": "STT_REASK",
                    "question_id": ask.question_id,
                    "stt_confidence": stt_confidence,
                },
            )
            emit_behavioural("stt_reask", _step_dict(step))
            return step

        turn_id = self._tid()
        event: dict[str, Any] = {
            "event": "TURN_COMPLETE",
            "turn": {
                "turn_id": turn_id,
                "question_id": ask.question_id,
                "question_text": ask.text,
                "candidate_answer_raw": raw_text,
                "stt_confidence": stt_confidence,
                "stt_unreliable": bool(
                    stt_confidence is not None and stt_confidence < 0.55
                ),
                "track": ask.track,
                "competency_id": ask.competency_id,
            },
        }

        if ask.track == "eligibility":
            await self._handle_eligibility(ask, raw_text, turn_id, event)
            if self.hard_rejected:
                report = self.generate_final_report()
                step = OrchestratorStep(
                    speak=self._line(
                        "Thank you for sharing that. We will be in touch about next steps."
                    ),
                    complete=True,
                    event={"event": "SESSION_COMPLETE", "final_report": report, **event},
                )
                emit_behavioural("hard_reject", _step_dict(step))
                return step
        elif ask.track == "profile":
            await self._handle_profile(ask, raw_text, turn_id, event)
        elif ask.track == "informational":
            await self._handle_informational(ask, raw_text, turn_id, event)
        elif ask.track == "behavioral":
            done_comp = await self._handle_behavioral(ask, raw_text, turn_id, event)
            if done_comp:
                event["competency_complete"] = done_comp

        self.turns.append(event)
        emit_behavioural("turn_complete", event)

        if self._time_exceeded() or self.planner.over_budget():
            # force gaps on active competency
            comp = self.planner.current_competency()
            if comp:
                st = self.evidence_by_comp[comp.competency_id]
                st.status = "COMPLETE_WITH_GAPS"
                await self._finalize_competency(comp)
                self.planner.mark_competency_done()
            report = self.generate_final_report()
            step = OrchestratorStep(
                speak=self._line(
                    "We are out of time for this round. Thank you for the conversation."
                ),
                complete=True,
                event={"event": "SESSION_COMPLETE", "final_report": report},
            )
            emit_behavioural("budget_or_time_complete", _step_dict(step))
            return step

        next_ask = await self._next_ask()
        if not next_ask:
            report = self.generate_final_report()
            step = OrchestratorStep(
                speak=self._line("Thank you. That concludes the behavioural interview."),
                complete=True,
                event={"event": "SESSION_COMPLETE", "final_report": report},
            )
            emit_behavioural("session_complete", _step_dict(step))
            return step

        self.pending_ask = next_ask
        self.planner.commit_ask(next_ask)
        self._stt_reask_used = False
        speak = next_ask.text
        # light acknowledgement prefix (rotate to avoid robotic repetition)
        if raw_text.strip():
            speak = f"{self._next_ack_phrase()} {next_ask.text}"
        step = OrchestratorStep(
            speak=speak,
            event={
                "event": "ASK",
                "question": next_ask.__dict__,
                "planner_snapshot": self.planner.snapshot(),
                "prior_turn": event,
            },
        )
        emit_behavioural(
            "next_ask",
            {
                "speak": speak,
                "question": _ask_dict(next_ask),
                "planner_snapshot": self.planner.snapshot(),
            },
        )
        return step

    async def _handle_eligibility(
        self,
        ask: QuestionAsk,
        raw_text: str,
        turn_id: str,
        event: dict[str, Any],
    ) -> None:
        sq = next(
            (s for s in self.config.screening_questions if s.question_id == ask.screening_question_id),
            None,
        )
        parsed = None
        assert self.client is not None
        if sq:
            parsed = await llm_ops.parse_screening_value(
                self.client, raw_text, sq.expected_type, sq.answer_field
            )
            cap = apply_screening_rule(sq, raw_text, parsed)
        else:
            cap = ScreeningCapture(
                question_id=ask.question_id,
                category="eligibility",
                answer_field=ask.answer_field,
                raw_answer_final=raw_text,
                parsed_value=None,
            )
        self.screening_captures.append(cap)
        event["screening_capture"] = cap.to_dict()
        status = (cap.requirement_mapping or {}).get("status")
        rule = (sq.decision_rule if sq else None) or {}
        if status == "NOT_SATISFIED":
            if rule.get("on_fail") == "reject" or (
                self.config.decision_policy.require_all_mandatory_eligibility
                and rule.get("type") == "hard_filter"
            ):
                self.hard_rejected = True
        self.planner.mark_screening_done("eligibility")

    async def _handle_profile(
        self,
        ask: QuestionAsk,
        raw_text: str,
        turn_id: str,
        event: dict[str, Any],
    ) -> None:
        assert self.client is not None
        req_ids = [r.requirement_id for r in self.config.job_requirements]
        data = await llm_ops.extract_profile(self.client, raw_text, req_ids)
        attrs = data.get("attributes") if isinstance(data.get("attributes"), list) else []
        maps = data.get("requirement_mapping") if isinstance(data.get("requirement_mapping"), list) else []
        updates = []
        for m in maps:
            rid = str(m.get("requirement_id") or "")
            if rid not in self.alignments:
                continue
            status = m.get("status")
            if status not in ("SUPPORTED", "NOT_ESTABLISHED", "CONTRADICTED"):
                status = "NOT_ESTABLISHED"
            # never invent failure from silence — only upgrade
            cur = self.alignments[rid]
            if cur.status == "SUPPORTED" and status != "CONTRADICTED":
                continue
            if status == "NOT_ESTABLISHED" and cur.status != "NOT_ESTABLISHED":
                continue
            self.alignments[rid] = RequirementAlignment(
                requirement_id=rid,
                status=status,
                source_turn=turn_id if status != "NOT_ESTABLISHED" else None,
                evidence=m.get("evidence"),
                confidence=m.get("confidence"),
                importance=cur.importance,
            )
            updates.append(self.alignments[rid].to_dict())
        event["candidate_profile_evidence"] = attrs
        event["requirement_alignment_updates"] = updates
        self.planner.mark_screening_done("profile")

    async def _handle_informational(
        self,
        ask: QuestionAsk,
        raw_text: str,
        turn_id: str,
        event: dict[str, Any],
    ) -> None:
        sq = next(
            (s for s in self.config.screening_questions if s.question_id == ask.screening_question_id),
            None,
        )
        parsed = None
        assert self.client is not None
        if sq:
            parsed = await llm_ops.parse_screening_value(
                self.client, raw_text, sq.expected_type, sq.answer_field
            )
            cap = apply_screening_rule(sq, raw_text, parsed)
        else:
            cap = ScreeningCapture(
                question_id=ask.question_id,
                category="informational",
                answer_field=ask.answer_field,
                raw_answer_final=raw_text,
                parsed_value=None,
            )
        self.screening_captures.append(cap)
        event["screening_capture"] = cap.to_dict()
        self.planner.mark_screening_done("informational")

    async def _handle_behavioral(
        self,
        ask: QuestionAsk,
        raw_text: str,
        turn_id: str,
        event: dict[str, Any],
    ) -> dict[str, Any] | None:
        comp = self.planner.current_competency()
        if not comp:
            return None
        state = self.evidence_by_comp[comp.competency_id]
        assert self.client is not None
        evidence_ids = [e.evidence_id for e in comp.evidence_requirements]
        extracted = await llm_ops.extract_star(self.client, raw_text, evidence_ids)
        # ensure quote fields
        for ex in extracted:
            if "quote" in ex and "quote_original" not in ex:
                ex["quote_original"] = ex.get("quote")
                ex["quote_normalized"] = ex.get("quote")
        apply_extracted_evidence(state, extracted, turn_id)
        if ask.is_followup:
            state.followups_used += 1
        else:
            state.questions_used += 1

        decision = decide_next_action(
            state,
            max_followups=comp.max_followups,
            followups_used=state.followups_used,
            required_ids=state.required_ids,
            optional_ids=[
                e.evidence_id for e in comp.evidence_requirements if not e.required
            ],
            questions_used=state.questions_used,
            max_questions=comp.max_questions,
        )
        event["extracted_evidence"] = extracted
        event["evidence_state"] = state.to_dict()
        event["decision"] = {
            "action": decision.action,
            "target_evidence": decision.target_evidence,
            "reason": decision.reason,
        }

        if decision.action in ("COMPLETE", "COMPLETE_WITH_GAPS"):
            state.status = decision.action  # type: ignore[assignment]
            done = await self._finalize_competency(comp)
            self.planner.mark_competency_done()
            self._pending_followup_gaps = None
            return done

        # stash gaps for next ask
        self._pending_followup_gaps = decision.target_evidence
        return None

    async def _finalize_competency(self, comp) -> dict[str, Any]:
        state = self.evidence_by_comp[comp.competency_id]
        quotes: list[dict[str, Any]] = []
        for turn in self.turns:
            te = turn.get("turn") or {}
            if te.get("competency_id") != comp.competency_id:
                continue
            for ex in turn.get("extracted_evidence") or []:
                if ex.get("present") and (ex.get("quote_normalized") or ex.get("quote_original")):
                    quotes.append(
                        {
                            "evidence_id": ex.get("evidence_id"),
                            "turn_id": te.get("turn_id"),
                            "quote_original": ex.get("quote_original"),
                            "quote_normalized": ex.get("quote_normalized"),
                        }
                    )
        assert self.client is not None
        data = await llm_ops.evaluate_competency(
            self.client,
            competency_name=comp.name,
            objective=comp.objective,
            evidence_state=state.to_dict(),
            quotes=quotes[:8],
        )
        score = int(data.get("score") or 3)
        # thin evidence cap
        qualities = [
            (state.evidence_state.get(eid).quality if state.evidence_state.get(eid) else None)
            for eid in state.required_ids
        ]
        if qualities and all(q in (None, "weak") for q in qualities):
            score = min(score, 2)
        supporting_quotes = resolve_supporting_quotes(
            data.get("supporting_quotes"),
            quotes,
            max_n=3,
        )
        ev = build_competency_evaluation(
            comp,
            state,
            score=score,
            reasoning=str(data.get("reasoning") or ""),
            supporting_quotes=supporting_quotes,
        )
        self.evaluations.append(ev)
        done = {
            "event": "COMPETENCY_COMPLETE",
            "evidence_state": state.to_dict(),
            "competency_evaluation": ev.to_dict(),
        }
        emit_behavioural("competency_complete", done)
        return done

    async def _next_ask(self) -> QuestionAsk | None:
        self.planner.advance_phase_if_needed()
        if self.planner.state.phase == "done" or self.planner.over_budget():
            return None

        # Continue behavioral follow-up
        gaps = getattr(self, "_pending_followup_gaps", None)
        if gaps and self.planner.state.phase == "behavioral":
            comp = self.planner.current_competency()
            if comp:
                self._pending_followup_gaps = None
                return await self._propose_behavioral(comp, gaps=gaps, is_followup=True)

        slot = self.planner.next_screening_slot()
        if slot:
            track, sq = slot
            return QuestionAsk(
                question_id=sq.question_id,
                text=sq.question_text,
                track=track if track != "informational" else "informational",
                type="hr_screening" if track != "profile" else "profile",
                category=sq.category,
                answer_field=sq.answer_field,
                screening_question_id=sq.question_id,
            )

        if self.planner.state.phase == "behavioral":
            comp = self.planner.current_competency()
            if not comp:
                self.planner.advance_phase_if_needed()
                return await self._next_ask()
            return await self._propose_behavioral(comp, gaps=None, is_followup=False)

        if self.planner.state.phase == "informational":
            slot = self.planner.next_screening_slot()
            if slot:
                track, sq = slot
                return QuestionAsk(
                    question_id=sq.question_id,
                    text=sq.question_text,
                    track="informational",
                    type="hr_screening",
                    category=sq.category,
                    answer_field=sq.answer_field,
                    screening_question_id=sq.question_id,
                )
        return None

    async def _propose_behavioral(
        self,
        comp,
        *,
        gaps: list[str] | None,
        is_followup: bool,
    ) -> QuestionAsk:
        assert self.client is not None
        targets = gaps or [e.evidence_id for e in comp.evidence_requirements]
        intent = comp.objective or f"Assess {comp.name}"
        resume_anchor = None
        if self.resume_projects and "payment" in (self.resume_projects or "").lower():
            resume_anchor = self.resume_projects.split(";")[0].strip()[:120]

        async def _gen(rejection: list[str] | None = None) -> QuestionAsk:
            data = await llm_ops.generate_question_text(
                self.client,
                track="behavioral",
                intent=intent,
                competency_name=comp.name,
                targets=targets,
                resume_anchor=resume_anchor,
                job_title=self.job_title,
                is_followup=is_followup,
                rejection_errors=rejection,
                interview_language=self.interview_language,
            )
            text = str(data.get("text") or "").strip()
            qtype = str(data.get("type") or ("followup" if is_followup else "behavioral"))
            return QuestionAsk(
                question_id=self._qid(),
                text=text
                or f"Tell me about a time that shows your {comp.name.lower()}.",
                track="behavioral",
                type=qtype,
                competency_id=comp.competency_id,
                targets_evidence=targets,
                is_followup=is_followup,
                resume_anchor=resume_anchor,
            )

        proposal = await _gen()
        # Opening questions: ensure required STAR slots are invited (one regenerate max).
        if not is_followup:
            required_ids = [
                e.evidence_id for e in comp.evidence_requirements if e.required
            ]
            missing = question_covers_evidence(proposal.text, required_ids)
            if missing:
                emit_behavioural(
                    "question_missing_evidence",
                    {
                        "question": _ask_dict(proposal),
                        "missing": missing,
                        "attempt": 1,
                    },
                )
                proposal = await _gen(
                    [
                        "missing_evidence:" + ",".join(missing),
                        f"Explicitly invite the candidate to cover: {missing}. "
                        "Include outcome/result if 'result' is listed.",
                    ]
                )
                # Proceed even if still incomplete — do not loop.
                still_missing = question_covers_evidence(proposal.text, required_ids)
                if still_missing:
                    emit_behavioural(
                        "question_missing_evidence_after_retry",
                        {
                            "question": _ask_dict(proposal),
                            "missing": still_missing,
                        },
                    )

        errors = self.planner.validate_proposal(proposal)
        if not errors:
            emit_behavioural(
                "question_proposal_accepted",
                {"question": _ask_dict(proposal), "is_followup": is_followup},
            )
            return proposal

        emit_behavioural(
            "question_proposal_rejected",
            {"question": _ask_dict(proposal), "errors": errors, "attempt": 1},
        )

        # one regenerate attempt
        retry = await _gen(errors)
        errors2 = self.planner.validate_proposal(retry)
        if not errors2:
            emit_behavioural(
                "question_proposal_accepted",
                {"question": _ask_dict(retry), "is_followup": is_followup, "after_retry": True},
            )
            return retry

        emit_behavioural(
            "question_proposal_rejected",
            {"question": _ask_dict(retry), "errors": errors2, "attempt": 2},
        )

        fallback = self.planner.handle_rejection(
            proposal,
            errors2,
            gaps=targets,
            regenerate_fn=lambda _e: None,
        )
        if fallback:
            emit_behavioural(
                "question_fallback_template",
                {"question": _ask_dict(fallback), "gaps": targets},
            )
            return fallback
        # skip gap
        emit_behavioural(
            "question_proposal_exhausted",
            {"competency_id": comp.competency_id, "gaps": targets},
        )
        state = self.evidence_by_comp[comp.competency_id]
        state.status = "COMPLETE_WITH_GAPS"
        await self._finalize_competency(comp)
        self.planner.mark_competency_done()
        nxt = await self._next_ask()
        return nxt or QuestionAsk(
            question_id=self._qid(),
            text="Is there anything else you would like to add before we wrap up?",
            track="informational",
            type="hr_screening",
        )

    def is_session_complete(self) -> bool:
        return self.final_report is not None or self.hard_rejected

    def generate_final_report(self) -> dict[str, Any]:
        if self.final_report:
            return self.final_report
        # finalize any open competency as gaps
        comp = self.planner.current_competency()
        # don't async finalize here if already mid-flight — mark gaps only
        decision = final_automated_decision(
            competency_results=self.evaluations,
            eligibility_captures=[
                c for c in self.screening_captures if c.category == "eligibility"
            ],
            alignments=list(self.alignments.values()),
            thresholds=self.config.score_thresholds,
            policy=self.config.decision_policy,
        )
        info_answers = [
            {
                "question_id": c.question_id,
                "category": c.category,
                "field": c.answer_field,
                "answer": c.raw_answer_final,
                "parsed_value": c.parsed_value,
            }
            for c in self.screening_captures
            if c.category in ("informational", "compensation", "background")
        ]
        eligibility = []
        for c in self.screening_captures:
            if c.category != "eligibility":
                continue
            rm = c.requirement_mapping or {}
            eligibility.append(
                {
                    "requirement_id": rm.get("requirement_id"),
                    "field": c.answer_field,
                    "status": rm.get("status") or "UNKNOWN",
                    "parsed_value": c.parsed_value,
                }
            )
        report = {
            "plan": self.planner.snapshot(),
            "weighted_competency_score": decision["weighted_competency_score"],
            "final_outcome": decision["final_outcome"],
            "platform_decision": decision["platform_decision"],
            "decision_inputs": decision["decision_inputs"],
            "competencies": [e.to_dict() for e in self.evaluations],
            "competency_evaluations": [e.to_dict() for e in self.evaluations],
            "evidence_states": {
                cid: st.to_dict() for cid, st in self.evidence_by_comp.items()
            },
            "eligibility": eligibility,
            "screening_assessment": {
                "eligibility": eligibility,
                "informational": info_answers,
            },
            "requirement_alignment": [a.to_dict() for a in self.alignments.values()],
            "requirement_alignments": [a.to_dict() for a in self.alignments.values()],
            "screening_answers": info_answers,
            "wrap_reason": "hard_reject"
            if self.hard_rejected
            else ("budget" if self.planner.over_budget() else "all_tracks_complete"),
            "turns": self.turns,
        }
        self.final_report = report
        emit_behavioural("final_report", report)
        return report
