"""LiveKit session runner for AI Behavioural interviews."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from behavioural.orchestrator import BehaviouralOrchestrator
from behavioural.schemas import BehaviouralRoundConfig
from interview_agent_session import connect_interview_room
from livekit import rtc
from livekit.agents import Agent, AgentSession, AutoSubscribe, JobContext, WorkerOptions, cli
from provider_resilience import ResilientLlmClient, build_provider_chain

logger = logging.getLogger("behavioural.session")


@dataclass
class BehaviouralInterviewResult:
    done: bool
    chat_history: list[dict[str, Any]] = field(default_factory=list)
    audit: dict[str, Any] | None = None


async def run_behavioural_interview(
    room_name: str,
    candidate_token: str,
    *,
    round_config: dict[str, Any] | None = None,
    rubric_criteria: list[dict] | None = None,
    job_profile_context: dict | None = None,
    candidate_name: str | None = None,
) -> BehaviouralInterviewResult:
    """
    Run behavioural orchestrator inside a LiveKit room.

    Speaks opening via room data / agent session; processes user transcripts
    through BehaviouralOrchestrator.handle_answer.
    """
    cfg = BehaviouralRoundConfig.from_payload(round_config, rubric_criteria)
    if not cfg.competencies and not cfg.screening_questions:
        logger.error("AI Behavioural session has empty config token=%s", candidate_token)
        return BehaviouralInterviewResult(done=False)

    ctx = job_profile_context or {}
    orch = BehaviouralOrchestrator(
        config=cfg,
        job_title=str(ctx.get("title") or "") or None,
        resume_projects=str(ctx.get("resume_projects") or "") or None,
        client=ResilientLlmClient(build_provider_chain()),
    )

    room: rtc.Room | None = None
    history: list[dict[str, Any]] = []
    try:
        room = await connect_interview_room(room_name)
        opening = await orch.get_opening_utterance()
        if opening.speak:
            history.append({"role": "assistant", "content": opening.speak})
            await _publish_agent_text(room, opening.speak)

        # Poll data channel / transcription events — lightweight participant wait loop
        # For production voice, STT arrives via LiveKit agents; we also accept text
        # payloads on the "behavioural_answer" topic for harness/testing.
        done = opening.complete
        if done:
            audit = orch.generate_final_report()
            return BehaviouralInterviewResult(done=True, chat_history=history, audit=audit)

        @room.on("data_received")
        def _on_data(data: rtc.DataPacket) -> None:
            try:
                import asyncio
                import json

                payload = json.loads(data.data.decode("utf-8"))
                if payload.get("type") != "behavioural_answer":
                    return
                text = str(payload.get("text") or "").strip()
                if not text:
                    return

                async def _handle() -> None:
                    nonlocal done
                    history.append({"role": "user", "content": text})
                    step = await orch.handle_answer(text, payload.get("stt_confidence"))
                    if step.speak:
                        history.append({"role": "assistant", "content": step.speak})
                        await _publish_agent_text(room, step.speak)
                    if step.complete:
                        done = True

                asyncio.create_task(_handle())
            except Exception:
                logger.exception("behavioural data handler failed")

        # Wait until complete or timeout (duration limit handled inside orchestrator)
        import asyncio

        deadline = asyncio.get_event_loop().time() + cfg.interview_limits.max_duration_minutes * 60 + 120
        while not done and asyncio.get_event_loop().time() < deadline:
            await asyncio.sleep(0.5)
            if orch.is_session_complete():
                done = True

        audit = orch.generate_final_report()
        return BehaviouralInterviewResult(done=True, chat_history=history, audit=audit)
    except Exception:
        logger.exception("Behavioural interview failed token=%s", candidate_token)
        return BehaviouralInterviewResult(
            done=False,
            chat_history=history,
            audit=orch.final_report,
        )
    finally:
        if room is not None:
            await room.disconnect()


async def _publish_agent_text(room: rtc.Room, text: str) -> None:
    import json

    payload = json.dumps({"type": "behavioural_speak", "text": text}).encode("utf-8")
    await room.local_participant.publish_data(payload, reliable=True)


async def run_behavioural_text_session(
    *,
    round_config: dict[str, Any] | None,
    rubric_criteria: list[dict] | None,
    job_profile_context: dict | None = None,
    answers: list[str],
) -> dict[str, Any]:
    """Deterministic harness helper — no LiveKit."""
    cfg = BehaviouralRoundConfig.from_payload(round_config, rubric_criteria)
    orch = BehaviouralOrchestrator(
        config=cfg,
        job_title=str((job_profile_context or {}).get("title") or "") or None,
        resume_projects=str((job_profile_context or {}).get("resume_projects") or "") or None,
        client=ResilientLlmClient(build_provider_chain()),
    )
    opening = await orch.get_opening_utterance()
    history = [{"role": "assistant", "content": opening.speak}]
    if opening.complete:
        return {"chat_history": history, "audit": orch.generate_final_report()}
    for ans in answers:
        history.append({"role": "user", "content": ans})
        step = await orch.handle_answer(ans)
        if step.speak:
            history.append({"role": "assistant", "content": step.speak})
        if step.complete:
            break
    return {"chat_history": history, "audit": orch.generate_final_report()}
