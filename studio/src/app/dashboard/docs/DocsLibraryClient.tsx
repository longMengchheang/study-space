"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  usePathname,
  useRouter,
  useSearchParams,
  type ReadonlyURLSearchParams,
} from "next/navigation";
import {
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  FileText,
  FileUp,
  Loader2,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import {
  STUDY_DOCS,
  stripHtml,
  studyDocToHtml,
  type StudyDoc,
} from "@/lib/study-docs";
import {
  getStorageSnapshot,
  setStorageValueAndNotify,
  subscribeStorageKey,
} from "@/lib/browser-storage";
import {
  deleteDocsPdfFile,
  loadDocsPdfFile,
  saveDocsPdfFile,
} from "@/lib/docs-file-store";
import StudyDocEditor from "./StudyDocEditor";

const DOCS_DRAFTS_STORAGE_KEY = "studyspace:docs-drafts";
const DOCS_SIDEBAR_STORAGE_KEY = "studyspace:docs-sidebar-collapsed";
const DOCS_MODE_STORAGE_KEY = "studyspace:docs-mode";
const DOCS_CUSTOM_STORAGE_KEY = "studyspace:docs-custom";
const DOCS_DELETED_STORAGE_KEY = "studyspace:docs-deleted";
const DOCS_PDF_HIGHLIGHTS_STORAGE_KEY = "studyspace:docs-pdf-highlights";
const DOC_LIBRARY_OPTIONS = [
  { value: "study", label: "Study" },
  { value: "explore", label: "Explore" },
  { value: "review", label: "Daily" },
] as const;

type DocCategory = StudyDoc["category"];
type DocSurfaceMode = "read" | "edit" | "pdf";
type CustomDocKind = "text" | "pdf" | "hybrid";
const ACCEPTED_EXTENSIONS = ".pdf,.txt,.md,.html,.htm";

type StoredDocDraft = {
  title: string;
  contentHtml: string;
  updatedAt: string;
};

export type StoredPdfHighlight = {
  id: string;
  pageNumber: number;
  quote: string;
  startOffset: number;
  endOffset: number;
  createdAt: string;
};

type StoredCustomDoc = {
  slug: string;
  title: string;
  createdAt: string;
  category: DocCategory;
  kind: CustomDocKind;
  pdfAssetId?: string;
  sourceFileName?: string;
};

type DocRecord = {
  slug: string;
  base: StudyDoc | null;
  isCustom: boolean;
  category: DocCategory;
  kind: CustomDocKind;
  pdfAssetId?: string;
  sourceFileName?: string;
  hasText: boolean;
  hasPdf: boolean;
  baseTitle: string;
  baseContent: string;
  title: string;
  searchContent: string;
  updatedAt?: string;
  createdAt?: string;
};

function setQueryValue(
  pathname: string,
  router: ReturnType<typeof useRouter>,
  searchParams: ReadonlyURLSearchParams,
  key: string,
  value: string | null,
) {
  const params = new URLSearchParams(searchParams.toString());

  if (value) {
    params.set(key, value);
  } else {
    params.delete(key);
  }

  const nextQuery = params.toString();
  router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
    scroll: false,
  });
}

function parseStoredDrafts(raw: string | null): Record<string, StoredDocDraft> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, StoredDocDraft>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function parseStoredCustomDocs(raw: string | null): StoredCustomDoc[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as StoredCustomDoc[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(
        (doc) =>
          doc &&
          typeof doc === "object" &&
          typeof doc.slug === "string" &&
          typeof doc.title === "string" &&
          typeof doc.createdAt === "string",
      )
      .map((doc) => ({
        slug: doc.slug,
        title: doc.title,
        createdAt: doc.createdAt,
        category: isDocCategory(doc.category) ? doc.category : "study",
        kind:
          doc.kind === "pdf" || doc.kind === "hybrid" || doc.kind === "text"
            ? doc.kind
            : "text",
        pdfAssetId: typeof doc.pdfAssetId === "string" ? doc.pdfAssetId : undefined,
        sourceFileName: typeof doc.sourceFileName === "string" ? doc.sourceFileName : undefined,
      }));
  } catch {
    return [];
  }
}

function parseStoredDeletedDocs(raw: string | null): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function parseStoredPdfHighlights(raw: string | null): Record<string, StoredPdfHighlight[]> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, StoredPdfHighlight[]>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).map(([slug, highlights]) => [
        slug,
        Array.isArray(highlights)
          ? highlights.filter(
              (highlight) =>
                highlight &&
                typeof highlight === "object" &&
                typeof highlight.id === "string" &&
                typeof highlight.pageNumber === "number" &&
                typeof highlight.quote === "string" &&
                typeof highlight.startOffset === "number" &&
                typeof highlight.endOffset === "number" &&
                typeof highlight.createdAt === "string",
            )
          : [],
      ]),
    );
  } catch {
    return {};
  }
}

function formatSavedAt(value?: string): string {
  if (!value) {
    return "Template";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Local draft";
  }

  return date.toLocaleDateString();
}

function isDocCategory(value: string | null | undefined): value is DocCategory {
  return value === "study" || value === "explore" || value === "review";
}

function getCategoryHeading(value: DocCategory): string {
  return DOC_LIBRARY_OPTIONS.find((option) => option.value === value)?.label ?? "Study";
}

// Stable server-snapshot defaults for useSyncExternalStore (must be referentially stable)
const SERVER_DRAFTS: Record<string, StoredDocDraft> = {};
const SERVER_SIDEBAR = false;
const SERVER_MODE: "read" | "edit" = "read";
const SERVER_CUSTOM_DOCS: StoredCustomDoc[] = [];
const SERVER_DELETED_DOCS: string[] = [];
const SERVER_PDF_HIGHLIGHTS: Record<string, StoredPdfHighlight[]> = {};

export default function DocsLibraryClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedSlug = searchParams.get("doc") ?? "";
  const searchQuery = searchParams.get("search") ?? "";
  const rawLibrary = searchParams.get("library");
  const activeCategory: DocCategory = isDocCategory(rawLibrary) ? rawLibrary : "study";
  const drafts = useSyncExternalStore<Record<string, StoredDocDraft>>(
    (callback) => subscribeStorageKey(DOCS_DRAFTS_STORAGE_KEY, callback),
    () =>
      getStorageSnapshot<Record<string, StoredDocDraft>>(
        DOCS_DRAFTS_STORAGE_KEY,
        parseStoredDrafts,
        {},
      ),
    () => SERVER_DRAFTS,
  );
  const storedSidebarCollapsed = useSyncExternalStore(
    (callback) => subscribeStorageKey(DOCS_SIDEBAR_STORAGE_KEY, callback),
    () => getStorageSnapshot(DOCS_SIDEBAR_STORAGE_KEY, (raw) => raw === "1", false),
    () => SERVER_SIDEBAR,
  );
  const docsMode = useSyncExternalStore<DocSurfaceMode>(
    (callback) => subscribeStorageKey(DOCS_MODE_STORAGE_KEY, callback),
    () =>
      getStorageSnapshot<DocSurfaceMode>(
        DOCS_MODE_STORAGE_KEY,
        (raw) => (raw === "edit" || raw === "pdf" ? raw : "read"),
        "read",
      ),
    () => SERVER_MODE,
  );
  const customDocs = useSyncExternalStore<StoredCustomDoc[]>(
    (callback) => subscribeStorageKey(DOCS_CUSTOM_STORAGE_KEY, callback),
    () =>
      getStorageSnapshot<StoredCustomDoc[]>(
        DOCS_CUSTOM_STORAGE_KEY,
        parseStoredCustomDocs,
        [],
      ),
    () => SERVER_CUSTOM_DOCS,
  );
  const deletedDocs = useSyncExternalStore<string[]>(
    (callback) => subscribeStorageKey(DOCS_DELETED_STORAGE_KEY, callback),
    () =>
      getStorageSnapshot<string[]>(
        DOCS_DELETED_STORAGE_KEY,
        parseStoredDeletedDocs,
        [],
      ),
    () => SERVER_DELETED_DOCS,
  );
  const pdfHighlights = useSyncExternalStore<Record<string, StoredPdfHighlight[]>>(
    (callback) => subscribeStorageKey(DOCS_PDF_HIGHLIGHTS_STORAGE_KEY, callback),
    () =>
      getStorageSnapshot<Record<string, StoredPdfHighlight[]>>(
        DOCS_PDF_HIGHLIGHTS_STORAGE_KEY,
        parseStoredPdfHighlights,
        {},
      ),
    () => SERVER_PDF_HIGHLIGHTS,
  );
  const [sidebarCompact, setSidebarCompact] = useState(false);
  const [pendingDeleteSlug, setPendingDeleteSlug] = useState<string | null>(null);
  const [importPending, setImportPending] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const dragCounter = useRef(0);
  const sidebarCollapsed = sidebarCompact || storedSidebarCollapsed;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1180px)");

    const syncViewport = () => {
      setSidebarCompact(mediaQuery.matches);
    };

    syncViewport();
    mediaQuery.addEventListener("change", syncViewport);

    return () => {
      mediaQuery.removeEventListener("change", syncViewport);
    };
  }, []);

  function updateSidebarCollapsed(nextValue: boolean) {
    if (sidebarCompact) {
      return;
    }

    setStorageValueAndNotify(DOCS_SIDEBAR_STORAGE_KEY, nextValue ? "1" : "0");
  }

  function updateDocsMode(nextMode: DocSurfaceMode) {
    setStorageValueAndNotify(DOCS_MODE_STORAGE_KEY, nextMode);
  }

  function persistDrafts(nextDrafts: Record<string, StoredDocDraft>) {
    setStorageValueAndNotify(DOCS_DRAFTS_STORAGE_KEY, JSON.stringify(nextDrafts));
  }

  function persistCustomDocs(nextCustomDocs: StoredCustomDoc[]) {
    setStorageValueAndNotify(DOCS_CUSTOM_STORAGE_KEY, JSON.stringify(nextCustomDocs));
  }

  function persistDeletedDocs(nextDeletedDocs: string[]) {
    setStorageValueAndNotify(DOCS_DELETED_STORAGE_KEY, JSON.stringify(nextDeletedDocs));
  }

  function persistPdfHighlights(nextPdfHighlights: Record<string, StoredPdfHighlight[]>) {
    setStorageValueAndNotify(
      DOCS_PDF_HIGHLIGHTS_STORAGE_KEY,
      JSON.stringify(nextPdfHighlights),
    );
  }

  function createCustomDoc(options?: {
    slug?: string;
    title?: string;
    contentHtml?: string;
    mode?: DocSurfaceMode;
    kind?: CustomDocKind;
    pdfAssetId?: string;
    sourceFileName?: string;
  }) {
    const createdAt = new Date().toISOString();
    const slug = options?.slug || `note-${createdAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
    const title = options?.title?.trim() || "Untitled document";
    const contentHtml = options?.contentHtml || "<p></p>";
    const kind = options?.kind || "text";

    persistCustomDocs([
      {
        slug,
        title,
        createdAt,
        category: activeCategory,
        kind,
        pdfAssetId: options?.pdfAssetId,
        sourceFileName: options?.sourceFileName,
      },
      ...customDocs,
    ]);

    persistDrafts({
      ...drafts,
      [slug]: {
        title,
        contentHtml,
        updatedAt: createdAt,
      },
    });

    updateDocsMode(options?.mode ?? "edit");
    setQueryValue(pathname, router, searchParams, "doc", slug);
  }

  async function importFile(file: File) {
    const formData = new FormData();
    const isPdf = /\.pdf$/i.test(file.name);

    setImportPending(true);
    setImportError(null);

    try {
      let title = file.name.replace(/\.[^.]+$/, "");
      let contentHtml = "<p></p>";
      let kind: CustomDocKind = isPdf ? "hybrid" : "text";
      let pdfAssetId: string | undefined;

      // Always extract text
      formData.set("file", file);
      const response = await fetch("/api/docs/import", {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          typeof data.detail === "string" ? data.detail : "Unable to import this file.",
        );
      }

      title = typeof data.title === "string" ? data.title : title;
      contentHtml =
        typeof data.contentHtml === "string" && data.contentHtml.trim().length > 0
          ? data.contentHtml
          : "<p></p>";

      // For PDFs, also store the original binary so the user can view it
      if (isPdf) {
        pdfAssetId = `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await saveDocsPdfFile(pdfAssetId, file, file.name, file.type || "application/pdf");
      }

      createCustomDoc({
        title,
        contentHtml,
        mode: "read",
        kind,
        pdfAssetId,
        sourceFileName: file.name,
      });
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : "Unable to import this file.",
      );
    } finally {
      setImportPending(false);
      if (importInputRef.current) {
        importInputRef.current.value = "";
      }
    }
  }

  async function deleteDoc(slug: string, isCustom: boolean) {
    const customDocToDelete = isCustom ? customDocs.find((doc) => doc.slug === slug) : null;
    const nextCustomDocs = isCustom ? customDocs.filter((doc) => doc.slug !== slug) : customDocs;
    const nextDrafts = { ...drafts };
    const nextPdfHighlights = { ...pdfHighlights };
    delete nextDrafts[slug];
    delete nextPdfHighlights[slug];

    if (customDocToDelete?.pdfAssetId) {
      await deleteDocsPdfFile(customDocToDelete.pdfAssetId).catch(() => undefined);
    }

    if (isCustom) {
      persistCustomDocs(nextCustomDocs);
    } else {
      persistDeletedDocs(Array.from(new Set([...deletedDocs, slug])));
    }
    persistDrafts(nextDrafts);
    persistPdfHighlights(nextPdfHighlights);
    setPendingDeleteSlug(null);
    setQueryValue(pathname, router, searchParams, "doc", null);
    updateDocsMode("read");
  }

  const seededDocs: DocRecord[] = STUDY_DOCS.map((doc) => {
    const draft = drafts[doc.slug];
    const title = draft?.title.trim() || doc.title;
    const contentHtml = draft?.contentHtml || studyDocToHtml(doc);
    const textContent = stripHtml(contentHtml);

    return {
      slug: doc.slug,
      base: doc,
      isCustom: false,
      category: doc.category,
      kind: "text",
      hasText: true,
      hasPdf: false,
      baseTitle: doc.title,
      baseContent: studyDocToHtml(doc),
      title,
      searchContent: `${title} ${doc.summary} ${doc.purpose} ${doc.tags.join(" ")} ${textContent}`.toLowerCase(),
      updatedAt: draft?.updatedAt,
    };
  });

  const localDocs: DocRecord[] = customDocs.map((doc) => {
    const draft = drafts[doc.slug];
    const title = draft?.title.trim() || doc.title || "Untitled document";
    const contentHtml = draft?.contentHtml || "<p></p>";
    const textContent = stripHtml(contentHtml);

    return {
      slug: doc.slug,
      base: null,
      isCustom: true,
      category: doc.category,
      kind: doc.kind,
      pdfAssetId: doc.pdfAssetId,
      sourceFileName: doc.sourceFileName,
      hasText: doc.kind !== "pdf",
      hasPdf: doc.kind !== "text" && Boolean(doc.pdfAssetId),
      baseTitle: doc.title || "Untitled document",
      baseContent: doc.kind === "pdf" ? "<p></p>" : "<p></p>",
      title,
      searchContent: `${title} ${textContent}`.toLowerCase(),
      updatedAt: draft?.updatedAt,
      createdAt: doc.createdAt,
    };
  });

  const docs: DocRecord[] = [...localDocs, ...seededDocs].filter((doc) => !deletedDocs.includes(doc.slug));
  const categoryDocs = docs.filter((doc) => doc.category === activeCategory);
  const query = searchQuery.trim().toLowerCase();
  const filteredDocs = categoryDocs.filter((doc) => {
    if (!query) {
      return true;
    }

    return doc.searchContent.includes(query);
  });

  const selectedDoc =
    filteredDocs.find((doc) => doc.slug === selectedSlug) ??
    categoryDocs.find((doc) => doc.slug === selectedSlug) ??
    filteredDocs[0] ??
    categoryDocs[0] ??
    null;

  const effectiveDocsMode: DocSurfaceMode = !selectedDoc
    ? "read"
    : docsMode === "pdf"
      ? selectedDoc.hasPdf
        ? "pdf"
        : selectedDoc.hasText
          ? "read"
          : "pdf"
      : selectedDoc.hasText
        ? docsMode
        : selectedDoc.hasPdf
          ? "pdf"
          : "read";

  useEffect(() => {
    const nextSlug = selectedDoc?.slug ?? null;

    if ((selectedSlug || "") !== (nextSlug ?? "")) {
      setQueryValue(pathname, router, searchParams, "doc", nextSlug);
    }
  }, [pathname, router, searchParams, selectedDoc?.slug, selectedSlug]);

  useEffect(() => {
    if (docsMode !== effectiveDocsMode) {
      updateDocsMode(effectiveDocsMode);
    }
  }, [docsMode, effectiveDocsMode]);

  useEffect(() => {
    let nextUrl: string | null = null;
    let cancelled = false;

    if (!selectedDoc?.pdfAssetId) {
      setPdfUrl(null);
      setPdfLoading(false);
      return;
    }

    setPdfLoading(true);
    loadDocsPdfFile(selectedDoc.pdfAssetId)
      .then((storedFile) => {
        if (cancelled) {
          return;
        }

        if (!storedFile) {
          setPdfUrl(null);
          setImportError("This PDF source is no longer available in local Docs storage.");
          return;
        }

        nextUrl = URL.createObjectURL(storedFile.blob);
        setPdfUrl(nextUrl);
      })
      .catch(() => {
        if (!cancelled) {
          setPdfUrl(null);
          setImportError("Unable to load the PDF source from local Docs storage.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPdfLoading(false);
        }
      });

    return () => {
      cancelled = true;
      if (nextUrl) {
        URL.revokeObjectURL(nextUrl);
      }
    };
  }, [selectedDoc?.pdfAssetId]);

  return (
    <div className="flex h-screen min-h-0 w-full overflow-hidden bg-bg-base">
      <aside
        className={[
          "flex h-full shrink-0 flex-col overflow-hidden border-r border-border bg-bg-sidebar transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          sidebarCollapsed ? "w-[4.75rem]" : "w-[18.75rem]",
        ].join(" ")}
      >
        <div
          className={[
            "group relative min-h-[5.25rem] overflow-hidden border-b border-border",
            sidebarCollapsed ? "px-2" : "px-4",
          ].join(" ")}
        >
          <div
            className={[
              "absolute inset-0 flex items-center justify-center transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              sidebarCollapsed
                ? "translate-x-0 opacity-100"
                : "pointer-events-none translate-x-2 opacity-0",
            ].join(" ")}
          >
            <button
              type="button"
              onClick={() => updateSidebarCollapsed(false)}
              className="docs-collapse-control group/logo relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border border-border bg-bg-elevated text-text-primary shadow-sm transition-all duration-200 hover:border-text-muted hover:bg-border"
              title="Expand docs sidebar"
              disabled={sidebarCompact}
            >
              <span className="transition-[opacity,transform] duration-200 group-hover/logo:-translate-x-1 group-hover/logo:opacity-0">
                <BookOpenText className="h-4 w-4" />
              </span>
              <span className="absolute inset-0 flex translate-x-1 items-center justify-center opacity-0 transition-[opacity,transform] duration-200 group-hover/logo:translate-x-0 group-hover/logo:opacity-100">
                <ChevronRight className="h-4 w-4" />
              </span>
            </button>
          </div>

          <div
            className={[
              "absolute inset-0 flex items-center transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              sidebarCollapsed
                ? "pointer-events-none -translate-x-3 opacity-0"
                : "translate-x-0 opacity-100",
            ].join(" ")}
          >
            <div className="flex w-full items-center justify-between gap-3 px-4">
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-elevated text-text-primary shadow-sm">
                  <BookOpenText className="h-4 w-4" />
                </div>
                <div className="min-w-0 overflow-hidden">
                  <div className="text-sm font-semibold text-text-primary">Study Docs</div>
                  <div className="text-xs text-text-muted">Editable reading library</div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => updateSidebarCollapsed(true)}
                  className="docs-collapse-control flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted transition-all duration-200 hover:bg-bg-elevated hover:text-text-primary"
                  title="Collapse docs sidebar"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div
          className={[
            "overflow-hidden border-b border-border transition-[max-height,opacity,padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] flex flex-col gap-3",
            sidebarCollapsed ? "max-h-0 px-0 py-0 opacity-0" : "max-h-40 px-4 py-4 opacity-100",
          ].join(" ")}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              value={searchQuery}
              onChange={(event) => {
                const value = event.target.value;
                setQueryValue(pathname, router, searchParams, "search", value === "" ? null : value);
              }}
              placeholder="Search documents..."
              className="study-field study-search-field min-h-0 rounded-lg py-2.5 text-sm"
            />
          </div>
          <div className="docs-library-switch">
            {DOC_LIBRARY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setQueryValue(pathname, router, searchParams, "library", option.value);
                }}
                className={[
                  "docs-library-switch-button",
                  activeCategory === option.value ? "docs-library-switch-button-active" : "",
                ].join(" ")}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-2">
          {filteredDocs.length === 0 ? (
            sidebarCollapsed ? null : (
              <div className="px-4 py-10 text-center text-sm text-text-muted">
                {query
                  ? "No documents match this search."
                  : `No ${getCategoryHeading(activeCategory).toLowerCase()} documents yet.`}
              </div>
            )
          ) : (
            filteredDocs.map((doc) => {
              const active = selectedDoc?.slug === doc.slug;

              return (
                <button
                  key={doc.slug}
                  type="button"
                  onClick={() => {
                    setQueryValue(pathname, router, searchParams, "doc", doc.slug);
                  }}
                  title={sidebarCollapsed ? doc.title : undefined}
                  className={[
                    "group flex w-full border-l-2 text-left transition",
                    sidebarCollapsed
                      ? "items-center justify-center px-3 py-3"
                      : "flex-col gap-2 px-4 py-3",
                    active
                      ? "border-accent bg-bg-elevated"
                      : "border-transparent hover:bg-bg-elevated",
                  ].join(" ")}
                >
                  <div
                    className={[
                      "flex w-full items-start",
                      sidebarCollapsed ? "justify-center" : "gap-2",
                    ].join(" ")}
                  >
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                    <div
                      className={[
                        "origin-left overflow-hidden transition-[max-width,opacity,transform] duration-200 ease-out",
                        sidebarCollapsed
                          ? "max-w-0 -translate-x-2 opacity-0"
                          : "max-w-[13rem] translate-x-0 opacity-100",
                      ].join(" ")}
                    >
                      <div className="truncate text-sm font-semibold text-text-primary">
                        {doc.title}
                      </div>
                    </div>
                  </div>
                  <div
                    className={[
                      "overflow-hidden pl-6 text-[11px] uppercase tracking-[0.12em] text-text-muted transition-[max-height,opacity,transform] duration-200 ease-out",
                      sidebarCollapsed
                        ? "max-h-0 -translate-y-1 opacity-0"
                        : "max-h-6 translate-y-0 opacity-100",
                    ].join(" ")}
                  >
                    {doc.isCustom
                      ? formatSavedAt(doc.updatedAt || doc.createdAt)
                      : formatSavedAt(doc.updatedAt)}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      <section
        className={[
          "min-h-0 flex-1 overflow-y-auto bg-bg-base relative",
          dragOver ? "study-doc-drag-active" : "",
        ].join(" ")}
        onDragEnter={(e) => {
          e.preventDefault();
          dragCounter.current += 1;
          if (dragCounter.current === 1) setDragOver(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          e.preventDefault();
          dragCounter.current -= 1;
          if (dragCounter.current <= 0) {
            dragCounter.current = 0;
            setDragOver(false);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragCounter.current = 0;
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void importFile(file);
        }}
      >
        {dragOver ? (
          <div className="study-doc-drop-overlay">
            <div className="study-doc-drop-label">
              <FileUp className="h-6 w-6" />
              <span>Drop file to import</span>
            </div>
          </div>
        ) : null}
        <div className="px-8 py-10">
          <div className="study-doc-modebar">
            {/* Minimal spacing adjustment */}
            <div className="study-doc-modebar-spacer" />
            <div className="study-doc-mode-actions">
              <input
                ref={importInputRef}
                type="file"
                accept={ACCEPTED_EXTENSIONS}
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importFile(file);
                }}
              />
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="study-button-secondary study-doc-action-button"
                disabled={importPending}
              >
                {importPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileUp className="h-4 w-4" />
                )}
                Import file
              </button>
              <button
                type="button"
                onClick={() => createCustomDoc()}
                className="study-button-secondary study-doc-action-button"
              >
                <Plus className="h-4 w-4" />
                New doc
              </button>
              <div className="study-doc-mode-toggle">
                {selectedDoc?.hasText ? (
                  <>
                    <button
                      type="button"
                      onClick={() => updateDocsMode("read")}
                      className={[
                        "study-doc-mode-button",
                        effectiveDocsMode === "read" ? "study-doc-mode-button-active" : "",
                      ].join(" ")}
                    >
                      Read
                    </button>
                    <button
                      type="button"
                      onClick={() => updateDocsMode("edit")}
                      className={[
                        "study-doc-mode-button",
                        effectiveDocsMode === "edit" ? "study-doc-mode-button-active" : "",
                      ].join(" ")}
                    >
                      Edit
                    </button>
                  </>
                ) : null}
                {selectedDoc?.hasPdf ? (
                  <button
                    type="button"
                    onClick={() => updateDocsMode("pdf")}
                    className={[
                      "study-doc-mode-button",
                      effectiveDocsMode === "pdf" ? "study-doc-mode-button-active" : "",
                    ].join(" ")}
                  >
                    PDF
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => selectedDoc && setPendingDeleteSlug(selectedDoc.slug)}
                className="study-doc-delete-icon-button"
                title="Delete document"
                disabled={!selectedDoc}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {importError ? (
            <div className="study-doc-import-banner">{importError}</div>
          ) : null}

          {selectedDoc ? (
            <StudyDocEditor
              key={selectedDoc.slug}
              mode={effectiveDocsMode}
              baseTitle={selectedDoc.baseTitle}
              baseContent={selectedDoc.baseContent}
              hasText={selectedDoc.hasText}
              hasPdf={selectedDoc.hasPdf}
              pdfUrl={pdfUrl}
              pdfLoading={pdfLoading}
              pdfFileName={selectedDoc.sourceFileName}
              pdfHighlights={pdfHighlights[selectedDoc.slug] ?? []}
              savedTitle={drafts[selectedDoc.slug]?.title}
              savedContent={drafts[selectedDoc.slug]?.contentHtml}
              savedUpdatedAt={drafts[selectedDoc.slug]?.updatedAt}
              onPdfHighlightsChange={(nextHighlights) => {
                persistPdfHighlights({
                  ...pdfHighlights,
                  [selectedDoc.slug]: nextHighlights,
                });
              }}
              onDraftChange={(draft) => {
                const nextDrafts = {
                  ...drafts,
                  [selectedDoc.slug]: draft,
                };
                persistDrafts(nextDrafts);

                if (selectedDoc.isCustom) {
                  persistCustomDocs(
                    customDocs.map((doc) =>
                      doc.slug === selectedDoc.slug
                        ? {
                            ...doc,
                            title: draft.title.trim() || doc.title,
                          }
                        : doc,
                    ),
                  );
                }
              }}
              onResetDraft={() => {
                const nextDrafts = { ...drafts };
                delete nextDrafts[selectedDoc.slug];
                persistDrafts(nextDrafts);

                if (selectedDoc.isCustom) {
                  persistCustomDocs(
                    customDocs.map((doc) =>
                      doc.slug === selectedDoc.slug
                        ? {
                            ...doc,
                            title: selectedDoc.baseTitle,
                          }
                        : doc,
                    ),
                  );
                }
              }}
            />
          ) : (
            <div className="study-doc-empty-state">
              <div className="study-doc-empty-kicker">{getCategoryHeading(activeCategory)}</div>
              <h2 className="study-doc-empty-title">No documents yet</h2>
              <p className="study-doc-empty-copy">
                Keep this library focused. Add a document here when you want a dedicated space for{" "}
                {activeCategory === "study"
                  ? "school notes and class revision."
                  : activeCategory === "explore"
                    ? "personal interests and open-ended learning."
                    : "daily review notes and short learning recaps."}
              </p>
            </div>
          )}
        </div>
      </section>

      {selectedDoc && pendingDeleteSlug === selectedDoc.slug ? (
        <div className="rag-confirm-overlay">
          <div className="rag-confirm-dialog">
            <div className="rag-confirm-kicker">Delete doc</div>
            <h2 className="rag-confirm-title">Remove {selectedDoc.title}?</h2>
            <p className="rag-confirm-copy">
              {selectedDoc.isCustom
                ? "This local document and its saved draft content will be removed from Studyspace."
                : "This document will be removed from your Studyspace library on this machine."}
            </p>
            <div className="rag-confirm-actions">
              <button
                type="button"
                onClick={() => setPendingDeleteSlug(null)}
                className="study-button-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void deleteDoc(selectedDoc.slug, selectedDoc.isCustom)}
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
