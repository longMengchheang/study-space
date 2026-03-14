from __future__ import annotations

from typing import Literal
from typing import Optional
from typing import Any

from pydantic import BaseModel, Field


ModelName = Literal["tiny", "base", "small", "medium", "large"]
TaskName = Literal["transcribe", "translate"]
OutputFormat = Literal["txt", "srt", "vtt", "tsv", "json", "all"]


class ProcessRequest(BaseModel):
    input_path: str = Field(..., description="Absolute or relative path to media file")
    output_dir: Optional[str] = Field(default=None, description="Output directory")
    audio_format: str = Field(default="mp3", description="Audio output extension")
    audio_bitrate: str = Field(default="192k", description="Audio bitrate")
    model: ModelName = Field(default="small")
    language: Optional[str] = Field(default=None)
    task: TaskName = Field(default="transcribe")
    output_format: OutputFormat = Field(default="txt")


class ProcessResponse(BaseModel):
    audio_path: str
    transcript_paths: dict[str, str]
    text: Optional[str]


class UploadResponse(BaseModel):
    text: str


JobStatus = Literal["queued", "running", "completed", "failed", "canceled"]
JobPhase = Literal["queued", "extracting", "transcribing", "writing", "completed", "failed", "canceled"]


class JobAcceptedResponse(BaseModel):
    job_id: str
    status: JobStatus


class JobStatusResponse(BaseModel):
    job_id: str
    status: JobStatus
    phase: JobPhase
    percent: int = Field(ge=0, le=100)
    message: str
    cancel_requested: bool = False
    error: Optional[str] = None
    result: Optional[dict[str, Any]] = None
