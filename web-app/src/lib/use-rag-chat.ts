/**
 * useRagChat — encapsulates RAG chat state and the sendMessage action.
 *
 * Extracted from StudyRagClient so the logic can be unit-tested
 * independently and reused across different UI layouts.
 *
 * When the `/api/local-rag/chat/stream` endpoint is available the hook
 * streams LLM tokens token-by-token using Server-Sent Events.  It
 * automatically falls back to the non-streaming `/api/local-rag/chat`
 * endpoint if streaming fails or is not supported.
 */
import { useCallback, useState } from "react";

export type Message = {
  id: string;
  role: "user" | "ai";
  content: string;
  sources?: SourceReference[];
  timestamp?: string;
};

export type SourceReference = {
  source: string;
  page?: number | null;
  snippet: string;
};

export const STARTER_MESSAGE: Message = {
  id: "rag-starter",
  role: "ai",
  content:
    "Pick a notebook, add PDFs as sources, and ask questions grounded in those documents.",
};

/** Maximum number of prior conversation turns sent as history to the backend. */
export const RAG_HISTORY_WINDOW = 10;

function buildMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface UseRagChatOptions {
  /** The currently selected collection. */
  activeCollectionId: string;
  /** Source file names to filter retrieved documents to. */
  selectedSourceNames: string[];
  /** Called with the updated message list after every turn so the parent
   *  component can persist the session to localStorage. */
  onSaveSession?: (messages: Message[]) => void;
}

export interface UseRagChatResult {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  chatInput: string;
  setChatInput: React.Dispatch<React.SetStateAction<string>>;
  chatLoading: boolean;
  errorMessage: string | null;
  sendMessage: () => Promise<void>;
  clearMessages: () => void;
}

/**
 * Attempt a streaming request. Resolves when the stream completes.
 * Returns the full reply text and sources array.
 * Throws if the backend returns a non-streaming error or any event
 * contains `{"error": "..."}`.
 */
async function streamChat(
  body: object,
  onToken: (token: string) => void,
): Promise<{ reply: string; sources: SourceReference[] }> {
  const response = await fetch("/api/local-rag/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(data.detail || "Streaming chat request failed.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";
  let sources: SourceReference[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE lines are separated by "\n\n"
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const line = part.startsWith("data: ") ? part.slice(6) : part;
      if (!line.trim()) continue;

      const event = JSON.parse(line) as {
        token?: string;
        done?: boolean;
        sources?: SourceReference[];
        error?: string;
      };

      if (event.error) {
        throw new Error(event.error);
      }
      if (event.token) {
        reply += event.token;
        onToken(event.token);
      }
      if (event.done) {
        sources = event.sources ?? [];
      }
    }
  }

  return { reply, sources };
}

export function useRagChat({
  activeCollectionId,
  selectedSourceNames,
  onSaveSession,
}: UseRagChatOptions): UseRagChatResult {
  const [messages, setMessages] = useState<Message[]>([STARTER_MESSAGE]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const clearMessages = useCallback(() => {
    setMessages([STARTER_MESSAGE]);
    setErrorMessage(null);
  }, []);

  const sendMessage = useCallback(async () => {
    const message = chatInput.trim();
    if (!message) return;

    const baseMessages =
      messages.length === 1 && messages[0]?.id === STARTER_MESSAGE.id ? [] : messages;

    const userMessage: Message = {
      id: buildMessageId("user"),
      role: "user",
      content: message,
      timestamp: new Date().toISOString(),
    };

    const nextUserMessages = [...baseMessages, userMessage];
    setMessages(nextUserMessages);
    onSaveSession?.(nextUserMessages);
    setChatInput("");
    setChatLoading(true);
    setErrorMessage(null);

    // Build history from prior messages (exclude starter), capped to window.
    const historyMessages = baseMessages
      .slice(-(RAG_HISTORY_WINDOW * 2))
      .map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content,
      }));

    const requestBody = {
      message,
      collection_id: activeCollectionId,
      source_names: selectedSourceNames,
      history: historyMessages,
    };

    // Placeholder AI message updated incrementally during streaming.
    const aiId = buildMessageId("ai");
    const streamingPlaceholder: Message = {
      id: aiId,
      role: "ai",
      content: "",
      sources: [],
      timestamp: new Date().toISOString(),
    };

    try {
      // Optimistically add the placeholder so the UI shows a streaming bubble.
      setMessages([...nextUserMessages, streamingPlaceholder]);

      const { reply, sources } = await streamChat(requestBody, (token) => {
        setMessages((current) =>
          current.map((m) =>
            m.id === aiId ? { ...m, content: m.content + token } : m,
          ),
        );
      });

      // Finalise with complete reply + sources from the done event.
      const finalAiMessage: Message = {
        id: aiId,
        role: "ai",
        content: reply,
        sources,
        timestamp: new Date().toISOString(),
      };
      const nextMessages = [...nextUserMessages, finalAiMessage];
      setMessages(nextMessages);
      onSaveSession?.(nextMessages);
    } catch (streamError) {
      // Streaming failed — fall back to the non-streaming endpoint.
      try {
        const response = await fetch("/api/local-rag/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });

        const data = (await response.json().catch(() => ({}))) as {
          reply?: string;
          sources?: SourceReference[];
          detail?: string;
        };

        if (!response.ok) {
          throw new Error(data.detail || "Unable to answer that question.");
        }

        const aiMessage: Message = {
          id: buildMessageId("ai"),
          role: "ai",
          content: data.reply || "",
          sources: data.sources ?? [],
          timestamp: new Date().toISOString(),
        };
        const nextMessages = [...nextUserMessages, aiMessage];
        setMessages(nextMessages);
        onSaveSession?.(nextMessages);
      } catch (fallbackError) {
        const detail =
          fallbackError instanceof Error
            ? fallbackError.message
            : streamError instanceof Error
              ? streamError.message
              : "Unable to answer that question.";
        setErrorMessage(detail);

        const errorReply: Message = {
          id: buildMessageId("error"),
          role: "ai",
          content: detail,
          timestamp: new Date().toISOString(),
        };
        const nextMessages = [...nextUserMessages, errorReply];
        setMessages(nextMessages);
        onSaveSession?.(nextMessages);
      }
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, messages, activeCollectionId, selectedSourceNames, onSaveSession]);

  return {
    messages,
    setMessages,
    chatInput,
    setChatInput,
    chatLoading,
    errorMessage,
    sendMessage,
    clearMessages,
  };
}

