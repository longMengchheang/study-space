import { NextResponse } from "next/server";
import { buildLocalRagApiUrl } from "@/lib/local-rag";

type RouteContext = {
  params: Promise<{
    collectionId: string;
    artifactName: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { collectionId, artifactName } = await context.params;
    const response = await fetch(
      buildLocalRagApiUrl(
        `/collections/${encodeURIComponent(collectionId)}/artifacts/${encodeURIComponent(artifactName)}`,
      ),
      {
        cache: "no-store",
      },
    );
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        {
          detail: data.detail || "Unable to load artifact.",
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

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { collectionId, artifactName } = await context.params;
    const body = await request.json();
    const response = await fetch(
      buildLocalRagApiUrl(
        `/collections/${encodeURIComponent(collectionId)}/artifacts/${encodeURIComponent(artifactName)}`,
      ),
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
      },
    );
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        {
          detail: data.detail || "Unable to update artifact.",
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

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { collectionId, artifactName } = await context.params;
    const response = await fetch(
      buildLocalRagApiUrl(
        `/collections/${encodeURIComponent(collectionId)}/artifacts/${encodeURIComponent(artifactName)}`,
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
          detail: data.detail || "Unable to delete artifact.",
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
