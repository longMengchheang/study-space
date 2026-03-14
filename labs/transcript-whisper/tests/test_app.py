from dataclasses import replace
from pathlib import Path

from fastapi.testclient import TestClient

from transcript_whisper.main import app
from transcript_whisper.api.routes import transcription as transcription_routes
from transcript_whisper.services.transcription import WhisperModelRegistry

client = TestClient(app)


def test_healthz() -> None:
    response = client.get("/api/v1/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_root_serves_ui() -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert "Transcript Whisper" in response.text


def test_process_missing_file_validation() -> None:
    response = client.post(
        "/api/v1/transcriptions/process",
        json={
            "input_path": "missing.mp4",
            "model": "small",
            "task": "transcribe",
            "output_format": "txt",
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Input file not found"


def test_process_rejects_input_outside_allowed_dirs(tmp_path, monkeypatch) -> None:
    allowed_dir = tmp_path / "allowed"
    allowed_dir.mkdir()
    blocked_file = tmp_path / "blocked.mp4"
    blocked_file.write_bytes(b"video")

    monkeypatch.setattr(
        transcription_routes,
        "settings",
        replace(transcription_routes.settings, whisper_allowed_input_dirs=(str(allowed_dir),)),
    )

    response = client.post(
        "/api/v1/transcriptions/process",
        json={
            "input_path": str(blocked_file),
            "model": "small",
            "task": "transcribe",
            "output_format": "txt",
        },
    )

    assert response.status_code == 400
    assert "allowed directories" in response.json()["detail"]


def test_upload_sanitizes_filename(tmp_path, monkeypatch) -> None:
    seen_input_path: Path | None = None

    def fake_extract_audio(
        input_path: Path,
        output_dir: Path,
        audio_format: str = "mp3",
        bitrate: str = "192k",
    ) -> Path:
        nonlocal seen_input_path
        seen_input_path = input_path
        output_path = output_dir / f"{input_path.stem}.{audio_format}"
        output_path.write_bytes(b"audio")
        return output_path

    def fake_transcribe(
        file_path: Path,
        model_name: str,
        task: str = "transcribe",
        language: str | None = None,
    ) -> dict[str, object]:
        return {"text": "sanitized transcript", "segments": []}

    monkeypatch.setattr(transcription_routes.audio_service, "extract_audio", fake_extract_audio)
    monkeypatch.setattr(
        transcription_routes.transcription_service,
        "transcribe",
        fake_transcribe,
    )

    response = client.post(
        "/api/v1/transcriptions/upload",
        files={"file": ("../evil.mp4", b"video-bytes", "video/mp4")},
        data={"model": "small", "task": "transcribe"},
    )

    assert response.status_code == 200
    assert response.json() == {"text": "sanitized transcript"}
    assert seen_input_path is not None
    assert seen_input_path.name == "evil.mp4"
    assert ".." not in str(seen_input_path)


def test_upload_rejects_invalid_model() -> None:
    response = client.post(
        "/api/v1/transcriptions/upload",
        files={"file": ("sample.mp4", b"video-bytes", "video/mp4")},
        data={"model": "not-a-model", "task": "transcribe"},
    )

    assert response.status_code == 422


def test_model_registry_evicts_old_models(monkeypatch) -> None:
    load_calls: list[str] = []

    class FakeModel:
        def __init__(self, name: str) -> None:
            self.name = name

        def transcribe(self, *_args, **_kwargs) -> dict[str, object]:
            return {"text": self.name, "segments": []}

    class FakeWhisperModule:
        @staticmethod
        def load_model(model_name: str) -> FakeModel:
            load_calls.append(model_name)
            return FakeModel(model_name)

    monkeypatch.setitem(__import__("sys").modules, "whisper", FakeWhisperModule())

    registry = WhisperModelRegistry(max_cache_size=1)

    first = registry.get("small")
    second = registry.get("base")
    third = registry.get("small")

    assert first.name == "small"
    assert second.name == "base"
    assert third.name == "small"
    assert load_calls == ["small", "base", "small"]
