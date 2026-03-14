"""
config.py — Centralised configuration for the Local RAG assistant.

All tuneable settings live here. Override any value via environment variables,
a `.env` file (loaded automatically via python-dotenv), or by editing defaults.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv

    load_dotenv()
except ModuleNotFoundError:  # python-dotenv is optional
    pass

# ── Paths ────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent
LEGACY_DOCS_DIR = BASE_DIR / "my_docs"
LEGACY_QDRANT_DIR = BASE_DIR / "qdrant_db"
COLLECTIONS_ROOT = BASE_DIR / "study_collections"
COLLECTIONS_INDEX_PATH = COLLECTIONS_ROOT / "index.json"

# ── Collection defaults ──────────────────────────────────────────
LEGACY_COLLECTION_ID = "general"
LEGACY_COLLECTION_NAME = "General"

# ── Embedding & LLM ─────────────────────────────────────────────
EMBED_MODEL: str = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")
LLM_MODEL: str = os.getenv("OLLAMA_LLM_MODEL", "llama3.2")
LLM_TEMP: float = float(os.getenv("LLM_TEMP", "0.3"))
LLM_TIMEOUT: float = float(os.getenv("LLM_TIMEOUT", "120"))  # seconds

# ── Retrieval ────────────────────────────────────────────────────
TOP_K: int = int(os.getenv("TOP_K", "6"))

# ── Chunking ─────────────────────────────────────────────────────
CHUNK_SIZE: int = int(os.getenv("CHUNK_SIZE", "800"))
CHUNK_OVERLAP: int = int(os.getenv("CHUNK_OVERLAP", "100"))

# ── Upload limits ────────────────────────────────────────────────
MAX_UPLOAD_BYTES: int = int(os.getenv("MAX_UPLOAD_BYTES", str(50 * 1024 * 1024)))  # 50 MB
ALLOWED_EXTENSIONS: set[str] = {".pdf", ".txt", ".md", ".html"}

# ── CORS ─────────────────────────────────────────────────────────
CORS_ORIGINS: list[str] = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if origin.strip()
]
