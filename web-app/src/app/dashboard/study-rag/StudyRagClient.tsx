"use client";

import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BookOpen,
  Bot,
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  FileSearch,
  FileText,
  FolderOpen,
  History,
  MoreVertical,
  Plus,
  RefreshCcw,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Trash2,
  Upload,
  User,
  X,
} from "lucide-react";

type HealthState = {
  connected: boolean;
  status: string;
  detail?: string;
  collections?: number;
  documents?: number;
};

type CollectionSummary = {
  id: string;
  name: string;
  is_default: boolean;
  document_count: number;
  artifact_count: number;
};

type DocumentRecord = {
  name: string;
  size: number;
};

type ArtifactRecord = {
  filename: string;
  kind: string;
  title: string;
  saved_path: string;
  updated_at: string;
  content?: string;
  source?: "generated" | "pinned";
};

type SourceReference = {
  source: string;
  page?: number | null;
  snippet: string;
};

type ArtifactDetail = {
  filename: string;
  kind: string;
  title: string;
  saved_path: string;
  updated_at: string;
  content: string;
};

type Message = {
  id: string;
  role: "user" | "ai";
  content: string;
  sources?: SourceReference[];
  timestamp?: string;
};

type ArtifactKind = "summary" | "flashcards" | "quiz" | "study_guide";
type CenterPanelMode = "chat" | "artifact";
type ChatSessionRecord = {
  id: string;
  collectionId: string;
  title: string;
  updatedAt: string;
  messages: Message[];
};

type DeleteIntent =
  | {
      kind: "collection";
      label: string;
    }
  | {
      kind: "document";
      label: string;
      documentName: string;
    }
  | {
      kind: "artifact";
      label: string;
      artifact: ArtifactRecord;
    };

const RAG_COLLECTION_STORAGE_KEY = "studyspace:rag-active-collection";
const RAG_CHAT_SESSIONS_STORAGE_KEY = "studyspace:rag-chat-sessions";
const RAG_PINNED_OUTPUTS_STORAGE_KEY = "studyspace:rag-pinned-outputs";
const RAG_LAYOUT_STORAGE_KEY = "studyspace:rag-layout.v1";
const COLLAPSED_RAG_PANEL_WIDTH = 54;

type ResizeTarget = "sources" | "studio";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

const ARTIFACT_OPTIONS: Array<{
  kind: ArtifactKind;
  label: string;
  className: string;
}> = [
  {
    kind: "summary",
    label: "Summary",
    className: "rag-studio-card-guide",
  },
  {
    kind: "study_guide",
    label: "Study Guide",
    className: "rag-studio-card-outline",
  },
];

const STARTER_MESSAGE: Message = {
  id: "rag-starter",
  role: "ai",
  content:
    "Pick a notebook, add PDFs as sources, and ask questions grounded in those documents.",
};

function parseStoredChatSessions(raw: string | null): ChatSessionRecord[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as ChatSessionRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseStoredPinnedOutputs(raw: string | null): Record<string, ArtifactRecord[]> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, ArtifactRecord[]>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatArtifactKind(kind: string): string {
  return kind.replace(/_/g, " ").replace(/\b\w/g, (value) => value.toUpperCase());
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatInlineDocumentText(value: string): string {
  const escaped = escapeHtml(value);

  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\*])\*([^*]+)\*/g, "$1<em>$2</em>");
}

function artifactTextToHtml(value: string): string {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraphLines: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (!paragraphLines.length) {
      return;
    }

    blocks.push(`<p>${formatInlineDocumentText(paragraphLines.join(" "))}</p>`);
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listType || !listItems.length) {
      listType = null;
      listItems = [];
      return;
    }

    blocks.push(
      `<${listType}>${listItems
        .map((item) => `<li>${formatInlineDocumentText(item)}</li>`)
        .join("")}</${listType}>`,
    );
    listType = null;
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
      blocks.push(`<h${level}>${formatInlineDocumentText(headingMatch[2])}</h${level}>`);
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      if (listType && listType !== "ol") {
        flushList();
      }
      listType = "ol";
      listItems.push(orderedMatch[1]);
      continue;
    }

    const unorderedMatch = line.match(/^[-*•]\s+(.+)$/);
    if (unorderedMatch) {
      flushParagraph();
      if (listType && listType !== "ul") {
        flushList();
      }
      listType = "ul";
      listItems.push(unorderedMatch[1]);
      continue;
    }

    if (listType) {
      flushList();
    }
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();

  return blocks.join("");
}

function buildMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatCollectionNameFromId(collectionId: string): string {
  if (!collectionId) {
    return "Notebook";
  }

  return collectionId
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function StudyRagClient() {
  const [health, setHealth] = useState<HealthState>({
    connected: false,
    status: "checking",
  });
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState("general");
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [collectionDraftName, setCollectionDraftName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sourceQuery, setSourceQuery] = useState("");
  const [selectedSourceNames, setSelectedSourceNames] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [renamingCollection, setRenamingCollection] = useState(false);
  const [deletingCollectionId, setDeletingCollectionId] = useState<string | null>(null);
  const [deletingDocumentName, setDeletingDocumentName] = useState<string | null>(null);
  const [artifactPrompt, setArtifactPrompt] = useState("");
  const [artifactLoading, setArtifactLoading] = useState<ArtifactKind | null>(null);
  const [artifactContent, setArtifactContent] = useState("");
  const [artifactTitle, setArtifactTitle] = useState("No studio output yet");
  const [artifactSavedPath, setArtifactSavedPath] = useState("");
  const [artifactUpdatedAt, setArtifactUpdatedAt] = useState("");
  const [selectedArtifactFilename, setSelectedArtifactFilename] = useState<string | null>(null);
  const [loadingArtifactFilename, setLoadingArtifactFilename] = useState<string | null>(null);
  const [artifactMenuFilename, setArtifactMenuFilename] = useState<string | null>(null);
  const [editingArtifactFilename, setEditingArtifactFilename] = useState<string | null>(null);
  const [artifactTitleDraft, setArtifactTitleDraft] = useState("");
  const [renamingArtifactFilename, setRenamingArtifactFilename] = useState<string | null>(null);
  const [deletingArtifactFilename, setDeletingArtifactFilename] = useState<string | null>(null);
  const [centerPanelMode, setCenterPanelMode] = useState<CenterPanelMode>("chat");
  const [messages, setMessages] = useState<Message[]>([STARTER_MESSAGE]);
  const [chatSessions, setChatSessions] = useState<ChatSessionRecord[]>([]);
  const [pinnedOutputsByCollection, setPinnedOutputsByCollection] = useState<
    Record<string, ArtifactRecord[]>
  >({});
  const [activeChatSessionId, setActiveChatSessionId] = useState<string | null>(null);
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleteIntent, setDeleteIntent] = useState<DeleteIntent | null>(null);
  const [sourcesWidth, setSourcesWidth] = useState(340);
  const [studioWidth, setStudioWidth] = useState(340);
  const [sourcesCollapsed, setSourcesCollapsed] = useState(false);
  const [studioCollapsed, setStudioCollapsed] = useState(false);
  const [isCompactViewport, setIsCompactViewport] = useState(false);

  const boardRef = useRef<HTMLDivElement | null>(null);
  const chatMessagesRef = useRef<HTMLDivElement | null>(null);
  const resizeStateRef = useRef<{
    target: ResizeTarget;
    startX: number;
    startWidth: number;
    containerWidth: number;
  } | null>(null);

  const activeCollection = useMemo(
    () => collections.find((collection) => collection.id === activeCollectionId) ?? null,
    [activeCollectionId, collections],
  );

  const activeCollectionName = activeCollection?.name || formatCollectionNameFromId(activeCollectionId);
  const displayCollectionName = storageReady ? activeCollectionName : "Loading notebook...";

  const filteredDocuments = useMemo(() => {
    const query = sourceQuery.trim().toLowerCase();
    if (!query) {
      return documents;
    }

    return documents.filter((document) => document.name.toLowerCase().includes(query));
  }, [documents, sourceQuery]);

  const selectedSourceCount = selectedSourceNames.length;

  const chatCountLabel = useMemo(() => {
    const userMessages = messages.filter((message) => message.role === "user").length;
    return `${userMessages} prompt${userMessages === 1 ? "" : "s"}`;
  }, [messages]);

  const collectionChatSessions = useMemo(() => {
    return chatSessions
      .filter((session) => session.collectionId === activeCollectionId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [activeCollectionId, chatSessions]);

  const pinnedArtifacts = useMemo(() => {
    return pinnedOutputsByCollection[activeCollectionId] || [];
  }, [activeCollectionId, pinnedOutputsByCollection]);

  const studioOutputs = useMemo(() => {
    return [...pinnedArtifacts, ...artifacts];
  }, [artifacts, pinnedArtifacts]);

  const artifactContentHtml = useMemo(() => {
    return artifactTextToHtml(artifactContent);
  }, [artifactContent]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(RAG_LAYOUT_STORAGE_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as {
        sourcesWidth?: number;
        studioWidth?: number;
        sourcesCollapsed?: boolean;
        studioCollapsed?: boolean;
      };

      if (typeof parsed.sourcesWidth === "number") {
        setSourcesWidth(clamp(parsed.sourcesWidth, 280, 520));
      }
      if (typeof parsed.studioWidth === "number") {
        setStudioWidth(clamp(parsed.studioWidth, 280, 520));
      }
      if (typeof parsed.sourcesCollapsed === "boolean") {
        setSourcesCollapsed(parsed.sourcesCollapsed);
      }
      if (typeof parsed.studioCollapsed === "boolean") {
        setStudioCollapsed(parsed.studioCollapsed);
      }
    } catch {
      // Ignore malformed local layout state.
    }
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 960px)");
    const syncViewport = () => setIsCompactViewport(mediaQuery.matches);
    syncViewport();
    mediaQuery.addEventListener("change", syncViewport);

    return () => mediaQuery.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        RAG_LAYOUT_STORAGE_KEY,
        JSON.stringify({
          sourcesWidth,
          studioWidth,
          sourcesCollapsed,
          studioCollapsed,
        }),
      );
    } catch {
      // Ignore storage failures for layout preferences.
    }
  }, [sourcesWidth, studioWidth, sourcesCollapsed, studioCollapsed]);

  useEffect(() => {
    setCollectionDraftName(activeCollection?.name || "");
  }, [activeCollection]);

  useEffect(() => {
    function handleWindowPointerDown(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-artifact-menu]")) {
        return;
      }
      setArtifactMenuFilename(null);
    }

    window.addEventListener("mousedown", handleWindowPointerDown);
    return () => window.removeEventListener("mousedown", handleWindowPointerDown);
  }, []);

  useEffect(() => {
    function handlePointerMove(event: MouseEvent) {
      const state = resizeStateRef.current;
      if (!state) {
        return;
      }

      if (state.target === "sources") {
        const maxWidth = Math.max(300, Math.min(520, state.containerWidth - 520));
        setSourcesWidth(clamp(state.startWidth + (event.clientX - state.startX), 280, maxWidth));
      } else {
        const maxWidth = Math.max(300, Math.min(520, state.containerWidth - 520));
        setStudioWidth(clamp(state.startWidth - (event.clientX - state.startX), 280, maxWidth));
      }

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    function stopResize() {
      resizeStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", stopResize);

    return () => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", stopResize);
      stopResize();
    };
  }, []);

  useEffect(() => {
    const container = chatMessagesRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [messages, chatLoading]);

  function persistChatSessions(nextSessions: ChatSessionRecord[]) {
    setChatSessions(nextSessions);

    try {
      window.localStorage.setItem(RAG_CHAT_SESSIONS_STORAGE_KEY, JSON.stringify(nextSessions));
    } catch {}
  }

  function persistPinnedOutputs(nextPinnedOutputs: Record<string, ArtifactRecord[]>) {
    setPinnedOutputsByCollection(nextPinnedOutputs);

    try {
      window.localStorage.setItem(
        RAG_PINNED_OUTPUTS_STORAGE_KEY,
        JSON.stringify(nextPinnedOutputs),
      );
    } catch {}
  }

  function saveChatSession(nextMessages: Message[]) {
    if (nextMessages.length <= 1) {
      return;
    }

    const firstUserMessage = nextMessages.find((message) => message.role === "user");
    const title = (firstUserMessage?.content || "Untitled chat").slice(0, 64);
    const sessionId = activeChatSessionId || buildMessageId("session");
    const nextSession: ChatSessionRecord = {
      id: sessionId,
      collectionId: activeCollectionId,
      title,
      updatedAt: new Date().toISOString(),
      messages: nextMessages,
    };

    const nextSessions = [
      nextSession,
      ...chatSessions.filter((session) => session.id !== sessionId),
    ];

    if (!activeChatSessionId) {
      setActiveChatSessionId(sessionId);
    }

    persistChatSessions(nextSessions);
  }

  function openChatSession(sessionId: string) {
    const session = collectionChatSessions.find((item) => item.id === sessionId);
    if (!session) {
      return;
    }

    setActiveChatSessionId(session.id);
    setMessages(session.messages.length ? session.messages : [STARTER_MESSAGE]);
    setHistoryPanelOpen(false);
    setCenterPanelMode("chat");
  }

  async function refreshHealth() {
    setHealth((current) => ({ ...current, status: "checking" }));

    try {
      const response = await fetch("/api/local-rag/health", { cache: "no-store" });
      const data = (await response.json()) as HealthState;

      if (!response.ok) {
        setHealth({
          connected: false,
          status: data.status || "offline",
          detail: data.detail || "Local RAG did not respond normally.",
        });
        return;
      }

      setHealth({
        connected: Boolean(data.connected),
        status: data.status || "ok",
        detail: data.detail,
        collections: data.collections,
        documents: data.documents,
      });
    } catch (error) {
      setHealth({
        connected: false,
        status: "offline",
        detail: error instanceof Error ? error.message : "Local RAG is unavailable.",
      });
    }
  }

  async function fetchCollections(preferredCollectionId?: string) {
    const response = await fetch("/api/local-rag/collections", {
      cache: "no-store",
    });
    const data = (await response.json().catch(() => ({}))) as {
      collections?: CollectionSummary[];
      detail?: string;
    };

    if (!response.ok) {
      throw new Error(data.detail || "Unable to load study collections.");
    }

    const nextCollections = data.collections || [];
    setCollections(nextCollections);
    setActiveCollectionId((current) => {
      const preferred = preferredCollectionId || current;
      if (nextCollections.some((collection) => collection.id === preferred)) {
        return preferred;
      }
      return nextCollections[0]?.id || "general";
    });
  }

  async function fetchDocuments(collectionId: string) {
    const response = await fetch(`/api/local-rag/collections/${collectionId}/documents`, {
      cache: "no-store",
    });
    const data = (await response.json().catch(() => ({}))) as {
      documents?: DocumentRecord[];
      detail?: string;
    };

    if (!response.ok) {
      throw new Error(data.detail || "Unable to load documents.");
    }

    setDocuments(data.documents || []);
  }

  async function fetchArtifacts(collectionId: string) {
    const response = await fetch(`/api/local-rag/collections/${collectionId}/artifacts`, {
      cache: "no-store",
    });
    const data = (await response.json().catch(() => ({}))) as {
      artifacts?: ArtifactRecord[];
      detail?: string;
    };

    if (!response.ok) {
      throw new Error(data.detail || "Unable to load artifacts.");
    }

    setArtifacts(data.artifacts || []);
  }

  async function loadArtifactDetail(collectionId: string, artifactName: string) {
    setLoadingArtifactFilename(artifactName);
    setErrorMessage(null);
    setCenterPanelMode("artifact");

    try {
      const response = await fetch(
        `/api/local-rag/collections/${collectionId}/artifacts/${encodeURIComponent(artifactName)}`,
        {
          cache: "no-store",
        },
      );
      const data = (await response.json().catch(() => ({}))) as ArtifactDetail & {
        detail?: string;
      };

      if (!response.ok) {
        throw new Error(data.detail || "Unable to load artifact.");
      }

      setArtifactTitle(data.title || formatArtifactKind(data.kind));
      setArtifactContent(data.content || "");
      setArtifactSavedPath(data.saved_path || "");
      setArtifactUpdatedAt(data.updated_at || "");
      setSelectedArtifactFilename(data.filename);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load artifact.");
    } finally {
      setLoadingArtifactFilename(null);
    }
  }

  function openPinnedArtifact(artifact: ArtifactRecord) {
    setErrorMessage(null);
    setCenterPanelMode("artifact");
    setArtifactTitle(artifact.title || "Pinned answer");
    setArtifactContent(artifact.content || "");
    setArtifactSavedPath("");
    setArtifactUpdatedAt(artifact.updated_at || "");
    setSelectedArtifactFilename(artifact.filename);
  }

  async function refreshCollectionState(collectionId: string) {
    await Promise.all([
      fetchCollections(collectionId),
      fetchDocuments(collectionId),
      fetchArtifacts(collectionId),
      refreshHealth(),
    ]);
  }

  useEffect(() => {
    try {
      const storedCollectionId = window.localStorage.getItem(RAG_COLLECTION_STORAGE_KEY);
      if (storedCollectionId) {
        setActiveCollectionId(storedCollectionId);
      }
      setChatSessions(
        parseStoredChatSessions(window.localStorage.getItem(RAG_CHAT_SESSIONS_STORAGE_KEY)),
      );
      setPinnedOutputsByCollection(
        parseStoredPinnedOutputs(window.localStorage.getItem(RAG_PINNED_OUTPUTS_STORAGE_KEY)),
      );
    } catch {}
    setStorageReady(true);

    void (async () => {
      try {
        setErrorMessage(null);
        await Promise.all([refreshHealth(), fetchCollections()]);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Unable to initialize RAG.");
      }
    })();
  }, []);

  useEffect(() => {
    if (!activeCollectionId) {
      return;
    }

    try {
      window.localStorage.setItem(RAG_COLLECTION_STORAGE_KEY, activeCollectionId);
    } catch {}

    void (async () => {
      try {
        setErrorMessage(null);
        setSelectedSourceNames([]);
        setArtifactMenuFilename(null);
        setEditingArtifactFilename(null);
        setArtifactTitleDraft("");
        await Promise.all([fetchDocuments(activeCollectionId), fetchArtifacts(activeCollectionId)]);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Unable to load collection data.");
      }
    })();
  }, [activeCollectionId]);

  useEffect(() => {
    if (!storageReady) {
      return;
    }

    const latestSession = collectionChatSessions[0];
    if (!latestSession) {
      setActiveChatSessionId(null);
      setMessages([STARTER_MESSAGE]);
      return;
    }

    setActiveChatSessionId(latestSession.id);
    setMessages(latestSession.messages.length ? latestSession.messages : [STARTER_MESSAGE]);
  }, [activeCollectionId, storageReady, collectionChatSessions]);

  async function handleCreateCollection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newCollectionName.trim();
    if (!name) {
      return;
    }

    setErrorMessage(null);

    try {
      const response = await fetch("/api/local-rag/collections", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name }),
      });
      const data = (await response.json().catch(() => ({}))) as CollectionSummary & {
        detail?: string;
      };

      if (!response.ok) {
        throw new Error(data.detail || "Unable to create study collection.");
      }

      setNewCollectionName("");
      await refreshCollectionState(data.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to create study collection.");
    }
  }

  async function handleRenameCollection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!activeCollection || activeCollection.is_default) {
      return;
    }

    const name = collectionDraftName.trim();
    if (!name || name === activeCollection.name) {
      setCollectionDraftName(activeCollection.name);
      return;
    }

    setRenamingCollection(true);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/local-rag/collections/${activeCollection.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name }),
      });
      const data = (await response.json().catch(() => ({}))) as CollectionSummary & {
        detail?: string;
      };

      if (!response.ok) {
        throw new Error(data.detail || "Unable to rename notebook.");
      }

      await fetchCollections(activeCollection.id);
      setCollectionDraftName(data.name || name);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to rename notebook.");
    } finally {
      setRenamingCollection(false);
    }
  }

  async function handleDeleteCollection() {
    if (!activeCollection || activeCollection.is_default) {
      return;
    }

    setDeletingCollectionId(activeCollection.id);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/local-rag/collections/${activeCollection.id}`, {
        method: "DELETE",
      });
      const data = (await response.json().catch(() => ({}))) as {
        collections?: CollectionSummary[];
        detail?: string;
      };

      if (!response.ok) {
        throw new Error(data.detail || "Unable to delete notebook.");
      }

      const fallbackCollectionId =
        data.collections?.find((collection) => collection.is_default)?.id ||
        data.collections?.[0]?.id ||
        "general";

      setCollections(data.collections || []);
      setActiveCollectionId(fallbackCollectionId);
      setMessages([STARTER_MESSAGE]);
      setArtifactTitle("No studio output yet");
      setArtifactContent("");
      setArtifactSavedPath("");
      setArtifactUpdatedAt("");
      setSelectedArtifactFilename(null);
      setCenterPanelMode("chat");
      await Promise.all([
        fetchDocuments(fallbackCollectionId),
        fetchArtifacts(fallbackCollectionId),
        refreshHealth(),
      ]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to delete notebook.");
    } finally {
      setDeletingCollectionId(null);
    }
  }

  async function handleUploadSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fileInput = form.elements.namedItem("rag-pdf-file") as HTMLInputElement | null;

    if (!selectedFile) {
      setErrorMessage("Choose a PDF file first.");
      return;
    }

    setUploading(true);
    setErrorMessage(null);

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const response = await fetch(`/api/local-rag/collections/${activeCollectionId}/upload`, {
        method: "POST",
        body: formData,
      });
      const data = (await response.json().catch(() => ({}))) as {
        detail?: string;
      };

      if (!response.ok) {
        throw new Error(data.detail || "Unable to upload PDF.");
      }

      setSelectedFile(null);
      if (fileInput) {
        fileInput.value = "";
      }
      await refreshCollectionState(activeCollectionId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to upload PDF.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteDocument(documentName: string) {
    setDeletingDocumentName(documentName);
    setErrorMessage(null);

    try {
      const response = await fetch(
        `/api/local-rag/collections/${activeCollectionId}/documents/${encodeURIComponent(documentName)}`,
        {
          method: "DELETE",
        },
      );
      const data = (await response.json().catch(() => ({}))) as {
        documents?: DocumentRecord[];
        detail?: string;
      };

      if (!response.ok) {
        throw new Error(data.detail || "Unable to delete document.");
      }

      setDocuments(data.documents || []);
      setSelectedSourceNames((current) => current.filter((name) => name !== documentName));
      await Promise.all([
        fetchCollections(activeCollectionId),
        fetchArtifacts(activeCollectionId),
        refreshHealth(),
      ]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to delete document.");
    } finally {
      setDeletingDocumentName(null);
    }
  }

  function requestDeleteCollection() {
    if (!activeCollection || activeCollection.is_default) {
      return;
    }

    setDeleteIntent({
      kind: "collection",
      label: activeCollection.name,
    });
  }

  function requestDeleteDocument(documentName: string) {
    setDeleteIntent({
      kind: "document",
      label: documentName,
      documentName,
    });
  }

  async function handleGenerateArtifact(kind: ArtifactKind) {
    setArtifactLoading(kind);
    setErrorMessage(null);
    setCenterPanelMode("artifact");
    setArtifactTitle(`Generating ${formatArtifactKind(kind)}...`);
    setArtifactContent("");
    setArtifactSavedPath("");
    setArtifactUpdatedAt("");
    setSelectedArtifactFilename(null);

    try {
      const response = await fetch("/api/local-rag/artifacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          collection_id: activeCollectionId,
          kind,
          prompt: artifactPrompt.trim() || undefined,
          source_names: selectedSourceNames,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        kind?: string;
        title?: string;
        content?: string;
        saved_path?: string;
        filename?: string;
        detail?: string;
      };

      if (!response.ok) {
        throw new Error(data.detail || "Unable to generate study artifact.");
      }

      setArtifactTitle(data.title || formatArtifactKind(data.kind || kind));
      setArtifactContent(data.content || "");
      setArtifactSavedPath(data.saved_path || "");
      setArtifactUpdatedAt(new Date().toISOString());
      setSelectedArtifactFilename(data.filename || null);
      await Promise.all([
        fetchArtifacts(activeCollectionId),
        fetchCollections(activeCollectionId),
        refreshHealth(),
      ]);
    } catch (error) {
      setArtifactTitle("Artifact generation failed");
      setArtifactContent("");
      setArtifactSavedPath("");
      setArtifactUpdatedAt("");
      setSelectedArtifactFilename(null);
      setErrorMessage(error instanceof Error ? error.message : "Unable to generate study artifact.");
    } finally {
      setArtifactLoading(null);
    }
  }

  async function sendChatMessage() {
    const message = chatInput.trim();
    if (!message) {
      return;
    }

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
    saveChatSession(nextUserMessages);
    setChatInput("");
    setChatLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/local-rag/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
          collection_id: activeCollectionId,
          source_names: selectedSourceNames,
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
        sources: data.sources || [],
        timestamp: new Date().toISOString(),
      };
      const nextMessages = [...nextUserMessages, aiMessage];
      setMessages(nextMessages);
      saveChatSession(nextMessages);
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
      saveChatSession(nextMessages);
    } finally {
      setChatLoading(false);
    }
  }

  async function handleSendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendChatMessage();
  }

  function toggleSourceSelection(documentName: string) {
    setSelectedSourceNames((current) =>
      current.includes(documentName)
        ? current.filter((name) => name !== documentName)
        : [...current, documentName],
    );
  }

  function pinMessageToStudio(message: Message) {
    const timestamp = new Date().toISOString();
    const title = message.content.split("\n")[0]?.trim().slice(0, 48) || "Pinned answer";
    const pinnedOutput: ArtifactRecord = {
      filename: buildMessageId("pinned"),
      kind: "pinned",
      title,
      saved_path: "",
      updated_at: timestamp,
      content: message.content,
      source: "pinned",
    };

    persistPinnedOutputs({
      ...pinnedOutputsByCollection,
      [activeCollectionId]: [pinnedOutput, ...(pinnedOutputsByCollection[activeCollectionId] || [])],
    });
  }

  function startArtifactRename(artifact: ArtifactRecord) {
    setArtifactMenuFilename(null);
    setEditingArtifactFilename(artifact.filename);
    setArtifactTitleDraft(artifact.title || formatArtifactKind(artifact.kind));
  }

  function requestDeleteArtifact(artifact: ArtifactRecord) {
    setArtifactMenuFilename(null);
    setDeleteIntent({
      kind: "artifact",
      label: artifact.title,
      artifact,
    });
  }

  async function handleRenameArtifact(artifact: ArtifactRecord) {
    const nextName = artifactTitleDraft.trim();

    if (!nextName || nextName === artifact.title) {
      setEditingArtifactFilename(null);
      setArtifactTitleDraft("");
      return;
    }

    if (artifact.source === "pinned") {
      persistPinnedOutputs({
        ...pinnedOutputsByCollection,
        [activeCollectionId]: (pinnedOutputsByCollection[activeCollectionId] || []).map((item) =>
          item.filename === artifact.filename ? { ...item, title: nextName } : item,
        ),
      });
      if (selectedArtifactFilename === artifact.filename) {
        setArtifactTitle(nextName);
      }
      setEditingArtifactFilename(null);
      setArtifactTitleDraft("");
      return;
    }

    setRenamingArtifactFilename(artifact.filename);
    setErrorMessage(null);

    try {
      const response = await fetch(
        `/api/local-rag/collections/${activeCollectionId}/artifacts/${encodeURIComponent(artifact.filename)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: nextName }),
        },
      );
      const data = (await response.json().catch(() => ({}))) as ArtifactDetail & {
        detail?: string;
      };

      if (!response.ok) {
        throw new Error(data.detail || "Unable to rename output.");
      }

      await Promise.all([fetchArtifacts(activeCollectionId), fetchCollections(activeCollectionId)]);
      setEditingArtifactFilename(null);
      setArtifactTitleDraft("");

      if (selectedArtifactFilename === artifact.filename) {
        setArtifactTitle(data.title || formatArtifactKind(data.kind));
        setArtifactContent(data.content || "");
        setArtifactSavedPath(data.saved_path || "");
        setArtifactUpdatedAt(data.updated_at || "");
        setSelectedArtifactFilename(data.filename);
        setCenterPanelMode("artifact");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to rename output.");
    } finally {
      setRenamingArtifactFilename(null);
    }
  }

  async function handleDeleteArtifact(artifact: ArtifactRecord) {
    setArtifactMenuFilename(null);
    setDeletingArtifactFilename(artifact.filename);
    setErrorMessage(null);

    if (artifact.source === "pinned") {
      persistPinnedOutputs({
        ...pinnedOutputsByCollection,
        [activeCollectionId]: (pinnedOutputsByCollection[activeCollectionId] || []).filter(
          (item) => item.filename !== artifact.filename,
        ),
      });

      if (selectedArtifactFilename === artifact.filename) {
        setSelectedArtifactFilename(null);
        setArtifactTitle("No studio output yet");
        setArtifactContent("");
        setArtifactSavedPath("");
        setArtifactUpdatedAt("");
      }
      if (editingArtifactFilename === artifact.filename) {
        setEditingArtifactFilename(null);
        setArtifactTitleDraft("");
      }
      setDeletingArtifactFilename(null);
      return;
    }

    try {
      const response = await fetch(
        `/api/local-rag/collections/${activeCollectionId}/artifacts/${encodeURIComponent(artifact.filename)}`,
        {
          method: "DELETE",
        },
      );
      const data = (await response.json().catch(() => ({}))) as {
        artifacts?: ArtifactRecord[];
        detail?: string;
      };

      if (!response.ok) {
        throw new Error(data.detail || "Unable to delete output.");
      }

      setArtifacts(data.artifacts || []);
      await Promise.all([fetchCollections(activeCollectionId), refreshHealth()]);

      if (selectedArtifactFilename === artifact.filename) {
        setSelectedArtifactFilename(null);
        setArtifactTitle("No studio output yet");
        setArtifactContent("");
        setArtifactSavedPath("");
        setArtifactUpdatedAt("");
      }
      if (editingArtifactFilename === artifact.filename) {
        setEditingArtifactFilename(null);
        setArtifactTitleDraft("");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to delete output.");
    } finally {
      setDeletingArtifactFilename(null);
    }
  }

  async function confirmDeleteIntent() {
    const intent = deleteIntent;
    if (!intent) {
      return;
    }

    setDeleteIntent(null);

    if (intent.kind === "collection") {
      await handleDeleteCollection();
      return;
    }

    if (intent.kind === "document") {
      await handleDeleteDocument(intent.documentName);
      return;
    }

    await handleDeleteArtifact(intent.artifact);
  }

  function resetChatThread() {
    setMessages([STARTER_MESSAGE]);
    setChatInput("");
    setChatLoading(false);
    setActiveChatSessionId(null);
    setHistoryPanelOpen(false);
  }

  function beginResize(target: ResizeTarget, event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();

    const container = boardRef.current;
    if (!container) {
      return;
    }

    resizeStateRef.current = {
      target,
      startX: event.clientX,
      startWidth: target === "sources" ? sourcesWidth : studioWidth,
      containerWidth: container.getBoundingClientRect().width,
    };
  }

  const effectiveSourcesCollapsed = !isCompactViewport && sourcesCollapsed;
  const effectiveStudioCollapsed = !isCompactViewport && studioCollapsed;

  const boardStyle = {
    "--rag-left-width": `${effectiveSourcesCollapsed ? COLLAPSED_RAG_PANEL_WIDTH : sourcesWidth}px`,
    "--rag-right-width": `${effectiveStudioCollapsed ? COLLAPSED_RAG_PANEL_WIDTH : studioWidth}px`,
    "--rag-left-divider-width": effectiveSourcesCollapsed ? "0px" : "0.75rem",
    "--rag-right-divider-width": effectiveStudioCollapsed ? "0px" : "0.75rem",
  } as CSSProperties;

  return (
    <div className="rag-shell">
      <header className="rag-topbar">
        <div>
          <h1 className="rag-topbar-title">{displayCollectionName}</h1>
        </div>

        <div className="rag-topbar-actions">
          <div className="rag-status-pill">
            <Brain className={`h-4 w-4 ${health.connected ? "text-[#22c55e]" : "text-text-muted"}`} />
            {health.status === "checking"
              ? "Checking"
              : health.connected
                ? "Connected"
                : "Offline"}
          </div>
          <button type="button" onClick={() => void refreshHealth()} className="study-button-secondary">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </header>

      {errorMessage ? <div className="rag-error-banner">{errorMessage}</div> : null}

      <div ref={boardRef} className="rag-board" style={boardStyle}>
        {effectiveSourcesCollapsed ? (
          <aside className="rag-side-rail rag-side-rail-left">
            <button
              type="button"
              onClick={() => setSourcesCollapsed(false)}
              className="rag-side-rail-button"
              title="Open sources"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <span className="rag-side-rail-label">Sources</span>
          </aside>
        ) : (
        <aside className="rag-column rag-sources">
          <div className="rag-panel-header">
            <div>
              <div className="rag-panel-title">Sources</div>
              <div className="rag-panel-subtitle">
                {activeCollection?.document_count ?? documents.length} documents in this notebook
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="rag-mini-badge">
                {collections.length} collection{collections.length === 1 ? "" : "s"}
              </div>
              {!isCompactViewport ? (
                <button
                  type="button"
                  onClick={() => setSourcesCollapsed(true)}
                  className="rag-header-icon-button"
                  title="Close sources"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>
          <div className="rag-column-scroll">

          <div className="rag-panel-section">
            <label className="study-label" htmlFor="rag-collection-select">
              Active collection
            </label>
            <div className="rag-select-wrap">
              <select
                id="rag-collection-select"
                value={activeCollectionId}
                onChange={(event) => setActiveCollectionId(event.target.value)}
                className="study-field rag-select"
              >
                {collections.map((collection) => (
                  <option key={collection.id} value={collection.id}>
                    {collection.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="rag-select-icon h-4 w-4" />
            </div>
          </div>

          <div className="rag-panel-section">
            <div className="rag-collection-meta">
              <div>
                <div className="text-sm font-semibold text-text-primary">
                  {displayCollectionName}
                </div>
                <div className="mt-1 text-xs text-text-muted">
                  {(activeCollection?.document_count ?? documents.length)} docs ·{" "}
                  {(activeCollection?.artifact_count ?? artifacts.length)} outputs
                </div>
              </div>
              {activeCollection?.is_default ? (
                <div className="rag-mini-badge">Default</div>
              ) : null}
            </div>

            {activeCollection?.is_default ? (
              <div className="mt-3 text-sm leading-7 text-text-secondary">
                The default notebook is always available and cannot be renamed or removed.
              </div>
            ) : (
              <form className="mt-3 space-y-3" onSubmit={handleRenameCollection}>
                <input
                  value={collectionDraftName}
                  onChange={(event) => setCollectionDraftName(event.target.value)}
                  placeholder="Notebook name"
                  className="study-field"
                />
                <div className="rag-collection-actions">
                  <button
                    type="submit"
                    className="study-button-secondary"
                    disabled={renamingCollection || !collectionDraftName.trim()}
                  >
                    <Check className="h-4 w-4" />
                    {renamingCollection ? "Saving..." : "Save name"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCollectionDraftName(activeCollection?.name || "")}
                    className="study-button-secondary"
                    disabled={renamingCollection}
                  >
                    <X className="h-4 w-4" />
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={requestDeleteCollection}
                    className="study-button-secondary"
                    disabled={deletingCollectionId === activeCollection?.id}
                  >
                    <Trash2 className="h-4 w-4" />
                    {deletingCollectionId === activeCollection?.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </form>
            )}
          </div>

          <div className="rag-panel-section">
            <form className="space-y-3" onSubmit={handleCreateCollection}>
              <label className="study-label" htmlFor="rag-collection-name">
                Create notebook
              </label>
              <input
                id="rag-collection-name"
                value={newCollectionName}
                onChange={(event) => setNewCollectionName(event.target.value)}
                placeholder="New notebook name"
                className="study-field"
              />
              <button type="submit" className="study-button-secondary w-full justify-center">
                <Plus className="h-4 w-4" />
                Create notebook
              </button>
            </form>
          </div>

          <div className="rag-panel-section">
            <form className="space-y-3" onSubmit={handleUploadSubmit}>
              <label className="study-label" htmlFor="rag-pdf-file">
                Add source
              </label>
              <input
                id="rag-pdf-file"
                name="rag-pdf-file"
                type="file"
                accept=".pdf,application/pdf"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                className="study-field"
              />
              <button
                type="submit"
                className="study-button-primary w-full justify-center"
                disabled={!selectedFile || uploading}
              >
                <Upload className="h-4 w-4" />
                {uploading ? "Uploading..." : "Upload PDF"}
              </button>
            </form>
          </div>

          <div className="rag-panel-section">
            <label className="study-label" htmlFor="rag-source-search">
              Search sources
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                id="rag-source-search"
                value={sourceQuery}
                onChange={(event) => setSourceQuery(event.target.value)}
                placeholder="Filter documents..."
                className="study-field study-search-field"
              />
            </div>
            {selectedSourceCount > 0 ? (
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="text-xs text-text-muted">
                  {selectedSourceCount} source{selectedSourceCount === 1 ? "" : "s"} selected
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedSourceNames([])}
                  className="rag-inline-action"
                >
                  Clear
                </button>
              </div>
            ) : null}
          </div>

          <div className="rag-sources-list">
            {filteredDocuments.length === 0 ? (
              <div className="rag-empty-state">
                {documents.length === 0
                  ? "Add a PDF source to start grounding chat and studio outputs."
                  : "No sources match this search."}
              </div>
            ) : (
              filteredDocuments.map((document) => {
                const selected = selectedSourceNames.includes(document.name);

                return (
                  <div
                    key={document.name}
                    className={["rag-source-item", selected ? "rag-source-item-selected" : ""].join(" ")}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSourceSelection(document.name)}
                      className="rag-source-main"
                    >
                      <div className="rag-source-icon">
                        <FileText className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-text-primary">
                          {document.name}
                        </div>
                        <div className="mt-1 text-xs text-text-muted">{formatBytes(document.size)}</div>
                      </div>
                    </button>
                    <div className="rag-source-actions">
                      <button
                        type="button"
                        onClick={() => toggleSourceSelection(document.name)}
                        className="rag-inline-action"
                      >
                        {selected ? "Selected" : "Select"}
                      </button>
                      <button
                        type="button"
                        onClick={() => requestDeleteDocument(document.name)}
                        className="rag-icon-button"
                        disabled={deletingDocumentName === document.name}
                        title="Delete source"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          </div>
        </aside>
        )}

        <div
          className={[
            "rag-panel-divider",
            effectiveSourcesCollapsed || isCompactViewport ? "rag-panel-divider-hidden" : "",
          ].join(" ")}
          onMouseDown={(event) => beginResize("sources", event)}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sources panel"
        />

        <section className="rag-column rag-chat">
          <div className="rag-panel-header">
            <div>
              <div className="rag-panel-title">
                {centerPanelMode === "chat" ? "Chat" : "Output"}
              </div>
              <div className="rag-panel-subtitle">
                {centerPanelMode === "chat"
                  ? storageReady
                    ? `Ask about ${activeCollectionName} using local retrieval`
                    : ""
                  : ""}
              </div>
            </div>
            <div className="rag-chat-header-actions">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setHistoryPanelOpen((value) => !value)}
                  className="rag-header-icon-button"
                  title="Chat history"
                >
                  <History className="h-4 w-4" />
                </button>

                {historyPanelOpen ? (
                  <div className="rag-history-panel">
                    {!storageReady ? (
                      <div className="rag-history-empty">Loading chats...</div>
                    ) : collectionChatSessions.length === 0 ? (
                      <div className="rag-history-empty">No saved chats for this notebook yet.</div>
                    ) : (
                      collectionChatSessions.map((session) => (
                        <button
                          key={session.id}
                          type="button"
                          onClick={() => openChatSession(session.id)}
                          className={[
                            "rag-history-session",
                            activeChatSessionId === session.id ? "rag-history-session-active" : "",
                          ].join(" ")}
                        >
                          <div className="truncate text-sm font-medium text-text-primary">
                            {session.title}
                          </div>
                          <div className="mt-1 text-xs text-text-muted">
                            {formatTimestamp(session.updatedAt)}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={resetChatThread}
                className="rag-header-icon-button"
                title="New chat"
              >
                <Plus className="h-4 w-4" />
              </button>

              <div className="rag-panel-toggle">
                <button
                  type="button"
                  onClick={() => setCenterPanelMode("chat")}
                  className={["rag-view-toggle", centerPanelMode === "chat" ? "rag-view-toggle-active" : ""].join(" ")}
                >
                  Chat
                </button>
                <button
                  type="button"
                  onClick={() => setCenterPanelMode("artifact")}
                  className={[
                    "rag-view-toggle",
                    centerPanelMode === "artifact" ? "rag-view-toggle-active" : "",
                  ].join(" ")}
                >
                  Output
                </button>
                <button
                  type="button"
                  onClick={resetChatThread}
                  className="rag-view-toggle"
                  title="Reset chat"
                >
                  <RefreshCcw className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          {centerPanelMode === "chat" ? (
            <>
              <div ref={chatMessagesRef} className="rag-messages">
                {!storageReady ? (
                  <div className="rag-chat-empty">
                    <div className="rag-chat-empty-icon">
                      <BookOpen className="h-6 w-6" />
                    </div>
                    <h2 className="rag-chat-empty-title">Loading notebook...</h2>
                  </div>
                ) : messages.length === 1 && messages[0]?.id === STARTER_MESSAGE.id ? (
                  <div className="rag-chat-empty">
                    <div className="rag-chat-empty-icon">
                      <BookOpen className="h-6 w-6" />
                    </div>
                    <h2 className="rag-chat-empty-title">
                      {displayCollectionName}
                    </h2>
                <p className="rag-chat-empty-copy">
                  Your local notebook can answer questions from indexed PDFs and generate
                  reusable study outputs from the same source set.
                </p>
              </div>
                ) : (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={[
                        "rag-message",
                        message.role === "user" ? "rag-message-user" : "rag-message-ai",
                      ].join(" ")}
                    >
                      <div className="rag-message-avatar">
                        {message.role === "user" ? (
                          <User className="h-4 w-4" />
                        ) : (
                          <Bot className="h-4 w-4" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="rag-message-meta">
                          <span className="rag-message-author">
                            {message.role === "user" ? "You" : "RAG Companion"}
                          </span>
                          {message.timestamp ? (
                            <span className="rag-message-time">
                              {formatTimestamp(message.timestamp)}
                            </span>
                          ) : null}
                        </div>
                        <div className="rag-message-body">{message.content}</div>
                        {message.role === "ai" && message.sources?.length ? (
                          <div className="rag-message-sources">
                            <div className="rag-message-sources-label">
                              <FileSearch className="h-3.5 w-3.5" />
                              Sources used
                            </div>
                            <div className="rag-source-reference-list">
                              {message.sources.map((source, index) => (
                                <div key={`${message.id}-${index}`} className="rag-source-reference">
                                  <div className="text-xs font-medium text-text-primary">
                                    {source.source}
                                    {source.page ? ` - p.${source.page}` : ""}
                                  </div>
                                  <div className="mt-1 text-xs leading-5 text-text-secondary">
                                    {source.snippet}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {message.role === "ai" ? (
                          <div className="rag-message-actions">
                            <button
                              type="button"
                              onClick={() => pinMessageToStudio(message)}
                              className="rag-inline-action"
                            >
                              Pin to studio
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}

                {chatLoading ? (
                  <div className="rag-message rag-message-ai">
                    <div className="rag-message-avatar">
                      <Bot className="h-4 w-4" />
                    </div>
                    <div className="rag-message-body">Thinking through the indexed material...</div>
                  </div>
                ) : null}
              </div>

              <form className="rag-chat-form" onSubmit={handleSendMessage}>
                <div className="rag-composer">
                  <textarea
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        if (!chatLoading && chatInput.trim()) {
                          void sendChatMessage();
                        }
                      }
                    }}
                    placeholder="Start typing..."
                    className="rag-chat-input"
                    rows={1}
                  />
                  <div className="rag-composer-meta">
                    {selectedSourceCount > 0
                      ? `${selectedSourceCount} selected`
                      : `${documents.length} source${documents.length === 1 ? "" : "s"}`}
                  </div>
                  <button
                    type="submit"
                    className="rag-send-button"
                    disabled={chatLoading || !chatInput.trim()}
                    title="Send"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="rag-reader">
              <div className="rag-reader-header">
                <h2 className="rag-reader-title">{artifactTitle}</h2>
                {artifactUpdatedAt ? (
                  <div className="rag-reader-meta">
                    <span>{formatTimestamp(artifactUpdatedAt)}</span>
                  </div>
                ) : null}
              </div>

              <div className="rag-reader-sheet">
                {artifactLoading ? (
                  <div className="rag-reader-empty">
                    Generating studio output from the active notebook...
                  </div>
                ) : artifactContent ? (
                  <article
                    className="rag-reader-doc rag-reader-prose"
                    dangerouslySetInnerHTML={{ __html: artifactContentHtml }}
                  />
                ) : (
                  <div className="rag-reader-empty">
                    Pick a studio feature on the right to open its output here.
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        <div
          className={[
            "rag-panel-divider",
            effectiveStudioCollapsed || isCompactViewport ? "rag-panel-divider-hidden" : "",
          ].join(" ")}
          onMouseDown={(event) => beginResize("studio", event)}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize studio panel"
        />

        {effectiveStudioCollapsed ? (
          <aside className="rag-side-rail rag-side-rail-right">
            <button
              type="button"
              onClick={() => setStudioCollapsed(false)}
              className="rag-side-rail-button"
              title="Open studio"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="rag-side-rail-label">Studio</span>
          </aside>
        ) : (
        <aside className="rag-column rag-studio">
          <div className="rag-panel-header">
            <div>
              <div className="rag-panel-title">Studio</div>
              <div className="rag-panel-subtitle">Generate outputs from the current notebook</div>
            </div>
            <div className="flex items-center gap-2">
              <div className="rag-mini-badge">
                {studioOutputs.length} saved
              </div>
              {!isCompactViewport ? (
                <button
                  type="button"
                  onClick={() => setStudioCollapsed(true)}
                  className="rag-header-icon-button"
                  title="Close studio"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>
          <div className="rag-column-scroll">

          <div className="rag-panel-section">
            <label className="study-label" htmlFor="rag-artifact-prompt">
              Focus prompt
            </label>
            <textarea
              id="rag-artifact-prompt"
              value={artifactPrompt}
              onChange={(event) => setArtifactPrompt(event.target.value)}
              placeholder="Optional direction, e.g. exam review, chapter recap, formulas only..."
              className="study-textarea rag-studio-prompt"
            />
          </div>

            <div className="rag-studio-grid">
              {ARTIFACT_OPTIONS.map((artifact) => (
                <button
                key={artifact.kind}
                type="button"
                onClick={() => void handleGenerateArtifact(artifact.kind)}
                className={["rag-studio-card", artifact.className].join(" ")}
                disabled={artifactLoading !== null}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="rag-studio-card-title">{artifact.label}</div>
                    </div>
                    <div className="rag-studio-card-action">
                      <Sparkles className="h-3.5 w-3.5 shrink-0 text-text-primary" />
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <div className="rag-artifact-history">
            {studioOutputs.length === 0 ? (
              <div className="rag-empty-state">Generated outputs will appear here after you run one.</div>
            ) : (
              studioOutputs.map((artifact) => {
                const active = selectedArtifactFilename === artifact.filename;
                const loading = loadingArtifactFilename === artifact.filename;
                const renaming = renamingArtifactFilename === artifact.filename;
                const deleting = deletingArtifactFilename === artifact.filename;
                const menuOpen = artifactMenuFilename === artifact.filename;
                const editing = editingArtifactFilename === artifact.filename;

                return (
                  <div
                    key={artifact.filename}
                    className={["rag-history-item", active ? "rag-history-item-selected" : ""].join(" ")}
                  >
                    {editing ? (
                      <form
                        className="rag-history-item-editor"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void handleRenameArtifact(artifact);
                        }}
                      >
                        <div className="rag-source-icon">
                          <FolderOpen className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <input
                            value={artifactTitleDraft}
                            onChange={(event) => setArtifactTitleDraft(event.target.value)}
                            className="rag-history-item-input"
                            autoFocus
                          />
                          <div className="mt-1 text-xs text-text-muted">
                            Edit output name
                          </div>
                        </div>
                        <div className="rag-history-item-editor-actions">
                          <button
                            type="submit"
                            className="rag-history-edit-button"
                            disabled={renaming || deleting || !artifactTitleDraft.trim()}
                            title="Save"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingArtifactFilename(null);
                              setArtifactTitleDraft("");
                            }}
                            className="rag-history-edit-button"
                            disabled={renaming || deleting}
                            title="Cancel"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          artifact.source === "pinned"
                            ? openPinnedArtifact(artifact)
                            : void loadArtifactDetail(activeCollectionId, artifact.filename)
                        }
                        className="rag-history-item-main"
                      >
                        <div className="rag-source-icon">
                          <FolderOpen className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-text-primary">
                            {artifact.title || formatArtifactKind(artifact.kind)}
                          </div>
                          <div className="mt-1 text-xs text-text-muted">
                            {deleting
                              ? "Deleting..."
                              : renaming
                                ? "Renaming..."
                                : loading
                                  ? "Loading..."
                                  : formatTimestamp(artifact.updated_at)}
                          </div>
                        </div>
                      </button>
                    )}
                    <div className="rag-history-item-menu" data-artifact-menu>
                      <button
                        type="button"
                        onClick={() =>
                          setArtifactMenuFilename((current) =>
                            current === artifact.filename ? null : artifact.filename,
                          )
                        }
                        className="rag-history-item-action"
                        title="Output actions"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>

                      {menuOpen ? (
                        <div className="rag-artifact-menu">
                          <button
                            type="button"
                            onClick={() => startArtifactRename(artifact)}
                            className="rag-artifact-menu-item"
                            disabled={editing || renaming || deleting}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            onClick={() => requestDeleteArtifact(artifact)}
                            className="rag-artifact-menu-item rag-artifact-menu-item-danger"
                            disabled={editing || renaming || deleting}
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          </div>
        </aside>
        )}
      </div>

      {deleteIntent ? (
        <div className="rag-confirm-overlay" role="presentation" onClick={() => setDeleteIntent(null)}>
          <div
            className="rag-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rag-delete-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="rag-confirm-kicker">Delete</div>
            <h2 id="rag-delete-title" className="rag-confirm-title">
              Remove {deleteIntent.label}?
            </h2>
            <p className="rag-confirm-copy">
              {deleteIntent.kind === "collection"
                ? "This notebook, its sources, and its saved outputs will be removed."
                : deleteIntent.kind === "document"
                  ? "This source will be removed from the notebook."
                  : "This saved output will be removed from Studio."}
            </p>
            <div className="rag-confirm-actions">
              <button
                type="button"
                onClick={() => setDeleteIntent(null)}
                className="study-button-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDeleteIntent()}
                className="rag-delete-button"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
