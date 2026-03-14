from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Callable
from typing import Optional


class AudioExtractionError(RuntimeError):
    pass


class AudioExtractionCanceledError(AudioExtractionError):
    pass


def resolve_ffmpeg_binary() -> str:
    configured = os.getenv("FFMPEG_BINARY", "").strip()
    if configured:
        configured_path = Path(configured).expanduser()
        if configured_path.exists():
            return str(configured_path.resolve())
        resolved = shutil.which(configured)
        if resolved:
            return resolved

    resolved = shutil.which("ffmpeg")
    if resolved:
        return resolved

    local_app_data = os.getenv("LOCALAPPDATA", "").strip()
    if local_app_data:
        winget_root = Path(local_app_data) / "Microsoft" / "WinGet" / "Packages"
        if winget_root.exists():
            matches = sorted(
                winget_root.glob("Gyan.FFmpeg_*/*/bin/ffmpeg.exe"),
                reverse=True,
            )
            if matches:
                return str(matches[0].resolve())

    raise AudioExtractionError("ffmpeg not found in PATH")


def ensure_ffmpeg_on_path() -> str:
    ffmpeg_binary = resolve_ffmpeg_binary()
    ffmpeg_directory = str(Path(ffmpeg_binary).resolve().parent)
    current_path = os.environ.get("PATH", "")
    path_entries = current_path.split(os.pathsep) if current_path else []

    if ffmpeg_directory not in path_entries:
        os.environ["PATH"] = (
            ffmpeg_directory
            if not current_path
            else ffmpeg_directory + os.pathsep + current_path
        )

    os.environ["FFMPEG_BINARY"] = ffmpeg_binary
    return ffmpeg_binary


def resolve_ffprobe_binary() -> str:
    ffmpeg_binary = ensure_ffmpeg_on_path()
    ffprobe_name = "ffprobe.exe" if os.name == "nt" else "ffprobe"
    ffprobe_path = Path(ffmpeg_binary).resolve().with_name(ffprobe_name)
    if ffprobe_path.exists():
        return str(ffprobe_path)

    resolved = shutil.which("ffprobe")
    if resolved:
        return resolved

    raise AudioExtractionError("ffprobe not found in PATH")


def read_media_duration(input_path: Path) -> Optional[float]:
    ffprobe_binary = resolve_ffprobe_binary()
    cmd = [
        ffprobe_binary,
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(input_path),
    ]

    try:
        completed = subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None

    raw_duration = completed.stdout.strip()
    if not raw_duration:
        return None

    try:
        return max(0.0, float(raw_duration))
    except ValueError:
        return None


class AudioService:
    @staticmethod
    def extract_audio(
        input_path: Path,
        output_dir: Path,
        audio_format: str = "mp3",
        bitrate: str = "192k",
        progress_callback: Optional[Callable[[int, str], None]] = None,
        is_canceled: Optional[Callable[[], bool]] = None,
    ) -> Path:
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / f"{input_path.stem}.{audio_format}"
        ffmpeg_binary = ensure_ffmpeg_on_path()
        duration_seconds = read_media_duration(input_path)

        cmd = [
            ffmpeg_binary,
            "-y",
            "-i",
            str(input_path),
            "-vn",
            "-b:a",
            bitrate,
            "-progress",
            "pipe:1",
            "-nostats",
            "-loglevel",
            "error",
            str(output_path),
        ]

        try:
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
        except FileNotFoundError as exc:
            raise AudioExtractionError("ffmpeg not found in PATH") from exc

        try:
            if progress_callback:
                progress_callback(0, "Extracting audio...")

            assert process.stdout is not None
            while True:
                if is_canceled and is_canceled():
                    process.terminate()
                    process.wait(timeout=5)
                    raise AudioExtractionCanceledError("Audio extraction canceled.")

                line = process.stdout.readline()
                if not line:
                    if process.poll() is not None:
                        break
                    continue

                line = line.strip()
                if "=" not in line:
                    continue

                key, value = line.split("=", 1)
                if key == "out_time_ms" and duration_seconds and progress_callback:
                    current_seconds = max(0.0, float(value) / 1_000_000.0)
                    percent = int(min(99, (current_seconds / duration_seconds) * 100))
                    progress_callback(percent, f"Extracting audio... {percent}%")
                elif key == "progress" and value == "end" and progress_callback:
                    progress_callback(100, "Audio extraction complete.")

            return_code = process.wait()
            stderr_output = process.stderr.read().strip() if process.stderr else ""
            if return_code != 0:
                detail = stderr_output or "unknown ffmpeg error"
                raise AudioExtractionError(f"ffmpeg failed: {detail}")
        finally:
            if process.stdout:
                process.stdout.close()
            if process.stderr:
                process.stderr.close()

        return output_path
