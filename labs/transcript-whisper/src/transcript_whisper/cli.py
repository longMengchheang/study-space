from __future__ import annotations

import argparse
from pathlib import Path

from transcript_whisper.services.audio import AudioService
from transcript_whisper.services.exporters import ExportService
from transcript_whisper.services.transcription import (
    TranscriptionService,
    WhisperModelRegistry,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Transcribe audio/video to text with local Whisper."
    )
    parser.add_argument("input", help="Path to media file")
    parser.add_argument(
        "--model",
        default="small",
        choices=["tiny", "base", "small", "medium", "large"],
    )
    parser.add_argument("--language", default=None)
    parser.add_argument("--task", default="transcribe", choices=["transcribe", "translate"])
    parser.add_argument("--out", default="outputs", help="Output directory")
    parser.add_argument("--audio-format", default="mp3")
    parser.add_argument("--audio-bitrate", default="192k")
    parser.add_argument(
        "--format",
        default="txt",
        choices=["txt", "srt", "vtt", "tsv", "json", "all"],
        help="Transcript output format",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    input_path = Path(args.input).expanduser().resolve()
    if not input_path.exists():
        raise SystemExit(f"Input file not found: {input_path}")

    out_dir = Path(args.out).expanduser().resolve()

    audio_service = AudioService()
    export_service = ExportService()
    transcription_service = TranscriptionService(registry=WhisperModelRegistry())

    audio_path = audio_service.extract_audio(
        input_path=input_path,
        output_dir=out_dir,
        audio_format=args.audio_format,
        bitrate=args.audio_bitrate,
    )
    result = transcription_service.transcribe(
        file_path=audio_path,
        model_name=args.model,
        task=args.task,
        language=args.language,
    )
    outputs = export_service.write_outputs(
        result=result,
        out_dir=out_dir,
        base_name=audio_path.stem,
        fmt=args.format,
    )

    print("Transcription complete.")
    for key, path in outputs.items():
        print(f"{key}: {path}")


if __name__ == "__main__":
    main()
