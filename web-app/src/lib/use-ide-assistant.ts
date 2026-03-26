/**
 * useIdeAssistant — encapsulates the AI coding assistant state in the IDE.
 *
 * Manages the prompt input, message history, and the submitPrompt action.
 * Extracted from IdeWorkspaceClient to enable independent testing and
 * potential reuse.
 *
 * Key behaviours:
 * - Chat history is persisted to localStorage keyed by the active file ID
 *   so conversation context survives page reloads and file switches.
 * - In "edit" mode the assistant response is held as a `pendingEdit`
 *   (diff preview) rather than being applied immediately. The caller
 *   should display both the original and proposed content and then call
 *   `acceptEdit()` or `rejectEdit()` to finalize or discard the change.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PracticeFile } from "@/lib/ide-workspace";

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type AssistantMode = "ask" | "edit";

/** A proposed file edit awaiting user confirmation. */
export type PendingEdit = {
  /** The full new content proposed by the assistant. */
  proposedContent: string;
  /** A short description of the edit (the user's original prompt). */
  description: string;
};

const INTRO_MESSAGE: AssistantMessage = {
  id: "assistant-intro",
  role: "assistant",
  content: "I am ready to help with the active file.",
};

const IDE_CHAT_STORAGE_PREFIX = "studyspace.ide.chat.v1.";

function truncateForContext(value: string, limit = 12_000) {
  return value.length > limit ? `${value.slice(0, limit)}\n...` : value;
}

function extractCodeBlock(response: string) {
  const match = response.match(/```[\w-]*\n([\s\S]*?)```/);
  return match ? match[1].trimEnd() : null;
}

function loadPersistedMessages(fileId: string): AssistantMessage[] {
  if (typeof window === "undefined") return [INTRO_MESSAGE];
  try {
    const raw = window.localStorage.getItem(`${IDE_CHAT_STORAGE_PREFIX}${fileId}`);
    if (!raw) return [INTRO_MESSAGE];
    const parsed = JSON.parse(raw) as AssistantMessage[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [INTRO_MESSAGE];
    return parsed;
  } catch {
    return [INTRO_MESSAGE];
  }
}

function persistMessages(fileId: string, messages: AssistantMessage[]) {
  try {
    window.localStorage.setItem(
      `${IDE_CHAT_STORAGE_PREFIX}${fileId}`,
      JSON.stringify(messages),
    );
  } catch {
    // Ignore storage quota errors.
  }
}

export interface UseIdeAssistantOptions {
  activeFile: PracticeFile | null;
  selectionPreview: string;
  onApplyEdit: (content: string) => void;
}

export interface UseIdeAssistantResult {
  messages: AssistantMessage[];
  prompt: string;
  setPrompt: React.Dispatch<React.SetStateAction<string>>;
  submitting: boolean;
  assistantMode: AssistantMode;
  setAssistantMode: React.Dispatch<React.SetStateAction<AssistantMode>>;
  /** Non-null when the assistant has proposed an edit that is awaiting confirmation. */
  pendingEdit: PendingEdit | null;
  /** Accept the pending edit — calls onApplyEdit and clears pendingEdit. */
  acceptEdit: () => void;
  /** Reject the pending edit — clears pendingEdit without touching the file. */
  rejectEdit: () => void;
  submitPrompt: () => Promise<void>;
  clearMessages: () => void;
}

export function useIdeAssistant({
  activeFile,
  selectionPreview,
  onApplyEdit,
}: UseIdeAssistantOptions): UseIdeAssistantResult {
  const [messages, setMessages] = useState<AssistantMessage[]>([INTRO_MESSAGE]);
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [assistantMode, setAssistantMode] = useState<AssistantMode>("ask");
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);

  // Track the last file ID we loaded messages for so we can persist on switch.
  const lastFileIdRef = useRef<string | null>(null);

  // Load persisted messages when the active file changes.
  useEffect(() => {
    if (!activeFile) return;
    if (activeFile.id === lastFileIdRef.current) return;
    lastFileIdRef.current = activeFile.id;
    setMessages(loadPersistedMessages(activeFile.id));
    setPendingEdit(null);
  }, [activeFile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist messages whenever they change.
  useEffect(() => {
    if (!activeFile) return;
    persistMessages(activeFile.id, messages);
  }, [messages, activeFile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearMessages = useCallback(() => {
    setMessages([INTRO_MESSAGE]);
    setPrompt("");
    setPendingEdit(null);
    if (activeFile) {
      persistMessages(activeFile.id, [INTRO_MESSAGE]);
    }
  }, [activeFile]);

  const acceptEdit = useCallback(() => {
    if (!pendingEdit) return;
    onApplyEdit(pendingEdit.proposedContent);
    setMessages((current) => [
      ...current,
      {
        id: `assistant-accept-${Date.now()}`,
        role: "assistant",
        content: `✓ Edit applied to ${activeFile?.name ?? "the file"}.`,
      },
    ]);
    setPendingEdit(null);
  }, [pendingEdit, onApplyEdit, activeFile]);

  const rejectEdit = useCallback(() => {
    if (!pendingEdit) return;
    setMessages((current) => [
      ...current,
      {
        id: `assistant-reject-${Date.now()}`,
        role: "assistant",
        content: "Edit discarded.",
      },
    ]);
    setPendingEdit(null);
  }, [pendingEdit]);

  const submitPrompt = useCallback(async () => {
    if (!activeFile) return;
    const value = prompt.trim();
    if (!value || submitting) return;

    const modeLabel = assistantMode === "edit" ? "Edit file" : "Ask";
    const userMessage: AssistantMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: `${modeLabel}: ${value}`,
    };
    setMessages((current) => [...current, userMessage]);
    setPrompt("");
    setSubmitting(true);

    const contextBlock = selectionPreview
      ? [
          `Active file: ${activeFile.name}`,
          `Language: ${activeFile.language}`,
          `Selected code:`,
          `\`\`\`${activeFile.language}`,
          truncateForContext(selectionPreview, 4_000),
          "```",
        ].join("\n")
      : [
          `Active file: ${activeFile.name}`,
          `Language: ${activeFile.language}`,
          `File content:`,
          `\`\`\`${activeFile.language}`,
          truncateForContext(activeFile.content),
          "```",
        ].join("\n");

    const requestBlock =
      assistantMode === "edit"
        ? [
            "Rewrite the active file to satisfy the request.",
            "Return the full updated file contents in one fenced code block.",
            "Keep the response concise.",
            `Edit request: ${value}`,
          ].join("\n")
        : `User request:\n${value}`;

    try {
      const response = await fetch("/api/ide/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: `${contextBlock}\n\n${requestBlock}` }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        response?: string;
        detail?: string;
      };

      if (!response.ok) throw new Error(data.detail || "Assistant request failed.");

      const assistantResponse = data.response || "No response returned.";
      if (assistantMode === "edit") {
        const nextContent = extractCodeBlock(assistantResponse);
        if (nextContent) {
          // Hold the proposed content for diff preview instead of applying immediately.
          setMessages((current) => [
            ...current,
            {
              id: `assistant-${Date.now()}`,
              role: "assistant",
              content: `Proposed edit for **${activeFile.name}** — review the diff and accept or reject below.`,
            },
          ]);
          setPendingEdit({ proposedContent: nextContent, description: value });
          return;
        }
      }

      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: assistantResponse,
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "The local coding assistant is unavailable.",
        },
      ]);
    } finally {
      setSubmitting(false);
    }
  }, [activeFile, prompt, submitting, assistantMode, selectionPreview, onApplyEdit]);

  return {
    messages,
    prompt,
    setPrompt,
    submitting,
    assistantMode,
    setAssistantMode,
    pendingEdit,
    acceptEdit,
    rejectEdit,
    submitPrompt,
    clearMessages,
  };
}

