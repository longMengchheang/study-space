import { NextResponse } from "next/server";
import { buildLocalRagApiUrl } from "@/lib/local-rag";

type RouteContext = {
  params: Promise<{
    collectionId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { collectionId } = await context.params;
    const formData = await request.formData();
    const response = await fetch(
      buildLocalRagApiUrl(`/collections/${encodeURIComponent(collectionId)}/upload`),
      {
        method: "POST",
        body: formData,
        cache: "no-store",
      },
    );
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        {
          detail: data.detail || "Unable to upload PDF.",
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
