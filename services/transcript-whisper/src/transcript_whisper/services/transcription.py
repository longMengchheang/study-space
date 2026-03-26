from __future__ import annotations

import importlib
from collections import OrderedDict
from pathlib import Path
from threading import Lock
from typing import Any, Optional
from typing import Callable

from transcript_whisper.services.audio import ensure_ffmpeg_on_path


class WhisperModelRegistry:
    def __init__(self, max_cache_size: int = 1) -> None:
        self._cache: OrderedDict[str, Any] = OrderedDict()
        self._lock = Lock()
        self._max_cache_size = max(1, max_cache_size)

    def get(self, model_name: str) -> Any:
        with self._lock:
            if model_name in self._cache:
                self._cache.move_to_end(model_name)
                return self._cache[model_name]

            import whisper

            self._cache[model_name] = whisper.load_model(model_name)
            while len(self._cache) > self._max_cache_size:
                self._cache.popitem(last=False)

            return self._cache[model_name]


class TranscriptionError(RuntimeError):
    pass


class TranscriptionCanceledError(TranscriptionError):
    pass


class TranscriptionService:
    def __init__(self, registry: WhisperModelRegistry) -> None:
        self.registry = registry
        self._transcription_lock = Lock()

    def transcribe(
        self,
        file_path: Path,
        model_name: str,
        task: str = "transcribe",
        language: Optional[str] = None,
        progress_callback: Optional[Callable[[int, str], None]] = None,
        is_canceled: Optional[Callable[[], bool]] = None,
    ) -> dict[str, Any]:
        try:
            whisper_transcribe_module = importlib.import_module("whisper.transcribe")

            ensure_ffmpeg_on_path()
            original_tqdm = whisper_transcribe_module.tqdm.tqdm

            if progress_callback:
                progress_callback(0, "Loading Whisper model...")

            class ProgressTqdm(original_tqdm):
                def update(inner_self, n: int = 1):
                    if is_canceled and is_canceled():
                        raise TranscriptionCanceledError("Transcription canceled.")

                    result = super().update(n)
                    if progress_callback and inner_self.total:
                        percent = int(min(99, (inner_self.n / inner_self.total) * 100))
                        progress_callback(percent, f"Transcribing audio... {percent}%")
                    return result

            with self._transcription_lock:
                whisper_transcribe_module.tqdm.tqdm = ProgressTqdm
                try:
                    model = self.registry.get(model_name)
                    if progress_callback:
                        progress_callback(0, "Starting Whisper transcription...")

                    result = model.transcribe(
                        str(file_path),
                        task=task,
                        language=language,
                        fp16=False,
                        verbose=False,
                    )
                finally:
                    whisper_transcribe_module.tqdm.tqdm = original_tqdm

            if progress_callback:
                progress_callback(100, "Transcription complete.")

            return result
        except TranscriptionCanceledError:
            raise
        except Exception as exc:
            raise TranscriptionError(f"transcription failed: {exc}") from exc
