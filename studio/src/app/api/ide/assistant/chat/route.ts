import { NextRequest, NextResponse } from "next/server";
import { buildCodeAssistantUrl, getCodeAssistantModel } from "@/lib/code-assistant";

const SYSTEM_PROMPT = [
  "You are Studyspace Code Companion.",
  "Help with coding practice, debugging, explanations, refactors, and small implementation steps.",
  "Prefer clear, practical answers.",
  "If the user asks for code, return concise code with a short explanation.",
  "If information is missing, say what assumption you are making.",
].join(" ");

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    prompt?: string;
  };
  const prompt = body.prompt?.trim();

  if (!prompt) {
    return NextResponse.json(
      {
        detail: "Prompt is required.",
      },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(buildCodeAssistantUrl("/api/chat"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: getCodeAssistantModel(),
        stream: false,
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
      cache: "no-store",
    });

    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: { content?: string };
    };

    if (!response.ok) {
      return NextResponse.json(
        {
          detail: data.error || `Assistant request failed with ${response.status}.`,
        },
        { status: response.status },
      );
    }

    return NextResponse.json(
      {
        response: data.message?.content || "",
        model: getCodeAssistantModel(),
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        detail: error instanceof Error ? error.message : "Assistant is unavailable.",
      },
      { status: 503 },
    );
  }
}
