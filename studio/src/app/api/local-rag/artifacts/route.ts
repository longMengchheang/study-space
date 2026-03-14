import { NextResponse } from "next/server";
import { buildLocalRagApiUrl } from "@/lib/local-rag";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const response = await fetch(buildLocalRagApiUrl("/artifacts"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        {
          detail: data.detail || "Artifact generation failed.",
        },
        { status: response.status },
      );
    }

    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        detail: error instanceof Error ? error.message : "Unable to reach Local RAG.",
      },
      { status: 503 },
    );
  }
}
