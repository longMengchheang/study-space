import { EventEmitter } from "node:events";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export type ForumChannel = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
};

export type ForumUser = {
  id: string;
  name: string;
  avatar?: string;
};

export type ForumMessage = {
  id: string;
  channelId: string;
  parentId: string | null;
  content: string;
  createdAt: string;
  user: ForumUser;
  reactions: Record<string, string[]>;
};

export type ForumState = {
  channels: ForumChannel[];
  messages: ForumMessage[];
  updatedAt: string;
};

type MessageInput = {
  channelId: string;
  content: string;
  parentId?: string | null;
  user: ForumUser;
};

type ReactionInput = {
  messageId: string;
  emoji: string;
  userId: string;
};

const DEFAULT_CHANNELS: ForumChannel[] = [
  { id: "general", name: "general", description: "General study discussion", createdAt: nowIso() },
  { id: "ai", name: "ai", description: "AI workflows and prompting", createdAt: nowIso() },
  { id: "backend", name: "backend", description: "Backend systems and APIs", createdAt: nowIso() },
  { id: "math", name: "math", description: "Math and problem solving", createdAt: nowIso() },
  { id: "study-group", name: "study-group", description: "Group learning and revision", createdAt: nowIso() },
];

const DEFAULT_STATE: ForumState = {
  channels: DEFAULT_CHANNELS,
  messages: [],
  updatedAt: nowIso(),
};

const FORUM_DB_PATH =
  process.env.STUDYSPACE_FORUM_DB_PATH?.trim() ||
  path.join(process.cwd(), ".studyspace", "forum-db.json");

const GLOBAL_EMITTER_KEY = "__studyspace_forum_emitter__";
const GLOBAL_STATE_CACHE_KEY = "__studyspace_forum_state_cache__";

const forumEmitter: EventEmitter = (() => {
  const globalRecord = globalThis as typeof globalThis & {
    [GLOBAL_EMITTER_KEY]?: EventEmitter;
  };
  if (globalRecord[GLOBAL_EMITTER_KEY]) {
    return globalRecord[GLOBAL_EMITTER_KEY] as EventEmitter;
  }

  const emitter = new EventEmitter();
  emitter.setMaxListeners(200);
  globalRecord[GLOBAL_EMITTER_KEY] = emitter;
  return emitter;
})();

let mutateQueue: Promise<void> = Promise.resolve();

function nowIso() {
  return new Date().toISOString();
}

function getCachedState(): ForumState | null {
  const globalRecord = globalThis as typeof globalThis & {
    [GLOBAL_STATE_CACHE_KEY]?: ForumState;
  };
  return globalRecord[GLOBAL_STATE_CACHE_KEY] || null;
}

function setCachedState(state: ForumState) {
  const globalRecord = globalThis as typeof globalThis & {
    [GLOBAL_STATE_CACHE_KEY]?: ForumState;
  };
  globalRecord[GLOBAL_STATE_CACHE_KEY] = state;
}

function normalizeId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_\s]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildForumMessage(input: MessageInput): ForumMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    channelId: input.channelId,
    parentId: input.parentId || null,
    content: input.content.trim(),
    createdAt: nowIso(),
    user: {
      id: input.user.id,
      name: input.user.name,
      avatar: input.user.avatar,
    },
    reactions: {},
  };
}

async function loadStateFromDisk(): Promise<ForumState> {
  try {
    const raw = await readFile(FORUM_DB_PATH, "utf8");
    const parsed = JSON.parse(raw) as ForumState;

    if (!Array.isArray(parsed.channels) || !Array.isArray(parsed.messages)) {
      return { ...DEFAULT_STATE };
    }

    return {
      channels: parsed.channels,
      messages: parsed.messages,
      updatedAt: parsed.updatedAt || nowIso(),
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

async function saveStateToDisk(state: ForumState) {
  const dir = path.dirname(FORUM_DB_PATH);
  await mkdir(dir, { recursive: true });
  // Write to a sibling temp file then atomically rename to prevent
  // corrupting the database if the process crashes mid-write.
  const tmpPath = path.join(dir, `.forum-db-${randomUUID()}.tmp`);
  await writeFile(tmpPath, JSON.stringify(state, null, 2), "utf8");
  await rename(tmpPath, FORUM_DB_PATH);
}

async function queueMutation<T>(task: () => Promise<T>): Promise<T> {
  const result = mutateQueue.then(task, task);
  mutateQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function publishState(state: ForumState) {
  forumEmitter.emit("state", state);
}

export async function getForumState() {
  const cached = getCachedState();
  if (cached) {
    return cached;
  }

  const state = await loadStateFromDisk();
  setCachedState(state);
  return state;
}

export async function createForumChannel(name: string, description?: string) {
  const normalizedName = normalizeId(name);
  if (!normalizedName) {
    throw new Error("Channel name is required.");
  }

  return queueMutation(async () => {
    const state = await getForumState();

    if (state.channels.some((channel) => channel.id === normalizedName)) {
      throw new Error("A channel with this name already exists.");
    }

    const nextState: ForumState = {
      ...state,
      channels: [
        ...state.channels,
        {
          id: normalizedName,
          name: normalizedName,
          description: (description || "").trim() || "Custom study topic",
          createdAt: nowIso(),
        },
      ],
      updatedAt: nowIso(),
    };

    await saveStateToDisk(nextState);
    setCachedState(nextState);
    publishState(nextState);
    return nextState;
  });
}

export async function addForumMessage(input: MessageInput) {
  if (!input.channelId.trim()) {
    throw new Error("Channel is required.");
  }

  if (!input.content.trim()) {
    throw new Error("Message content is required.");
  }

  return queueMutation(async () => {
    const state = await getForumState();
    const channelExists = state.channels.some((channel) => channel.id === input.channelId);

    if (!channelExists) {
      throw new Error("Selected channel does not exist.");
    }

    if (input.parentId) {
      const parent = state.messages.find((message) => message.id === input.parentId);
      if (!parent) {
        throw new Error("Reply target no longer exists.");
      }
      if (parent.channelId !== input.channelId) {
        throw new Error("Replies must stay in the same channel.");
      }
    }

    const nextState: ForumState = {
      ...state,
      messages: [...state.messages, buildForumMessage(input)],
      updatedAt: nowIso(),
    };

    await saveStateToDisk(nextState);
    setCachedState(nextState);
    publishState(nextState);
    return nextState;
  });
}

export async function toggleForumReaction(input: ReactionInput) {
  const emoji = input.emoji.trim();
  if (!emoji) {
    throw new Error("Emoji is required.");
  }
  if (!input.userId.trim()) {
    throw new Error("User is required.");
  }

  return queueMutation(async () => {
    const state = await getForumState();
    const message = state.messages.find((candidate) => candidate.id === input.messageId);
    if (!message) {
      throw new Error("Message no longer exists.");
    }

    const existing = message.reactions[emoji] || [];
    const hasReaction = existing.includes(input.userId);
    const nextUsers = hasReaction
      ? existing.filter((value) => value !== input.userId)
      : [...existing, input.userId];

    const nextReactions = {
      ...message.reactions,
      [emoji]: nextUsers,
    };

    if (nextUsers.length === 0) {
      delete nextReactions[emoji];
    }

    const nextState: ForumState = {
      ...state,
      messages: state.messages.map((candidate) =>
        candidate.id === message.id
          ? {
              ...candidate,
              reactions: nextReactions,
            }
          : candidate,
      ),
      updatedAt: nowIso(),
    };

    await saveStateToDisk(nextState);
    setCachedState(nextState);
    publishState(nextState);
    return nextState;
  });
}

export async function deleteForumMessage(messageId: string) {
  if (!messageId.trim()) {
    throw new Error("Message ID is required.");
  }

  return queueMutation(async () => {
    const state = await getForumState();
    const exists = state.messages.some((message) => message.id === messageId);
    if (!exists) {
      throw new Error("Message not found.");
    }

    // Remove the message and all of its replies.
    const nextState: ForumState = {
      ...state,
      messages: state.messages.filter(
        (message) => message.id !== messageId && message.parentId !== messageId,
      ),
      updatedAt: nowIso(),
    };

    await saveStateToDisk(nextState);
    setCachedState(nextState);
    publishState(nextState);
    return nextState;
  });
}

export async function deleteForumChannel(channelId: string) {
  const DEFAULT_IDS = DEFAULT_CHANNELS.map((channel) => channel.id);
  if (DEFAULT_IDS.includes(channelId)) {
    throw new Error("Built-in channels cannot be deleted.");
  }

  return queueMutation(async () => {
    const state = await getForumState();
    const exists = state.channels.some((channel) => channel.id === channelId);
    if (!exists) {
      throw new Error("Channel not found.");
    }

    const nextState: ForumState = {
      ...state,
      channels: state.channels.filter((channel) => channel.id !== channelId),
      messages: state.messages.filter((message) => message.channelId !== channelId),
      updatedAt: nowIso(),
    };

    await saveStateToDisk(nextState);
    setCachedState(nextState);
    publishState(nextState);
    return nextState;
  });
}

export function subscribeForumState(listener: (state: ForumState) => void) {
  forumEmitter.on("state", listener);
  return () => forumEmitter.off("state", listener);
}
