"""Build & Defend — Build phase LiveKit agent.

Speaks a one-shot intro about the assessment time window, then stays in the room
(no conversation / STT loop) so screen-share Track Egress can continue.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

from livekit import rtc
from livekit.agents import Agent, AgentSession
from livekit.agents.utils import http_context
from livekit.agents.voice import room_io

from interview_agent_session import (
    _build_candidate_media,
    build_agent_session,
    connect_interview_room,
)
from livekit_speaker import wait_for_candidate_screen_share
from recording import (
    SessionRecorder,
    _is_build_video_recording_enabled,
    _is_recording_enabled,
    _start_agent_audio_egress,
    _wire_remote_track_events,
    stage_id_from_room,
)
from sarvam_media import sarvam_stt_sample_rate, sarvam_tts_sample_rate
from sarvam_stt_resilient import long_lived_http_session

logger = logging.getLogger("bnd-build.livekit")


_BUILD_COMPLETE_SCRIPT = (
    "Okay, you have now completed the assessment round. "
    "You will now be redirected to the interview round."
)


def _intro_script(hours: float | int | None, project_title: str | None, language: str | None = None) -> str:
    from prompts import speak_line

    return speak_line(
        "Welcome to the assessment round. We will now begin your assessment.",
        language,
    )


@dataclass
class BuildPhaseState:
    candidate_token: str
    intro_text: str
    completion_event: asyncio.Event = field(default_factory=asyncio.Event)
    speaking_done: asyncio.Event = field(default_factory=asyncio.Event)
    interview_language: str = "en-IN"
    intro_spoken: bool = False
    candidate_left: bool = False
    intentional_end: bool = False
    session_dropped: asyncio.Event = field(default_factory=asyncio.Event)
    session: AgentSession | None = None


class BuildPhaseAgent(Agent):
    def __init__(self, state: BuildPhaseState, *, http_session) -> None:
        stt, tts = _build_candidate_media(
            http_session=http_session,
            language_preference=state.interview_language,
        )
        super().__init__(
            instructions=(
                "You are a silent assessment host. Speak only the fixed welcome script "
                "when asked. Do not ask questions or continue a conversation."
            ),
            stt=stt,
            tts=tts,
        )
        self._state = state

    async def on_user_turn_completed(self, turn_ctx, new_message) -> None:  # type: ignore[override]
        # Ignore all candidate speech during Build — mic should be off anyway.
        return


async def run_bnd_build_session(
    room_name: str,
    candidate_token: str,
    *,
    project_build_payload: dict[str, Any] | None = None,
    candidate_name: str | None = None,
    candidate_id: str | None = None,
    language_preference: str | None = None,
) -> dict[str, Any]:
    payload = project_build_payload or {}
    hours = payload.get("max_assessment_hours")
    project = payload.get("project") if isinstance(payload.get("project"), dict) else {}
    title = str(project.get("title") or "") if isinstance(project, dict) else ""
    from prompts import normalize_interview_language

    spoken = normalize_interview_language(language_preference)
    intro = _intro_script(
        hours if isinstance(hours, (int, float)) else None,
        title or None,
        spoken,
    )

    # Stay for assessment window + buffer so egress keeps running after intro.
    try:
        hours_f = float(hours) if hours is not None else 4.0
    except (TypeError, ValueError):
        hours_f = 4.0
    stay_seconds = max(60.0, hours_f * 3600.0 + 300.0)

    state = BuildPhaseState(
        candidate_token=candidate_token,
        intro_text=intro,
        interview_language=spoken,
    )
    room: rtc.Room | None = None
    recorder: SessionRecorder | None = None
    try:
        room = await connect_interview_room(room_name)

        if _is_recording_enabled():
            recorder = SessionRecorder(
                room_name,
                candidate_token,
                stage_id=stage_id_from_room(room_name, candidate_token) or "bnd_assessment",
                candidate_name=candidate_name,
                candidate_id=candidate_id,
            )
            # Build-only: optional candidate camera → user_video (env-gated).
            _wire_remote_track_events(
                recorder,
                room,
                record_user_video=_is_build_video_recording_enabled(),
            )
            await _start_agent_audio_egress(recorder, room)

        async with long_lived_http_session() as http_session, http_context.open():
            def _wire_session(session: AgentSession) -> None:
                @session.on("agent_state_changed")
                def _on_agent_state(ev) -> None:
                    try:
                        new_state = getattr(ev, "new_state", None)
                        if new_state == "speaking":
                            session.input.set_audio_enabled(False)
                            state.speaking_done.clear()
                        elif new_state == "listening":
                            session.input.set_audio_enabled(False)
                            state.speaking_done.set()
                            if not state.intro_spoken:
                                state.intro_spoken = True
                    except Exception:
                        logger.debug("bnd_build agent_state toggle failed", exc_info=True)

                @session.on("close")
                def _on_close(_ev) -> None:
                    # A candidate refresh or a TTS glitch closes the session. That must not
                    # end the Build room — only an explicit leave or submit does.
                    if state.intentional_end:
                        state.completion_event.set()
                    else:
                        logger.warning(
                            "Build agent session closed unexpectedly token=%s; staying in the room",
                            candidate_token,
                        )
                        state.session_dropped.set()

            @room.on("participant_disconnected")
            def _on_participant_disconnected(participant: rtc.RemoteParticipant) -> None:
                # Refresh / network drop must not end Build or assign 0.
                if str(participant.identity).startswith("candidate-"):
                    logger.info(
                        "Build candidate disconnected (session kept) token=%s identity=%s",
                        candidate_token,
                        participant.identity,
                    )

            @room.on("participant_connected")
            def _on_participant_connected(participant: rtc.RemoteParticipant) -> None:
                if str(participant.identity).startswith("candidate-"):
                    logger.info(
                        "Build candidate rejoined token=%s identity=%s",
                        candidate_token,
                        participant.identity,
                    )

            @room.on("data_received")
            def _on_data_received(data_packet: rtc.DataPacket) -> None:
                try:
                    import json
                    payload = json.loads(data_packet.data.decode("utf-8"))
                    action = payload.get("action")
                    msg_type = payload.get("type")
                    # GitHub submitted → existing handoff into Defend.
                    if action == "end_build_phase":
                        async def _speak_and_finish():
                            try:
                                active = state.session
                                if active is not None:
                                    await active.say(_BUILD_COMPLETE_SCRIPT, allow_interruptions=False)
                                await asyncio.sleep(1.0)
                            except Exception:
                                logger.exception(
                                    "Build completion speech failed token=%s", candidate_token
                                )
                            finally:
                                state.intentional_end = True
                                state.completion_event.set()
                        asyncio.create_task(_speak_and_finish())
                        return
                    # Explicit Leave Build (no repo). Do not treat disconnect as this.
                    if msg_type == "end_interview":
                        if state.intentional_end or state.completion_event.is_set():
                            return
                        state.intentional_end = True

                        async def _leave_without_submission():
                            try:
                                from handoff import post_leave_build
                                await post_leave_build(candidate_token)
                            except Exception:
                                logger.exception(
                                    "leave-build callback failed token=%s", candidate_token
                                )
                            finally:
                                state.completion_event.set()

                        asyncio.create_task(_leave_without_submission())
                except Exception:
                    pass

            # Do not pin participant_identity. A screen-share republish drops and
            # rejoins the candidate; a pinned session treats that as the end of Build.
            room_options = room_io.RoomOptions(
                close_on_disconnect=False,
                audio_input=room_io.AudioInputOptions(
                    sample_rate=sarvam_stt_sample_rate(),
                    auto_gain_control=False,
                ),
                audio_output=room_io.AudioOutputOptions(sample_rate=sarvam_tts_sample_rate()),
            )
            deadline = asyncio.get_running_loop().time() + stay_seconds
            session: AgentSession | None = None
            unexpected_restarts = 0
            try:
                while not state.intentional_end and asyncio.get_running_loop().time() < deadline:
                    session = build_agent_session()
                    state.session = session
                    state.session_dropped.clear()
                    _wire_session(session)
                    agent = BuildPhaseAgent(state, http_session=http_session)
                    try:
                        await session.start(agent=agent, room=room, room_options=room_options)
                    except Exception:
                        logger.exception(
                            "Build agent failed to start token=%s; retrying",
                            candidate_token,
                        )
                        try:
                            await session.aclose()
                        except Exception:
                            pass
                        await asyncio.sleep(2)
                        continue
                    try:
                        session.input.set_audio_enabled(False)
                    except Exception:
                        pass
                    if not state.intro_spoken:
                        try:
                            await session.say(intro, allow_interruptions=False)
                            state.intro_spoken = True
                        except Exception:
                            logger.exception(
                                "Build intro TTS failed token=%s — staying in room for screen-share recording",
                                candidate_token,
                            )
                    remaining = deadline - asyncio.get_running_loop().time()
                    if remaining <= 0:
                        break
                    finished, pending = await asyncio.wait(
                        [
                            asyncio.create_task(state.completion_event.wait()),
                            asyncio.create_task(state.session_dropped.wait()),
                        ],
                        timeout=remaining,
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    for task in pending:
                        task.cancel()
                    if state.intentional_end or not finished:
                        break
                    unexpected_restarts += 1
                    if unexpected_restarts > 6:
                        logger.warning(
                            "Build agent stopped retrying after repeated session closes token=%s",
                            candidate_token,
                        )
                        break
                    logger.info("Restarting Build agent session token=%s", candidate_token)
                    try:
                        await session.aclose()
                    except Exception:
                        logger.debug("Build session aclose before restart failed", exc_info=True)
                    await asyncio.sleep(1)
            finally:
                if session is not None:
                    try:
                        await session.aclose()
                    except Exception:
                        logger.debug("Build session aclose failed", exc_info=True)
        return {"done": True, "intro_spoken": state.intro_spoken, "candidate_left": state.candidate_left}
    except Exception:
        logger.exception("Build phase session failed token=%s", candidate_token)
        return {"done": False, "intro_spoken": state.intro_spoken, "candidate_left": state.candidate_left}
    finally:
        if recorder is not None:
            try:
                await recorder.stop_all()
            except Exception:
                logger.exception("Build recorder stop failed token=%s", candidate_token)
        if room is not None:
            try:
                await room.disconnect()
            except Exception:
                pass
