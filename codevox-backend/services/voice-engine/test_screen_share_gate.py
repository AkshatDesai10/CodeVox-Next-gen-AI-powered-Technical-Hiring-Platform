"""Screen-share gate: joining the room is not the same as publishing a screen track."""

from __future__ import annotations

import pytest

pytest.importorskip("livekit")

from livekit import rtc

from livekit_speaker import _candidate_has_screen_share


class _Pub:
    def __init__(self, source: int) -> None:
        self.source = source


class _Participant:
    def __init__(self, identity: str, sources: list[int]) -> None:
        self.identity = identity
        self.track_publications = {str(i): _Pub(source) for i, source in enumerate(sources)}


class _Room:
    def __init__(self, participants: dict[str, _Participant]) -> None:
        self.remote_participants = participants


def test_camera_and_mic_do_not_count_as_screen_share() -> None:
    room = _Room(
        {
            "candidate": _Participant(
                "candidate-ses",
                [rtc.TrackSource.SOURCE_CAMERA, rtc.TrackSource.SOURCE_MICROPHONE],
            ),
        },
    )
    assert _candidate_has_screen_share(room) is False


def test_candidate_screen_share_track_is_required() -> None:
    room = _Room(
        {
            "candidate": _Participant(
                "candidate-ses",
                [rtc.TrackSource.SOURCE_CAMERA, rtc.TrackSource.SOURCE_SCREENSHARE],
            ),
        },
    )
    assert _candidate_has_screen_share(room) is True


def test_student_screen_share_does_not_release_a_candidate_round() -> None:
    room = _Room(
        {
            "student": _Participant(
                "student-viva",
                [rtc.TrackSource.SOURCE_SCREENSHARE],
            ),
        },
    )
    assert _candidate_has_screen_share(room) is False
