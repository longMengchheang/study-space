/**
 * useRagChat — encapsulates RAG chat state and the sendMessage action.
 *
 * Extracted from StudyRagClient so the logic can be unit-tested
 * independently and reused across different UI layouts.
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

    try {
      const response = await fetch("/api/local-rag/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          collection_id: activeCollectionId,
          source_names: selectedSourceNames,
          history: historyMessages,
        }),
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
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Unable to answer that question.";
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
