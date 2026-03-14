"""
ollama_utils.py — Helpers for resolving locally installed Ollama models.
"""

from __future__ import annotations

import logging

from ollama import Client

logger = logging.getLogger(__name__)


def resolve_ollama_model(preferred_model: str, env_var_name: str) -> str:
    """Resolve an Ollama model name against the locally installed models.

    Checks, in order:
    1. Exact match for *configured_model*
    2. Exact match for *configured_model:latest*
    3. Any installed model whose name starts with *configured_model:*

    Falls back to *configured_model* if Ollama is unreachable.
    """
    import os

    configured_model = os.getenv(env_var_name, preferred_model).strip()

    try:
        installed_models = [model.model for model in Client().list().models]
    except Exception as exc:
        logger.warning(
            "Unable to query Ollama models; using '%s'. Error: %s",
            configured_model,
            exc,
        )
        return configured_model

    exact_candidates = [configured_model, f"{configured_model}:latest"]
    for candidate in exact_candidates:
        if candidate in installed_models:
            return candidate

    prefix_matches = [
        name for name in installed_models if name.startswith(f"{configured_model}:")
    ]
    if prefix_matches:
        resolved_model = prefix_matches[0]
        logger.info(
            "Using installed Ollama model '%s' for '%s'.",
            resolved_model,
            configured_model,
        )
        return resolved_model

    return configured_model
