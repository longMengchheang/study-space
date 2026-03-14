import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from transcript_whisper.services.audio import AudioExtractionError, AudioService

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract audio from a video file using FFmpeg."
    )
    parser.add_argument("input", help="Path to video file (mp4, mov, mkv, etc.)")
    parser.add_argument(
        "--format",
        default="mp3",
        choices=["mp3", "wav", "m4a", "aac", "flac", "ogg"],
        help="Audio output format. Default: mp3",
    )
    parser.add_argument(
        "--out",
        default=None,
        help="Output folder. Default: same folder as input.",
    )
    parser.add_argument(
        "--bitrate",
        default="192k",
        help="Audio bitrate for lossy formats (mp3/aac/m4a/ogg). Default: 192k",
    )
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    if not input_path.exists():
        raise SystemExit(f"Input file not found: {input_path}")

    out_dir = Path(args.out).expanduser().resolve() if args.out else input_path.parent

    try:
        output_path = AudioService.extract_audio(
            input_path=input_path,
            output_dir=out_dir,
            audio_format=args.format,
            bitrate=args.bitrate,
        )
    except AudioExtractionError as exc:
        raise SystemExit(str(exc)) from exc

    print(f"Saved audio: {str(output_path)}")


if __name__ == "__main__":
    main()
