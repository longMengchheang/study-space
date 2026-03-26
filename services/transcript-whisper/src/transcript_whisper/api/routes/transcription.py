from __future__ import annotations

import asyncio
import json
import re
import shutil
import tempfile
from pathlib import Path
from threading import Thread
from typing import Callable
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse

from transcript_whisper.api.deps import (
    audio_service,
    export_service,
    job_service,
    transcription_service,
)
from transcript_whisper.core.config import settings
from transcript_whisper.schemas.transcription import (
    JobAcceptedResponse,
    JobStatusResponse,
    ModelName,
    ProcessRequest,
    ProcessResponse,
    TaskName,
    UploadResponse,
)
from transcript_whisper.services.audio import (
    AudioExtractionCanceledError,
    AudioExtractionError,
)
from transcript_whisper.services.transcription import (
    TranscriptionCanceledError,
    TranscriptionError,
)

router = APIRouter(prefix="/transcriptions", tags=["transcriptions"])


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _ensure_allowed_path(path: Path, label: str) -> Path:
    allowed_roots = [
        Path(raw_root).expanduser().resolve()
        for raw_root in settings.whisper_allowed_input_dirs
    ]
    if not allowed_roots:
        return path

    if any(_is_relative_to(path, root) for root in allowed_roots):
        return path

    allowed_display = ", ".join(str(root) for root in allowed_roots)
    raise HTTPException(
        status_code=400,
        detail=f"{label} must be inside configured allowed directories: {allowed_display}",
    )


def _sanitize_upload_filename(filename: str) -> str:
    candidate = Path(filename).name.strip()
    if not candidate or candidate in {".", ".."}:
        return f"upload-{uuid4().hex}.bin"

    sanitized = re.sub(r"[^A-Za-z0-9._-]+", "_", candidate)
    if not sanitized or sanitized in {".", ".."}:
        return f"upload-{uuid4().hex}.bin"
    if sanitized.startswith("."):
        sanitized = f"upload-{uuid4().hex}{Path(sanitized).suffix}"
    return sanitized


def _get_job_or_404(job_id: str):
    job = job_service.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def _job_to_payload(job) -> dict:
    return {
        "job_id": job.job_id,
        "status": job.status,
        "phase": job.phase,
        "percent": job.percent,
        "message": job.message,
        "cancel_requested": job.cancel_requested,
        "error": job.error,
        "result": job.result,
    }


def _job_progress_callback(job_id: str, phase: str) -> Callable[[int, str], None]:
    def callback(percent: int, message: str) -> None:
        job_service.update_job(
            job_id,
            status="running",
            phase=phase,
            percent=percent,
            message=message,
        )

    return callback


def _cancel_checker(job_id: str) -> Callable[[], bool]:
    return lambda: job_service.is_cancel_requested(job_id)


def _start_job(target: Callable[..., None], *args, **kwargs) -> None:
    thread = Thread(target=target, args=args, kwargs=kwargs, daemon=True)
    thread.start()


def _run_upload_job(
    job_id: str,
    *,
    input_path: Path,
    temp_dir: Path,
    model: str,
    task: str,
    language: Optional[str],
) -> None:
    try:
        if job_service.is_cancel_requested(job_id):
            job_service.cancel_job(job_id)
            return

        audio_path = audio_service.extract_audio(
            input_path=input_path,
            output_dir=temp_dir,
            audio_format="mp3",
            bitrate="192k",
            progress_callback=_job_progress_callback(job_id, "extracting"),
            is_canceled=_cancel_checker(job_id),
        )

        result = transcription_service.transcribe(
            file_path=audio_path,
            model_name=model,
            task=task,
            language=language,
            progress_callback=_job_progress_callback(job_id, "transcribing"),
            is_canceled=_cancel_checker(job_id),
        )

        job_service.complete_job(
            job_id,
            result={"text": result["text"].strip()},
            message="Transcription complete.",
        )
    except (AudioExtractionCanceledError, TranscriptionCanceledError):
        job_service.cancel_job(job_id)
    except (AudioExtractionError, TranscriptionError) as exc:
        job_service.fail_job(job_id, error=str(exc))
    except Exception as exc:
        job_service.fail_job(job_id, error=f"Unexpected error: {exc}")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def _run_process_job(job_id: str, req: ProcessRequest) -> None:
    try:
        input_path = _ensure_allowed_path(
            Path(req.input_path).expanduser().resolve(),
            "Input path",
        )
        if not input_path.exists() or not input_path.is_file():
            raise AudioExtractionError("Input file not found")

        out_dir = (
            Path(req.output_dir).expanduser().resolve()
            if req.output_dir
            else Path(settings.whisper_output_dir).expanduser().resolve()
        )
        out_dir = _ensure_allowed_path(out_dir, "Output directory")

        audio_path = audio_service.extract_audio(
            input_path=input_path,
            output_dir=out_dir,
            audio_format=req.audio_format,
            bitrate=req.audio_bitrate,
            progress_callback=_job_progress_callback(job_id, "extracting"),
            is_canceled=_cancel_checker(job_id),
        )

        result = transcription_service.transcribe(
            file_path=audio_path,
            model_name=req.model,
            task=req.task,
            language=req.language,
            progress_callback=_job_progress_callback(job_id, "transcribing"),
            is_canceled=_cancel_checker(job_id),
        )

        job_service.update_job(
            job_id,
            status="running",
            phase="writing",
            percent=100,
            message="Writing transcript outputs...",
        )

        outputs = export_service.write_outputs(
            result=result,
            out_dir=out_dir,
            base_name=audio_path.stem,
            fmt=req.output_format,
        )

        job_service.complete_job(
            job_id,
            result={
                "audio_path": str(audio_path),
                "transcript_paths": outputs,
                "text": result["text"].strip() if "txt" in outputs else None,
            },
            message="Path transcription complete.",
        )
    except (AudioExtractionCanceledError, TranscriptionCanceledError):
        job_service.cancel_job(job_id)
    except (AudioExtractionError, TranscriptionError, ValueError) as exc:
        job_service.fail_job(job_id, error=str(exc))
    except Exception as exc:
        job_service.fail_job(job_id, error=f"Unexpected error: {exc}")


@router.post("/process", response_model=ProcessResponse)
def process(req: ProcessRequest) -> ProcessResponse:
    input_path = _ensure_allowed_path(
        Path(req.input_path).expanduser().resolve(),
        "Input path",
    )
    if not input_path.exists() or not input_path.is_file():
        raise HTTPException(status_code=400, detail="Input file not found")

    out_dir = (
        Path(req.output_dir).expanduser().resolve()
        if req.output_dir
        else Path(settings.whisper_output_dir).expanduser().resolve()
    )
    out_dir = _ensure_allowed_path(out_dir, "Output directory")

    try:
        audio_path = audio_service.extract_audio(
            input_path=input_path,
            output_dir=out_dir,
            audio_format=req.audio_format,
            bitrate=req.audio_bitrate,
        )
        result = transcription_service.transcribe(
            file_path=audio_path,
            model_name=req.model,
            task=req.task,
            language=req.language,
        )
    except AudioExtractionError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except TranscriptionError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    try:
        outputs = export_service.write_outputs(
            result=result,
            out_dir=out_dir,
            base_name=audio_path.stem,
            fmt=req.output_format,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return ProcessResponse(
        audio_path=str(audio_path),
        transcript_paths=outputs,
        text=result["text"].strip() if "txt" in outputs else None,
    )


@router.post("/upload", response_model=UploadResponse)
def upload(
    file: UploadFile = File(...),
    model: ModelName = Form(settings.whisper_model),
    language: Optional[str] = Form(None),
    task: TaskName = Form(settings.whisper_default_task),
) -> UploadResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file uploaded")

    with tempfile.TemporaryDirectory() as tmp_dir:
        input_path = Path(tmp_dir) / _sanitize_upload_filename(file.filename)
        with input_path.open("wb") as handle:
            shutil.copyfileobj(file.file, handle)

        try:
            audio_path = audio_service.extract_audio(
                input_path=input_path,
                output_dir=Path(tmp_dir),
                audio_format="mp3",
                bitrate="192k",
            )
            result = transcription_service.transcribe(
                file_path=audio_path,
                model_name=model,
                task=task,
                language=language,
            )
        except AudioExtractionError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        except TranscriptionError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        return UploadResponse(text=result["text"].strip())


@router.post("/upload/jobs", response_model=JobAcceptedResponse)
def upload_job(
    file: UploadFile = File(...),
    model: ModelName = Form(settings.whisper_model),
    language: Optional[str] = Form(None),
    task: TaskName = Form(settings.whisper_default_task),
) -> JobAcceptedResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file uploaded")

    temp_dir = Path(tempfile.mkdtemp(prefix="transcript-whisper-"))
    try:
        input_path = temp_dir / _sanitize_upload_filename(file.filename)
        with input_path.open("wb") as handle:
            shutil.copyfileobj(file.file, handle)
    except Exception as exc:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Failed to receive uploaded file: {exc}") from exc

    job = job_service.create_job(message="Upload received.")
    _start_job(
        _run_upload_job,
        job.job_id,
        input_path=input_path,
        temp_dir=temp_dir,
        model=model,
        task=task,
        language=language,
    )

    return JobAcceptedResponse(job_id=job.job_id, status=job.status)


@router.post("/process/jobs", response_model=JobAcceptedResponse)
def process_job(req: ProcessRequest) -> JobAcceptedResponse:
    input_path = _ensure_allowed_path(
        Path(req.input_path).expanduser().resolve(),
        "Input path",
    )
    if not input_path.exists() or not input_path.is_file():
        raise HTTPException(status_code=400, detail="Input file not found")

    if req.output_dir:
        _ensure_allowed_path(Path(req.output_dir).expanduser().resolve(), "Output directory")

    job = job_service.create_job(message="Queued path transcription.")
    _start_job(_run_process_job, job.job_id, req)
    return JobAcceptedResponse(job_id=job.job_id, status=job.status)


@router.get("/jobs/{job_id}", response_model=JobStatusResponse)
def get_job(job_id: str) -> JobStatusResponse:
    job = _get_job_or_404(job_id)
    return JobStatusResponse(**job.__dict__)


@router.post("/jobs/{job_id}/cancel", response_model=JobStatusResponse)
def cancel_job(job_id: str) -> JobStatusResponse:
    _get_job_or_404(job_id)
    job = job_service.request_cancel(job_id)
    return JobStatusResponse(**job.__dict__)


@router.get("/jobs/{job_id}/events")
async def job_events(job_id: str, request: Request) -> StreamingResponse:
    job = _get_job_or_404(job_id)

    async def event_stream():
        current_job = job
        yield f"data: {json.dumps(_job_to_payload(current_job))}\n\n"
        last_version = current_job.version

        terminal_states = {"completed", "failed", "canceled"}

        while True:
            if await request.is_disconnected():
                break

            if current_job.status in terminal_states:
                break

            updated_job = await asyncio.to_thread(
                job_service.wait_for_update,
                job_id,
                last_version=last_version,
                timeout=10.0,
            )

            if updated_job is None:
                yield ": keep-alive\n\n"
                continue

            current_job = updated_job
            last_version = current_job.version
            yield f"data: {json.dumps(_job_to_payload(current_job))}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
