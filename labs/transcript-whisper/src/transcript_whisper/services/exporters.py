from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from transcript_whisper.utils.timecode import to_srt_time, to_vtt_time


class ExportService:
    def write_outputs(
        self,
        result: dict[str, Any],
        out_dir: Path,
        base_name: str,
        fmt: str,
    ) -> dict[str, str]:
        out_dir.mkdir(parents=True, exist_ok=True)
        outputs: dict[str, str] = {}

        def write_txt() -> None:
            path = out_dir / f"{base_name}.txt"
            path.write_text(result["text"].strip() + "\n", encoding="utf-8")
            outputs["txt"] = str(path)

        def write_srt() -> None:
            path = out_dir / f"{base_name}.srt"
            with path.open("w", encoding="utf-8") as handle:
                for idx, seg in enumerate(result["segments"], start=1):
                    handle.write(f"{idx}\n")
                    handle.write(
                        f"{to_srt_time(seg['start'])} --> {to_srt_time(seg['end'])}\n"
                    )
                    handle.write(seg["text"].strip() + "\n\n")
            outputs["srt"] = str(path)

        def write_vtt() -> None:
            path = out_dir / f"{base_name}.vtt"
            with path.open("w", encoding="utf-8") as handle:
                handle.write("WEBVTT\n\n")
                for seg in result["segments"]:
                    handle.write(
                        f"{to_vtt_time(seg['start'])} --> {to_vtt_time(seg['end'])}\n"
                    )
                    handle.write(seg["text"].strip() + "\n\n")
            outputs["vtt"] = str(path)

        def write_tsv() -> None:
            path = out_dir / f"{base_name}.tsv"
            with path.open("w", encoding="utf-8") as handle:
                handle.write("start\tend\ttext\n")
                for seg in result["segments"]:
                    handle.write(
                        f"{seg['start']:.3f}\t{seg['end']:.3f}\t{seg['text'].strip()}\n"
                    )
            outputs["tsv"] = str(path)

        def write_json() -> None:
            path = out_dir / f"{base_name}.json"
            path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            outputs["json"] = str(path)

        if fmt == "txt":
            write_txt()
        elif fmt == "srt":
            write_srt()
        elif fmt == "vtt":
            write_vtt()
        elif fmt == "tsv":
            write_tsv()
        elif fmt == "json":
            write_json()
        elif fmt == "all":
            write_txt()
            write_srt()
            write_vtt()
            write_tsv()
            write_json()
        else:
            raise ValueError(f"Unknown output format: {fmt}")

        return outputs
