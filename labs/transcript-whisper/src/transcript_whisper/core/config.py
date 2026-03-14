from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Tuple


@dataclass(frozen=True)
class Settings:
    app_name: str
    app_env: str
    app_host: str
    app_port: int
    app_log_level: str

    whisper_model: str
    whisper_default_task: str
    whisper_output_dir: str
    whisper_model_cache_size: int
    whisper_allowed_input_dirs: Tuple[str, ...]


def _parse_allowed_input_dirs(raw_value: str | None) -> Tuple[str, ...]:
    if raw_value and raw_value.strip() == "*":
        return ()

    if raw_value:
        values = [item.strip() for item in raw_value.split(os.pathsep) if item.strip()]
        if values:
            return tuple(str(Path(item).expanduser().resolve()) for item in values)

    return (str(Path.home().resolve()),)


def _load_settings() -> Settings:
    env_file = Path(".env")
    if env_file.exists():
        for raw_line in env_file.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())

    return Settings(
        app_name=os.getenv("APP_NAME", "Transcript Whisper API"),
        app_env=os.getenv("APP_ENV", "production"),
        app_host=os.getenv("APP_HOST", "127.0.0.1"),
        app_port=int(os.getenv("APP_PORT", "8000")),
        app_log_level=os.getenv("APP_LOG_LEVEL", "INFO"),
        whisper_model=os.getenv("WHISPER_MODEL", "small"),
        whisper_default_task=os.getenv("WHISPER_DEFAULT_TASK", "transcribe"),
        whisper_output_dir=os.getenv("WHISPER_OUTPUT_DIR", "outputs"),
        whisper_model_cache_size=max(1, int(os.getenv("WHISPER_MODEL_CACHE_SIZE", "1"))),
        whisper_allowed_input_dirs=_parse_allowed_input_dirs(
            os.getenv("WHISPER_ALLOWED_INPUT_DIRS")
        ),
    )


settings = _load_settings()
