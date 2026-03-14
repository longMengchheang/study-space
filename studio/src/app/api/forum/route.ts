import { NextResponse } from "next/server";
import { buildLocalRagApiUrl } from "@/lib/local-rag";
import {
  addForumMessage,
  createForumChannel,
  getForumState,
  toggleForumReaction,
  type ForumMessage,
} from "@/lib/forum-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ForumActionRequest =
  | {
      action: "create_channel";
      name?: string;
      description?: string;
    }
  | {
      action: "send_message";
      channelId?: string;
      content?: string;
      parentId?: string | null;
      userId?: string;
      username?: string;
      avatar?: string;
    }
  | {
      action: "toggle_reaction";
      messageId?: string;
      emoji?: string;
      userId?: string;
    }
  | {
      action: "ai_summarize";
      channelId?: string;
    }
  | {
      action: "ai_answer";
      channelId?: string;
      question?: string;
    }
  | {
      action: "ai_insights";
      channelId?: string;
    };

function getChannelMessages(messages: ForumMessage[], channelId: string) {
  return messages
    .filter((message) => message.channelId === channelId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function buildTranscript(messages: ForumMessage[]) {
  return messages
    .map((message) => {
      const user = message.user?.name || "User";
      return `${user}: ${message.content}`;
    })
    .join("\n");
}

function fallbackSummary(messages: ForumMessage[]) {
  const latest = messages.slice(-8);
  if (latest.length === 0) {
    return "No discussion yet. Start asking questions in this channel and I can summarize it.";
  }

  const bulletPoints = latest.map((message) => {
    const content = message.content.replace(/\s+/g, " ").trim();
    return `- ${message.user.name}: ${content.slice(0, 140)}${content.length > 140 ? "..." : ""}`;
  });

  return `Quick summary of recent discussion:\n${bulletPoints.join("\n")}`;
}

function fallbackInsights(messages: ForumMessage[]) {
  if (messages.length === 0) {
    return "No insights yet. Add more messages and I will highlight patterns.";
  }

  const questionCount = messages.filter((message) => message.content.includes("?")).length;
  const replyCount = messages.filter((message) => Boolean(message.parentId)).length;
  const uniqueUsers = new Set(messages.map((message) => message.user.id)).size;

  return [
    "Key channel insights:",
    `- Participants: ${uniqueUsers}`,
    `- Questions asked: ${questionCount}`,
    `- Threaded replies: ${replyCount}`,
    "- Tip: convert unresolved questions into a checklist for revision.",
  ].join("\n");
}

async function askLocalRag(prompt: string) {
  try {
    const response = await fetch(buildLocalRagApiUrl("/chat"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: prompt,
        collection_id: "general",
      }),
      cache: "no-store",
    });

    const data = (await response.json().catch(() => ({}))) as {
      reply?: string;
      detail?: string;
    };

    if (!response.ok) {
      throw new Error(data.detail || "Local RAG request failed.");
    }

    return data.reply || "";
  } catch {
    return "";
  }
}

async function addAiMessage(channelId: string, content: string) {
  return addForumMessage({
    channelId,
    content,
    user: {
      id: "study-ai",
      name: "Study AI",
      avatar: "AI",
    },
  });
}

export async function GET() {
  const state = await getForumState();
  return NextResponse.json(state, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as ForumActionRequest;

  try {
    if (!body || typeof body !== "object" || !("action" in body)) {
      throw new Error("Invalid forum action.");
    }

    switch (body.action) {
      case "create_channel": {
        const next = await createForumChannel(body.name || "", body.description);
        return NextResponse.json(next, { status: 200 });
      }
      case "send_message": {
        const userId = body.userId?.trim() || `user-${Math.random().toString(36).slice(2, 8)}`;
        const username = body.username?.trim() || "Learner";

        const next = await addForumMessage({
          channelId: body.channelId?.trim() || "",
          content: body.content?.trim() || "",
          parentId: body.parentId || null,
          user: {
            id: userId,
            name: username,
            avatar: body.avatar?.trim() || username.slice(0, 1).toUpperCase(),
          },
        });

        return NextResponse.json(next, { status: 200 });
      }
      case "toggle_reaction": {
        const next = await toggleForumReaction({
          messageId: body.messageId?.trim() || "",
          emoji: body.emoji?.trim() || "",
          userId: body.userId?.trim() || "",
        });

        return NextResponse.json(next, { status: 200 });
      }
      case "ai_summarize": {
        const state = await getForumState();
        const channelId = body.channelId?.trim() || "";
        const messages = getChannelMessages(state.messages, channelId);
        const transcript = buildTranscript(messages.slice(-50));

        const ragReply =
          transcript.length > 0
            ? await askLocalRag(
                [
                  "Summarize this forum discussion for students.",
                  "Use compact bullet points and a short action list.",
                  "",
                  transcript,
                ].join("\n"),
              )
            : "";

        const content = ragReply || fallbackSummary(messages);
        const next = await addAiMessage(channelId, content);
        return NextResponse.json(next, { status: 200 });
      }
      case "ai_answer": {
        const channelId = body.channelId?.trim() || "";
        const question = body.question?.trim() || "";

        if (!question) {
          throw new Error("Question is required for AI answer.");
        }

        const state = await getForumState();
        const contextMessages = getChannelMessages(state.messages, channelId).slice(-24);
        const transcript = buildTranscript(contextMessages);

        const ragReply = await askLocalRag(
          [
            "Answer this forum question clearly for study collaboration.",
            "If relevant, include a short explanation and next steps.",
            "Use the discussion context to stay consistent with the channel.",
            "",
            transcript ? `Channel context:\n${transcript}` : "",
            "",
            `Question: ${question}`,
          ].join("\n"),
        );

        const content =
          ragReply ||
          "Local RAG is unavailable right now. Try again once the RAG service is connected.";
        const next = await addAiMessage(channelId, content);
        return NextResponse.json(next, { status: 200 });
      }
      case "ai_insights": {
        const state = await getForumState();
        const channelId = body.channelId?.trim() || "";
        const messages = getChannelMessages(state.messages, channelId);
        const transcript = buildTranscript(messages.slice(-70));

        const ragReply =
          transcript.length > 0
            ? await askLocalRag(
                [
                  "Highlight important insights from this forum discussion.",
                  "Return concise bullets focused on learning outcomes and unresolved questions.",
                  "",
                  transcript,
                ].join("\n"),
              )
            : "";

        const content = ragReply || fallbackInsights(messages);
        const next = await addAiMessage(channelId, content);
        return NextResponse.json(next, { status: 200 });
      }
      default:
        throw new Error("Unknown forum action.");
    }
  } catch (error) {
    return NextResponse.json(
      {
        detail: error instanceof Error ? error.message : "Forum action failed.",
      },
      { status: 400 },
    );
  }
}
