import { NextResponse } from "next/server";
import { buildLocalRagApiUrl } from "@/lib/local-rag";

type RouteContext = {
  params: Promise<{
    collectionId: string;
    documentName: string;
  }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { collectionId, documentName } = await context.params;
    const response = await fetch(
      buildLocalRagApiUrl(
        `/collections/${encodeURIComponent(collectionId)}/documents/${encodeURIComponent(documentName)}`,
      ),
      {
        method: "DELETE",
        cache: "no-store",
      },
    );
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        {
          detail: data.detail || "Unable to delete document.",
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
