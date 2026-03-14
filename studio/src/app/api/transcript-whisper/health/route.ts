import { NextResponse } from "next/server";
import { buildTranscriptWhisperApiUrl } from "@/lib/transcript-whisper";

export async function GET() {
  try {
    const response = await fetch(buildTranscriptWhisperApiUrl("/healthz"), {
      cache: "no-store",
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        {
          status: "error",
          detail: data.detail || "Transcript Whisper health check failed.",
        },
        { status: response.status },
      );
    }

    return NextResponse.json(
      {
        status: data.status || "ok",
        connected: true,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        status: "offline",
        connected: false,
        detail: error instanceof Error ? error.message : "Transcript Whisper is unavailable.",
      },
      { status: 503 },
    );
  }
}
