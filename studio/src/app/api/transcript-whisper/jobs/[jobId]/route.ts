import { NextResponse } from "next/server";
import { buildTranscriptWhisperApiUrl } from "@/lib/transcript-whisper";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { jobId } = await context.params;
    const response = await fetch(buildTranscriptWhisperApiUrl(`/transcriptions/jobs/${jobId}`), {
      cache: "no-store",
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        {
          detail: data.detail || "Unable to read job status.",
        },
        { status: response.status },
      );
    }

    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        detail: error instanceof Error ? error.message : "Unable to reach Transcript Whisper.",
      },
      { status: 503 },
    );
  }
}
