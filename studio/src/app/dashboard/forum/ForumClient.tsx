"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Hash,
  Lightbulb,
  Loader2,
  MessageCircleReply,
  MessagesSquare,
  Plus,
  Send,
  Sparkles,
} from "lucide-react";

type ForumChannel = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
};

type ForumUser = {
  id: string;
  name: string;
  avatar?: string;
};

type ForumMessage = {
  id: string;
  channelId: string;
  parentId: string | null;
  content: string;
  createdAt: string;
  user: ForumUser;
  reactions: Record<string, string[]>;
};

type ForumState = {
  channels: ForumChannel[];
  messages: ForumMessage[];
  updatedAt: string;
};

type ForumApiResponse = ForumState & {
  detail?: string;
};

type AiAction = "summary" | "insights" | "answer" | null;
type StreamStatus = "connecting" | "live" | "offline";

const USER_STORAGE_KEY = "studyspace:forum-user.v1";
const ACTIVE_CHANNEL_STORAGE_KEY = "studyspace:forum-active-channel.v1";
const DEFAULT_REACTIONS = ["👍", "🎯", "✅", "🤔", "💡"];
const EMPTY_CHANNELS: ForumChannel[] = [];
const EMPTY_MESSAGES: ForumMessage[] = [];

function createFallbackUser(name = "Learner"): ForumUser {
  const normalizedName = name.trim() || "Learner";
  const generatedId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? `forum-${crypto.randomUUID()}`
      : `forum-${Math.random().toString(36).slice(2, 10)}`;

  return {
    id: generatedId,
    name: normalizedName,
    avatar: normalizedName.slice(0, 1).toUpperCase(),
  };
}

function normalizeChannelId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_\s]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatInlineMarkdown(value: string) {
  let output = escapeHtml(value);

  output = output.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
  );
  output = output.replace(/`([^`]+)`/g, "<code>$1</code>");
  output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  output = output.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");

  return output;
}

function markdownToHtml(value: string) {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraphLines: string[] = [];
  let listKind: "ul" | "ol" | null = null;
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (!paragraphLines.length) {
      return;
    }
    blocks.push(`<p>${formatInlineMarkdown(paragraphLines.join(" "))}</p>`);
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listKind || !listItems.length) {
      listKind = null;
      listItems = [];
      return;
    }

    blocks.push(
      `<${listKind}>${listItems
        .map((item) => `<li>${formatInlineMarkdown(item)}</li>`)
        .join("")}</${listKind}>`,
    );
    listKind = null;
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length + 1;
      blocks.push(`<h${level}>${formatInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      if (listKind && listKind !== "ol") {
        flushList();
      }
      listKind = "ol";
      listItems.push(orderedMatch[1]);
      continue;
    }

    const unorderedMatch = line.match(/^[-*+]\s+(.+)$/);
    if (unorderedMatch) {
      flushParagraph();
      if (listKind && listKind !== "ul") {
        flushList();
      }
      listKind = "ul";
      listItems.push(unorderedMatch[1]);
      continue;
    }

    if (listKind) {
      flushList();
    }
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();

  return blocks.length
    ? blocks.join("")
    : `<p>${formatInlineMarkdown(value.replace(/\n/g, " "))}</p>`;
}

function isForumState(value: unknown): value is ForumState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as ForumState;
  return Array.isArray(candidate.channels) && Array.isArray(candidate.messages);
}

export default function ForumClient() {
  const [forumState, setForumState] = useState<ForumState | null>(null);
  const [loadingState, setLoadingState] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [channelNameDraft, setChannelNameDraft] = useState("");
  const [channelDescriptionDraft, setChannelDescriptionDraft] = useState("");
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [activeChannelId, setActiveChannelId] = useState("general");
  const [messageDraft, setMessageDraft] = useState("");
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("connecting");
  const [reactionPending, setReactionPending] = useState<string | null>(null);
  const [aiAction, setAiAction] = useState<AiAction>(null);
  const [displayNameDraft, setDisplayNameDraft] = useState("Learner");
  const [user, setUser] = useState<ForumUser>(() => createFallbackUser("Learner"));

  const threadRef = useRef<HTMLDivElement | null>(null);
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);

  const channels = forumState?.channels ?? EMPTY_CHANNELS;
  const messages = forumState?.messages ?? EMPTY_MESSAGES;

  const channelMessageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const message of messages) {
      counts.set(message.channelId, (counts.get(message.channelId) ?? 0) + 1);
    }
    return counts;
  }, [messages]);

  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? channels[0] ?? null,
    [activeChannelId, channels],
  );

  const activeMessages = useMemo(() => {
    if (!activeChannel) {
      return [];
    }
    return messages
      .filter((message) => message.channelId === activeChannel.id)
      .sort((left, right) => {
        return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      });
  }, [activeChannel, messages]);

  const { rootMessages, repliesByParent } = useMemo(() => {
    const children = new Map<string, ForumMessage[]>();
    const roots: ForumMessage[] = [];
    const knownIds = new Set(activeMessages.map((message) => message.id));

    for (const message of activeMessages) {
      if (message.parentId && knownIds.has(message.parentId)) {
        const thread = children.get(message.parentId) ?? [];
        thread.push(message);
        children.set(message.parentId, thread);
      } else {
        roots.push(message);
      }
    }

    return {
      rootMessages: roots,
      repliesByParent: children,
    };
  }, [activeMessages]);

  const replyTarget = useMemo(
    () => activeMessages.find((message) => message.id === replyTargetId) ?? null,
    [activeMessages, replyTargetId],
  );

  useEffect(() => {
    try {
      const rawUser = window.localStorage.getItem(USER_STORAGE_KEY);
      if (rawUser) {
        const parsed = JSON.parse(rawUser) as ForumUser;
        if (parsed?.id && parsed?.name) {
          setUser({
            id: parsed.id,
            name: parsed.name,
            avatar: parsed.avatar || parsed.name.slice(0, 1).toUpperCase(),
          });
          setDisplayNameDraft(parsed.name);
        }
      }

      const storedChannel = window.localStorage.getItem(ACTIVE_CHANNEL_STORAGE_KEY);
      if (storedChannel) {
        setActiveChannelId(storedChannel);
      }
    } catch {
      // Ignore malformed local forum settings.
    }
  }, []);

  useEffect(() => {
    if (!activeChannelId) {
      return;
    }

    try {
      window.localStorage.setItem(ACTIVE_CHANNEL_STORAGE_KEY, activeChannelId);
    } catch {
      // Ignore storage failures.
    }
  }, [activeChannelId]);

  useEffect(() => {
    if (!channels.length) {
      return;
    }

    if (!channels.some((channel) => channel.id === activeChannelId)) {
      setActiveChannelId(channels[0].id);
      setReplyTargetId(null);
    }
  }, [activeChannelId, channels]);

  useEffect(() => {
    const node = threadRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [activeChannelId, activeMessages.length]);

  async function fetchState() {
    setLoadingState(true);

    try {
      const response = await fetch("/api/forum", {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as ForumApiResponse;

      if (!response.ok || !isForumState(data)) {
        throw new Error(data.detail || "Unable to load forum state.");
      }

      setForumState(data);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load forum state.");
    } finally {
      setLoadingState(false);
    }
  }

  useEffect(() => {
    void fetchState();
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/forum/events");

    const handleState = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as ForumState;
        if (isForumState(parsed)) {
          setForumState(parsed);
          setErrorMessage(null);
          setLoadingState(false);
          setStreamStatus("live");
        }
      } catch {
        // Ignore malformed server event payloads.
      }
    };

    source.addEventListener("state", handleState as EventListener);
    source.onopen = () => {
      setStreamStatus("live");
    };
    source.onerror = () => {
      setStreamStatus("offline");
    };

    return () => {
      source.removeEventListener("state", handleState as EventListener);
      source.close();
    };
  }, []);

  async function submitAction(payload: Record<string, unknown>) {
    const response = await fetch("/api/forum", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const data = (await response.json().catch(() => ({}))) as ForumApiResponse;

    if (!response.ok) {
      throw new Error(data.detail || "Forum request failed.");
    }

    if (isForumState(data)) {
      setForumState(data);
    }
  }

  function persistUser(nextUser: ForumUser) {
    setUser(nextUser);
    try {
      window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(nextUser));
    } catch {
      // Ignore storage failures.
    }
  }

  function saveDisplayName() {
    const trimmed = displayNameDraft.trim();
    if (!trimmed) {
      setDisplayNameDraft(user.name);
      return;
    }

    persistUser({
      id: user.id,
      name: trimmed,
      avatar: trimmed.slice(0, 1).toUpperCase(),
    });
  }

  async function handleCreateChannel() {
    const normalizedName = channelNameDraft.trim();
    if (!normalizedName) {
      return;
    }

    const createdId = normalizeChannelId(normalizedName);
    setCreatingChannel(true);
    setErrorMessage(null);

    try {
      await submitAction({
        action: "create_channel",
        name: normalizedName,
        description: channelDescriptionDraft.trim(),
      });
      if (createdId) {
        setActiveChannelId(createdId);
      }
      setChannelNameDraft("");
      setChannelDescriptionDraft("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to create channel.");
    } finally {
      setCreatingChannel(false);
    }
  }

  async function handleSendMessage() {
    if (!activeChannel || !messageDraft.trim()) {
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const content = messageDraft.trim();
      setMessageDraft("");

      await submitAction({
        action: "send_message",
        channelId: activeChannel.id,
        content,
        parentId: replyTargetId,
        userId: user.id,
        username: user.name,
        avatar: user.avatar,
      });
      setReplyTargetId(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to send message.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAskAi() {
    if (!activeChannel || !messageDraft.trim()) {
      return;
    }

    setAiAction("answer");
    setErrorMessage(null);

    try {
      const question = messageDraft.trim();
      setMessageDraft("");
      await submitAction({
        action: "ai_answer",
        channelId: activeChannel.id,
        question,
      });
      setReplyTargetId(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "AI answer failed.");
    } finally {
      setAiAction(null);
    }
  }

  async function handleAiChannelAction(action: "ai_summarize" | "ai_insights") {
    if (!activeChannel) {
      return;
    }

    setAiAction(action === "ai_summarize" ? "summary" : "insights");
    setErrorMessage(null);

    try {
      await submitAction({
        action,
        channelId: activeChannel.id,
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "AI action failed.");
    } finally {
      setAiAction(null);
    }
  }

  async function handleToggleReaction(messageId: string, emoji: string) {
    if (!user.id) {
      return;
    }

    const pendingKey = `${messageId}:${emoji}`;
    setReactionPending(pendingKey);
    setErrorMessage(null);

    try {
      await submitAction({
        action: "toggle_reaction",
        messageId,
        emoji,
        userId: user.id,
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Reaction update failed.");
    } finally {
      setReactionPending(null);
    }
  }

  function focusComposerWithReply(messageId: string) {
    setReplyTargetId(messageId);
    messageInputRef.current?.focus();
  }

  function renderMessage(message: ForumMessage, depth = 0): JSX.Element {
    const isAi = message.user.id === "study-ai";
    const replyMessages = repliesByParent.get(message.id) ?? [];
    const reactionEntries = Object.entries(message.reactions);

    return (
      <article
        key={message.id}
        className={[
          "forum-message-card",
          isAi ? "forum-message-card-ai" : "",
          depth > 0 ? "forum-message-card-reply" : "",
        ].join(" ")}
      >
        <div className="forum-message-header">
          <div className={["forum-avatar", isAi ? "forum-avatar-ai" : ""].join(" ")}>
            {isAi ? <Bot className="h-4 w-4" /> : message.user.avatar || message.user.name.slice(0, 1)}
          </div>
          <div className="forum-message-meta">
            <div className="forum-message-author">{message.user.name}</div>
            <div className="forum-message-time">{formatTimestamp(message.createdAt)}</div>
          </div>
        </div>

        <div
          className="forum-markdown"
          dangerouslySetInnerHTML={{ __html: markdownToHtml(message.content) }}
        />

        <div className="forum-message-actions">
          <button
            type="button"
            onClick={() => focusComposerWithReply(message.id)}
            className="forum-inline-button"
          >
            <MessageCircleReply className="h-3.5 w-3.5" />
            Reply
          </button>

          <div className="forum-reactions">
            {reactionEntries.map(([emoji, userIds]) => {
              const active = userIds.includes(user.id);
              const pending = reactionPending === `${message.id}:${emoji}`;
              return (
                <button
                  key={`${message.id}-${emoji}`}
                  type="button"
                  onClick={() => void handleToggleReaction(message.id, emoji)}
                  className={[
                    "forum-reaction-chip",
                    active ? "forum-reaction-chip-active" : "",
                  ].join(" ")}
                  disabled={pending}
                >
                  <span>{emoji}</span>
                  <span>{userIds.length}</span>
                </button>
              );
            })}

            {DEFAULT_REACTIONS.filter((emoji) => !message.reactions[emoji]).map((emoji) => {
              const pending = reactionPending === `${message.id}:${emoji}`;
              return (
                <button
                  key={`${message.id}-quick-${emoji}`}
                  type="button"
                  onClick={() => void handleToggleReaction(message.id, emoji)}
                  className="forum-reaction-chip"
                  disabled={pending}
                  title={`React with ${emoji}`}
                >
                  {emoji}
                </button>
              );
            })}
          </div>
        </div>

        {replyMessages.length ? (
          <div className="forum-reply-list">
            {replyMessages.map((replyMessage) => renderMessage(replyMessage, depth + 1))}
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <div className="forum-shell">
      <div className="forum-status-banner">
        Forum is an unfinished feature intended to evolve into a Discord-like study channel with AI chat support.
        Core flows work for experimentation, but behavior and data model may still change.
      </div>
      <div className="forum-layout">
        <aside className="forum-channel-panel">
          <div className="forum-panel-head">
            <div>
              <h1 className="forum-panel-title">Forum</h1>
              <p className="forum-panel-copy">Study discussion and knowledge sharing</p>
            </div>
            <div className={["forum-stream-chip", `forum-stream-chip-${streamStatus}`].join(" ")}>
              {streamStatus === "live" ? "Live" : streamStatus === "connecting" ? "Connecting" : "Offline"}
            </div>
          </div>

          <div className="forum-panel-section">
            <label className="study-label" htmlFor="forum-display-name">
              Display name
            </label>
            <input
              id="forum-display-name"
              value={displayNameDraft}
              onChange={(event) => setDisplayNameDraft(event.target.value)}
              onBlur={saveDisplayName}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  saveDisplayName();
                }
              }}
              className="study-field"
              placeholder="Your name"
            />
          </div>

          <div className="forum-panel-section">
            <label className="study-label" htmlFor="forum-channel-name">
              Create channel
            </label>
            <input
              id="forum-channel-name"
              value={channelNameDraft}
              onChange={(event) => setChannelNameDraft(event.target.value)}
              className="study-field"
              placeholder="e.g. exam-prep"
            />
            <input
              value={channelDescriptionDraft}
              onChange={(event) => setChannelDescriptionDraft(event.target.value)}
              className="study-field mt-2"
              placeholder="Short description (optional)"
            />
            <button
              type="button"
              onClick={() => void handleCreateChannel()}
              disabled={creatingChannel || !channelNameDraft.trim()}
              className="study-button-secondary mt-2 w-full"
            >
              {creatingChannel ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create
            </button>
          </div>

          <div className="forum-channel-list">
            {channels.map((channel) => {
              const active = activeChannel?.id === channel.id;
              return (
                <button
                  key={channel.id}
                  type="button"
                  onClick={() => {
                    setActiveChannelId(channel.id);
                    setReplyTargetId(null);
                  }}
                  className={["forum-channel-row", active ? "forum-channel-row-active" : ""].join(" ")}
                >
                  <span className="forum-channel-name">
                    <Hash className="h-3.5 w-3.5" />
                    {channel.name}
                  </span>
                  <span className="forum-channel-count">
                    {channelMessageCounts.get(channel.id) ?? 0}
                  </span>
                  <span className="forum-channel-description">{channel.description}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="forum-thread-panel">
          <div className="forum-thread-header">
            <div className="forum-thread-headline">
              <h2 className="forum-thread-title">#{activeChannel?.name || "general"}</h2>
              <p className="forum-thread-copy">
                {activeChannel?.description || "Share questions, solutions, and study notes."}
              </p>
            </div>
            <div className="forum-thread-actions">
              <button
                type="button"
                onClick={() => void handleAiChannelAction("ai_summarize")}
                className="study-button-secondary"
                disabled={!activeChannel || aiAction !== null}
              >
                {aiAction === "summary" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Summarize
              </button>
              <button
                type="button"
                onClick={() => void handleAiChannelAction("ai_insights")}
                className="study-button-secondary"
                disabled={!activeChannel || aiAction !== null}
              >
                {aiAction === "insights" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Lightbulb className="h-4 w-4" />
                )}
                Insights
              </button>
            </div>
          </div>

          <div ref={threadRef} className="forum-thread-scroll">
            {loadingState ? (
              <div className="forum-empty-state">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading forum...
              </div>
            ) : rootMessages.length === 0 ? (
              <div className="forum-empty-state">
                <MessagesSquare className="h-5 w-5" />
                No messages yet. Start the discussion in this channel.
              </div>
            ) : (
              <div className="forum-thread-list">{rootMessages.map((message) => renderMessage(message))}</div>
            )}
          </div>

          <form
            className="forum-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSendMessage();
            }}
          >
            {replyTarget ? (
              <div className="forum-reply-banner">
                Replying to <strong>{replyTarget.user.name}</strong>
                <button
                  type="button"
                  onClick={() => setReplyTargetId(null)}
                  className="forum-inline-button"
                >
                  Cancel
                </button>
              </div>
            ) : null}

            <textarea
              ref={messageInputRef}
              value={messageDraft}
              onChange={(event) => setMessageDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (messageDraft.trim() && !submitting) {
                    void handleSendMessage();
                  }
                }
              }}
              placeholder="Write a question, insight, or answer..."
              className="forum-composer-input"
              rows={3}
            />

            <div className="forum-composer-footer">
              <div className="forum-composer-hint">Enter to send. Shift+Enter for newline.</div>
              <div className="forum-composer-actions">
                <button
                  type="button"
                  onClick={() => void handleAskAi()}
                  disabled={!messageDraft.trim() || aiAction !== null}
                  className="study-button-secondary"
                >
                  {aiAction === "answer" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Bot className="h-4 w-4" />
                  )}
                  Ask AI
                </button>
                <button
                  type="submit"
                  disabled={!messageDraft.trim() || submitting}
                  className="study-button-primary"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send
                </button>
              </div>
            </div>

            {errorMessage ? <div className="forum-error-banner">{errorMessage}</div> : null}
          </form>
        </section>
      </div>
    </div>
  );
}
