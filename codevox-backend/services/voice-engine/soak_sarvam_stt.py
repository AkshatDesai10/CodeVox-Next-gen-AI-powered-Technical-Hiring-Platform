"""Hold a Sarvam STT WebSocket for >3 minutes with idle gaps (TTS-like mute).

Simulates the interview pattern: send audio, then go silent while the agent
speaks, then send audio again. Reconnects on 1006 keepalive closes.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import math
import os
import sys
import time
from urllib.parse import urlencode

sys.path.insert(0, os.path.dirname(__file__))

from livekit.agents import APIStatusError

from sarvam_stt_resilient import is_transient_stt_failure, long_lived_http_session

STREAM_URL = "wss://api.sarvam.ai/speech-to-text/ws"
SAMPLE_RATE = 16000
CHUNK_MS = 50


def _ws_url() -> str:
    params = {
        "language-code": "unknown",
        "model": "saaras:v3",
        "vad_signals": "true",
        "sample_rate": str(SAMPLE_RATE),
        "flush_signal": "true",
        "mode": "codemix",
    }
    return f"{STREAM_URL}?{urlencode(params)}"


def _pcm_chunk(t0: float) -> str:
    samples = SAMPLE_RATE * CHUNK_MS // 1000
    frames = bytearray()
    for i in range(samples):
        t = t0 + i / SAMPLE_RATE
        sample = int(800 * math.sin(2 * math.pi * 220 * t))
        frames += sample.to_bytes(2, "little", signed=True)
    return base64.b64encode(frames).decode("ascii")


async def _send_audio(ws, seconds: float) -> None:
    chunks = int(seconds * 1000 / CHUNK_MS)
    t0 = 0.0
    for _ in range(chunks):
        if ws.closed:
            raise APIStatusError(
                "Sarvam STT WebSocket closed unexpectedly during send",
                status_code=1006,
            )
        payload = {
            "audio": {
                "data": _pcm_chunk(t0),
                "encoding": "audio/wav",
                "sample_rate": SAMPLE_RATE,
            }
        }
        await ws.send_str(json.dumps(payload))
        t0 += CHUNK_MS / 1000
        await asyncio.sleep(CHUNK_MS / 1000)


async def _idle(ws, seconds: float) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if ws.closed:
            close_code = ws.close_code
            raise APIStatusError(
                f'Sarvam STT WebSocket closed unexpectedly: {{"close_code": {close_code}}}',
                status_code=int(close_code or 1006),
            )
        timeout = min(1.0, max(0.05, deadline - time.monotonic()))
        try:
            msg = await asyncio.wait_for(ws.receive(), timeout=timeout)
        except asyncio.TimeoutError:
            continue
        if msg.type.name in ("CLOSED", "CLOSE", "CLOSING", "ERROR"):
            raise APIStatusError(
                f"Sarvam STT WebSocket closed unexpectedly: {msg.data} {msg.extra}",
                status_code=int(ws.close_code or 1006),
            )


async def soak(duration_sec: float) -> int:
    api_key = os.getenv("SARVAM_API_KEY", "").strip()
    if not api_key:
        print("SARVAM_API_KEY is required", file=sys.stderr)
        return 2

    reconnects = 0
    started = time.monotonic()
    headers = {"api-subscription-key": api_key}
    async with long_lived_http_session() as session:
        while time.monotonic() - started < duration_sec:
            remaining = duration_sec - (time.monotonic() - started)
            try:
                ws = await session.ws_connect(_ws_url(), headers=headers)
                print(f"connected elapsed={time.monotonic() - started:.1f}s reconnects={reconnects}")
                speak = min(12.0, remaining)
                await _send_audio(ws, speak)
                remaining = duration_sec - (time.monotonic() - started)
                if remaining <= 0:
                    await ws.close()
                    break
                await _idle(ws, min(35.0, remaining))
                remaining = duration_sec - (time.monotonic() - started)
                if remaining <= 0:
                    await ws.close()
                    break
                await _send_audio(ws, min(8.0, remaining))
                await ws.close()
            except asyncio.TimeoutError:
                continue
            except Exception as exc:
                if not is_transient_stt_failure(exc):
                    print(f"fatal: {type(exc).__name__}: {exc}", file=sys.stderr)
                    return 1
                reconnects += 1
                print(f"transient drop ({exc}); reconnect #{reconnects}")
                await asyncio.sleep(0.4)

    print(
        f"SOAK_OK duration={duration_sec:.0f}s reconnects={reconnects} "
        f"elapsed={time.monotonic() - started:.1f}s"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seconds", type=float, default=190)
    args = parser.parse_args()
    return asyncio.run(soak(args.seconds))


if __name__ == "__main__":
    raise SystemExit(main())
