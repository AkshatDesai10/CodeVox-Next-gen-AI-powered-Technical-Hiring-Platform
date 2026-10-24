"""Tech-stack keyed topic pools for autonomous interviewing."""

from __future__ import annotations

DEFAULT_TOPICS = [
    "architecture",
    "core_language",
    "data_layer",
    "caching",
    "security",
    "reliability",
    "testing",
]

STACK_TOPICS: dict[str, list[str]] = {
    "php": [
        "oop_php",
        "laravel_lifecycle",
        "database_query_optimization",
        "caching",
        "security",
        "api_design",
        "concurrency_queues",
    ],
    "python": [
        "python_fundamentals",
        "async_concurrency",
        "data_layer",
        "caching",
        "api_design",
        "testing",
        "architecture",
    ],
    "javascript": [
        "javascript_core",
        "nodejs_runtime",
        "frontend_state",
        "api_design",
        "caching",
        "security",
        "testing",
    ],
    "java": [
        "oop_java",
        "spring_ecosystem",
        "jvm_performance",
        "data_layer",
        "concurrency",
        "security",
        "architecture",
    ],
    "react": [
        "react_core",
        "state_management",
        "performance",
        "testing",
        "api_integration",
        "architecture",
        "accessibility",
    ],
}


def normalize_stack(tech_stack: str) -> str:
    return (tech_stack or "general").strip().lower()


def topic_pool_for_stack(tech_stack: str) -> list[str]:
    key = normalize_stack(tech_stack)
    for stack_key, topics in STACK_TOPICS.items():
        if stack_key in key:
            return list(topics)
    return list(DEFAULT_TOPICS)


def topic_display_name(topic_key: str) -> str:
    return topic_key.replace("_", " ")
