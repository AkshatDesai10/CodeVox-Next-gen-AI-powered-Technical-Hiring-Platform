import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from analyze_submission import analyze_submission
from chat_turn import run_chat_turn
from llm_engine import validate_voice_keys
from voice_agent import run_voice_agent

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voice-engine")

_active_tasks: dict[str, asyncio.Task] = {}


def _validate_agent_keys() -> None:
    try:
        validate_voice_keys()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _validate_llm_keys() -> None:
    from provider_resilience import resolve_llm_config

    try:
        resolve_llm_config()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


class StartAgentRequest(BaseModel):
    token: str
    room_name: str
    phase: Literal["intro_verbal", "ai_verbal", "hr_verbal", "ai_screening", "bnd_assessment", "bnd_interview"] = "ai_verbal"
    session_type: str = "candidate_interview"
    tech_stack: str | None = None
    resume_skills: list[str] = Field(default_factory=list)
    candidate_name: str | None = None
    candidate_id: str | None = None
    application_id: str | None = None
    question_mode: str | None = None
    language_preference: str | None = None
    panel_mode: str | None = None
    question_bank: list[dict] = Field(default_factory=list)
    sarvam_llm_model: str | None = None
    max_turns: int | None = None
    resume: bool = False
    resume_snapshot: dict | None = None
    rubric_criteria: list[dict] = Field(default_factory=list)
    reconnect_grace_sec: int | None = None
    job_profile_context: dict | None = None
    engine: Literal["technical", "behavioral", "screening", "bnd_build"] | None = None
    round_config: dict | None = None
    take_home_verification_enabled: bool = False
    take_home_weight_pct: float = 0.0
    take_home_payload: dict | None = None
    project_interview_payload: dict | None = None
    project_build_payload: dict | None = None
    round_type: str | None = None


class AnalyzeSubmissionRequest(BaseModel):
    token: str
    source_code: str
    language: str = "PYTHON"


class ChatTurnRequest(BaseModel):
    tech_stack: str = "Python"
    phase: Literal["intro_verbal", "hr_verbal"] = "intro_verbal"
    message: str = ""
    chat_history: list[dict] = Field(default_factory=list)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("Voice engine ready on port %s", os.getenv("PORT", "8001"))
    logger.info("VERSION MARKER: AI_SCREENING PHASE+ENGINE ACCEPTED (2026-09-22)")
    yield
    for task in list(_active_tasks.values()):
        task.cancel()


app = FastAPI(title="Assessment Voice Engine", version="1.0.0", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "voice-engine"}


@app.post("/api/v1/voice/start-agent")
async def start_agent(body: StartAgentRequest):
    if not body.token.strip():
        raise HTTPException(status_code=400, detail="token required")

    logger.info(
        "START_AGENT phase=%s engine=%s session_type=%s job_profile_title=%s job_profile_seniority=%s rubric_count=%s",
        body.phase,
        body.engine,
        body.session_type,
        (body.job_profile_context or {}).get("title") if isinstance(body.job_profile_context, dict) else None,
        (body.job_profile_context or {}).get("seniority_level") if isinstance(body.job_profile_context, dict) else None,
        len(body.rubric_criteria or []),
    )
    logger.debug(
        "START_AGENT_DEBUG token=%s room=%s tech_stack=%s candidate_name=%s resume_skills=%s",
        body.token.strip(),
        body.room_name.strip(),
        body.tech_stack,
        body.candidate_name,
        body.resume_skills[:12],
    )

    _validate_agent_keys()

    token = body.token.strip()
    if body.resume:
        prior = _active_tasks.get(token)
        if prior and not prior.done():
            return {"accepted": True, "token": token, "resumed": True}

    prior = _active_tasks.pop(token, None)
    if prior and not prior.done():
        prior.cancel()

    task = asyncio.create_task(
        run_voice_agent(
            {
                "token": token,
                "room_name": body.room_name.strip(),
                "phase": body.phase,
                "engine": body.engine,
                "round_config": body.round_config,
                "session_type": body.session_type,
                "tech_stack": body.tech_stack,
                "resume_skills": body.resume_skills,
                "candidate_name": body.candidate_name,
                "candidate_id": body.candidate_id or body.application_id,
                "application_id": body.application_id or body.candidate_id,
                "question_mode": body.question_mode,
                "language_preference": body.language_preference,
                "panel_mode": body.panel_mode,
                "question_bank": body.question_bank,
                "sarvam_llm_model": body.sarvam_llm_model,
                "max_turns": body.max_turns,
                "resume_snapshot": body.resume_snapshot,
                "rubric_criteria": body.rubric_criteria,
                "reconnect_grace_sec": body.reconnect_grace_sec,
                "job_profile_context": body.job_profile_context,
                "take_home_verification_enabled": body.take_home_verification_enabled,
                "take_home_weight_pct": body.take_home_weight_pct,
                "take_home_payload": body.take_home_payload,
                "project_interview_payload": body.project_interview_payload,
                "project_build_payload": body.project_build_payload,
                "round_type": body.round_type,
            },
        ),
    )
    _active_tasks[token] = task

    def _cleanup(t: asyncio.Task) -> None:
        if _active_tasks.get(token) is t:
            _active_tasks.pop(token, None)

    task.add_done_callback(_cleanup)
    return {"accepted": True, "token": token, "resumed": False}


@app.get("/api/v1/voice/active-agent/{token}")
async def active_agent(token: str):
    task = _active_tasks.get(token.strip())
    active = task is not None and not task.done()
    return {"active": active, "token": token.strip()}


@app.post("/api/v1/voice/chat-turn")
async def chat_turn(body: ChatTurnRequest):
    _validate_llm_keys()
    try:
        return await run_chat_turn(
            tech_stack=body.tech_stack,
            phase=body.phase,
            message=body.message,
            chat_history=body.chat_history,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/v1/analyze-submission")
async def analyze_submission_route(body: AnalyzeSubmissionRequest):
    result = await analyze_submission(body.source_code, body.language)
    return {"token": body.token, **result}

from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    logger.error(f"Validation Error Details: {exc}")
    return JSONResponse(status_code=422, content={"detail": exc.errors(), "body": exc.body})
