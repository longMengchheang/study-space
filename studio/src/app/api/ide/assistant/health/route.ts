import { NextResponse } from "next/server";
import { buildCodeAssistantUrl, getCodeAssistantModel } from "@/lib/code-assistant";

type OllamaTagsResponse = {
  models?: Array<{
    name?: string;
    model?: string;
  }>;
};

export async function GET() {
  const model = getCodeAssistantModel();

  try {
    const response = await fetch(buildCodeAssistantUrl("/api/tags"), {
      cache: "no-store",
    });
    const data = (await response.json().catch(() => ({}))) as OllamaTagsResponse;

    if (!response.ok) {
      return NextResponse.json(
        {
          connected: false,
          status: "error",
          model,
          detail: `Ollama responded with ${response.status}.`,
        },
        { status: response.status },
      );
    }

    const installedModels = (data.models ?? []).map((item) => item.name || item.model || "");
    const modelInstalled = installedModels.some(
      (candidate) => candidate === model || candidate.startsWith(`${model}:`) || model.startsWith(`${candidate}:`),
    );

    return NextResponse.json(
      {
        connected: true,
        status: modelInstalled ? "ready" : "missing-model",
        model,
        modelInstalled,
        detail: modelInstalled
          ? `${model} is available through Ollama.`
          : `${model} is not installed in Ollama yet.`,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        connected: false,
        status: "offline",
        model,
        modelInstalled: false,
        detail: error instanceof Error ? error.message : "Ollama is unavailable.",
      },
      { status: 503 },
    );
  }
}
