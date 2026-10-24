"""Resume skill extraction for autonomous interview tech rotation."""

from __future__ import annotations

from topic_catalog import normalize_stack

DEFAULT_WEB_BASELINE = ["JavaScript", "SQL", "REST APIs", "System Design"]
MAX_RESUME_SKILLS = 8

ENTRY_STACK_RESUME_SKILLS: dict[str, list[str]] = {
    "php": ["PHP", "HTML/CSS", "MySQL", "Basic SQL", "Git", "REST APIs"],
    "python": ["Python", "Git", "SQL", "REST APIs", "HTML/CSS"],
    "javascript": ["JavaScript", "HTML/CSS", "Git", "REST APIs", "SQL"],
    "java": ["Java", "Git", "SQL", "REST APIs"],
    "react": ["React", "JavaScript", "HTML/CSS", "Git", "REST APIs"],
    "sql": ["SQL", "MySQL", "Basic SQL", "Database Design"],
    "aiml": ["Python", "Machine Learning", "Basic SQL", "Data Analysis", "Git"],
}

STACK_RESUME_SKILLS: dict[str, list[str]] = {
    "php": ["PHP", "Laravel", "MySQL", "REST APIs", "Redis", "System Design"],
    "python": ["Python", "Django", "Flask", "SQL", "REST APIs", "System Design"],
    "javascript": ["JavaScript", "Node.js", "React", "REST APIs", "SQL", "System Design"],
    "java": ["Java", "Spring Boot", "SQL", "System Design", "REST APIs"],
    "react": ["React", "JavaScript", "TypeScript", "REST APIs", "System Design"],
    "sql": ["SQL", "MySQL", "PostgreSQL", "Database Design", "Query Optimization"],
    "aiml": ["Machine Learning", "Deep Learning", "Python", "SQL", "Model Deployment"],
}

SKILL_ALIASES: dict[str, str] = {
    "node": "javascript",
    "node.js": "javascript",
    "nodejs": "javascript",
    "js": "javascript",
    "ts": "typescript",
    "typescript": "javascript",
    "postgres": "sql",
    "postgresql": "sql",
    "mysql": "sql",
    "mssql": "sql",
    "ai": "aiml",
    "ml": "aiml",
    "machine learning": "aiml",
    "data science": "aiml",
    "artificial intelligence": "aiml",
    "reactjs": "react",
    "react.js": "react",
    "vuejs": "vue",
    "vue.js": "vue",
    "angularjs": "angular",
    "laravel": "php",
    "django": "python",
    "flask": "python",
    "spring boot": "java",
    "springboot": "java",
    "k8s": "kubernetes",
    "rest": "rest apis",
    "rest api": "rest apis",
    "rest apis": "rest apis",
    "api design": "rest apis",
    "system design": "system design",
    "debugging": "general",
}


def _match_key(skill: str) -> str:
    normalized = normalize_stack(skill)
    return SKILL_ALIASES.get(normalized, normalized)


def _dedupe_key(skill: str) -> str:
    return normalize_stack(skill)


def _resolve_stack_key(tech_stack: str) -> str:
    key = _match_key(tech_stack)
    if key in STACK_RESUME_SKILLS:
        return key
    for stack_key in STACK_RESUME_SKILLS:
        if stack_key in key:
            return stack_key
    return key


def _pool_for_stack(stack_key: str, *, entry_level: bool) -> list[str]:
    if entry_level:
        return ENTRY_STACK_RESUME_SKILLS.get(stack_key, STACK_RESUME_SKILLS.get(stack_key, []))
    return STACK_RESUME_SKILLS.get(stack_key, [])


def _skill_matches_tech(skill: str, stack_key: str, *, entry_level: bool = False) -> bool:
    skill_key = _match_key(skill)
    if stack_key in skill_key or skill_key in stack_key:
        return True
    pool = _pool_for_stack(stack_key, entry_level=entry_level)
    return any(_match_key(entry) == skill_key for entry in pool)


def is_entry_level_interview(candidate_token: str | None = None) -> bool:
    token = (candidate_token or "").strip().lower()
    if token.endswith("-entry"):
        return True
    return __import__("os").getenv("INTERVIEW_BASE_LEVEL", "").strip().upper() == "JUNIOR"


def _dedupe_preserve_order(labels: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for label in labels:
        display = label.strip()
        if not display:
            continue
        key = _dedupe_key(display)
        if key in seen:
            continue
        seen.add(key)
        result.append(display)
    return result


def extract_resume_tech_stack(
    raw_skills: list[str] | None,
    *,
    fallback_stack: str | None = None,
    max_skills: int = MAX_RESUME_SKILLS,
    entry_level: bool = False,
    candidate_token: str | None = None,
) -> list[str]:
    entry_level = entry_level or is_entry_level_interview(candidate_token)
    primary = (fallback_stack or "Python").strip() or "Python"
    stack_key = _resolve_stack_key(primary)
    defaults = _pool_for_stack(stack_key, entry_level=entry_level)
    if not defaults:
        merged = _dedupe_preserve_order([primary, *(raw_skills or [])])
        return merged[:max_skills]

    relevant = [
        skill
        for skill in (raw_skills or [])
        if _skill_matches_tech(skill, stack_key, entry_level=entry_level)
    ]

    if entry_level and relevant:
        merged = _dedupe_preserve_order([primary, *relevant])
        seen = {_dedupe_key(skill) for skill in merged}
        for label in defaults:
            if len(merged) >= max_skills:
                break
            key = _dedupe_key(label)
            if key in seen:
                continue
            seen.add(key)
            merged.append(label)
        return merged[:max_skills]

    merged = _dedupe_preserve_order([primary, *relevant, *defaults])
    return merged[:max_skills]
