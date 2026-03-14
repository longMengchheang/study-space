/**
 * api.ts — Centralised API client for the Local RAG backend.
 *
 * Every fetch call lives here so that components stay focused on
 * presentation.  All functions throw on non-OK responses.
 */

const API_URL = 'http://127.0.0.1:9999';

// ── Types ────────────────────────────────────────────────────────

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
};

export type ArtifactKind = 'summary' | 'flashcards' | 'quiz' | 'study_guide';

export type SourceReference = {
  source: string;
  page: number | null;
  snippet: string;
};

export type ChatResult = {
  reply: string;
  sources: SourceReference[];
};

export type ArtifactResult = {
  kind: string;
  title: string;
  content: string;
  filename: string;
  saved_path: string;
};

// ── Helpers ──────────────────────────────────────────────────────

async function json<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error((data as Record<string, string>)?.detail || `Request failed (${response.status})`);
  }
  return data as T;
}

// ── API calls ───────────────────────────────────────────────────

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchCollections(): Promise<CollectionSummary[]> {
  const res = await fetch(`${API_URL}/collections`);
  const data = await json<{ collections: CollectionSummary[] }>(res);
  return data.collections ?? [];
}

export async function createCollection(name: string): Promise<CollectionSummary> {
  const res = await fetch(`${API_URL}/collections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return json<CollectionSummary>(res);
}

export async function fetchDocuments(collectionId: string): Promise<DocumentRecord[]> {
  const res = await fetch(`${API_URL}/collections/${collectionId}/documents`);
  const data = await json<{ documents: DocumentRecord[] }>(res);
  return data.documents ?? [];
}

export async function deleteDocument(collectionId: string, documentName: string): Promise<DocumentRecord[]> {
  const res = await fetch(
    `${API_URL}/collections/${collectionId}/documents/${encodeURIComponent(documentName)}`,
    { method: 'DELETE' },
  );
  const data = await json<{ documents: DocumentRecord[] }>(res);
  return data.documents ?? [];
}

export async function fetchArtifacts(collectionId: string): Promise<ArtifactRecord[]> {
  const res = await fetch(`${API_URL}/collections/${collectionId}/artifacts`);
  const data = await json<{ artifacts: ArtifactRecord[] }>(res);
  return data.artifacts ?? [];
}

export async function uploadFile(collectionId: string, file: File): Promise<{ filename: string; chunks_added: number }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_URL}/collections/${collectionId}/upload`, {
    method: 'POST',
    body: formData,
  });
  return json(res);
}

export async function sendChat(message: string, collectionId: string): Promise<ChatResult> {
  const res = await fetch(`${API_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, collection_id: collectionId }),
  });
  return json<ChatResult>(res);
}

export async function generateArtifact(
  collectionId: string,
  kind: ArtifactKind,
  prompt?: string,
): Promise<ArtifactResult> {
  const res = await fetch(`${API_URL}/artifacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collection_id: collectionId,
      kind,
      prompt: prompt || undefined,
    }),
  });
  return json<ArtifactResult>(res);
}
