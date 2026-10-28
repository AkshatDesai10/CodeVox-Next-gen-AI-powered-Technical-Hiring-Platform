"""Per-track LiveKit egress recorder — replaces Room Composite Egress.

Starts a separate Track Egress for each media track (user_audio, agent_audio,
screen_share, screen_share_audio, and optionally Build-only user_video) and
writes each to local disk as an individual file.  A ``meta.json`` per
session stores the mapping so that ``merge_recordings.py`` can stitch them offline.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from typing import Any

from livekit import api as lkapi
from livekit import rtc

logger = logging.getLogger("track-recorder")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_RECORDING_MODE = os.getenv("RECORDING_MODE", "track").strip().lower()
# Local layout: local-recordings/uploads/interview-recordings/{name-id-stage}/{ts}_{kind}.ext
_RECORDING_PREFIX = (
    os.getenv("RECORDING_S3_PREFIX", "uploads/interview-recordings").strip().strip("/")
    or "uploads/interview-recordings"
)


def _is_recording_enabled() -> bool:
    """Return True when track recording is turned on."""
    return _RECORDING_MODE == "track"


def _is_build_video_recording_enabled() -> bool:
    """Build-phase candidate camera (SOURCE_CAMERA → user_video) only.

    Controlled by BUILD_VIDEO_RECORDING_ENABLED. Default off so other rounds
    and existing Build audio/screen-share behavior stay unchanged.
    """
    return os.getenv("BUILD_VIDEO_RECORDING_ENABLED", "false").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def stage_id_from_room(room_name: str, candidate_token: str) -> str | None:
    """Derive round_type from `{token}_{round_type}` room names."""
    prefix = f"{candidate_token}_"
    if room_name.startswith(prefix) and len(room_name) > len(prefix):
        return room_name[len(prefix):]
    return None


def _slug_part(value: str | None, *, max_len: int) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", (value or "").strip().lower()).strip("-")
    return cleaned[:max_len]


def build_recording_folder(
    *,
    candidate_name: str | None,
    candidate_id: str | None,
    stage_id: str | None,
    fallback: str,
) -> str:
    """Viva-style folder: ``{name}-{id}-{stage}`` (no ses_ token in the path)."""
    name = _slug_part(candidate_name, max_len=40) or "candidate"
    cid = _slug_part(candidate_id, max_len=32)
    stage = _slug_part(stage_id, max_len=32) or "interview"
    parts = [name]
    if cid:
        parts.append(cid)
    parts.append(stage)
    folder = "-".join(parts)[:96]
    return folder or _slug_part(fallback, max_len=80) or "session"


def _lk_api() -> lkapi.LiveKitAPI:
    """Construct a LiveKitAPI handle from env."""
    url = os.getenv("LIVEKIT_URL", "ws://localhost:7880").strip()
    http_url = url.replace("ws://", "http://").replace("wss://", "https://")
    api_key = os.getenv("LIVEKIT_API_KEY", "devkey").strip()
    api_secret = os.getenv("LIVEKIT_API_SECRET", "devlocal_livekit_secret_minimum_32b").strip()
    return lkapi.LiveKitAPI(url=http_url, api_key=api_key, api_secret=api_secret)


# ---------------------------------------------------------------------------
# SessionRecorder
# ---------------------------------------------------------------------------


class SessionRecorder:
    """Manage per-track egresses for a single interview session.

    Parameters
    ----------
    room_name:
        LiveKit room name (also used as the local recording folder so each
        round keeps an isolated ``meta.json`` / track set).
    session_id:
        Candidate token — used when posting the merged URL back to the API.
    stage_id:
        Round type (``ai_screening``, ``bnd_interview``, …) stored in meta and
        sent with the merged-recording callback.
    """

    def __init__(
        self,
        room_name: str,
        session_id: str,
        stage_id: str | None = None,
        *,
        candidate_name: str | None = None,
        candidate_id: str | None = None,
        recording_folder: str | None = None,
    ) -> None:
        self.room_name = room_name
        self.session_id = session_id
        self.stage_id = stage_id
        # Human-readable folder (name-id-stage), not the LiveKit ses_ room name.
        self.recording_key = (
            (recording_folder or "").strip().strip("/")
            or build_recording_folder(
                candidate_name=candidate_name,
                candidate_id=candidate_id,
                stage_id=stage_id,
                fallback=room_name,
            )
        )
        # egress_id -> metadata dict
        self._active: dict[str, dict[str, Any]] = {}
        # track_sid -> egress_id  (guard against double-start)
        self._track_to_egress: dict[str, str] = {}
        # counter per kind_label for file-name disambiguation
        self._kind_counter: dict[str, int] = {}
        self._meta_tracks: list[dict[str, Any]] = []
        # Serialize starts so publish+subscribe cannot race two screen egresses.
        self._start_lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def start_track(
        self,
        track_sid: str,
        kind_label: str,
        *,
        alias_sids: list[str] | None = None,
    ) -> str | None:
        """Start a Track Egress for *track_sid* and return the egress_id.

        ``kind_label`` is one of: ``user_audio``, ``agent_audio``,
        ``screen_share``, ``screen_share_audio``, or Build-only ``user_video``.
        Returns ``None`` if recording is disabled or the egress call fails.

        ``alias_sids`` maps alternate LiveKit ids (publication.sid vs track.sid)
        so publish+subscribe handlers do not start two egresses for one share.
        """
        if not _is_recording_enabled():
            return None

        aliases = [sid for sid in [track_sid, *(alias_sids or [])] if sid]
        async with self._start_lock:
            for sid in aliases:
                if sid in self._track_to_egress:
                    logger.info(
                        "Track egress already active session=%s track=%s egress=%s — skipping",
                        self.session_id,
                        sid,
                        self._track_to_egress[sid],
                    )
                    return self._track_to_egress[sid]

            # Browsers / forced-share re-publish can emit two SOURCE_SCREENSHARE tracks
            # within the same second. Keep a single screen-video egress per session.
            if kind_label == "screen_share":
                for egress_id, meta in self._active.items():
                    if meta.get("kind_label") == "screen_share":
                        logger.info(
                            "Screen share egress already active session=%s existing=%s — skipping track=%s",
                            self.session_id,
                            egress_id,
                            track_sid,
                        )
                        for sid in aliases:
                            self._track_to_egress[sid] = egress_id
                        return egress_id

            # Build file path
            count = self._kind_counter.get(kind_label, 0)
            self._kind_counter[kind_label] = count + 1
            ts_ms = int(time.time() * 1000)
            # Local key: {prefix}/{sessionFolder}/{timestamp}_{kind}
            # LiveKit appends the codec extension (.ogg / .webm / .mp4).
            filepath = (
                f"{_RECORDING_PREFIX}/{self.recording_key}/"
                f"{ts_ms}_{kind_label}"
            )

            try:
                lk = _lk_api()
                # Local disk via the egress container's /out mount
                file_output = lkapi.DirectFileOutput(
                    filepath=f"/out/{filepath}",
                )

                req = lkapi.TrackEgressRequest(
                    room_name=self.room_name,
                    track_id=track_sid,
                    file=file_output,
                )
                info = await lk.egress.start_track_egress(req)
                egress_id = info.egress_id

                self._active[egress_id] = {
                    "track_sid": track_sid,
                    "kind_label": kind_label,
                    "filepath": filepath,
                    "start_ts": ts_ms,
                }
                for sid in aliases:
                    self._track_to_egress[sid] = egress_id
                self._meta_tracks.append(
                    {
                        "track_sid": track_sid,
                        "kind_label": kind_label,
                        "egress_id": egress_id,
                        "start_ts": ts_ms,
                        "filepath": filepath,
                    }
                )

                logger.info(
                    "Track egress STARTED session=%s track=%s kind=%s egress=%s path=%s",
                    self.session_id,
                    track_sid,
                    kind_label,
                    egress_id,
                    filepath,
                )
                return egress_id

            except Exception:
                logger.exception(
                    "Track egress start FAILED session=%s track=%s kind=%s",
                    self.session_id,
                    track_sid,
                    kind_label,
                )
                return None

    async def stop_track(self, track_sid: str) -> None:
        """Stop the egress associated with *track_sid*, if any."""
        egress_id = self._track_to_egress.get(track_sid)
        if egress_id is None:
            return
        # Drop every alias (publication.sid + track.sid) pointing at this egress.
        for sid, eid in list(self._track_to_egress.items()):
            if eid == egress_id:
                self._track_to_egress.pop(sid, None)
        await self._stop_egress(egress_id)

    async def stop_all(self) -> None:
        """Stop every active egress for this session (best-effort)."""
        for egress_id in list(self._active.keys()):
            await self._stop_egress(egress_id)
        self._track_to_egress.clear()
        self._save_meta()

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    async def _stop_egress(self, egress_id: str) -> None:
        try:
            lk = _lk_api()
            await lk.egress.stop_egress(lkapi.StopEgressRequest(egress_id=egress_id))
            logger.info(
                "Track egress STOPPED session=%s egress=%s",
                self.session_id,
                egress_id,
            )
        except Exception:
            logger.exception(
                "Track egress stop FAILED session=%s egress=%s",
                self.session_id,
                egress_id,
            )
        finally:
            self._active.pop(egress_id, None)

    def _save_meta(self) -> None:
        """Persist ``meta.json`` alongside the track files on local disk."""
        meta = {
            "session_id": self.session_id,
            "recording_key": self.recording_key,
            "room_name": self.room_name,
            "stage_id": self.stage_id,
            "tracks": self._meta_tracks,
            "merged": False,
            "storage": "local",
        }
        local_dir = os.path.join(
            "local-recordings", _RECORDING_PREFIX, self.recording_key
        )
        os.makedirs(local_dir, exist_ok=True)
        path = os.path.join(local_dir, "meta.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(meta, fh, indent=2)
        logger.info("meta.json saved to %s", path)

# ---------------------------------------------------------------------------
# Track-recording room helpers
# ---------------------------------------------------------------------------


async def _start_agent_audio_egress(
    recorder: SessionRecorder,
    room: rtc.Room,
    *,
    max_wait: float = 10.0,
) -> None:
    """Subscribe to the local participant's audio track and start egress for it."""
    for pub in room.local_participant.track_publications.values():
        if pub.track and pub.source == rtc.TrackSource.SOURCE_MICROPHONE:
            asyncio.ensure_future(recorder.start_track(pub.track.sid, "agent_audio"))
            return

    @room.on("local_track_published")
    def _on_local_pub(pub: rtc.LocalTrackPublication) -> None:
        if pub.source == rtc.TrackSource.SOURCE_MICROPHONE:
            sid = pub.track.sid if pub.track else pub.sid
            asyncio.ensure_future(_safe_start_track(recorder, sid, "agent_audio"))


def _wire_remote_track_events(
    recorder: SessionRecorder,
    room: rtc.Room,
    *,
    record_user_video: bool = False,
) -> None:
    """Subscribe to room events to start/stop egress for remote participant tracks.

    ``record_user_video`` is Build-only (candidate camera → ``user_video``). Other
    rounds must leave it False so AI Screening / Defend / etc. stay unchanged.
    """

    def _start_for_pub(
        pub: rtc.RemoteTrackPublication,
        identity: str,
        track: rtc.Track | None = None,
        *,
        allow_without_track: bool = True,
    ) -> None:
        if not identity.startswith(("candidate-", "student-")):
            return

        kind_label: str | None = None
        if pub.source == rtc.TrackSource.SOURCE_MICROPHONE:
            kind_label = "user_audio"
        elif pub.source == rtc.TrackSource.SOURCE_SCREENSHARE:
            kind_label = "screen_share"
        elif pub.source == rtc.TrackSource.SOURCE_SCREENSHARE_AUDIO:
            kind_label = "screen_share_audio"
        elif pub.source == rtc.TrackSource.SOURCE_CAMERA and record_user_video:
            kind_label = "user_video"

        if not kind_label:
            return

        pub_sid = getattr(pub, "sid", None) or ""
        track_sid = None
        if track is not None and getattr(track, "sid", None):
            track_sid = track.sid
        elif pub.track is not None and getattr(pub.track, "sid", None):
            track_sid = pub.track.sid

        # Screen share / camera: wait for the media track sid when possible.
        # Publishing with publication.sid and again on subscribe with track.sid
        # caused duplicate rows in interview_recordings.
        if kind_label in ("screen_share", "screen_share_audio", "user_video") and not track_sid:
            if not allow_without_track:
                return

        egress_track_id = track_sid or pub_sid
        if not egress_track_id:
            return
        aliases = [sid for sid in {pub_sid, track_sid} if sid]
        asyncio.ensure_future(
            _safe_start_track(recorder, egress_track_id, kind_label, aliases)
        )

    # Catch tracks that were already published before agent joined
    for participant in room.remote_participants.values():
        for pub in participant.track_publications.values():
            _start_for_pub(pub, participant.identity)

    @room.on("track_published")
    def _on_track_published(
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> None:
        # Prefer track_subscribed (stable track.sid) for video sources.
        if publication.source in (
            rtc.TrackSource.SOURCE_SCREENSHARE,
            rtc.TrackSource.SOURCE_SCREENSHARE_AUDIO,
            rtc.TrackSource.SOURCE_CAMERA,
        ):
            _start_for_pub(
                publication,
                participant.identity,
                allow_without_track=False,
            )
            return
        _start_for_pub(publication, participant.identity)

    @room.on("track_subscribed")
    def _on_track_subscribed(
        track: rtc.Track,
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> None:
        # Screen share often becomes egress-ready only after subscribe.
        _start_for_pub(publication, participant.identity, track=track)

    @room.on("track_unpublished")
    def _on_track_unpublished(
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> None:
        pub_sid = getattr(publication, "sid", None) or ""
        track_sid = publication.track.sid if publication.track else ""
        for sid in {pub_sid, track_sid}:
            if sid:
                asyncio.ensure_future(_safe_stop_track(recorder, sid))


async def _safe_start_track(
    recorder: SessionRecorder,
    track_sid: str,
    kind_label: str,
    alias_sids: list[str] | None = None,
) -> None:
    """Start egress, swallowing errors to never crash the agent."""
    try:
        await recorder.start_track(track_sid, kind_label, alias_sids=alias_sids)
    except Exception:
        logger.exception(
            "Failed to start track egress session=%s track=%s kind=%s",
            recorder.session_id,
            track_sid,
            kind_label,
        )


async def _safe_stop_track(recorder: SessionRecorder, track_sid: str) -> None:
    """Stop egress, swallowing errors to never crash the agent."""
    try:
        await recorder.stop_track(track_sid)
    except Exception:
        logger.exception(
            "Failed to stop track egress session=%s track=%s",
            recorder.session_id,
            track_sid,
        )

