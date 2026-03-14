from __future__ import annotations

from transcript_whisper.core.config import settings
from transcript_whisper.services.audio import AudioService
from transcript_whisper.services.exporters import ExportService
from transcript_whisper.services.jobs import JobService
from transcript_whisper.services.transcription import (
    TranscriptionService,
    WhisperModelRegistry,
)

registry = WhisperModelRegistry(max_cache_size=settings.whisper_model_cache_size)
audio_service = AudioService()
export_service = ExportService()
job_service = JobService()
transcription_service = TranscriptionService(registry=registry)
