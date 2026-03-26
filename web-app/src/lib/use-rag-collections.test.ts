import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useRagCollections } from "./use-rag-collections";
import type { CollectionSummary } from "./use-rag-collections";

// ── Helpers ───────────────────────────────────────────────────────────────────

const MOCK_COLLECTIONS: CollectionSummary[] = [
  { id: "general", name: "General", is_default: true, document_count: 2, artifact_count: 0 },
  { id: "col-2", name: "Second", is_default: false, document_count: 1, artifact_count: 1 },
];

function makeFetchOk(body: object) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  });
}

function makeFetchError(status: number, body: object) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(body),
  });
}

function makeFetchReject(message: string) {
  return vi.fn().mockRejectedValue(new Error(message));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useRagCollections", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("starts with connected:false and status 'checking'", () => {
    vi.stubGlobal("fetch", makeFetchOk({}));
    const { result } = renderHook(() => useRagCollections());
    expect(result.current.health.connected).toBe(false);
    expect(result.current.health.status).toBe("checking");
  });

  it("uses the provided initial collection id", () => {
    vi.stubGlobal("fetch", makeFetchOk({}));
    const { result } = renderHook(() => useRagCollections("col-2"));
    expect(result.current.activeCollectionId).toBe("col-2");
  });

  describe("refreshHealth", () => {
    it("sets connected:true on a successful health response", async () => {
      vi.stubGlobal(
        "fetch",
        makeFetchOk({ status: "ok", collections: 1, documents: 3, ollama: "llama3" }),
      );

      const { result } = renderHook(() => useRagCollections());
      await act(() => result.current.refreshHealth());

      expect(result.current.health.connected).toBe(true);
      expect(result.current.health.status).toBe("ok");
      expect(result.current.health.ollama).toBe("llama3");
    });

    it("sets connected:false on a non-ok response", async () => {
      vi.stubGlobal("fetch", makeFetchError(503, { status: "offline", detail: "down" }));

      const { result } = renderHook(() => useRagCollections());
      await act(() => result.current.refreshHealth());

      expect(result.current.health.connected).toBe(false);
      expect(result.current.health.status).toBe("offline");
      expect(result.current.health.detail).toBe("down");
    });

    it("sets connected:false when fetch rejects", async () => {
      vi.stubGlobal("fetch", makeFetchReject("Network failure"));

      const { result } = renderHook(() => useRagCollections());
      await act(() => result.current.refreshHealth());

      expect(result.current.health.connected).toBe(false);
      expect(result.current.health.status).toBe("offline");
      expect(result.current.health.detail).toBe("Network failure");
    });
  });

  describe("fetchCollections", () => {
    it("populates collections on success", async () => {
      vi.stubGlobal(
        "fetch",
        makeFetchOk({ collections: MOCK_COLLECTIONS }),
      );

      const { result } = renderHook(() => useRagCollections());
      await act(() => result.current.fetchCollections());

      expect(result.current.collections).toHaveLength(2);
      expect(result.current.collections[0].id).toBe("general");
    });

    it("keeps activeCollectionId when the current id is still present", async () => {
      vi.stubGlobal("fetch", makeFetchOk({ collections: MOCK_COLLECTIONS }));

      const { result } = renderHook(() => useRagCollections("col-2"));
      await act(() => result.current.fetchCollections());

      expect(result.current.activeCollectionId).toBe("col-2");
    });

    it("switches activeCollectionId to the preferred id if provided", async () => {
      vi.stubGlobal("fetch", makeFetchOk({ collections: MOCK_COLLECTIONS }));

      const { result } = renderHook(() => useRagCollections("general"));
      await act(() => result.current.fetchCollections("col-2"));

      expect(result.current.activeCollectionId).toBe("col-2");
    });

    it("falls back to the first collection if the current id is gone", async () => {
      vi.stubGlobal(
        "fetch",
        makeFetchOk({
          collections: [
            { id: "new-col", name: "New", is_default: false, document_count: 0, artifact_count: 0 },
          ],
        }),
      );

      const { result } = renderHook(() => useRagCollections("stale-id"));
      await act(() => result.current.fetchCollections());

      expect(result.current.activeCollectionId).toBe("new-col");
    });

    it("throws when the API returns non-ok", async () => {
      vi.stubGlobal("fetch", makeFetchError(500, { detail: "server error" }));

      const { result } = renderHook(() => useRagCollections());
      await expect(
        act(() => result.current.fetchCollections()),
      ).rejects.toThrow("server error");
    });
  });

  describe("fetchDocuments", () => {
    it("populates the documents list on success", async () => {
      vi.stubGlobal(
        "fetch",
        makeFetchOk({ documents: [{ name: "file.pdf", size: 1024 }] }),
      );

      const { result } = renderHook(() => useRagCollections());
      await act(() => result.current.fetchDocuments("general"));

      expect(result.current.documents).toHaveLength(1);
      expect(result.current.documents[0].name).toBe("file.pdf");
    });

    it("throws when the API returns non-ok", async () => {
      vi.stubGlobal("fetch", makeFetchError(404, { detail: "not found" }));

      const { result } = renderHook(() => useRagCollections());
      await expect(
        act(() => result.current.fetchDocuments("bad-id")),
      ).rejects.toThrow("not found");
    });
  });

  describe("fetchArtifacts", () => {
    it("populates the artifacts list on success", async () => {
      const artifact = {
        filename: "notes.md",
        kind: "notes",
        title: "Notes",
        saved_path: "/path/to/notes.md",
        updated_at: "2024-01-01T00:00:00Z",
        source: "generated",
      };
      vi.stubGlobal("fetch", makeFetchOk({ artifacts: [artifact] }));

      const { result } = renderHook(() => useRagCollections());
      await act(() => result.current.fetchArtifacts("general"));

      expect(result.current.artifacts).toHaveLength(1);
      expect(result.current.artifacts[0].filename).toBe("notes.md");
    });

    it("throws when the API returns non-ok", async () => {
      vi.stubGlobal("fetch", makeFetchError(404, { detail: "not found" }));

      const { result } = renderHook(() => useRagCollections());
      await expect(
        act(() => result.current.fetchArtifacts("bad-id")),
      ).rejects.toThrow("not found");
    });
  });

  describe("refreshCollectionState", () => {
    it("calls all four sub-fetches in parallel", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            // health shape
            status: "ok",
            // collections shape
            collections: MOCK_COLLECTIONS,
            // documents shape
            documents: [],
            // artifacts shape
            artifacts: [],
          }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { result } = renderHook(() => useRagCollections());
      await act(() => result.current.refreshCollectionState("general"));

      // health + collections + documents + artifacts = 4 calls
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
  });

  it("setArtifacts updates the artifacts list directly", async () => {
    vi.stubGlobal("fetch", makeFetchOk({}));
    const { result } = renderHook(() => useRagCollections());

    const newArtifact = {
      filename: "summary.md",
      kind: "summary",
      title: "Summary",
      saved_path: "/summary.md",
      updated_at: "2024-01-01T00:00:00Z",
    };

    act(() => result.current.setArtifacts([newArtifact]));
    await waitFor(() => expect(result.current.artifacts).toHaveLength(1));
    expect(result.current.artifacts[0].filename).toBe("summary.md");
  });
});
