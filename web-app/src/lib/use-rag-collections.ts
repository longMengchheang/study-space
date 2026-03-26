/**
 * useRagCollections — manages RAG service health, collections list,
 * documents list, and artifacts list.
 *
 * Extracted from StudyRagClient so the data-fetching layer can be
 * unit-tested independently and reused across different UI layouts.
 */
import { useCallback, useState } from "react";

export type HealthState = {
  connected: boolean;
  status: string;
  detail?: string;
  collections?: number;
  documents?: number;
  ollama?: string;
};

export type CollectionSummary = {
  id: string;
  name: string;
  is_default: boolean;
  document_count: number;
  artifact_count: number;
};

export type DocumentRecord = {
  name: string;
  size: number;
};

export type ArtifactRecord = {
  filename: string;
  kind: string;
  title: string;
  saved_path: string;
  updated_at: string;
  content?: string;
  source?: "generated" | "pinned";
};

export interface UseRagCollectionsResult {
  health: HealthState;
  collections: CollectionSummary[];
  activeCollectionId: string;
  setActiveCollectionId: React.Dispatch<React.SetStateAction<string>>;
  documents: DocumentRecord[];
  artifacts: ArtifactRecord[];
  setArtifacts: React.Dispatch<React.SetStateAction<ArtifactRecord[]>>;
  refreshHealth: () => Promise<void>;
  fetchCollections: (preferredCollectionId?: string) => Promise<void>;
  fetchDocuments: (collectionId: string) => Promise<void>;
  fetchArtifacts: (collectionId: string) => Promise<void>;
  refreshCollectionState: (collectionId: string) => Promise<void>;
}

export function useRagCollections(
  initialCollectionId = "general",
): UseRagCollectionsResult {
  const [health, setHealth] = useState<HealthState>({
    connected: false,
    status: "checking",
  });
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState(initialCollectionId);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);

  const refreshHealth = useCallback(async () => {
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
        connected: true,
        status: data.status || "ok",
        detail: data.detail,
        collections: data.collections,
        documents: data.documents,
        ollama: data.ollama,
      });
    } catch (error) {
      setHealth({
        connected: false,
        status: "offline",
        detail: error instanceof Error ? error.message : "Local RAG is unavailable.",
      });
    }
  }, []);

  const fetchCollections = useCallback(async (preferredCollectionId?: string) => {
    const response = await fetch("/api/local-rag/collections", { cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as {
      collections?: CollectionSummary[];
      detail?: string;
    };

    if (!response.ok) throw new Error(data.detail || "Unable to load study collections.");

    const nextCollections = data.collections ?? [];
    setCollections(nextCollections);
    setActiveCollectionId((current) => {
      const preferred = preferredCollectionId ?? current;
      if (nextCollections.some((c) => c.id === preferred)) return preferred;
      return nextCollections[0]?.id ?? "general";
    });
  }, []);

  const fetchDocuments = useCallback(async (collectionId: string) => {
    const response = await fetch(`/api/local-rag/collections/${collectionId}/documents`, {
      cache: "no-store",
    });
    const data = (await response.json().catch(() => ({}))) as {
      documents?: DocumentRecord[];
      detail?: string;
    };
    if (!response.ok) throw new Error(data.detail || "Unable to load documents.");
    setDocuments(data.documents ?? []);
  }, []);

  const fetchArtifacts = useCallback(async (collectionId: string) => {
    const response = await fetch(`/api/local-rag/collections/${collectionId}/artifacts`, {
      cache: "no-store",
    });
    const data = (await response.json().catch(() => ({}))) as {
      artifacts?: ArtifactRecord[];
      detail?: string;
    };
    if (!response.ok) throw new Error(data.detail || "Unable to load artifacts.");
    setArtifacts(data.artifacts ?? []);
  }, []);

  const refreshCollectionState = useCallback(
    async (collectionId: string) => {
      await Promise.all([
        fetchCollections(collectionId),
        fetchDocuments(collectionId),
        fetchArtifacts(collectionId),
        refreshHealth(),
      ]);
    },
    [fetchCollections, fetchDocuments, fetchArtifacts, refreshHealth],
  );

  return {
    health,
    collections,
    activeCollectionId,
    setActiveCollectionId,
    documents,
    artifacts,
    setArtifacts,
    refreshHealth,
    fetchCollections,
    fetchDocuments,
    fetchArtifacts,
    refreshCollectionState,
  };
}
