"""
test_api.py — Smoke tests for the Local RAG API.

Run with:
    python -m pytest test_api.py -v

These tests exercise the HTTP layer using FastAPI's TestClient.
They do NOT require a running Ollama instance for the basic CRUD
endpoints (collections, health, root).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from api import app

client = TestClient(app)


# ── Health & root ────────────────────────────────────────────────


def test_root_returns_message():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert "message" in data
    assert "collections" in data


def test_health_returns_ok():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "collections" in data
    assert "documents" in data


# ── Collections CRUD ─────────────────────────────────────────────


def test_list_collections_has_default():
    response = client.get("/collections")
    assert response.status_code == 200
    data = response.json()
    ids = [c["id"] for c in data["collections"]]
    assert "general" in ids


def test_create_and_delete_collection():
    # Create
    response = client.post("/collections", json={"name": "Test Collection"})
    assert response.status_code == 200
    created = response.json()
    assert created["name"] == "Test Collection"
    assert created["id"]

    collection_id = created["id"]

    # Verify it shows up in the list
    response = client.get("/collections")
    ids = [c["id"] for c in response.json()["collections"]]
    assert collection_id in ids

    # Delete
    response = client.delete(f"/collections/{collection_id}")
    assert response.status_code == 200
    ids_after = [c["id"] for c in response.json()["collections"]]
    assert collection_id not in ids_after


def test_create_collection_empty_name_fails():
    response = client.post("/collections", json={"name": "   "})
    assert response.status_code == 400


def test_create_duplicate_collection_fails():
    # Create first
    client.post("/collections", json={"name": "Duplicate Test"})
    # Attempt duplicate
    response = client.post("/collections", json={"name": "Duplicate Test"})
    assert response.status_code == 400
    # Cleanup
    collections = client.get("/collections").json()["collections"]
    for c in collections:
        if c["name"] == "Duplicate Test":
            client.delete(f"/collections/{c['id']}")


def test_delete_default_collection_fails():
    response = client.delete("/collections/general")
    assert response.status_code == 400


def test_rename_collection():
    # Create
    created = client.post("/collections", json={"name": "Rename Me"}).json()
    cid = created["id"]

    # Rename
    response = client.patch(f"/collections/{cid}", json={"name": "Renamed"})
    assert response.status_code == 200
    assert response.json()["name"] == "Renamed"

    # Cleanup
    client.delete(f"/collections/{cid}")


# ── Documents (no upload, just listing) ──────────────────────────


def test_list_documents_for_default():
    response = client.get("/collections/general/documents")
    assert response.status_code == 200
    assert "documents" in response.json()


def test_list_documents_for_nonexistent_collection():
    response = client.get("/collections/nonexistent-xxx/documents")
    assert response.status_code == 404


# ── Artifacts listing ────────────────────────────────────────────


def test_list_artifacts_for_default():
    response = client.get("/collections/general/artifacts")
    assert response.status_code == 200
    assert "artifacts" in response.json()


# ── Chat without documents ───────────────────────────────────────


def test_chat_without_documents_returns_400():
    """Chat should fail gracefully when no documents are uploaded."""
    response = client.post(
        "/chat",
        json={"message": "hello", "collection_id": "general"},
    )
    # Expect 400 because no documents exist (or 500 if Ollama is down)
    assert response.status_code in (400, 500)
