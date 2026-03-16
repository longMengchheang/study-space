"use client";

import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import {
  useCallback,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Command,
  ClipboardCopy,
  Download,
  FileCode2,
  FilePlus2,
  FileUp,
  Hash,
  History,
  Loader2,
  Play,
  PencilLine,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Terminal,
  Trash2,
  WrapText,
  X,
} from "lucide-react";
import {
  getStorageSnapshot,
  setStorageValueAndNotify,
  subscribeStorageKey,
} from "@/lib/browser-storage";
import {
  createDefaultPracticeWorkspace,
  createPracticeFile,
  detectLanguageFromName,
  IDE_FILE_TEMPLATES,
  IDE_WORKSPACE_STORAGE_KEY,
  type PracticeFile,
  type PracticeTemplateId,
  type PracticeWorkspace,
} from "@/lib/ide-workspace";
import { STUDYSPACE_THEME_STORAGE_KEY } from "@/lib/theme";

type ServiceState = {
  connected: boolean;
  status: string;
  detail?: string;
  model?: string;
  modelInstalled?: boolean;
};

type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type AssistantMode = "ask" | "edit";
type ResizeTarget = "explorer" | "assistant" | "output";
type IdeCommandId =
  | "new-file"
  | "quick-open"
  | "run-file"
  | "toggle-terminal"
  | "toggle-files"
  | "toggle-chat"
  | "rename-file"
  | "duplicate-file"
  | "download-file"
  | "upload-files"
  | "toggle-wrap";

type CodeRunResult = {
  runtime: "python" | "javascript";
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
};

type TerminalRunResult = {
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
};

type TerminalHistoryEntry = TerminalRunResult & {
  id: string;
  createdAt: string;
};

type IdeOutputTab = "console" | "terminal";

const INITIAL_SERVICE_STATE: ServiceState = {
  connected: false,
  status: "checking",
};
const IDE_LAYOUT_STORAGE_KEY = "studyspace.ide.layout.v1";
const IDE_SETTINGS_STORAGE_KEY = "studyspace.ide.settings.v1";
const COLLAPSED_PANEL_WIDTH = 54;
const OUTPUT_PANEL_MIN_HEIGHT = 110;
const OUTPUT_PANEL_MAX_HEIGHT = 420;
const MAX_TERMINAL_ENTRIES = 50;
const DEFAULT_IDE_LAYOUT = {
  explorerWidth: 290,
  assistantWidth: 420,
  explorerCollapsed: false,
  assistantCollapsed: false,
};
const DEFAULT_IDE_SETTINGS = {
  wordWrap: true,
};

type IdeLayoutSnapshot = {
  explorerWidth: number;
  assistantWidth: number;
  explorerCollapsed: boolean;
  assistantCollapsed: boolean;
};

let workspaceBootstrapCache: PracticeWorkspace | null = null;
let layoutBootstrapCache: IdeLayoutSnapshot | null = null;
let settingsBootstrapCache: typeof DEFAULT_IDE_SETTINGS | null = null;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function loadWorkspaceSnapshot(): PracticeWorkspace {
  return getStorageSnapshot(
    IDE_WORKSPACE_STORAGE_KEY,
    (raw) => {
      if (!raw) {
        return createDefaultPracticeWorkspace();
      }

      try {
        const parsed = JSON.parse(raw) as PracticeWorkspace;
        if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
          return createDefaultPracticeWorkspace();
        }

        const files = parsed.files
          .filter((file): file is PracticeFile => Boolean(file?.id && file?.name))
          .map((file) => ({
            ...file,
            language: detectLanguageFromName(file.name, file.language),
          }));

        if (files.length === 0) {
          return createDefaultPracticeWorkspace();
        }

        const activeFileId = files.some((file) => file.id === parsed.activeFileId)
          ? parsed.activeFileId
          : files[0].id;

        return {
          files,
          activeFileId,
          updatedAt: parsed.updatedAt || new Date().toISOString(),
        };
      } catch {
        return createDefaultPracticeWorkspace();
      }
    },
    createDefaultPracticeWorkspace(),
  );
}

function loadIdeLayoutSnapshot(): IdeLayoutSnapshot {
  if (layoutBootstrapCache) {
    return layoutBootstrapCache;
  }

  if (typeof window === "undefined") {
    return { ...DEFAULT_IDE_LAYOUT };
  }

  let snapshot: IdeLayoutSnapshot = { ...DEFAULT_IDE_LAYOUT };

  try {
    const raw = window.localStorage.getItem(IDE_LAYOUT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as {
        explorerWidth?: number;
        assistantWidth?: number;
        explorerCollapsed?: boolean;
        assistantCollapsed?: boolean;
      };

      snapshot = {
        explorerWidth:
          typeof parsed.explorerWidth === "number"
            ? clamp(parsed.explorerWidth, 220, 560)
            : DEFAULT_IDE_LAYOUT.explorerWidth,
        assistantWidth:
          typeof parsed.assistantWidth === "number"
            ? clamp(parsed.assistantWidth, 300, 640)
            : DEFAULT_IDE_LAYOUT.assistantWidth,
        explorerCollapsed:
          typeof parsed.explorerCollapsed === "boolean"
            ? parsed.explorerCollapsed
            : DEFAULT_IDE_LAYOUT.explorerCollapsed,
        assistantCollapsed:
          typeof parsed.assistantCollapsed === "boolean"
            ? parsed.assistantCollapsed
            : DEFAULT_IDE_LAYOUT.assistantCollapsed,
      };
    }
  } catch {
    snapshot = { ...DEFAULT_IDE_LAYOUT };
  }

  layoutBootstrapCache = snapshot;
  return snapshot;
}

function loadIdeSettingsSnapshot(): typeof DEFAULT_IDE_SETTINGS {
  if (settingsBootstrapCache) {
    return settingsBootstrapCache;
  }

  if (typeof window === "undefined") {
    return { ...DEFAULT_IDE_SETTINGS };
  }

  let snapshot: typeof DEFAULT_IDE_SETTINGS = { ...DEFAULT_IDE_SETTINGS };

  try {
    const raw = window.localStorage.getItem(IDE_SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as {
        wordWrap?: boolean;
      };

      snapshot = {
        wordWrap:
          typeof parsed.wordWrap === "boolean" ? parsed.wordWrap : DEFAULT_IDE_SETTINGS.wordWrap,
      };
    }
  } catch {
    snapshot = { ...DEFAULT_IDE_SETTINGS };
  }

  settingsBootstrapCache = snapshot;
  return snapshot;
}

function uniqueFileName(name: string, existingFiles: PracticeFile[]) {
  const trimmed = name.trim();
  if (!existingFiles.some((file) => file.name.toLowerCase() === trimmed.toLowerCase())) {
    return trimmed;
  }

  const extensionIndex = trimmed.lastIndexOf(".");
  const base = extensionIndex > 0 ? trimmed.slice(0, extensionIndex) : trimmed;
  const extension = extensionIndex > 0 ? trimmed.slice(extensionIndex) : "";

  let count = 2;
  let candidate = `${base}-${count}${extension}`;

  while (existingFiles.some((file) => file.name.toLowerCase() === candidate.toLowerCase())) {
    count += 1;
    candidate = `${base}-${count}${extension}`;
  }

  return candidate;
}

function truncateForContext(value: string, limit = 12000) {
  return value.length > limit ? `${value.slice(0, limit)}\n...` : value;
}

function extractCodeBlock(response: string) {
  const match = response.match(/```[\w-]*\n([\s\S]*?)```/);
  return match ? match[1].trimEnd() : null;
}

function createWorkspaceFile(name: string, content: string): PracticeFile {
  return {
    id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    language: detectLanguageFromName(name),
    content,
  };
}

export default function IdeWorkspaceClient() {
  const [ideHealth, setIdeHealth] = useState<ServiceState>(INITIAL_SERVICE_STATE);
  const [assistantHealth, setAssistantHealth] = useState<ServiceState>(INITIAL_SERVICE_STATE);
  const [workspace, setWorkspace] = useState<PracticeWorkspace | null>(() => workspaceBootstrapCache);
  const [refreshing, setRefreshing] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [assistantMode, setAssistantMode] = useState<AssistantMode>("ask");
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [newFileName, setNewFileName] = useState("practice.py");
  const [templateId, setTemplateId] = useState<PracticeTemplateId>("python");
  const [selectionPreview, setSelectionPreview] = useState("");
  const [explorerWidth, setExplorerWidth] = useState(
    () => layoutBootstrapCache?.explorerWidth ?? DEFAULT_IDE_LAYOUT.explorerWidth,
  );
  const [assistantWidth, setAssistantWidth] = useState(
    () => layoutBootstrapCache?.assistantWidth ?? DEFAULT_IDE_LAYOUT.assistantWidth,
  );
  const [explorerCollapsed, setExplorerCollapsed] = useState(
    () => layoutBootstrapCache?.explorerCollapsed ?? DEFAULT_IDE_LAYOUT.explorerCollapsed,
  );
  const [assistantCollapsed, setAssistantCollapsed] = useState(
    () => layoutBootstrapCache?.assistantCollapsed ?? DEFAULT_IDE_LAYOUT.assistantCollapsed,
  );
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [explorerQuery, setExplorerQuery] = useState("");
  const [showQuickOpen, setShowQuickOpen] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState("");
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  const [renamingDraft, setRenamingDraft] = useState("");
  const [wordWrap, setWordWrap] = useState(
    () => settingsBootstrapCache?.wordWrap ?? DEFAULT_IDE_SETTINGS.wordWrap,
  );
  const [runningFile, setRunningFile] = useState(false);
  const [runPanelVisible, setRunPanelVisible] = useState(false);
  const [outputPanelHeight, setOutputPanelHeight] = useState(220);
  const [outputTab, setOutputTab] = useState<IdeOutputTab>("console");
  const [runOutput, setRunOutput] = useState<CodeRunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [terminalCommand, setTerminalCommand] = useState("");
  const [terminalRunning, setTerminalRunning] = useState(false);
  const [terminalHistory, setTerminalHistory] = useState<TerminalHistoryEntry[]>([]);
  const [terminalCwd, setTerminalCwd] = useState("");
  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      id: "assistant-intro",
      role: "assistant",
      content: "I am ready to help with the active file.",
    },
  ]);

  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const workspaceBodyRef = useRef<HTMLDivElement | null>(null);
  const editorStackRef = useRef<HTMLDivElement | null>(null);
  const fileUploadRef = useRef<HTMLInputElement | null>(null);
  const quickOpenInputRef = useRef<HTMLInputElement | null>(null);
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const terminalInputRef = useRef<HTMLInputElement | null>(null);
  const terminalLogRef = useRef<HTMLDivElement | null>(null);
  const assistantMessagesRef = useRef<HTMLDivElement | null>(null);
  const resizeStateRef = useRef<
    | {
        target: "explorer" | "assistant";
        startX: number;
        startWidth: number;
        containerWidth: number;
      }
    | {
        target: "output";
        startY: number;
        startHeight: number;
        containerHeight: number;
      }
    | null
  >(null);
  const storedTheme = useSyncExternalStore(
    (callback) => subscribeStorageKey(STUDYSPACE_THEME_STORAGE_KEY, callback),
    () =>
      getStorageSnapshot<string | null>(
        STUDYSPACE_THEME_STORAGE_KEY,
        (raw) => raw,
        null,
      ),
    () => null,
  );

  useEffect(() => {
    if (workspaceBootstrapCache) {
      setWorkspace(workspaceBootstrapCache);
    } else {
      const workspaceSnapshot = loadWorkspaceSnapshot();
      workspaceBootstrapCache = workspaceSnapshot;
      setWorkspace(workspaceSnapshot);
    }

    if (!layoutBootstrapCache) {
      layoutBootstrapCache = loadIdeLayoutSnapshot();
    }
    setExplorerWidth(layoutBootstrapCache.explorerWidth);
    setAssistantWidth(layoutBootstrapCache.assistantWidth);
    setExplorerCollapsed(layoutBootstrapCache.explorerCollapsed);
    setAssistantCollapsed(layoutBootstrapCache.assistantCollapsed);

    if (!settingsBootstrapCache) {
      settingsBootstrapCache = loadIdeSettingsSnapshot();
    }
    setWordWrap(settingsBootstrapCache.wordWrap);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 960px)");
    const syncViewport = () => setIsCompactViewport(mediaQuery.matches);
    syncViewport();
    mediaQuery.addEventListener("change", syncViewport);

    return () => mediaQuery.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    if (!workspace) {
      return;
    }

    workspaceBootstrapCache = workspace;
    setStorageValueAndNotify(IDE_WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
  }, [workspace]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        IDE_LAYOUT_STORAGE_KEY,
        JSON.stringify({
          explorerWidth,
          assistantWidth,
          explorerCollapsed,
          assistantCollapsed,
        }),
      );
    } catch {
      // Ignore storage failures for layout preferences.
    }

    layoutBootstrapCache = {
      explorerWidth,
      assistantWidth,
      explorerCollapsed,
      assistantCollapsed,
    };
  }, [assistantCollapsed, assistantWidth, explorerCollapsed, explorerWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        IDE_SETTINGS_STORAGE_KEY,
        JSON.stringify({
          wordWrap,
        }),
      );
    } catch {
      // Ignore storage failures for editor settings.
    }

    settingsBootstrapCache = { wordWrap };
  }, [wordWrap]);

  const activeFile = useMemo(() => {
    if (!workspace) {
      return null;
    }

    return (
      workspace.files.find((file) => file.id === workspace.activeFileId) ?? workspace.files[0] ?? null
    );
  }, [workspace]);

  const filteredFiles = useMemo(() => {
    if (!workspace) {
      return [];
    }

    const query = explorerQuery.trim().toLowerCase();
    if (!query) {
      return workspace.files;
    }

    return workspace.files.filter((file) => {
      const fileName = file.name.toLowerCase();
      const fileLanguage = file.language.toLowerCase();
      return fileName.includes(query) || fileLanguage.includes(query);
    });
  }, [explorerQuery, workspace]);

  const quickOpenFiles = useMemo(() => {
    if (!workspace) {
      return [];
    }

    const query = quickOpenQuery.trim().toLowerCase();
    if (!query) {
      return workspace.files.slice(0, 12);
    }

    return workspace.files
      .filter((file) => file.name.toLowerCase().includes(query))
      .slice(0, 20);
  }, [quickOpenQuery, workspace]);

  const ideCommands = useMemo(
    () =>
      [
        { id: "new-file", label: "New File", shortcut: "Ctrl+N" },
        { id: "quick-open", label: "Quick Open File", shortcut: "Ctrl+P" },
        { id: "run-file", label: "Run Active File", shortcut: "Ctrl+Enter" },
        { id: "toggle-terminal", label: "Toggle Terminal Panel", shortcut: "Ctrl+`" },
        { id: "rename-file", label: "Rename Active File", shortcut: "F2" },
        { id: "duplicate-file", label: "Duplicate Active File", shortcut: "Ctrl+Shift+D" },
        { id: "download-file", label: "Download Active File", shortcut: "Ctrl+Shift+S" },
        { id: "upload-files", label: "Import Files", shortcut: "Ctrl+O" },
        { id: "toggle-files", label: "Toggle Files Panel", shortcut: "Ctrl+B" },
        { id: "toggle-chat", label: "Toggle Chat Panel", shortcut: "Ctrl+J" },
        { id: "toggle-wrap", label: "Toggle Word Wrap", shortcut: "Alt+Z" },
      ] satisfies Array<{ id: IdeCommandId; label: string; shortcut: string }>,
    [],
  );

  const filteredCommands = useMemo(() => {
    const query = commandQuery.trim().toLowerCase();
    if (!query) {
      return ideCommands;
    }

    return ideCommands.filter((command) => command.label.toLowerCase().includes(query));
  }, [commandQuery, ideCommands]);

  async function refreshServices() {
    setRefreshing(true);

    try {
      const [ideResponse, assistantResponse] = await Promise.all([
        fetch("/api/ide/health", { cache: "no-store" }),
        fetch("/api/ide/assistant/health", { cache: "no-store" }),
      ]);

      const ideData = (await ideResponse.json().catch(() => ({}))) as ServiceState;
      const assistantData = (await assistantResponse.json().catch(() => ({}))) as ServiceState;

      setIdeHealth({
        connected: ideResponse.ok && Boolean(ideData.connected),
        status: ideData.status || (ideResponse.ok ? "ready" : "offline"),
        detail: ideData.detail,
      });
      setAssistantHealth({
        connected: assistantResponse.ok && Boolean(assistantData.connected),
        status: assistantData.status || (assistantResponse.ok ? "ok" : "offline"),
        detail: assistantData.detail,
        model: assistantData.model,
        modelInstalled: assistantData.modelInstalled,
      });
    } catch {
      setIdeHealth({
        connected: true,
        status: "ready",
        detail: "The built-in editor is ready.",
      });
      setAssistantHealth({
        connected: false,
        status: "offline",
        detail: "Local coding assistant is unavailable.",
      });
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refreshServices();
  }, []);

  useEffect(() => {
    setSelectionPreview("");
  }, [activeFile?.id]);

  useEffect(() => {
    function handlePointerMove(event: MouseEvent) {
      const state = resizeStateRef.current;
      if (!state) {
        return;
      }

      if (state.target === "output") {
        const maxHeight = Math.max(
          OUTPUT_PANEL_MIN_HEIGHT,
          Math.min(OUTPUT_PANEL_MAX_HEIGHT, state.containerHeight - 120),
        );
        setOutputPanelHeight(
          clamp(
            state.startHeight + (state.startY - event.clientY),
            OUTPUT_PANEL_MIN_HEIGHT,
            maxHeight,
          ),
        );
        document.body.style.cursor = "row-resize";
      } else if (state.target === "explorer") {
        const maxWidth = Math.max(260, Math.min(560, state.containerWidth - 360));
        setExplorerWidth(clamp(state.startWidth + (event.clientX - state.startX), 220, maxWidth));
        document.body.style.cursor = "col-resize";
      } else {
        const maxWidth = Math.max(320, Math.min(640, state.containerWidth - 420));
        setAssistantWidth(clamp(state.startWidth - (event.clientX - state.startX), 300, maxWidth));
        document.body.style.cursor = "col-resize";
      }

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
    if (showQuickOpen) {
      quickOpenInputRef.current?.focus();
      quickOpenInputRef.current?.select();
    }
  }, [showQuickOpen]);

  useEffect(() => {
    if (showCommandPalette) {
      commandInputRef.current?.focus();
      commandInputRef.current?.select();
    }
  }, [showCommandPalette]);

  useEffect(() => {
    if (runPanelVisible && outputTab === "terminal") {
      terminalInputRef.current?.focus();
    }
  }, [outputTab, runPanelVisible]);

  useEffect(() => {
    if (!runPanelVisible || outputTab !== "terminal") {
      return;
    }

    const container = terminalLogRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [outputTab, runPanelVisible, terminalHistory, terminalRunning]);

  useEffect(() => {
    const container = assistantMessagesRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [messages, submitting]);

  function handleEditorMount(
    editor: MonacoEditor.IStandaloneCodeEditor,
    _monaco: typeof import("monaco-editor"),
  ) {
    editorRef.current = editor;

    const updateSelection = () => {
      const model = editor.getModel();
      const selection = editor.getSelection();

      if (!model || !selection || selection.isEmpty()) {
        setSelectionPreview("");
        return;
      }

      setSelectionPreview(model.getValueInRange(selection).trim());
    };

    updateSelection();
    editor.onDidChangeCursorSelection(updateSelection);
  }

  function updateActiveFileContent(nextContent: string) {
    if (!workspace || !activeFile) {
      return;
    }

    setWorkspace({
      ...workspace,
      updatedAt: new Date().toISOString(),
      files: workspace.files.map((file) =>
        file.id === activeFile.id
          ? {
              ...file,
              content: nextContent,
            }
          : file,
      ),
    });
  }

  function activateFile(fileId: string) {
    if (!workspace) {
      return;
    }

    setWorkspace({
      ...workspace,
      activeFileId: fileId,
    });
  }

  function handleCreateFile() {
    if (!workspace) {
      return;
    }

    const rawName = newFileName.trim();
    if (!rawName) {
      return;
    }

    const file = createPracticeFile(templateId, uniqueFileName(rawName, workspace.files));
    setWorkspace({
      files: [...workspace.files, file],
      activeFileId: file.id,
      updatedAt: new Date().toISOString(),
    });
    setShowCreatePanel(false);
  }

  function handleDeleteFile(fileId: string) {
    if (!workspace) {
      return;
    }

    const remaining = workspace.files.filter((file) => file.id !== fileId);
    const nextWorkspace =
      remaining.length > 0
        ? {
            files: remaining,
            activeFileId:
              workspace.activeFileId === fileId ? remaining[0].id : workspace.activeFileId,
            updatedAt: new Date().toISOString(),
          }
        : createDefaultPracticeWorkspace();

    setWorkspace(nextWorkspace);
  }

  function resetWorkspace() {
    setWorkspace(createDefaultPracticeWorkspace());
    setSelectionPreview("");
    setMessages((current) => current.slice(0, 1));
  }

  function resetChat() {
    setMessages((current) => current.slice(0, 1));
    setPrompt("");
  }

  function beginResize(target: ResizeTarget, event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();

    if (target === "output") {
      const container = editorStackRef.current;
      if (!container) {
        return;
      }

      resizeStateRef.current = {
        target,
        startY: event.clientY,
        startHeight: outputPanelHeight,
        containerHeight: container.getBoundingClientRect().height,
      };
      return;
    }

    const container = target === "explorer" ? workspaceBodyRef.current : boardRef.current;
    if (!container) {
      return;
    }

    resizeStateRef.current = {
      target,
      startX: event.clientX,
      startWidth: target === "explorer" ? explorerWidth : assistantWidth,
      containerWidth: container.getBoundingClientRect().width,
    };
  }

  function renameFile(fileId: string, nextName: string) {
    if (!workspace) {
      return;
    }

    const sanitized = nextName.trim();
    if (!sanitized) {
      return;
    }

    const existing = workspace.files.filter((file) => file.id !== fileId);
    const uniqueName = uniqueFileName(sanitized, existing);

    setWorkspace({
      ...workspace,
      updatedAt: new Date().toISOString(),
      files: workspace.files.map((file) =>
        file.id === fileId
          ? {
              ...file,
              name: uniqueName,
              language: detectLanguageFromName(uniqueName, file.language),
            }
          : file,
      ),
    });
  }

  const duplicateFile = useCallback((fileId: string) => {
    if (!workspace) {
      return;
    }

    const source = workspace.files.find((file) => file.id === fileId);
    if (!source) {
      return;
    }

    const extensionIndex = source.name.lastIndexOf(".");
    const baseName = extensionIndex > 0 ? source.name.slice(0, extensionIndex) : source.name;
    const extension = extensionIndex > 0 ? source.name.slice(extensionIndex) : "";
    const duplicateName = uniqueFileName(`${baseName}-copy${extension}`, workspace.files);
    const duplicate = createWorkspaceFile(duplicateName, source.content);

    setWorkspace({
      files: [...workspace.files, duplicate],
      activeFileId: duplicate.id,
      updatedAt: new Date().toISOString(),
    });
  }, [workspace]);

  async function importFiles(list: FileList | null) {
    if (!workspace || !list || list.length === 0) {
      return;
    }

    const imported = await Promise.all(
      Array.from(list).map(async (file) => ({
        name: file.name,
        content: await file.text(),
      })),
    );

    const nextFiles = [...workspace.files];
    let lastFileId = workspace.activeFileId;

    for (const item of imported) {
      const uniqueName = uniqueFileName(item.name, nextFiles);
      const nextFile = createWorkspaceFile(uniqueName, item.content);
      nextFiles.push(nextFile);
      lastFileId = nextFile.id;
    }

    setWorkspace({
      files: nextFiles,
      activeFileId: lastFileId,
      updatedAt: new Date().toISOString(),
    });
  }

  const startRenameActiveFile = useCallback(() => {
    if (!activeFile) {
      return;
    }

    setRenamingFileId(activeFile.id);
    setRenamingDraft(activeFile.name);
  }, [activeFile]);

  function closeRenameFile() {
    setRenamingFileId(null);
    setRenamingDraft("");
  }

  const runActiveFile = useCallback(async () => {
    if (!activeFile || runningFile) {
      return;
    }

    if (activeFile.language !== "python" && activeFile.language !== "javascript") {
      setRunPanelVisible(true);
      setOutputTab("console");
      setRunOutput(null);
      setRunError("Run currently supports Python and JavaScript files.");
      return;
    }

    setRunPanelVisible(true);
    setOutputTab("console");
    setRunError(null);
    setRunningFile(true);

    try {
      const response = await fetch("/api/ide/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileName: activeFile.name,
          language: activeFile.language,
          content: activeFile.content,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as
        | (CodeRunResult & { detail?: string })
        | { detail?: string };

      if (!response.ok) {
        throw new Error(data.detail || "Failed to run the active file.");
      }

      setRunOutput(data as CodeRunResult);
    } catch (error) {
      setRunOutput(null);
      setRunError(error instanceof Error ? error.message : "Failed to run the active file.");
    } finally {
      setRunningFile(false);
    }
  }, [activeFile, runningFile]);

  const runTerminalCommand = useCallback(
    async (rawCommand: string) => {
      const command = rawCommand.trim();
      if (!command || terminalRunning) {
        return;
      }

      setRunPanelVisible(true);
      setOutputTab("terminal");
      setTerminalRunning(true);
      setTerminalCommand("");

      try {
        const response = await fetch("/api/ide/terminal", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            command,
            cwd: terminalCwd || undefined,
          }),
        });

        const data = (await response.json().catch(() => ({}))) as
          | (TerminalRunResult & { detail?: string })
          | { detail?: string };

        if (!response.ok) {
          throw new Error(data.detail || "Terminal command failed.");
        }

        const nextEntry: TerminalHistoryEntry = {
          ...(data as TerminalRunResult),
          id: `terminal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: new Date().toISOString(),
        };

        setTerminalCwd(nextEntry.cwd || terminalCwd);
        setTerminalHistory((current) => [...current, nextEntry].slice(-MAX_TERMINAL_ENTRIES));
      } catch (error) {
        const nextEntry: TerminalHistoryEntry = {
          id: `terminal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: new Date().toISOString(),
          command,
          cwd: "",
          stdout: "",
          stderr: error instanceof Error ? error.message : "Terminal command failed.",
          exitCode: null,
          durationMs: 0,
          timedOut: false,
        };

        setTerminalHistory((current) => [...current, nextEntry].slice(-MAX_TERMINAL_ENTRIES));
      } finally {
        setTerminalRunning(false);
      }
    },
    [terminalCwd, terminalRunning],
  );

  function runCommand(commandId: IdeCommandId) {
    switch (commandId) {
      case "new-file":
        setShowCreatePanel(true);
        break;
      case "quick-open":
        setShowQuickOpen(true);
        break;
      case "run-file":
        void runActiveFile();
        break;
      case "toggle-terminal":
        setRunPanelVisible((current) => !current);
        setOutputTab("terminal");
        break;
      case "toggle-files":
        if (!isCompactViewport) {
          setExplorerCollapsed((current) => !current);
        }
        break;
      case "toggle-chat":
        if (!isCompactViewport) {
          setAssistantCollapsed((current) => !current);
        }
        break;
      case "rename-file":
        startRenameActiveFile();
        break;
      case "duplicate-file":
        if (activeFile) {
          duplicateFile(activeFile.id);
        }
        break;
      case "download-file":
        void downloadActiveFile();
        break;
      case "upload-files":
        fileUploadRef.current?.click();
        break;
      case "toggle-wrap":
        setWordWrap((current) => !current);
        break;
      default:
        break;
    }
  }

  async function copyActiveFile() {
    if (!activeFile) {
      return;
    }

    await navigator.clipboard.writeText(activeFile.content);
  }

  const downloadActiveFile = useCallback(async () => {
    if (!activeFile) {
      return;
    }

    const blob = new Blob([activeFile.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = activeFile.name;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [activeFile]);

  async function submitPrompt() {
    if (!activeFile) {
      return;
    }

    const value = prompt.trim();
    if (!value || submitting) {
      return;
    }

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
          truncateForContext(selectionPreview, 4000),
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
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: `${contextBlock}\n\n${requestBlock}`,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        response?: string;
        detail?: string;
      };

      if (!response.ok) {
        throw new Error(data.detail || "Assistant request failed.");
      }

      const assistantResponse = data.response || "No response returned.";
      if (assistantMode === "edit") {
        const nextContent = extractCodeBlock(assistantResponse);

        if (nextContent) {
          updateActiveFileContent(nextContent);
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
  }

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTextInput =
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement ||
        target?.isContentEditable;

      if (showQuickOpen || showCommandPalette) {
        if (event.key === "Escape") {
          setShowQuickOpen(false);
          setShowCommandPalette(false);
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void runActiveFile();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setShowQuickOpen(true);
        setQuickOpenQuery("");
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowCommandPalette(true);
        setCommandQuery("");
        return;
      }

      if (isTextInput) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setShowCreatePanel(true);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        if (activeFile) {
          duplicateFile(activeFile.id);
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void downloadActiveFile();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        fileUploadRef.current?.click();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "`") {
        event.preventDefault();
        setRunPanelVisible((current) => !current);
        setOutputTab("terminal");
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        if (!isCompactViewport) {
          setExplorerCollapsed((current) => !current);
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        if (!isCompactViewport) {
          setAssistantCollapsed((current) => !current);
        }
        return;
      }

      if (event.altKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        setWordWrap((current) => !current);
        return;
      }

      if (event.key === "F2") {
        event.preventDefault();
        startRenameActiveFile();
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [
    activeFile,
    downloadActiveFile,
    duplicateFile,
    isCompactViewport,
    runActiveFile,
    showCommandPalette,
    showQuickOpen,
    startRenameActiveFile,
  ]);

  const monacoTheme = storedTheme === "dark" ? "vs-dark" : "vs";

  if (!workspace || !activeFile) {
    return (
      <div className="ide-shell">
        <div className="ide-loading-state">
          <Loader2 className="h-5 w-5 animate-spin" />
          Preparing your coding workspace...
        </div>
      </div>
    );
  }

  const effectiveExplorerCollapsed = !isCompactViewport && explorerCollapsed;
  const effectiveAssistantCollapsed = !isCompactViewport && assistantCollapsed;
  const activeFileRunnable =
    activeFile.language === "python" || activeFile.language === "javascript";

  const boardStyle = {
    "--ide-assistant-width": `${effectiveAssistantCollapsed ? COLLAPSED_PANEL_WIDTH : assistantWidth}px`,
    "--ide-assistant-divider-width": effectiveAssistantCollapsed ? "0px" : "0.75rem",
  } as CSSProperties;

  const workspaceBodyStyle = {
    "--ide-explorer-width": `${effectiveExplorerCollapsed ? COLLAPSED_PANEL_WIDTH : explorerWidth}px`,
    "--ide-explorer-divider-width": effectiveExplorerCollapsed ? "0px" : "0.75rem",
  } as CSSProperties;

  return (
    <div className="ide-shell">
      <div className="ide-topbar">
        <div>
          <h1 className="ide-topbar-title">Code Workspace</h1>
        </div>

        <div className="ide-topbar-actions">
          <button
            type="button"
            onClick={() => {
              setShowQuickOpen(true);
              setQuickOpenQuery("");
            }}
            className="ide-topbar-icon-button"
            title="Quick open (Ctrl+P)"
          >
            <Search className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setShowCommandPalette(true);
              setCommandQuery("");
            }}
            className="ide-topbar-icon-button"
            title="Command palette (Ctrl+K)"
          >
            <Command className="h-4 w-4" />
          </button>
          <span className="ide-status-chip">
            <CheckCircle2 className="h-4 w-4" />
            {ideHealth.connected ? "Editor ready" : "Checking"}
          </span>
          <span className="ide-status-chip">
            <Bot className="h-4 w-4" />
            {assistantHealth.connected
              ? assistantHealth.modelInstalled
                ? assistantHealth.model || "Assistant ready"
                : "Model missing"
              : "Assistant offline"}
          </span>
          <button
            type="button"
            onClick={() => void refreshServices()}
            className="ide-topbar-icon-button"
            disabled={refreshing}
            title="Refresh services"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <input
        ref={fileUploadRef}
        type="file"
        multiple
        className="ide-hidden-input"
        onChange={(event) => {
          const files = event.target.files;
          void importFiles(files);
          event.currentTarget.value = "";
        }}
      />

      <div ref={boardRef} className="ide-board" style={boardStyle}>
        <section className="ide-workspace-column">
          <div ref={workspaceBodyRef} className="ide-workspace-body" style={workspaceBodyStyle}>
            {effectiveExplorerCollapsed ? (
              <aside className="ide-side-rail ide-side-rail-left">
                <button
                  type="button"
                  onClick={() => setExplorerCollapsed(false)}
                  className="ide-side-rail-button"
                  title="Open files"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <span className="ide-side-rail-label">Files</span>
              </aside>
            ) : (
              <aside className="ide-explorer">
                <div className="ide-explorer-header">
                  <div>
                    <div className="ide-explorer-title">Files</div>
                    <div className="ide-explorer-subtitle">Local practice set</div>
                  </div>
                  <div className="ide-explorer-actions">
                    <button
                      type="button"
                      onClick={() => setShowCreatePanel((current) => !current)}
                      className="ide-icon-button"
                      title="New file"
                    >
                      <FilePlus2 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => fileUploadRef.current?.click()}
                      className="ide-icon-button"
                      title="Import files"
                    >
                      <FileUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={resetWorkspace}
                      className="ide-icon-button"
                      title="Reset workspace"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                    {!isCompactViewport ? (
                      <button
                        type="button"
                        onClick={() => setExplorerCollapsed(true)}
                        className="ide-icon-button"
                        title="Close files"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="ide-explorer-search">
                  <Search className="h-4 w-4 text-text-muted" />
                  <input
                    value={explorerQuery}
                    onChange={(event) => setExplorerQuery(event.target.value)}
                    placeholder="Search files..."
                    className="ide-explorer-search-input"
                  />
                </div>

                {showCreatePanel ? (
                  <div className="ide-create-panel">
                    <label className="study-label" htmlFor="ide-file-name">
                      File name
                    </label>
                    <input
                      id="ide-file-name"
                      value={newFileName}
                      onChange={(event) => setNewFileName(event.target.value)}
                      className="study-field"
                    />
                    <div className="ide-template-grid">
                      {IDE_FILE_TEMPLATES.map((template) => (
                        <button
                          key={template.id}
                          type="button"
                          onClick={() => {
                            setTemplateId(template.id);
                            setNewFileName(template.defaultName);
                          }}
                          className={[
                            "ide-template-button",
                            template.id === templateId ? "ide-template-button-active" : "",
                          ].join(" ")}
                        >
                          {template.label}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={handleCreateFile}
                      className="study-button-primary"
                    >
                      Create file
                    </button>
                  </div>
                ) : null}

                <div className="ide-explorer-files">
                  {filteredFiles.length === 0 ? (
                    <div className="ide-file-empty-state">
                      {explorerQuery.trim()
                        ? "No files match this search."
                        : "No files in workspace."}
                    </div>
                  ) : (
                    filteredFiles.map((file) => (
                      <div
                        key={file.id}
                        className={[
                          "ide-file-row",
                          file.id === workspace.activeFileId ? "ide-file-row-active" : "",
                        ].join(" ")}
                      >
                        {renamingFileId === file.id ? (
                          <form
                            className="ide-file-rename-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              renameFile(file.id, renamingDraft);
                              closeRenameFile();
                            }}
                          >
                            <input
                              value={renamingDraft}
                              onChange={(event) => setRenamingDraft(event.target.value)}
                              className="ide-file-rename-input"
                              autoFocus
                            />
                            <button type="submit" className="ide-file-action">
                              Save
                            </button>
                            <button type="button" onClick={closeRenameFile} className="ide-file-action">
                              Cancel
                            </button>
                          </form>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => activateFile(file.id)}
                              className="ide-file-main"
                            >
                              <span className="ide-file-icon">
                                <FileCode2 className="h-4 w-4" />
                              </span>
                              <span className="ide-file-meta">
                                <span className="ide-file-name">{file.name}</span>
                                <span className="ide-file-language">{file.language}</span>
                              </span>
                            </button>
                            <div className="ide-file-actions">
                              <button
                                type="button"
                                onClick={() => {
                                  setRenamingFileId(file.id);
                                  setRenamingDraft(file.name);
                                }}
                                className="ide-file-action"
                                title={`Rename ${file.name}`}
                              >
                                <PencilLine className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => duplicateFile(file.id)}
                                className="ide-file-action"
                                title={`Duplicate ${file.name}`}
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteFile(file.id)}
                                className="ide-file-action ide-file-action-danger"
                                title={`Delete ${file.name}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </aside>
            )}

            <div
              className={[
                "ide-panel-divider",
                effectiveExplorerCollapsed || isCompactViewport ? "ide-panel-divider-hidden" : "",
              ].join(" ")}
              onMouseDown={(event) => beginResize("explorer", event)}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize files panel"
            />

            <section className="ide-editor-area">
              <div className="ide-editor-tabs">
                {workspace.files.map((file) => (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => activateFile(file.id)}
                    className={[
                      "ide-editor-tab",
                      file.id === workspace.activeFileId ? "ide-editor-tab-active" : "",
                    ].join(" ")}
                  >
                    {file.name}
                  </button>
                ))}
              </div>

              <div className="ide-editor-toolbar">
                <div>
                  <div className="ide-editor-title">{activeFile.name}</div>
                </div>
                <div className="ide-editor-actions">
                  <button
                    type="button"
                    onClick={() => void runActiveFile()}
                    className="ide-toolbar-run"
                    title={
                      activeFileRunnable
                        ? "Run active file (Ctrl+Enter)"
                        : "Run supports Python and JavaScript files."
                    }
                    disabled={runningFile || !activeFileRunnable}
                  >
                    {runningFile ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </button>
                  <div className="ide-toolbar-output-group">
                    <button
                      type="button"
                      onClick={() => {
                        setRunPanelVisible((current) => (outputTab === "terminal" ? !current : true));
                        setOutputTab("terminal");
                      }}
                      className={[
                        "ide-toolbar-output-button",
                        runPanelVisible && outputTab === "terminal" ? "ide-toolbar-output-button-active" : "",
                      ].join(" ")}
                      title="Open terminal panel (Ctrl+`)"
                      aria-label="Terminal"
                    >
                      <Terminal className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRunPanelVisible((current) => (outputTab === "console" ? !current : true));
                        setOutputTab("console");
                      }}
                      className={[
                        "ide-toolbar-output-button",
                        runPanelVisible && outputTab === "console" ? "ide-toolbar-output-button-active" : "",
                      ].join(" ")}
                      title="Open run console"
                      aria-label="Console"
                    >
                      <Play className="h-4 w-4" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyActiveFile()}
                    className="ide-toolbar-icon-button"
                    title="Copy active file"
                    aria-label="Copy active file"
                  >
                    <ClipboardCopy className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void downloadActiveFile()}
                    className="ide-toolbar-icon-button"
                    title="Save active file"
                    aria-label="Save active file"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setWordWrap((current) => !current)}
                    className={[
                      "ide-toolbar-icon-button",
                      wordWrap ? "ide-toolbar-icon-button-active" : "",
                    ].join(" ")}
                    title="Toggle word wrap"
                    aria-label="Toggle word wrap"
                  >
                    <WrapText className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => updateActiveFileContent("")}
                    className="ide-toolbar-icon-button"
                    title="Clear active file"
                    aria-label="Clear active file"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div ref={editorStackRef} className="ide-editor-stack">
                <div className="ide-editor-surface">
                  <Editor
                    height="100%"
                    path={activeFile.name}
                    language={activeFile.language}
                    value={activeFile.content}
                    onMount={handleEditorMount as OnMount}
                    onChange={(value) => updateActiveFileContent(value ?? "")}
                    theme={monacoTheme}
                    options={{
                      automaticLayout: true,
                      minimap: { enabled: false },
                      fontSize: 14,
                      lineHeight: 22,
                      scrollBeyondLastLine: false,
                      smoothScrolling: true,
                      wordWrap: wordWrap ? "on" : "off",
                      padding: { top: 16, bottom: 16 },
                      roundedSelection: false,
                    }}
                    loading={
                      <div className="ide-editor-loading">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading editor...
                      </div>
                    }
                  />
                </div>

                {runPanelVisible ? (
                  <div className="ide-run-console" style={{ height: `${outputPanelHeight}px` }}>
                    <div
                      className="ide-run-console-grip"
                      onMouseDown={(event) => beginResize("output", event)}
                      role="separator"
                      aria-orientation="horizontal"
                      aria-label="Resize output panel"
                    >
                      <span className="ide-run-console-grip-line" />
                    </div>
                    <div className="ide-run-console-header">
                      <div className="ide-run-console-title-wrap">
                        <Terminal className="h-4 w-4" />
                        <span className="ide-run-console-title">Output panel</span>
                        <div className="ide-run-console-tabs">
                          <button
                            type="button"
                            onClick={() => setOutputTab("console")}
                            className={[
                              "ide-run-console-tab",
                              outputTab === "console" ? "ide-run-console-tab-active" : "",
                            ].join(" ")}
                          >
                            Console
                          </button>
                          <button
                            type="button"
                            onClick={() => setOutputTab("terminal")}
                            className={[
                              "ide-run-console-tab",
                              outputTab === "terminal" ? "ide-run-console-tab-active" : "",
                            ].join(" ")}
                          >
                            Terminal
                          </button>
                        </div>
                        {outputTab === "console" && runningFile ? (
                          <span className="ide-run-console-badge">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Running
                          </span>
                        ) : null}
                        {outputTab === "console" && runOutput ? (
                          <span className="ide-run-console-badge">
                            Exit {runOutput.exitCode ?? "?"} | {runOutput.durationMs} ms
                          </span>
                        ) : null}
                        {outputTab === "terminal" && terminalRunning ? (
                          <span className="ide-run-console-badge">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Running command
                          </span>
                        ) : null}
                      </div>
                      <div className="ide-run-console-actions">
                        {outputTab === "console" && (runOutput || runError) ? (
                          <button
                            type="button"
                            onClick={() => {
                              setRunOutput(null);
                              setRunError(null);
                            }}
                            className="ide-run-console-button"
                          >
                            Clear
                          </button>
                        ) : null}
                        {outputTab === "terminal" && terminalHistory.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => setTerminalHistory([])}
                            className="ide-run-console-button"
                          >
                            Clear
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setRunPanelVisible(false)}
                          className="ide-run-console-button"
                          title="Collapse output panel"
                        >
                          <ChevronDown className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <div className="ide-run-console-body">
                      {outputTab === "console" ? (
                        runningFile ? (
                          <div className="ide-run-console-empty">Running {activeFile.name}...</div>
                        ) : runError ? (
                          <pre className="ide-run-console-stream ide-run-console-stream-error">{runError}</pre>
                        ) : runOutput ? (
                          <>
                            {runOutput.stdout ? (
                              <pre className="ide-run-console-stream">{runOutput.stdout}</pre>
                            ) : (
                              <div className="ide-run-console-empty">No standard output.</div>
                            )}
                            {runOutput.stderr ? (
                              <pre className="ide-run-console-stream ide-run-console-stream-error">
                                {runOutput.stderr}
                              </pre>
                            ) : null}
                            {runOutput.timedOut ? (
                              <div className="ide-run-console-empty">
                                Execution stopped after timeout.
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <div className="ide-run-console-empty">Run a file to see output here.</div>
                        )
                      ) : (
                        <div className="ide-terminal-shell">
                          <div ref={terminalLogRef} className="ide-terminal-log">
                            {terminalHistory.length === 0 ? (
                              <div className="ide-run-console-empty">
                                Execute shell commands from here.
                              </div>
                            ) : (
                              terminalHistory.map((entry) => (
                                <div key={entry.id} className="ide-terminal-entry">
                                  <div className="ide-terminal-command-line">
                                    <span className="ide-terminal-prompt">$</span>
                                    <span className="ide-terminal-command">{entry.command}</span>
                                    <span className="ide-terminal-meta">
                                      {entry.exitCode === null
                                        ? entry.timedOut
                                          ? "Timed out"
                                          : "No exit code"
                                        : `Exit ${entry.exitCode}`}{" "}
                                      | {entry.durationMs} ms
                                    </span>
                                  </div>
                                  {entry.cwd ? (
                                    <div className="ide-terminal-cwd">{entry.cwd}</div>
                                  ) : null}
                                  {entry.stdout ? (
                                    <pre className="ide-run-console-stream ide-terminal-stream">
                                      {entry.stdout}
                                    </pre>
                                  ) : null}
                                  {entry.stderr ? (
                                    <pre className="ide-run-console-stream ide-run-console-stream-error">
                                      {entry.stderr}
                                    </pre>
                                  ) : null}
                                </div>
                              ))
                            )}
                            {terminalRunning ? (
                              <div className="ide-run-console-empty">Running command...</div>
                            ) : null}
                          </div>
                          <form
                            className="ide-terminal-input-row"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void runTerminalCommand(terminalCommand);
                            }}
                          >
                            <span className="ide-terminal-prompt">$</span>
                            <span className="ide-terminal-cwd-pill">{terminalCwd || "~"}</span>
                            <input
                              ref={terminalInputRef}
                              value={terminalCommand}
                              onChange={(event) => setTerminalCommand(event.target.value)}
                              placeholder="Type a command and press Enter..."
                              className="ide-terminal-input"
                              disabled={terminalRunning}
                            />
                            <button
                              type="submit"
                              className="ide-run-console-button"
                              disabled={terminalRunning || terminalCommand.trim().length === 0}
                            >
                              Run
                            </button>
                          </form>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </section>

        <div
          className={[
            "ide-panel-divider",
            effectiveAssistantCollapsed || isCompactViewport ? "ide-panel-divider-hidden" : "",
          ].join(" ")}
          onMouseDown={(event) => beginResize("assistant", event)}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize chat panel"
        />

        {effectiveAssistantCollapsed ? (
          <aside className="ide-side-rail ide-side-rail-right">
            <button
              type="button"
              onClick={() => setAssistantCollapsed(false)}
              className="ide-side-rail-button"
              title="Open chat"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="ide-side-rail-label">Chat</span>
          </aside>
        ) : (
          <aside className="ide-assistant-column">
            <div className="ide-chat-header">
              <div className="ide-chat-title-wrap">
                <Hash className="h-4.5 w-4.5 text-text-secondary" />
                <div>
                  <div className="ide-chat-title">code-companion</div>
                  <div className="ide-chat-subtitle">
                    {assistantHealth.connected ? "Local channel" : "Assistant offline"}
                  </div>
                </div>
              </div>
              <div className="ide-chat-header-actions">
                <button
                  type="button"
                  onClick={resetChat}
                  className="ide-chat-header-button"
                  title="New chat"
                >
                  <Plus className="h-4 w-4" />
                </button>
                <div className="ide-chat-status">
                  <History className="h-3.5 w-3.5" />
                  {assistantHealth.connected ? "Live" : "Offline"}
                </div>
                {!isCompactViewport ? (
                  <button
                    type="button"
                    onClick={() => setAssistantCollapsed(true)}
                    className="ide-chat-header-button"
                    title="Close chat"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </div>

            <div className="ide-assistant-body">
              <div className="ide-assistant-banner">
                {assistantHealth.connected
                  ? assistantHealth.detail || "Assistant ready."
                  : assistantHealth.detail ||
                    "Start Ollama and ensure your coding model is available."}
              </div>

              <div className="ide-assistant-context">
                <span className="ide-context-pill">{activeFile.name}</span>
                {selectionPreview ? (
                  <span className="ide-context-pill">
                    {selectionPreview.length > 80
                      ? `${selectionPreview.slice(0, 80)}...`
                      : selectionPreview}
                  </span>
                ) : (
                  <span className="ide-context-pill">Full file context</span>
                )}
              </div>

              <div ref={assistantMessagesRef} className="ide-assistant-messages">
                <div className="ide-assistant-thread">
                  {messages.length <= 1 ? (
                    <div className="ide-chat-empty">
                      <div className="ide-chat-empty-icon">
                        <Sparkles className="h-6 w-6" />
                      </div>
                      <h2 className="ide-chat-empty-title">Welcome to the link.</h2>
                      <p className="ide-chat-empty-copy">
                        Use Qwen against the active file, or switch to edit mode to rewrite code directly.
                      </p>
                    </div>
                  ) : (
                    messages.map((message) => (
                      <div
                        key={message.id}
                        className={[
                          "ide-chat-message",
                          message.role === "user"
                            ? "ide-chat-message-user"
                            : "ide-chat-message-assistant",
                        ].join(" ")}
                      >
                        <div
                          className={[
                            "ide-chat-avatar",
                            message.role === "assistant"
                              ? "ide-chat-avatar-assistant"
                              : "ide-chat-avatar-user",
                          ].join(" ")}
                        >
                          {message.role === "assistant" ? (
                            <Sparkles className="h-4 w-4" />
                          ) : (
                            <Bot className="h-4 w-4" />
                          )}
                        </div>

                        <div className="ide-chat-message-content">
                          <div className="ide-chat-message-meta">
                            <span className="ide-chat-message-author">
                              {message.role === "assistant" ? "Code Companion" : "You"}
                            </span>
                          </div>
                          <div className="ide-chat-message-text">{message.content}</div>
                        </div>
                      </div>
                    ))
                  )}

                  {submitting ? (
                    <div className="ide-chat-message ide-chat-message-assistant">
                      <div className="ide-chat-avatar ide-chat-avatar-assistant">
                        <Sparkles className="h-4 w-4" />
                      </div>
                      <div className="ide-chat-message-content">
                        <div className="ide-chat-message-meta">
                          <span className="ide-chat-message-author">Code Companion</span>
                        </div>
                        <div className="ide-chat-typing">
                          <span />
                          <span />
                          <span />
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="ide-assistant-composer">
                <div className="ide-assistant-modebar">
                  <button
                    type="button"
                    onClick={() => setAssistantMode("ask")}
                    className={[
                      "ide-assistant-mode-button",
                      assistantMode === "ask" ? "ide-assistant-mode-button-active" : "",
                    ].join(" ")}
                  >
                    Ask
                  </button>
                  <button
                    type="button"
                    onClick={() => setAssistantMode("edit")}
                    className={[
                      "ide-assistant-mode-button",
                      assistantMode === "edit" ? "ide-assistant-mode-button-active" : "",
                    ].join(" ")}
                  >
                    <PencilLine className="h-3.5 w-3.5" />
                    Edit file
                  </button>
                </div>
                <div className="ide-chat-composer-shell">
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void submitPrompt();
                      }
                    }}
                    placeholder={
                      assistantMode === "edit"
                        ? "Describe the change you want in the active file..."
                        : "Start typing..."
                    }
                    className="ide-chat-input"
                  />
                  {prompt.trim() ? (
                    <button
                      type="button"
                      onClick={() => void submitPrompt()}
                      className="ide-chat-send"
                      disabled={submitting || !assistantHealth.connected}
                    >
                      {submitting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>

      {showQuickOpen ? (
        <div className="ide-modal-overlay" onClick={() => setShowQuickOpen(false)}>
          <div className="ide-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="ide-modal-header">
              <div className="ide-modal-title">Quick Open</div>
              <button
                type="button"
                onClick={() => setShowQuickOpen(false)}
                className="ide-modal-close"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="ide-modal-search">
              <Search className="h-4 w-4 text-text-muted" />
              <input
                ref={quickOpenInputRef}
                value={quickOpenQuery}
                onChange={(event) => setQuickOpenQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && quickOpenFiles[0]) {
                    activateFile(quickOpenFiles[0].id);
                    setShowQuickOpen(false);
                  }
                }}
                placeholder="Type a file name..."
                className="ide-modal-search-input"
              />
            </div>
            <div className="ide-modal-list">
              {quickOpenFiles.length === 0 ? (
                <div className="ide-modal-empty">No matching files.</div>
              ) : (
                quickOpenFiles.map((file) => (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => {
                      activateFile(file.id);
                      setShowQuickOpen(false);
                    }}
                    className="ide-modal-item"
                  >
                    <span className="ide-modal-item-name">{file.name}</span>
                    <span className="ide-modal-item-meta">{file.language}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {showCommandPalette ? (
        <div className="ide-modal-overlay" onClick={() => setShowCommandPalette(false)}>
          <div className="ide-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="ide-modal-header">
              <div className="ide-modal-title">Command Palette</div>
              <button
                type="button"
                onClick={() => setShowCommandPalette(false)}
                className="ide-modal-close"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="ide-modal-search">
              <Command className="h-4 w-4 text-text-muted" />
              <input
                ref={commandInputRef}
                value={commandQuery}
                onChange={(event) => setCommandQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && filteredCommands[0]) {
                    runCommand(filteredCommands[0].id);
                    setShowCommandPalette(false);
                  }
                }}
                placeholder="Type a command..."
                className="ide-modal-search-input"
              />
            </div>
            <div className="ide-modal-list">
              {filteredCommands.length === 0 ? (
                <div className="ide-modal-empty">No matching commands.</div>
              ) : (
                filteredCommands.map((command) => (
                  <button
                    key={command.id}
                    type="button"
                    onClick={() => {
                      runCommand(command.id);
                      setShowCommandPalette(false);
                    }}
                    className="ide-modal-item"
                  >
                    <span className="ide-modal-item-name">{command.label}</span>
                    <span className="ide-modal-item-meta">{command.shortcut}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
