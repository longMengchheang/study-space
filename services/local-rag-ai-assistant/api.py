"""
api.py — FastAPI backend for the local RAG assistant.

Studyspace-friendly features:
- Named collections with per-collection document management
- Saved study artifacts (summaries, flashcards, quizzes, study guides)
- Multi-format uploads (PDF, TXT, MD, HTML) with file-size limits
- Thread-safe collection runtime cache
"""

from __future__ import annotations

import gc
import hashlib
import logging
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, HumanMessage
from pydantic import BaseModel, Field

from collection_store import (
    create_collection,
    delete_collection,
    ensure_collection_directories,
    get_collection,
    get_collection_artifacts_dir,
    get_collection_qdrant_dir,
    get_collection_docs_dir,
    get_collection_vector_name,
    list_collection_artifacts,
    list_collection_documents,
    rename_collection,
    summarize_collections,
)
from config import (
    ALLOWED_EXTENSIONS,
    CORS_ORIGINS,
    EMBED_MODEL,
    LEGACY_COLLECTION_ID,
    LLM_MODEL,
    MAX_UPLOAD_BYTES,
)
from ingest import ingest_documents, ingest_file_incremental, remove_source_from_store
from rag_pipeline import build_rag_runtime
from rag_utils import normalize_question, retrieve_context, retrieve_documents

logger = logging.getLogger(__name__)

# ── App setup ────────────────────────────────────────────────────

app = FastAPI(title="Local RAG API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Runtime cache with per-collection locking (#4) ───────────────

_collection_runtimes: dict[str, dict[str, Any]] = {}
_runtime_locks: dict[str, threading.Lock] = {}
_global_lock = threading.Lock()


def _get_lock(collection_id: str) -> threading.Lock:
    with _global_lock:
        if collection_id not in _runtime_locks:
            _runtime_locks[collection_id] = threading.Lock()
        return _runtime_locks[collection_id]


# ── Pydantic models ─────────────────────────────────────────────


class SourceReference(BaseModel):
    source: str
    page: int | None = None
    snippet: str


class HistoryMessage(BaseModel):
    """A single turn in the conversation history sent by the client."""

    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    message: str
    collection_id: str = LEGACY_COLLECTION_ID
    source_names: list[str] = Field(default_factory=list)
    history: list[HistoryMessage] = Field(
        default_factory=list,
        description="Prior conversation turns (oldest first). Sent by the "
        "client to enable multi-turn, context-aware answers.",
    )


class ChatResponse(BaseModel):
    reply: str
    sources: list[SourceReference] = Field(default_factory=list)


class CreateCollectionRequest(BaseModel):
    name: str


class UpdateCollectionRequest(BaseModel):
    name: str


class CollectionResponse(BaseModel):
    id: str
    name: str
    is_default: bool
    document_count: int
    artifact_count: int


class CollectionListResponse(BaseModel):
    collections: list[CollectionResponse]


class DocumentRecord(BaseModel):
    name: str
    size: int


class DocumentListResponse(BaseModel):
    documents: list[DocumentRecord]


class UploadResponse(BaseModel):
    filename: str
    status: str
    chunks_added: int
    collection_id: str


class ArtifactRecord(BaseModel):
    filename: str
    kind: str
    title: str
    saved_path: str
    updated_at: str


class ArtifactListResponse(BaseModel):
    artifacts: list[ArtifactRecord]


class ArtifactRequest(BaseModel):
    collection_id: str = LEGACY_COLLECTION_ID
    kind: Literal["summary", "flashcards", "quiz", "study_guide"]
    prompt: str | None = None
    source_names: list[str] = Field(default_factory=list)


class UpdateArtifactRequest(BaseModel):
    name: str


class ArtifactResponse(BaseModel):
    kind: str
    title: str
    content: str
    filename: str
    saved_path: str


class ArtifactDetailResponse(BaseModel):
    filename: str
    kind: str
    title: str
    saved_path: str
    updated_at: str
    content: str


# ── Helpers ──────────────────────────────────────────────────────


def _validate_upload_filename(filename: str | None) -> str:
    """Validate and return the cleaned filename for upload.

    Accepts any extension in ALLOWED_EXTENSIONS (#1).
    """
    cleaned = Path(filename or "").name.strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="Filename is required.")
    ext = Path(cleaned).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(ALLOWED_EXTENSIONS))
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: {allowed}",
        )
    return cleaned


def _validate_document_name(document_name: str) -> str:
    """Validate a document name for deletion (allows any known extension)."""
    cleaned = Path(document_name).name.strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="Document name is required.")
    return cleaned


def ensure_collection_exists(collection_id: str) -> str:
    if not get_collection(collection_id):
        raise HTTPException(status_code=404, detail="Collection not found.")
    ensure_collection_directories(collection_id)
    return collection_id


def clear_collection_runtime(collection_id: str) -> None:
    lock = _get_lock(collection_id)
    with lock:
        _collection_runtimes.pop(collection_id, None)
    gc.collect()


def list_available_documents(collection_id: str) -> list[dict[str, int | str]]:
    ensure_collection_exists(collection_id)
    return list_collection_documents(collection_id)


def ensure_collection_has_documents(collection_id: str) -> None:
    if not list_available_documents(collection_id):
        raise HTTPException(
            status_code=400,
            detail="Upload at least one document to this collection before chatting.",
        )


def get_collection_runtime(collection_id: str) -> dict[str, Any]:
    collection_id = ensure_collection_exists(collection_id)
    lock = _get_lock(collection_id)

    with lock:
        cached = _collection_runtimes.get(collection_id)
        if cached is not None:
            return cached

        logger.info("Initializing RAG pipeline for collection '%s' ...", collection_id)
        runtime = build_rag_runtime(
            collection_name=get_collection_vector_name(collection_id),
            qdrant_dir=str(get_collection_qdrant_dir(collection_id)),
            embed_model=EMBED_MODEL,
            llm_model=LLM_MODEL,
        )
        _collection_runtimes[collection_id] = runtime
        logger.info("RAG pipeline ready for collection '%s'.", collection_id)
        return runtime


def reingest_collection(collection_id: str) -> int:
    clear_collection_runtime(collection_id)
    return ingest_documents(
        data_folder=str(get_collection_docs_dir(collection_id)),
        qdrant_dir=str(get_collection_qdrant_dir(collection_id)),
        qdrant_collection=get_collection_vector_name(collection_id),
        reset_store=True,
    )


def ingest_file_into_collection(collection_id: str, file_path: str) -> int:
    """Incrementally add (or replace) a single file in a collection's vector store.

    This avoids a full collection re-index when only one file has changed.
    The collection runtime cache is invalidated so the next query picks up
    the new vectors.
    """
    clear_collection_runtime(collection_id)
    return ingest_file_incremental(
        file_path=file_path,
        qdrant_dir=str(get_collection_qdrant_dir(collection_id)),
        qdrant_collection=get_collection_vector_name(collection_id),
    )


def remove_file_from_collection(collection_id: str, file_path: str) -> int:
    """Remove all vectors for a single source file from the collection's vector store.

    Returns the number of vectors deleted.  Falls back to a full re-index
    when the filter-based delete fails (e.g. collection is corrupt).
    """
    clear_collection_runtime(collection_id)
    deleted = remove_source_from_store(
        source_path=file_path,
        qdrant_dir=str(get_collection_qdrant_dir(collection_id)),
        qdrant_collection=get_collection_vector_name(collection_id),
    )
    if deleted == 0:
        # remove_source_from_store already logged a warning; fall back to a
        # full reindex so the document is definitely gone.
        reingest_collection(collection_id)
    return deleted


# ── Artifact helpers ──────────────────────────────────────────────


def artifact_seed_prompt(kind: str, custom_prompt: str | None) -> str:
    cleaned_prompt = (custom_prompt or "").strip()
    if cleaned_prompt:
        return cleaned_prompt

    defaults = {
        "summary": "Summarize the most important ideas in this collection.",
        "flashcards": "Create strong study flashcards from this collection.",
        "quiz": "Create a quiz that tests the key ideas in this collection.",
        "study_guide": "Create a study guide from this collection.",
    }
    return defaults[kind]


def render_artifact_prompt(kind: str, seed_prompt: str, context: str) -> str:
    instructions = {
        "summary": """Create a concise markdown summary with:
- Overview
- Key ideas
- Important terms
- What to review next""",
        "flashcards": """Create markdown flashcards with:
- One question per bullet
- A short answer under each question
- Focus on important facts, definitions, and comparisons""",
        "quiz": """Create a markdown quiz with:
- 5 to 8 questions
- Mix of short answer and multiple choice
- Add an answer key at the end""",
        "study_guide": """Create a markdown study guide with:
- Main topics
- Important concepts
- Step-by-step explanations where useful
- A short revision checklist at the end""",
    }

    return f"""You are generating a study artifact.

Use ONLY the context below. If the context is insufficient, say so clearly.

Requested output:
{instructions[kind]}

Focus:
{seed_prompt}

Context:
{context}
"""


def save_artifact(collection_id: str, kind: str, content: str) -> Path:
    artifacts_dir = get_collection_artifacts_dir(collection_id)
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    path = artifacts_dir / f"{kind}-{timestamp}.md"
    path.write_text(content.strip() + "\n", encoding="utf-8")
    return path


def format_artifact_kind(kind: str) -> str:
    return kind.replace("_", " ").title()


def slugify_artifact_title(name: str) -> str:
    value = "".join(ch.lower() if ch.isalnum() else "-" for ch in name.strip())
    value = "-".join(part for part in value.split("-") if part)
    return value or "study-output"


def resolve_artifact_path(collection_id: str, filename: str) -> Path:
    ensure_collection_exists(collection_id)
    cleaned_name = Path(filename).name
    artifact_path = get_collection_artifacts_dir(collection_id) / cleaned_name

    if not artifact_path.exists() or artifact_path.suffix.lower() != ".md":
        raise HTTPException(status_code=404, detail="Artifact not found.")

    return artifact_path


def build_artifact_title(kind: str, filename: str) -> str:
    stem = Path(filename).stem
    prefix = f"{kind}-"
    if not stem.startswith(prefix):
        return format_artifact_kind(kind)

    suffix = stem[len(prefix):].strip()
    if not suffix:
        return format_artifact_kind(kind)

    if len(suffix) == 15 and suffix[8] == "-" and suffix.replace("-", "").isdigit():
        return format_artifact_kind(kind)

    return suffix.replace("-", " ").strip().title() or format_artifact_kind(kind)


def rename_artifact(collection_id: str, filename: str, name: str) -> Path:
    artifact_path = resolve_artifact_path(collection_id, filename)
    kind = artifact_path.stem.split("-", 1)[0] or "artifact"
    cleaned_name = name.strip()
    if not cleaned_name:
        raise HTTPException(status_code=400, detail="Artifact name is required.")

    slug = slugify_artifact_title(cleaned_name)
    artifacts_dir = get_collection_artifacts_dir(collection_id)
    candidate = artifacts_dir / f"{kind}-{slug}.md"
    suffix = 2
    while candidate.exists() and candidate.name != artifact_path.name:
        candidate = artifacts_dir / f"{kind}-{slug}-{suffix}.md"
        suffix += 1

    artifact_path.rename(candidate)
    return candidate


def delete_artifact(collection_id: str, filename: str) -> None:
    artifact_path = resolve_artifact_path(collection_id, filename)
    artifact_path.unlink()


def build_source_references(docs: list[Any]) -> list[SourceReference]:
    references: list[SourceReference] = []
    seen: set[tuple[str, int | None]] = set()

    for doc in docs:
        metadata = doc.metadata or {}
        source_name = Path(str(metadata.get("source") or "Unknown source")).name
        page = metadata.get("page")
        page_number = int(page) + 1 if isinstance(page, int) else None
        key = (source_name, page_number)
        if key in seen:
            continue
        seen.add(key)

        snippet = " ".join(str(doc.page_content or "").split())
        references.append(
            SourceReference(
                source=source_name,
                page=page_number,
                snippet=snippet[:220] + ("..." if len(snippet) > 220 else ""),
            )
        )

    return references


def read_artifact_detail(collection_id: str, filename: str) -> ArtifactDetailResponse:
    artifact_path = resolve_artifact_path(collection_id, filename)
    content = artifact_path.read_text(encoding="utf-8")
    kind = artifact_path.stem.split("-", 1)[0] or "artifact"
    updated_at = datetime.fromtimestamp(artifact_path.stat().st_mtime).isoformat()

    return ArtifactDetailResponse(
        filename=artifact_path.name,
        kind=kind,
        title=build_artifact_title(kind, artifact_path.name),
        saved_path=str(artifact_path),
        updated_at=updated_at,
        content=content,
    )


# ── Endpoints ────────────────────────────────────────────────────


@app.get("/collections", response_model=CollectionListResponse)
async def get_collections():
    return CollectionListResponse(
        collections=[CollectionResponse(**item) for item in summarize_collections()]
    )


@app.post("/collections", response_model=CollectionResponse)
async def create_collection_endpoint(req: CreateCollectionRequest):
    try:
        record = create_collection(req.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return CollectionResponse(
        id=record.id,
        name=record.name,
        is_default=record.is_default,
        document_count=0,
        artifact_count=0,
    )


@app.patch("/collections/{collection_id}", response_model=CollectionResponse)
async def update_collection_endpoint(collection_id: str, req: UpdateCollectionRequest):
    try:
        record = rename_collection(collection_id, req.name)
    except ValueError as exc:
        message = str(exc)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from exc

    return CollectionResponse(
        id=record.id,
        name=record.name,
        is_default=record.is_default,
        document_count=len(list_collection_documents(record.id)),
        artifact_count=len(list_collection_artifacts(record.id)),
    )


@app.delete("/collections/{collection_id}", response_model=CollectionListResponse)
async def delete_collection_endpoint(collection_id: str):
    try:
        delete_collection(collection_id)
    except ValueError as exc:
        message = str(exc)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from exc

    clear_collection_runtime(collection_id)
    return CollectionListResponse(
        collections=[CollectionResponse(**item) for item in summarize_collections()]
    )


@app.get("/collections/{collection_id}/documents", response_model=DocumentListResponse)
async def get_collection_documents(collection_id: str):
    documents = list_available_documents(collection_id)
    return DocumentListResponse(documents=[DocumentRecord(**item) for item in documents])


@app.get("/collections/{collection_id}/artifacts", response_model=ArtifactListResponse)
async def get_collection_artifacts(collection_id: str):
    ensure_collection_exists(collection_id)
    return ArtifactListResponse(
        artifacts=[
            ArtifactRecord(
                **item,
                title=build_artifact_title(item["kind"], item["filename"]),
            )
            for item in list_collection_artifacts(collection_id)
        ]
    )


@app.get(
    "/collections/{collection_id}/artifacts/{artifact_name}",
    response_model=ArtifactDetailResponse,
)
async def get_collection_artifact_detail(collection_id: str, artifact_name: str):
    return read_artifact_detail(collection_id, artifact_name)


@app.patch(
    "/collections/{collection_id}/artifacts/{artifact_name}",
    response_model=ArtifactDetailResponse,
)
async def update_collection_artifact(
    collection_id: str,
    artifact_name: str,
    req: UpdateArtifactRequest,
):
    renamed_path = rename_artifact(collection_id, artifact_name, req.name)
    return read_artifact_detail(collection_id, renamed_path.name)


@app.delete(
    "/collections/{collection_id}/artifacts/{artifact_name}",
    response_model=ArtifactListResponse,
)
async def delete_collection_artifact(collection_id: str, artifact_name: str):
    delete_artifact(collection_id, artifact_name)
    return ArtifactListResponse(
        artifacts=[
            ArtifactRecord(
                **item,
                title=build_artifact_title(item["kind"], item["filename"]),
            )
            for item in list_collection_artifacts(collection_id)
        ]
    )

@app.post("/chat", response_model=ChatResponse)
async def chat_endpoint(req: ChatRequest):
    ensure_collection_has_documents(req.collection_id)

    # Convert client history to LangChain message objects (oldest first).
    chat_history: list[HumanMessage | AIMessage] = []
    for msg in req.history:
        if msg.role == "user":
            chat_history.append(HumanMessage(content=msg.content))
        else:
            chat_history.append(AIMessage(content=msg.content))

    try:
        runtime = get_collection_runtime(req.collection_id)

        if req.source_names:
            # Source-filtered path: retrieve with source filtering then call
            # the LLM directly so the user's chosen sources are respected.
            source_docs = retrieve_documents(
                req.message, runtime["retriever"], req.source_names
            )
            if not source_docs:
                raise HTTPException(
                    status_code=400,
                    detail="No matching context was found in the selected sources.",
                )
            context = "\n\n---\n\n".join(doc.page_content for doc in source_docs)
            # The answer prompt expects {context, chat_history, input}.
            prompt_messages = runtime["prompt"].format_messages(
                context=context,
                chat_history=chat_history,
                input=normalize_question(req.message),
            )
            result = runtime["llm"].invoke(prompt_messages)
            reply = result.content if hasattr(result, "content") else str(result)
        else:
            # History-aware RAG chain: rewrites the question against the chat
            # history, retrieves with MMR, then calls the LLM with full context.
            result = runtime["rag_chain"].invoke(
                {"input": req.message, "chat_history": chat_history}
            )
            reply = result["answer"]
            source_docs = result.get("context") or []
            if not source_docs:
                raise HTTPException(
                    status_code=400,
                    detail="No matching context was found in the collection.",
                )

        return ChatResponse(reply=reply, sources=build_source_references(source_docs))
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Chat request failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/chat/stream")
async def chat_stream_endpoint(req: ChatRequest):
    """Server-Sent Events streaming variant of /chat.

    Emits newline-delimited SSE events::

        data: {"token": "Hello"}\n\n
        data: {"token": " world"}\n\n
        data: {"done": true, "sources": [...]}\n\n

    A final ``{"done": true, "sources": [...]}`` event signals completion.
    Errors are emitted as ``{"error": "message"}`` followed by stream close.
    """
    import json

    ensure_collection_has_documents(req.collection_id)

    chat_history: list[HumanMessage | AIMessage] = []
    for msg in req.history:
        if msg.role == "user":
            chat_history.append(HumanMessage(content=msg.content))
        else:
            chat_history.append(AIMessage(content=msg.content))

    async def event_generator():
        try:
            runtime = get_collection_runtime(req.collection_id)

            if req.source_names:
                source_docs = retrieve_documents(
                    req.message, runtime["retriever"], req.source_names
                )
                if not source_docs:
                    yield f"data: {json.dumps({'error': 'No matching context was found in the selected sources.'})}\n\n"
                    return
                context = "\n\n---\n\n".join(doc.page_content for doc in source_docs)
                prompt_messages = runtime["prompt"].format_messages(
                    context=context,
                    chat_history=chat_history,
                    input=normalize_question(req.message),
                )
                for chunk in runtime["llm"].stream(prompt_messages):
                    token = chunk.content if hasattr(chunk, "content") else str(chunk)
                    if token:
                        yield f"data: {json.dumps({'token': token})}\n\n"
            else:
                # Use the history-aware retriever to rewrite the question,
                # then stream the LLM answer token by token.
                history_aware = runtime["rag_chain"].steps[0]  # history_aware_retriever
                retriever_chain = runtime["rag_chain"].steps[1]  # combine_docs_chain

                source_docs = await history_aware.ainvoke(
                    {"input": req.message, "chat_history": chat_history}
                )
                if not source_docs:
                    yield f"data: {json.dumps({'error': 'No matching context was found in the collection.'})}\n\n"
                    return

                context = "\n\n---\n\n".join(
                    doc.page_content for doc in source_docs
                )
                prompt_messages = runtime["prompt"].format_messages(
                    context=context,
                    chat_history=chat_history,
                    input=normalize_question(req.message),
                )
                for chunk in runtime["llm"].stream(prompt_messages):
                    token = chunk.content if hasattr(chunk, "content") else str(chunk)
                    if token:
                        yield f"data: {json.dumps({'token': token})}\n\n"

            yield f"data: {json.dumps({'done': True, 'sources': [s.model_dump() for s in build_source_references(source_docs)]})}\n\n"
        except HTTPException as exc:
            yield f"data: {json.dumps({'error': exc.detail})}\n\n"
        except Exception as exc:
            logger.exception("Streaming chat request failed")
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/artifacts", response_model=ArtifactResponse)
async def generate_artifact(req: ArtifactRequest):
    ensure_collection_has_documents(req.collection_id)

    try:
        runtime = get_collection_runtime(req.collection_id)
        seed_prompt = artifact_seed_prompt(req.kind, req.prompt)
        context = retrieve_context(seed_prompt, runtime["retriever"], req.source_names)
        if not context.strip():
            raise HTTPException(
                status_code=400,
                detail="No relevant context was found for this artifact request.",
            )

        prompt = render_artifact_prompt(req.kind, seed_prompt, context)
        result = runtime["llm"].invoke(prompt)
        content = result.content if hasattr(result, "content") else str(result)
        saved_path = save_artifact(req.collection_id, req.kind, content)

        return ArtifactResponse(
            kind=req.kind,
            title=build_artifact_title(req.kind, saved_path.name),
            content=content,
            filename=saved_path.name,
            saved_path=str(saved_path),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Artifact generation failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/upload", response_model=UploadResponse)
async def upload_document(
    file: UploadFile = File(...),
    collection_id: str = Form(LEGACY_COLLECTION_ID),
):
    collection_id = ensure_collection_exists(collection_id)
    filename = _validate_upload_filename(file.filename)
    docs_dir = get_collection_docs_dir(collection_id)
    docs_dir.mkdir(parents=True, exist_ok=True)
    file_path = docs_dir / filename

    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")
        if len(content) > MAX_UPLOAD_BYTES:
            max_mb = MAX_UPLOAD_BYTES / (1024 * 1024)
            raise HTTPException(
                status_code=413,
                detail=f"File exceeds the {max_mb:.0f} MB upload limit.",
            )

        # Skip re-ingestion when the exact same bytes already exist on disk.
        # This prevents redundant embedding runs when a file is uploaded twice.
        incoming_hash = hashlib.sha256(content).hexdigest()
        if file_path.exists():
            existing_hash = hashlib.sha256(file_path.read_bytes()).hexdigest()
            if incoming_hash == existing_hash:
                logger.info(
                    "Skipping re-ingest for '%s': content unchanged (sha256=%s).",
                    filename,
                    incoming_hash[:12],
                )
                chunks = len(list_available_documents(collection_id))
                return UploadResponse(
                    filename=filename,
                    status="unchanged",
                    chunks_added=chunks,
                    collection_id=collection_id,
                )

        file_path.write_bytes(content)
        chunks_added = ingest_file_into_collection(collection_id, str(file_path))

        return UploadResponse(
            filename=filename,
            status="success",
            chunks_added=chunks_added,
            collection_id=collection_id,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Upload failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/collections/{collection_id}/upload", response_model=UploadResponse)
async def upload_collection_document(collection_id: str, file: UploadFile = File(...)):
    return await upload_document(file=file, collection_id=collection_id)


@app.delete(
    "/collections/{collection_id}/documents/{document_name}",
    response_model=DocumentListResponse,
)
async def delete_collection_document(collection_id: str, document_name: str):
    collection_id = ensure_collection_exists(collection_id)
    cleaned_name = _validate_document_name(document_name)
    path = get_collection_docs_dir(collection_id) / cleaned_name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Document not found.")

    path.unlink()
    remove_file_from_collection(collection_id, str(path))
    documents = list_available_documents(collection_id)
    return DocumentListResponse(documents=[DocumentRecord(**item) for item in documents])


@app.get("/documents", response_model=DocumentListResponse)
async def list_default_documents():
    documents = list_available_documents(LEGACY_COLLECTION_ID)
    return DocumentListResponse(documents=[DocumentRecord(**item) for item in documents])


@app.get("/")
async def root():
    return {"message": "Local RAG API is running", "collections": len(summarize_collections())}


@app.get("/health")
async def health():
    summaries = summarize_collections()
    document_total = sum(int(item["document_count"]) for item in summaries)
    return {
        "status": "ok",
        "collections": len(summaries),
        "documents": document_total,
    }


if __name__ == "__main__":
    import uvicorn

    logging.basicConfig(level=logging.INFO)
    uvicorn.run("api:app", host="127.0.0.1", port=9999, reload=True)
