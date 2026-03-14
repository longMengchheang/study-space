import {
  getForumState,
  subscribeForumState,
  type ForumState,
} from "@/lib/forum-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_INTERVAL_MS = 15_000;

function serializeStateEvent(state: ForumState) {
  return `event: state\ndata: ${JSON.stringify(state)}\n\n`;
}

function serializeHeartbeat() {
  return ": ping\n\n";
}

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  let cleanup: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const pushState = (state: ForumState) => {
        try {
          controller.enqueue(encoder.encode(serializeStateEvent(state)));
        } catch {
          // Stream can be closed by the browser; ignore enqueue failures.
        }
      };

      const initialState = await getForumState();
      pushState(initialState);

      const unsubscribe = subscribeForumState(pushState);
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(serializeHeartbeat()));
        } catch {
          // Ignore heartbeat errors once the stream is closed.
        }
      }, HEARTBEAT_INTERVAL_MS);

      const closeStream = () => {
        clearInterval(heartbeat);
        unsubscribe();
        request.signal.removeEventListener("abort", closeStream);
        try {
          controller.close();
        } catch {
          // Ignore close errors if stream already closed.
        }
      };

      cleanup = closeStream;
      request.signal.addEventListener("abort", closeStream);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
