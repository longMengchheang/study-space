import { NextResponse } from "next/server";
import { buildLocalRagApiUrl } from "@/lib/local-rag";

export async function GET() {
  try {
    const response = await fetch(buildLocalRagApiUrl("/health"), {
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        {
          status: "error",
          connected: false,
          detail: data.detail || "Local RAG health check failed.",
        },
        { status: response.status },
      );
    }

    return NextResponse.json(
      {
        status: data.status || "ok",
        connected: true,
        collections: data.collections ?? 0,
        documents: data.documents ?? 0,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        status: "offline",
        connected: false,
        detail: error instanceof Error ? error.message : "Local RAG is unavailable.",
      },
      { status: 503 },
    );
  }
}
