# Local RAG AI Assistant

FastAPI-based local RAG backend used by Studyspace.

## What It Does

- Manages study collections
- Ingests local docs (`.pdf`, `.txt`, `.md`, `.html`)
- Runs retrieval + generation with Ollama
- Generates artifacts (summary, flashcards, quiz, study guide)

## Run

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m uvicorn api:app --host 127.0.0.1 --port 9999 --reload
```

## API Highlights

- `GET /health`
- `GET /collections`
- `POST /collections`
- `POST /chat`
- `POST /upload`
- `POST /artifacts`

## Runtime Data

- `my_docs/`: local source docs for default collection
- `study_collections/`: collection index + generated artifacts

These directories are intentionally kept minimal in git and populated at runtime.

## Notes

- Requires Ollama models configured for embeddings and generation.
- Pydantic request defaults are configured with safe factories to avoid shared mutable state across requests.
