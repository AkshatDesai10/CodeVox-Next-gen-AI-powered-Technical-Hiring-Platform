"""LiveKit room utilities for the voice interview agent."""
from __future__ import annotations

import asyncio
import logging
import os

from livekit import rtc
from livekit.api import AccessToken, VideoGrants

logger = logging.getLogger("livekit-speaker")

SAMPLE_RATE = 48_000
CANDIDATE_WAIT_SECONDS = int(os.getenv("VOICE_CANDIDATE_WAIT_SECONDS", "90"))


def _livekit_config() -> tuple[str, str, str]:
    url = os.getenv("LIVEKIT_URL", "ws://localhost:7880").strip()
    api_key = os.getenv("LIVEKIT_API_KEY", "devkey").strip()
    api_secret = os.getenv("LIVEKIT_API_SECRET", "devlocal_livekit_secret_minimum_32b").strip()
    return url, api_key, api_secret


def _agent_token(room_name: str, *, display_name: str = "Interview Agent") -> str:
    _, api_key, api_secret = _livekit_config()
    return (
        AccessToken(api_key, api_secret)
        .with_identity(f"agent-{room_name}")
        .with_name(display_name)
        .with_grants(
            VideoGrants(
                room_join=True,
                room=room_name,
                can_publish=True,
                can_subscribe=True,
            ),
        )
        .to_jwt()
    )


def _has_primary_participant(participants: dict[str, rtc.RemoteParticipant]) -> bool:
    return any(
        p.identity.startswith("candidate-") or p.identity.startswith("student-")
        for p in participants.values()
    )


async def _wait_for_primary_participant(room: rtc.Room, timeout_seconds: int) -> bool:
    if _has_primary_participant(room.remote_participants):
        logger.info("Primary participant already in room")
        return True

    joined = asyncio.Event()

    @room.on("participant_connected")
    def on_participant_connected(participant: rtc.RemoteParticipant) -> None:
        if participant.identity.startswith("candidate-") or participant.identity.startswith(
            "student-",
        ):
            logger.info("Primary participant joined room: %s", participant.identity)
            joined.set()

    try:
        await asyncio.wait_for(joined.wait(), timeout=timeout_seconds)
        return True
    except asyncio.TimeoutError:
        logger.warning("Timed out waiting for primary participant (%ss)", timeout_seconds)
        return False


def _is_screen_share_source(source: object) -> bool:
    return source == rtc.TrackSource.SOURCE_SCREENSHARE


def _candidate_has_screen_share(room: rtc.Room) -> bool:
    for participant in room.remote_participants.values():
        if not participant.identity.startswith("candidate-"):
            continue
        for publication in participant.track_publications.values():
            if _is_screen_share_source(publication.source):
                return True
    return False


async def wait_for_candidate_screen_share(room: rtc.Room, timeout_seconds: int = 120) -> bool:
    """Block the opening question until the candidate's screen-share track is published.

    Joining the room is not enough: the browser share dialog can take several
    seconds, and the first question must not play during that dialog.
    """
    if _candidate_has_screen_share(room):
        logger.info("Candidate screen share already published")
        return True

    shared = asyncio.Event()

    @room.on("track_published")
    def on_track_published(
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> None:
        if participant.identity.startswith("candidate-") and _is_screen_share_source(
            publication.source,
        ):
            logger.info("Candidate screen share published: %s", participant.identity)
            shared.set()

    if _candidate_has_screen_share(room):
        return True
    try:
        await asyncio.wait_for(shared.wait(), timeout=timeout_seconds)
        return True
    except asyncio.TimeoutError:
        logger.warning(
            "Timed out waiting for candidate screen share (%ss); opening anyway",
            timeout_seconds,
        )
        return False


async def _wait_for_candidate(room: rtc.Room, timeout_seconds: int) -> bool:
    """Backward-compatible alias for candidate interviews."""
    return await _wait_for_primary_participant(room, timeout_seconds)


def _has_candidate(participants: dict[str, rtc.RemoteParticipant]) -> bool:
    return any(p.identity.startswith("candidate-") for p in participants.values())
