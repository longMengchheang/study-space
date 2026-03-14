from __future__ import annotations

from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from transcript_whisper.api.router import api_router
from transcript_whisper.api.routes.transcription import process, upload
from transcript_whisper.core.config import settings
from transcript_whisper.core.logging import configure_logging

PROJECT_ROOT = Path(__file__).resolve().parents[2]
STATIC_DIR = PROJECT_ROOT / "static"

configure_logging(settings.app_log_level)

app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

app.include_router(api_router, prefix="/api/v1")


@app.get("/", response_class=HTMLResponse, tags=["web"])
def index() -> HTMLResponse:
    index_file = STATIC_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="UI not found")
    return HTMLResponse(index_file.read_text(encoding="utf-8"))


# Backward-compatible endpoints for existing clients
app.add_api_route("/upload", endpoint=upload, methods=["POST"])
app.add_api_route("/process", endpoint=process, methods=["POST"])


def run() -> None:
    uvicorn.run(
        "transcript_whisper.main:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=False,
    )


if __name__ == "__main__":
    run()
