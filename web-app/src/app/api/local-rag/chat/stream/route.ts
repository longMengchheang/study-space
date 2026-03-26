import { buildLocalRagApiUrl } from "@/lib/local-rag";

export const dynamic = "force-dynamic";

/**
 * Proxy for the RAG streaming chat endpoint.
 *
 * Forwards the request body to the Python backend's `/chat/stream`
 * endpoint and pipes the SSE response straight through to the browser.
 * Falls back gracefully when the backend is unreachable.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const upstream = await fetch(buildLocalRagApiUrl("/chat/stream"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // @ts-expect-error — Node 18+ fetch supports duplex
      duplex: "half",
      cache: "no-store",
    });

    if (!upstream.ok || !upstream.body) {
      const data = await upstream.json().catch(() => ({})) as { detail?: string };
      return new Response(
        JSON.stringify({ detail: data.detail || "Streaming chat request failed." }),
        { status: upstream.status, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        detail: error instanceof Error ? error.message : "Unable to reach Local RAG.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }
}
