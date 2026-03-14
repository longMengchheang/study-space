import { buildTranscriptWhisperApiUrl } from "@/lib/transcript-whisper";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const response = await fetch(
    buildTranscriptWhisperApiUrl(`/transcriptions/jobs/${jobId}/events`),
    {
      cache: "no-store",
      headers: {
        Accept: "text/event-stream",
      },
    },
  );

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "Unable to open progress stream.");
    return new Response(detail, {
      status: response.status || 503,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
