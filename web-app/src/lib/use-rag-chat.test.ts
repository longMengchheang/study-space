import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useRagChat, STARTER_MESSAGE, RAG_HISTORY_WINDOW } from "./use-rag-chat";

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// Default hook options used across tests.
const defaultOptions = {
  activeCollectionId: "general",
  selectedSourceNames: [] as string[],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useRagChat", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("initialises with the starter message", () => {
    const { result } = renderHook(() => useRagChat(defaultOptions));
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toEqual(STARTER_MESSAGE);
    expect(result.current.chatInput).toBe("");
    expect(result.current.chatLoading).toBe(false);
    expect(result.current.errorMessage).toBeNull();
  });

  it("does not send when chatInput is empty", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useRagChat(defaultOptions));
    await act(() => result.current.sendMessage());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adds user message immediately, then ai message on success", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchOk({ reply: "Paris", sources: [{ source: "geo.pdf", snippet: "..." }] }),
    );

    const { result } = renderHook(() => useRagChat(defaultOptions));

    act(() => result.current.setChatInput("What is the capital of France?"));
    await act(() => result.current.sendMessage());

    await waitFor(() => expect(result.current.chatLoading).toBe(false));

    const msgs = result.current.messages;
    expect(msgs.some((m) => m.role === "user")).toBe(true);
    const aiMsg = msgs.find((m) => m.role === "ai" && m.id !== STARTER_MESSAGE.id);
    expect(aiMsg?.content).toBe("Paris");
    expect(aiMsg?.sources).toHaveLength(1);
  });

  it("clears chatInput after sending", async () => {
    vi.stubGlobal("fetch", makeFetchOk({ reply: "ok", sources: [] }));

    const { result } = renderHook(() => useRagChat(defaultOptions));
    act(() => result.current.setChatInput("hello"));
    await act(() => result.current.sendMessage());

    expect(result.current.chatInput).toBe("");
  });

  it("sets errorMessage and adds error reply when the API returns non-ok", async () => {
    vi.stubGlobal("fetch", makeFetchError(400, { detail: "No context found." }));

    const { result } = renderHook(() => useRagChat(defaultOptions));
    act(() => result.current.setChatInput("test"));
    await act(() => result.current.sendMessage());

    await waitFor(() => expect(result.current.chatLoading).toBe(false));

    expect(result.current.errorMessage).toBe("No context found.");
    const errorMsg = result.current.messages.findLast((m) => m.role === "ai");
    expect(errorMsg?.content).toBe("No context found.");
  });

  it("handles a network failure gracefully", async () => {
    vi.stubGlobal("fetch", makeFetchReject("Network error"));

    const { result } = renderHook(() => useRagChat(defaultOptions));
    act(() => result.current.setChatInput("ping"));
    await act(() => result.current.sendMessage());

    await waitFor(() => expect(result.current.chatLoading).toBe(false));

    expect(result.current.errorMessage).toBe("Network error");
  });

  it("clears messages and error when clearMessages is called", async () => {
    vi.stubGlobal("fetch", makeFetchError(400, { detail: "bad" }));

    const { result } = renderHook(() => useRagChat(defaultOptions));
    act(() => result.current.setChatInput("hi"));
    await act(() => result.current.sendMessage());
    await waitFor(() => expect(result.current.chatLoading).toBe(false));

    act(() => result.current.clearMessages());

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toEqual(STARTER_MESSAGE);
    expect(result.current.errorMessage).toBeNull();
  });

  it("calls onSaveSession with the updated message list", async () => {
    vi.stubGlobal("fetch", makeFetchOk({ reply: "hi", sources: [] }));
    const onSaveSession = vi.fn();

    const { result } = renderHook(() =>
      useRagChat({ ...defaultOptions, onSaveSession }),
    );
    act(() => result.current.setChatInput("hello"));
    await act(() => result.current.sendMessage());
    await waitFor(() => expect(result.current.chatLoading).toBe(false));

    // Called at least twice: once after user message, once after ai message.
    expect(onSaveSession).toHaveBeenCalledTimes(2);
  });

  it("sends the correct JSON body including collection_id and source_names", async () => {
    const fetchMock = makeFetchOk({ reply: "pong", sources: [] });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useRagChat({
        activeCollectionId: "my-col",
        selectedSourceNames: ["doc1.pdf"],
      }),
    );
    act(() => result.current.setChatInput("ping"));
    await act(() => result.current.sendMessage());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.collection_id).toBe("my-col");
    expect(body.source_names).toEqual(["doc1.pdf"]);
    expect(body.message).toBe("ping");
  });

  it("includes prior conversation turns in the history payload", async () => {
    const fetchMock = makeFetchOk({ reply: "answer", sources: [] });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useRagChat(defaultOptions));

    // First turn
    act(() => result.current.setChatInput("first question"));
    await act(() => result.current.sendMessage());
    await waitFor(() => expect(result.current.chatLoading).toBe(false));

    // Second turn — the first turn's messages should appear in history
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ reply: "second answer", sources: [] }),
    });
    act(() => result.current.setChatInput("second question"));
    await act(() => result.current.sendMessage());

    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.history.length).toBeGreaterThan(0);
    expect(body.history[0].role).toBe("user");
    expect(body.history[0].content).toBe("first question");
  });

  it("caps history to RAG_HISTORY_WINDOW * 2 entries", async () => {
    const fetchMock = makeFetchOk({ reply: "x", sources: [] });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useRagChat(defaultOptions));

    // Send enough turns to exceed the window
    const turns = RAG_HISTORY_WINDOW + 2;
    for (let i = 0; i < turns; i++) {
      act(() => result.current.setChatInput(`q${i}`));
      await act(() => result.current.sendMessage());
      await waitFor(() => expect(result.current.chatLoading).toBe(false));
    }

    const lastCall = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    const body = JSON.parse(lastCall[1].body as string);
    expect(body.history.length).toBeLessThanOrEqual(RAG_HISTORY_WINDOW * 2);
  });
});
