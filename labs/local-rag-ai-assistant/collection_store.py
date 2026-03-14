"""
collection_store.py — CRUD operations on study collections.

Each collection has its own docs/, qdrant/, and artifacts/ directories
under COLLECTIONS_ROOT.  A JSON index file tracks metadata.
"""

from __future__ import annotations

import json
import logging
import re
import shutil
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

from config import (
    COLLECTIONS_INDEX_PATH,
    COLLECTIONS_ROOT,
    LEGACY_QDRANT_DIR,
    LEGACY_COLLECTION_ID,
    LEGACY_COLLECTION_NAME,
    LEGACY_DOCS_DIR,
)

logger = logging.getLogger(__name__)


@dataclass
class CollectionRecord:
    id: str
    name: str
    is_default: bool = False


def slugify_collection_name(name: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return value or "study-set"


# ── Index persistence ────────────────────────────────────────────


def _load_records() -> list[CollectionRecord]:
    if not COLLECTIONS_INDEX_PATH.exists():
        return []
    payload = json.loads(COLLECTIONS_INDEX_PATH.read_text(encoding="utf-8"))
    return [CollectionRecord(**item) for item in payload]


def _save_records(records: list[CollectionRecord]) -> None:
    COLLECTIONS_ROOT.mkdir(parents=True, exist_ok=True)
    payload = [asdict(record) for record in records]
    COLLECTIONS_INDEX_PATH.write_text(
        json.dumps(payload, indent=2),
        encoding="utf-8",
    )


def ensure_collection_index() -> list[CollectionRecord]:
    COLLECTIONS_ROOT.mkdir(parents=True, exist_ok=True)
    records = _load_records()

    if not any(record.id == LEGACY_COLLECTION_ID for record in records):
        records.insert(
            0,
            CollectionRecord(
                id=LEGACY_COLLECTION_ID,
                name=LEGACY_COLLECTION_NAME,
                is_default=True,
            ),
        )
        _save_records(records)

    ensure_collection_directories(LEGACY_COLLECTION_ID)
    return records


# ── CRUD ─────────────────────────────────────────────────────────


def list_collections() -> list[CollectionRecord]:
    return ensure_collection_index()


def get_collection(collection_id: str) -> CollectionRecord | None:
    for record in ensure_collection_index():
        if record.id == collection_id:
            return record
    return None


def create_collection(name: str) -> CollectionRecord:
    cleaned_name = name.strip()
    if not cleaned_name:
        raise ValueError("Collection name is required.")

    records = ensure_collection_index()
    normalized_name = cleaned_name.casefold()
    if any(record.name.casefold() == normalized_name for record in records):
        raise ValueError("A collection with that name already exists.")

    base_slug = slugify_collection_name(cleaned_name)
    slug = base_slug
    suffix = 2
    existing_ids = {record.id for record in records}
    while slug in existing_ids:
        slug = f"{base_slug}-{suffix}"
        suffix += 1

    record = CollectionRecord(id=slug, name=cleaned_name)
    records.append(record)
    _save_records(records)
    ensure_collection_directories(record.id)
    logger.info("Created collection '%s' (id=%s).", cleaned_name, slug)
    return record


def rename_collection(collection_id: str, name: str) -> CollectionRecord:
    cleaned_name = name.strip()
    if not cleaned_name:
        raise ValueError("Collection name is required.")

    records = ensure_collection_index()
    target = next((r for r in records if r.id == collection_id), None)
    if target is None:
        raise ValueError("Collection not found.")
    if target.is_default:
        raise ValueError("The default collection cannot be renamed.")

    normalized_name = cleaned_name.casefold()
    if any(
        r.id != collection_id and r.name.casefold() == normalized_name for r in records
    ):
        raise ValueError("A collection with that name already exists.")

    target.name = cleaned_name
    _save_records(records)
    return target


def delete_collection(collection_id: str) -> None:
    records = ensure_collection_index()
    target = next((r for r in records if r.id == collection_id), None)
    if target is None:
        raise ValueError("Collection not found.")
    if target.is_default:
        raise ValueError("The default collection cannot be deleted.")

    next_records = [r for r in records if r.id != collection_id]
    _save_records(next_records)

    storage_root = get_collection_storage_root(collection_id)
    if storage_root.exists():
        shutil.rmtree(storage_root, ignore_errors=True)
    logger.info("Deleted collection '%s'.", collection_id)


# ── Directory helpers ────────────────────────────────────────────


def ensure_collection_directories(collection_id: str) -> None:
    get_collection_docs_dir(collection_id).mkdir(parents=True, exist_ok=True)
    get_collection_artifacts_dir(collection_id).mkdir(parents=True, exist_ok=True)
    if collection_id != LEGACY_COLLECTION_ID:
        get_collection_qdrant_dir(collection_id).mkdir(parents=True, exist_ok=True)


def get_collection_storage_root(collection_id: str) -> Path:
    return COLLECTIONS_ROOT / collection_id


def get_collection_docs_dir(collection_id: str) -> Path:
    if collection_id == LEGACY_COLLECTION_ID:
        return LEGACY_DOCS_DIR
    return get_collection_storage_root(collection_id) / "docs"


def get_collection_qdrant_dir(collection_id: str) -> Path:
    if collection_id == LEGACY_COLLECTION_ID:
        return LEGACY_QDRANT_DIR
    return get_collection_storage_root(collection_id) / "qdrant"


def get_collection_artifacts_dir(collection_id: str) -> Path:
    return get_collection_storage_root(collection_id) / "artifacts"


def get_collection_vector_name(collection_id: str) -> str:
    if collection_id == LEGACY_COLLECTION_ID:
        return "rag_documents"
    return f"rag_documents_{collection_id}"


# ── Listing helpers ──────────────────────────────────────────────


def list_collection_documents(collection_id: str) -> list[dict[str, int | str]]:
    docs_dir = get_collection_docs_dir(collection_id)
    if not docs_dir.exists():
        return []

    from config import ALLOWED_EXTENSIONS

    documents: list[dict[str, int | str]] = []
    for path in sorted(docs_dir.iterdir()):
        if path.is_file() and path.suffix.lower() in ALLOWED_EXTENSIONS:
            documents.append({"name": path.name, "size": path.stat().st_size})
    return documents


def list_collection_artifacts(collection_id: str) -> list[dict[str, str]]:
    artifacts_dir = get_collection_artifacts_dir(collection_id)
    if not artifacts_dir.exists():
        return []

    # Collect entries with a single stat() per file to avoid redundant I/O (#11)
    entries: list[tuple[Path, float]] = []
    for path in artifacts_dir.glob("*.md"):
        if path.is_file():
            entries.append((path, path.stat().st_mtime))

    entries.sort(key=lambda entry: entry[1], reverse=True)

    artifacts: list[dict[str, str]] = []
    for path, mtime in entries:
        kind, _, _ = path.stem.partition("-")
        artifacts.append(
            {
                "filename": path.name,
                "kind": kind or "artifact",
                "saved_path": str(path),
                "updated_at": datetime.fromtimestamp(mtime).isoformat(),
            }
        )
    return artifacts


def summarize_collections() -> list[dict[str, int | str | bool]]:
    summary: list[dict[str, int | str | bool]] = []
    for record in ensure_collection_index():
        summary.append(
            {
                "id": record.id,
                "name": record.name,
                "is_default": record.is_default,
                "document_count": len(list_collection_documents(record.id)),
                "artifact_count": len(list_collection_artifacts(record.id)),
            }
        )
    return summary
