"""Offline merge of per-track recordings into a single MP4 (or audio-only).

Usage
-----
Merge a single session::

    python merge_recordings.py --session SES_TOKEN

Batch-merge all un-merged sessions::

    python merge_recordings.py --batch

The script reads ``{prefix}/{session_id}/meta.json`` from local disk,
loads the individual track files, runs *ffmpeg* to combine them,
and writes the result as ``{prefix}/{session_id}/{timestamp}.mp4``.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("merge-recordings")

_RECORDING_PREFIX = (
    os.getenv("RECORDING_S3_PREFIX", "icloudemsapps/interview-recordings").strip().strip("/")
    or "icloudemsapps/interview-recordings"
)

# Force local-only storage (S3 upload paths removed).
os.environ.setdefault("RECORDING_STORAGE", "local")


# ---------------------------------------------------------------------------
# Local helpers
# ---------------------------------------------------------------------------


def _local_base() -> Path:
    return Path("local-recordings") / _RECORDING_PREFIX


def _public_api_base() -> str:
    return (
        os.getenv("PUBLIC_API_BASE_URL", "").strip()
        or f"http://localhost:{os.getenv('PORT', '4000').strip() or '4000'}"
    ).rstrip("/")


def _local_recording_url(key: str) -> str:
    clean = key.replace("\\", "/").lstrip("/")
    if clean.startswith("local-recordings/"):
        return f"{_public_api_base()}/{clean}"
    return f"{_public_api_base()}/local-recordings/{clean}"


# ---------------------------------------------------------------------------
# Meta loading
# ---------------------------------------------------------------------------


def _load_meta(session_id: str) -> tuple[dict[str, Any], str]:
    """Return (meta_dict, storage_mode)."""
    path = _local_base() / session_id / "meta.json"
    with open(path, encoding="utf-8") as f:
        return json.load(f), "local"


def _download_tracks(meta: dict[str, Any], workdir: Path) -> dict[str, list[tuple[Path, int]]]:
    """Copy all track files into *workdir*; return kind_label -> list of (path, ts)."""
    result: dict[str, list[tuple[Path, int]]] = {}
    for track in meta["tracks"]:
        kind = track["kind_label"]
        filepath = track["filepath"]
        start_ts = track.get("start_ts", 0)

        # Egress writes under local-recordings/{prefix}/... (filepath already includes prefix)
        parent = Path("local-recordings") / Path(filepath).parent
        stem = Path(filepath).name
        if parent.exists():
            for f in parent.iterdir():
                if f.name.startswith(stem):
                    local = workdir / f.name
                    shutil.copy2(f, local)
                    result.setdefault(kind, []).append((local, start_ts))
        else:
            logger.warning("Track directory missing for %s", filepath)

    return result


# ---------------------------------------------------------------------------
# ffmpeg merge
# ---------------------------------------------------------------------------

_CANVAS_W = 1280
_CANVAS_H = 720
_CANVAS_FPS = 15


def _media_span(path: Path) -> tuple[float, float]:
    """(start_time, duration) in seconds. Egress WebM has no stream duration, so read the container's."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=start_time,duration",
         "-of", "default=nw=1", str(path)],
        capture_output=True, text=True, timeout=60,
    ).stdout
    values = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)

    def _num(key: str) -> float:
        try:
            return max(0.0, float(values.get(key, "")))
        except ValueError:
            return 0.0

    return _num("start_time"), _num("duration")


def _merge(
    meta: dict[str, Any],
    tracks: dict[str, list[tuple[Path, int]]],
    workdir: Path,
) -> Path:
    """Build a merged MP4/M4A from the per-track files.

    Returns the path to the merged output.
    """
    all_ts = [ts for files in tracks.values() for _, ts in files]
    if not all_ts:
        raise ValueError("No track files to merge")
    earliest = min(all_ts)

    has_video = "screen_share" in tracks and len(tracks["screen_share"]) > 0
    output = workdir / ("final.mp4" if has_video else "final.m4a")

    # Collect audio inputs with offsets
    audio_inputs: list[tuple[Path, int]] = []  # (path, delay_ms)
    for kind in ("user_audio", "agent_audio", "screen_share_audio"):
        for path, ts in tracks.get(kind, []):
            audio_inputs.append((path, ts - earliest))

    if not audio_inputs and not has_video:
        raise ValueError("No audio or video tracks to merge")

    cmd: list[str] = ["ffmpeg", "-y"]

    # --- Video inputs ---
    video_entries = sorted(tracks.get("screen_share", []), key=lambda x: x[1])
    for path, _ in video_entries:
        # Screen shares change resolution mid-track (simulcast layers); rebuilding the filter
        # graph on each change would reset setpts/tpad and wreck the timeline.
        cmd.extend(["-reinit_filter", "0", "-i", str(path)])

    # --- Audio inputs ---
    for path, _ in audio_inputs:
        cmd.extend(["-i", str(path)])

    filter_parts: list[str] = []
    input_idx = 0

    # --- Video filter ---
    if has_video:
        if len(video_entries) == 1:
            # Single screen share
            delay_ms = video_entries[0][1] - earliest
            v_label = f"[{input_idx}:v]"
            filter_parts.append(
                f"{v_label}scale=1280:-2,setpts=PTS+{delay_ms / 1000:.3f}/TB[vout]"
            )
            input_idx += 1
        elif audio_inputs:
            # Multiple screen-share segments (candidate rejoined after a drop). Lay them on a
            # timeline at their real offsets with black fill before, between and after them,
            # so the offline gap stays visible and the video stays in sync with the audio.
            audio_end = max(
                delay_ms / 1000.0 + _media_span(path)[1] for path, delay_ms in audio_inputs
            )
            cursor = 0.0
            seg_labels = []
            for i, (path, ts) in enumerate(video_entries):
                start_time, duration = _media_span(path)
                seg_start = max(cursor, (ts - earliest) / 1000.0 + start_time)
                gap = seg_start - cursor
                tail = 0.0
                if i == len(video_entries) - 1:
                    tail = max(0.0, audio_end - (seg_start + duration))
                filter_parts.append(
                    f"[{input_idx}:v]setpts=PTS-STARTPTS,fps={_CANVAS_FPS},"
                    f"scale={_CANVAS_W}:{_CANVAS_H}:force_original_aspect_ratio=decrease,"
                    f"pad={_CANVAS_W}:{_CANVAS_H}:(ow-iw)/2:(oh-ih)/2,setsar=1,"
                    f"tpad=start_duration={gap:.3f}:stop_duration={tail:.3f}:color=black"
                    f"[v_seg{i}]"
                )
                seg_labels.append(f"[v_seg{i}]")
                cursor = seg_start + duration
                input_idx += 1
            filter_parts.append(
                f"{''.join(seg_labels)}concat=n={len(seg_labels)}:v=1:a=0[vout]"
            )
        else:
            # Multiple screen share segments, no audio — concat back to back
            seg_labels = []
            for i, (path, ts) in enumerate(video_entries):
                v_label = f"[{input_idx}:v]"
                delay_s = (ts - earliest) / 1000.0
                seg = f"v_seg{i}"
                filter_parts.append(
                    f"{v_label}scale=1280:-2,setpts=PTS+{delay_s}/TB[{seg}]"
                )
                seg_labels.append(f"[{seg}]")
                input_idx += 1
            concat_in = "".join(seg_labels)
            filter_parts.append(
                f"{concat_in}concat=n={len(seg_labels)}:v=1:a=0[vout]"
            )

    # --- Audio filter ---
    if audio_inputs:
        a_labels = []
        for i, (path, delay_ms) in enumerate(audio_inputs):
            idx = input_idx
            input_idx += 1
            a_label = f"a{i}"
            if delay_ms > 0:
                filter_parts.append(
                    f"[{idx}:a]adelay={delay_ms}|{delay_ms}[{a_label}]"
                )
            else:
                filter_parts.append(f"[{idx}:a]acopy[{a_label}]")
            a_labels.append(f"[{a_label}]")

        if len(a_labels) == 1:
            filter_parts.append(f"{a_labels[0]}acopy[aout]")
        else:
            mix_in = "".join(a_labels)
            filter_parts.append(
                f"{mix_in}amix=inputs={len(a_labels)}:duration=longest[aout]"
            )

    # Build filter_complex
    filter_complex = ";".join(filter_parts)
    cmd.extend(["-filter_complex", filter_complex])

    if has_video:
        cmd.extend([
            "-map", "[vout]",
            "-c:v", "libx264", "-crf", "28", "-preset", "veryfast",
            "-vsync", "cfr", "-r", "15",
        ])

    if audio_inputs:
        cmd.extend(["-map", "[aout]", "-c:a", "aac", "-b:a", "128k"])

    cmd.append(str(output))

    logger.info("Running ffmpeg: %s", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        logger.error("ffmpeg stderr: %s", result.stderr)
        raise RuntimeError(f"ffmpeg failed with code {result.returncode}")

    logger.info("Merged output: %s (%.1f MB)", output, output.stat().st_size / 1e6)
    return output


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def _notify_backend(
    meta: dict[str, Any],
    session_id: str,
    dest_key: str,
) -> None:
    """POST merged recording URL + raw track URLs to the Nest API."""
    api_url = os.getenv("BACKEND_API_URL", "http://host.docker.internal:4000")
    service_key = os.getenv("AUTONOMOUS_INTERVIEW_SERVICE_KEY", "dev_service_key")
    candidate_token = str(meta.get("session_id") or session_id)
    stage_id = meta.get("stage_id")
    if not stage_id:
        room = str(meta.get("room_name") or session_id)
        prefix = f"{candidate_token}_"
        if room.startswith(prefix):
            stage_id = room[len(prefix):]

    raw_tracks_payload = []
    for t in meta.get("tracks", []):
        if "filepath" in t and "kind_label" in t:
            raw_tracks_payload.append({
                "kind": t["kind_label"],
                "url": _local_recording_url(t["filepath"]),
            })

    recording_url = _local_recording_url(dest_key)
    try:
        import httpx

        resp = httpx.post(
            f"{api_url}/api/autonomous-interview/session/{candidate_token}/merged-recording",
            json={
                "recordingUrl": recording_url,
                "stage_id": stage_id,
                "tracks": raw_tracks_payload,
            },
            headers={"x-service-key": service_key},
            timeout=10.0,
        )
        resp.raise_for_status()
        logger.info(
            "Saved recording URL and tracks to database token=%s stage_id=%s",
            candidate_token,
            stage_id,
        )
    except Exception as e:
        logger.error("Failed to save recording URL to database: %s", e)


def merge_session(session_id: str) -> None:
    """Load tracks, merge, save result locally, update meta.

    ``session_id`` here is the recording folder key (usually the LiveKit room
    name, e.g. ``ses_123_ai_screening``). Meta still carries the candidate
    token as ``session_id`` for the backend API callback.
    """
    logger.info("Processing session: %s", session_id)
    meta, _storage = _load_meta(session_id)
    if meta.get("merged"):
        logger.info("Session %s already merged — skipping", session_id)
        return

    with tempfile.TemporaryDirectory(prefix=f"merge_{session_id}_") as tmpdir:
        workdir = Path(tmpdir)
        tracks = _download_tracks(meta, workdir)
        if not tracks:
            logger.warning("No track files found for session %s", session_id)
            return

        output = _merge(meta, tracks, workdir)

        ext = output.suffix  # .mp4 or .m4a
        stamp = int(time.time() * 1000)
        local_dest = _local_base() / session_id / f"{stamp}{ext}"
        local_dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(output, local_dest)
        # Also keep a stable final* name for convenience
        final_copy = _local_base() / session_id / f"final{ext}"
        shutil.copy2(output, final_copy)
        logger.info("Merged file saved to %s", local_dest)

        dest_key = f"{_RECORDING_PREFIX}/{session_id}/{local_dest.name}"
        _notify_backend(meta, session_id, dest_key)

        # Mark meta as merged
        meta["merged"] = True
        meta["merged_key"] = dest_key
        meta["storage"] = "local"
        meta_path = _local_base() / session_id / "meta.json"
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)

    logger.info("Session %s merged successfully", session_id)


def batch_merge() -> None:
    """Process all sessions that have not been merged yet."""
    base = _local_base()
    if not base.exists():
        logger.info("No local recordings directory found")
        return
    session_ids = [
        d.name for d in base.iterdir() if d.is_dir() and (d / "meta.json").exists()
    ]

    logger.info("Found %d sessions to check", len(session_ids))
    for sid in session_ids:
        try:
            merge_session(sid)
        except Exception:
            logger.exception("Failed to merge session %s", sid)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> None:
    """CLI entry point for merge_recordings."""
    parser = argparse.ArgumentParser(description="Merge per-track recordings into a single file")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--session", help="Merge a single session by ID")
    group.add_argument("--batch", action="store_true", help="Merge all un-merged sessions")
    args = parser.parse_args()

    if args.session:
        merge_session(args.session)
    else:
        batch_merge()


if __name__ == "__main__":
    main()
