/**
 * useIdeAssistant — encapsulates the AI coding assistant state in the IDE.
 *
 * Manages the prompt input, message history, and the submitPrompt action.
 * Extracted from IdeWorkspaceClient to enable independent testing and
 * potential reuse.
 */
import { useCallback, useState } from "react";
import type { PracticeFile } from "@/lib/ide-workspace";

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type AssistantMode = "ask" | "edit";

const INTRO_MESSAGE: AssistantMessage = {
  id: "assistant-intro",
  role: "assistant",
  content: "I am ready to help with the active file.",
};

function truncateForContext(value: string, limit = 12_000) {
  return value.length > limit ? `${value.slice(0, limit)}\n...` : value;
}

function extractCodeBlock(response: string) {
  const match = response.match(/```[\w-]*\n([\s\S]*?)```/);
  return match ? match[1].trimEnd() : null;
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

  const clearMessages = useCallback(() => {
    setMessages([INTRO_MESSAGE]);
    setPrompt("");
  }, []);

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
          onApplyEdit(nextContent);
          setMessages((current) => [
            ...current,
            {
              id: `assistant-${Date.now()}`,
              role: "assistant",
              content: `Applied the edit to ${activeFile.name}.`,
            },
          ]);
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
    submitPrompt,
    clearMessages,
  };
}
