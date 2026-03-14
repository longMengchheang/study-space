from __future__ import annotations

from fastapi import APIRouter

from transcript_whisper.api.routes.health import router as health_router
from transcript_whisper.api.routes.transcription import router as transcription_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(transcription_router)
