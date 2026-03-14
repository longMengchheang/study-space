"""
rag_utils.py — Retrieval helpers shared by the API and the Gradio assistant.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from langchain_core.documents import Document
    from langchain_core.vectorstores import VectorStoreRetriever

QUERY_REWRITES: tuple[tuple[str, str], ...] = (
    (r"\bdata signature\b", "digital signature"),
    (r"\bdatasignature\b", "digital signature"),
    (r"\bcyber security\b", "network security"),
)


def build_query_variants(question: str) -> list[str]:
    """Return the original question plus any rewritten variants."""
    normalized = " ".join(question.split())
    if not normalized:
        return [question]

    variants: list[str] = [normalized]
    lowered = normalized.lower()

    for pattern, replacement in QUERY_REWRITES:
        rewritten = re.sub(pattern, replacement, lowered)
        if rewritten != lowered:
            variants.append(rewritten)

    unique_variants: list[str] = []
    seen: set[str] = set()
    for variant in variants:
        key = variant.strip().lower()
        if key and key not in seen:
            seen.add(key)
            unique_variants.append(variant)
    return unique_variants


def normalize_question(question: str) -> str:
    """Pick the best query variant (last rewrite if any, else original)."""
    variants = build_query_variants(question)
    return variants[-1] if len(variants) > 1 else variants[0]


def filter_documents_by_source_names(
    docs: list[Document],
    source_names: list[str] | None,
) -> list[Document]:
    """Keep only documents whose source filename is in *source_names*."""
    if not source_names:
        return docs

    allowed_names = {
        Path(name).name.strip().lower() for name in source_names if name.strip()
    }
    if not allowed_names:
        return docs

    return [
        doc
        for doc in docs
        if Path(str((doc.metadata or {}).get("source") or "")).name.strip().lower()
        in allowed_names
    ]


def retrieve_documents(
    question: str,
    retriever: VectorStoreRetriever,
    source_names: list[str] | None = None,
) -> list[Document]:
    """Retrieve and deduplicate documents across all query variants."""
    docs_by_key: dict[tuple, Document] = {}

    for variant in build_query_variants(question):
        for doc in filter_documents_by_source_names(
            retriever.invoke(variant), source_names
        ):
            metadata = doc.metadata or {}
            key = (
                metadata.get("source"),
                metadata.get("page"),
                doc.page_content,
            )
            docs_by_key.setdefault(key, doc)

    return list(docs_by_key.values())


def retrieve_context(
    question: str,
    retriever: VectorStoreRetriever,
    source_names: list[str] | None = None,
) -> str:
    """Retrieve context string by joining document contents."""
    docs = retrieve_documents(question, retriever, source_names)
    return "\n\n---\n\n".join(doc.page_content for doc in docs)
