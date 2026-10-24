"""Build LLM adapters from session runtime config."""

from __future__ import annotations

from session_config.types import AgentRuntimeConfig


def llm_backend_for_runtime(runtime: AgentRuntimeConfig) -> str:
    """Candidate uses provider_chain via IntroOrchestratorLLM; viva uses VivaOrchestratorLLM."""
    return runtime.llm.backend
