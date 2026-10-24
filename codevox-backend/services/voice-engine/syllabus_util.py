"""Parse official syllabus text into ordered units for viva topic rotation."""

from __future__ import annotations

import re

_UNIT_LINE = re.compile(
    r"^(Unit\s+[IVXLC\d]+)\s*[—\-:]\s*(.+)$",
    re.IGNORECASE,
)


def parse_syllabus_units(syllabus_ref: str | None) -> list[str]:
    """Extract ordered unit labels from a multi-line syllabus_ref string."""
    if not syllabus_ref or not syllabus_ref.strip():
        return []
    units: list[str] = []
    seen: set[str] = set()
    for raw_line in syllabus_ref.replace("\r", "\n").split("\n"):
        line = raw_line.strip()
        if not line:
            continue
        match = _UNIT_LINE.match(line)
        if not match:
            continue
        unit_num = match.group(1).strip()
        title = match.group(2).split(".")[0].strip()
        label = f"{unit_num}: {title}" if title else unit_num
        key = label.lower()
        if key in seen:
            continue
        seen.add(key)
        units.append(label)
    return units


def unit_prefix(label: str) -> str:
    """Return the 'Unit I' portion of a unit label."""
    if ":" in label:
        return label.split(":", 1)[0].strip()
    return label.strip()


def topic_matches_unit(topic: str, unit_label: str) -> bool:
    """True when a bank topic name references the same syllabus unit."""
    if not topic or not unit_label:
        return False
    return unit_prefix(topic).lower() == unit_prefix(unit_label).lower()


def next_uncovered_unit(
    syllabus_ref: str | None,
    covered: list[str],
) -> str | None:
    covered_lower = {c.lower() for c in covered}
    for unit in parse_syllabus_units(syllabus_ref):
        if unit.lower() not in covered_lower and unit_prefix(unit).lower() not in covered_lower:
            return unit
    return None
