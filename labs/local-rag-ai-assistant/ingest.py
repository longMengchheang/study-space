"""
ingest.py - Document ingestion pipeline.

Loads documents from a folder, splits them into chunks, embeds with
the configured embedding model via Ollama, and stores them in a local
Qdrant vector store.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from langchain_community.document_loaders import PyPDFLoader
from langchain_ollama import OllamaEmbeddings
from langchain_qdrant import QdrantVectorStore
from langchain_text_splitters import RecursiveCharacterTextSplitter
from qdrant_client import QdrantClient

from config import ALLOWED_EXTENSIONS, CHUNK_OVERLAP, CHUNK_SIZE, EMBED_MODEL
from ollama_utils import resolve_ollama_model

logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FOLDER = os.path.join(BASE_DIR, "my_docs")
QDRANT_DIR = os.path.join(BASE_DIR, "qdrant_db")
QDRANT_COLLECTION = "rag_documents"


def _load_file(file_path: str) -> list:
    """Load a single file based on its extension and return LangChain documents."""
    ext = Path(file_path).suffix.lower()
    if ext == ".pdf":
        return PyPDFLoader(file_path).load()
    if ext in {".txt", ".md", ".html"}:
        from langchain_community.document_loaders import TextLoader

        return TextLoader(file_path, encoding="utf-8").load()
    return []


def _build_embeddings() -> OllamaEmbeddings:
    """Build the embedding function, resolving the model once."""
    resolved = resolve_ollama_model(EMBED_MODEL, "OLLAMA_EMBED_MODEL")
    return OllamaEmbeddings(model=resolved)


def _get_qdrant_client(qdrant_dir: str) -> QdrantClient:
    Path(qdrant_dir).mkdir(parents=True, exist_ok=True)
    return QdrantClient(path=qdrant_dir)


def _delete_collection_if_exists(qdrant_dir: str, qdrant_collection: str) -> None:
    client = _get_qdrant_client(qdrant_dir)
    try:
        if client.collection_exists(qdrant_collection):
            client.delete_collection(qdrant_collection)
    finally:
        client.close()


def ingest_documents(
    data_folder: str = DATA_FOLDER,
    qdrant_dir: str = QDRANT_DIR,
    qdrant_collection: str = QDRANT_COLLECTION,
    reset_store: bool = True,
) -> int:
    """Ingest all supported documents from *data_folder* into Qdrant.

    When *reset_store* is True the existing collection is dropped first
    (full re-index). Returns the number of chunks added.
    """
    if not os.path.exists(data_folder):
        os.makedirs(data_folder)
        logger.info("Created folder '%s'. Drop your documents inside and run again!", data_folder)
        return 0

    logger.info("Loading documents from '%s' ...", data_folder)
    file_paths = sorted(
        os.path.join(data_folder, name)
        for name in os.listdir(data_folder)
        if Path(name).suffix.lower() in ALLOWED_EXTENSIONS
    )

    docs = []
    skipped_files: list[tuple[str, str]] = []
    for file_path in file_paths:
        filename = os.path.basename(file_path)
        if os.path.getsize(file_path) == 0:
            skipped_files.append((filename, "file is empty"))
            continue
        try:
            docs.extend(_load_file(file_path))
        except Exception as exc:
            logger.warning("Skipping '%s': %s", filename, exc)
            skipped_files.append((filename, str(exc)))

    for filename, reason in skipped_files:
        logger.warning("Skipped '%s': %s", filename, reason)

    embeddings = _build_embeddings()

    if not docs:
        if reset_store:
            _delete_collection_if_exists(qdrant_dir, qdrant_collection)
        logger.info("No readable pages found. Add a valid document and try again.")
        return 0

    logger.info("Found %d page(s) across your documents.", len(docs))

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
    )
    chunks = splitter.split_documents(docs)
    logger.info(
        "Split into %d chunks (size=%d, overlap=%d).",
        len(chunks),
        CHUNK_SIZE,
        CHUNK_OVERLAP,
    )

    if reset_store:
        logger.info("Refreshing Qdrant collection '%s'.", qdrant_collection)
        _delete_collection_if_exists(qdrant_dir, qdrant_collection)

    QdrantVectorStore.from_documents(
        documents=chunks,
        embedding=embeddings,
        collection_name=qdrant_collection,
        path=qdrant_dir,
    )

    logger.info("Done. Ingested %d chunks into '%s'.", len(chunks), qdrant_dir)
    return len(chunks)


def ingest_single_file(
    file_path: str,
    qdrant_dir: str = QDRANT_DIR,
    qdrant_collection: str = QDRANT_COLLECTION,
) -> int:
    """Add a single file to an existing Qdrant collection (no reset)."""
    if not os.path.exists(file_path) or os.path.getsize(file_path) == 0:
        return 0

    docs = _load_file(file_path)
    if not docs:
        return 0

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
    )
    chunks = splitter.split_documents(docs)
    embeddings = _build_embeddings()

    QdrantVectorStore.from_documents(
        documents=chunks,
        embedding=embeddings,
        collection_name=qdrant_collection,
        path=qdrant_dir,
    )
    logger.info("Incrementally added %d chunks from '%s'.", len(chunks), file_path)
    return len(chunks)


def remove_source_from_store(
    source_path: str,
    qdrant_dir: str = QDRANT_DIR,
    qdrant_collection: str = QDRANT_COLLECTION,
) -> int:
    """Source-level deletion is handled through full reindexing for now."""
    logger.info(
        "Source-level deletion for '%s' defers to full collection reindex in Qdrant.",
        source_path,
    )
    return 0


def main() -> None:
    chunks_added = ingest_documents()
    if chunks_added > 0:
        logger.info("Run your api or app to start chatting!")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main()
