import { NextResponse } from "next/server";
import { buildTranscriptWhisperApiUrl } from "@/lib/transcript-whisper";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const response = await fetch(buildTranscriptWhisperApiUrl("/transcriptions/upload/jobs"), {
      method: "POST",
      body: formData,
      cache: "no-store",
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        {
          detail: data.detail || "Upload transcription failed.",
        },
        { status: response.status },
      );
    }

    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        detail:
          error instanceof Error ? error.message : "Unable to reach Transcript Whisper.",
      },
      { status: 503 },
    );
  }
}
