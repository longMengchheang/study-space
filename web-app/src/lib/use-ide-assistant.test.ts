import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIdeAssistant } from "./use-ide-assistant";
import type { PracticeFile } from "@/lib/ide-workspace";

// ── Helpers ───────────────────────────────────────────────────────────────────

const ACTIVE_FILE: PracticeFile = {
  id: "file-1",
  name: "hello.py",
  language: "python",
  content: 'print("hello")',
};

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

describe("useIdeAssistant", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("initialises with the intro message, empty prompt, and ask mode", () => {
    const { result } = renderHook(() =>
      useIdeAssistant({ activeFile: ACTIVE_FILE, selectionPreview: "", onApplyEdit: vi.fn() }),
    );
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe("assistant");
    expect(result.current.prompt).toBe("");
    expect(result.current.submitting).toBe(false);
    expect(result.current.assistantMode).toBe("ask");
  });

  it("does nothing when activeFile is null", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useIdeAssistant({ activeFile: null, selectionPreview: "", onApplyEdit: vi.fn() }),
    );
    act(() => result.current.setPrompt("hello"));
    await act(() => result.current.submitPrompt());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing when prompt is empty", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useIdeAssistant({ activeFile: ACTIVE_FILE, selectionPreview: "", onApplyEdit: vi.fn() }),
    );
    await act(() => result.current.submitPrompt());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adds a user message and appends the assistant reply on success", async () => {
    vi.stubGlobal("fetch", makeFetchOk({ response: "Use a for loop instead." }));

    const { result } = renderHook(() =>
      useIdeAssistant({ activeFile: ACTIVE_FILE, selectionPreview: "", onApplyEdit: vi.fn() }),
    );

    act(() => result.current.setPrompt("How can I improve this?"));
    await act(() => result.current.submitPrompt());
    await waitFor(() => expect(result.current.submitting).toBe(false));

    const messages = result.current.messages;
    const userMsg = messages.find((m) => m.role === "user");
    expect(userMsg?.content).toContain("How can I improve this?");

    const aiMsg = messages.findLast((m) => m.role === "assistant");
    expect(aiMsg?.content).toBe("Use a for loop instead.");
  });

  it("clears the prompt after submitting", async () => {
    vi.stubGlobal("fetch", makeFetchOk({ response: "done" }));

    const { result } = renderHook(() =>
      useIdeAssistant({ activeFile: ACTIVE_FILE, selectionPreview: "", onApplyEdit: vi.fn() }),
    );
    act(() => result.current.setPrompt("explain this"));
    await act(() => result.current.submitPrompt());

    expect(result.current.prompt).toBe("");
  });

  it("posts an 'Ask: …' label in ask mode", async () => {
    const fetchMock = makeFetchOk({ response: "Sure!" });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useIdeAssistant({ activeFile: ACTIVE_FILE, selectionPreview: "", onApplyEdit: vi.fn() }),
    );
    act(() => result.current.setPrompt("What does this do?"));
    await act(() => result.current.submitPrompt());

    const userMsg = result.current.messages.find((m) => m.role === "user");
    expect(userMsg?.content).toMatch(/^Ask:/);
  });

  it("posts an 'Edit file: …' label in edit mode", async () => {
    vi.stubGlobal("fetch", makeFetchOk({ response: "```python\nprint('hi')\n```" }));

    const onApplyEdit = vi.fn();
    const { result } = renderHook(() =>
      useIdeAssistant({ activeFile: ACTIVE_FILE, selectionPreview: "", onApplyEdit }),
    );
    act(() => result.current.setAssistantMode("edit"));
    act(() => result.current.setPrompt("Add a comment"));
    await act(() => result.current.submitPrompt());

    const userMsg = result.current.messages.find((m) => m.role === "user");
    expect(userMsg?.content).toMatch(/^Edit file:/);
  });

  it("calls onApplyEdit with extracted code block in edit mode when acceptEdit is called", async () => {
    const codeBlock = "print('hello world')";
    vi.stubGlobal(
      "fetch",
      makeFetchOk({ response: `Here is the result:\n\`\`\`python\n${codeBlock}\n\`\`\`` }),
    );

    const onApplyEdit = vi.fn();
    const { result } = renderHook(() =>
      useIdeAssistant({ activeFile: ACTIVE_FILE, selectionPreview: "", onApplyEdit }),
    );
    act(() => result.current.setAssistantMode("edit"));
    act(() => result.current.setPrompt("Add hello world print"));
    await act(() => result.current.submitPrompt());
    await waitFor(() => expect(result.current.submitting).toBe(false));

    // onApplyEdit is NOT called until the user accepts the diff.
    expect(onApplyEdit).not.toHaveBeenCalled();
    expect(result.current.pendingEdit).not.toBeNull();
    expect(result.current.pendingEdit?.proposedContent).toBe(codeBlock);

    act(() => result.current.acceptEdit());
    expect(onApplyEdit).toHaveBeenCalledWith(codeBlock);
    expect(result.current.pendingEdit).toBeNull();
  });

  it("rejectEdit clears pendingEdit without calling onApplyEdit", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchOk({ response: "```python\nprint('hi')\n```" }),
    );

    const onApplyEdit = vi.fn();
    const { result } = renderHook(() =>
      useIdeAssistant({ activeFile: ACTIVE_FILE, selectionPreview: "", onApplyEdit }),
    );
    act(() => result.current.setAssistantMode("edit"));
    act(() => result.current.setPrompt("refactor"));
    await act(() => result.current.submitPrompt());
    await waitFor(() => expect(result.current.submitting).toBe(false));

    expect(result.current.pendingEdit).not.toBeNull();
    act(() => result.current.rejectEdit());
    expect(onApplyEdit).not.toHaveBeenCalled();
    expect(result.current.pendingEdit).toBeNull();
  });

  it("adds diff-review message after a successful edit", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchOk({ response: "```python\nprint('done')\n```" }),
    );

    const { result } = renderHook(() =>
      useIdeAssistant({ activeFile: ACTIVE_FILE, selectionPreview: "", onApplyEdit: vi.fn() }),
    );
    act(() => result.current.setAssistantMode("edit"));
    act(() => result.current.setPrompt("refactor"));
    await act(() => result.current.submitPrompt());
    await waitFor(() => expect(result.current.submitting).toBe(false));

    const reviewMsg = result.current.messages.findLast((m) => m.role === "assistant");
    expect(reviewMsg?.content).toContain(ACTIVE_FILE.name);
  });

  it("includes selected code in the prompt body when selectionPreview is set", async () => {
    const fetchMock = makeFetchOk({ response: "ok" });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useIdeAssistant({
        activeFile: ACTIVE_FILE,
        selectionPreview: "selected code here",
        onApplyEdit: vi.fn(),
      }),
    );
    act(() => result.current.setPrompt("explain"));
    await act(() => result.current.submitPrompt());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.prompt).toContain("Selected code:");
    expect(body.prompt).toContain("selected code here");
  });

  it("includes full file content when selectionPreview is empty", async () => {
    const fetchMock = makeFetchOk({ response: "ok" });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useIdeAssistant({ activeFile: ACTIVE_FILE, selectionPreview: "", onApplyEdit: vi.fn() }),
    );
    act(() => result.current.setPrompt("explain"));
    await act(() => result.current.submitPrompt());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.prompt).toContain("File content:");
    expect(body.prompt).toContain(ACTIVE_FILE.content);
  });

  it("appends an error message when the API returns non-ok", async () => {
    vi.stubGlobal("fetch", makeFetchError(500, { detail: "Internal error" }));

    const { result } = renderHook(() =>
      useIdeAssistant({ activeFile: ACTIVE_FILE, selectionPreview: "", onApplyEdit: vi.fn() }),
    );
    act(() => result.current.setPrompt("test"));
    await act(() => result.current.submitPrompt());
    await waitFor(() => expect(result.current.submitting).toBe(false));

    const errMsg = result.current.messages.findLast((m) => m.role === "assistant");
    expect(errMsg?.content).toBe("Internal error");
  });

  it("appends a fallback error message on network failure", async () => {
    vi.stubGlobal("fetch", makeFetchReject("fetch failed"));

    const { result } = renderHook(() =>
      useIdeAssistant({ activeFile: ACTIVE_FILE, selectionPreview: "", onApplyEdit: vi.fn() }),
    );
    act(() => result.current.setPrompt("test"));
    await act(() => result.current.submitPrompt());
    await waitFor(() => expect(result.current.submitting).toBe(false));

    const errMsg = result.current.messages.findLast((m) => m.role === "assistant");
    expect(errMsg?.content).toBe("fetch failed");
  });

  it("resets messages and prompt when clearMessages is called", async () => {
    vi.stubGlobal("fetch", makeFetchOk({ response: "some answer" }));

    const { result } = renderHook(() =>
      useIdeAssistant({ activeFile: ACTIVE_FILE, selectionPreview: "", onApplyEdit: vi.fn() }),
    );
    act(() => result.current.setPrompt("hello"));
    await act(() => result.current.submitPrompt());
    await waitFor(() => expect(result.current.submitting).toBe(false));

    // Multiple messages exist now
    expect(result.current.messages.length).toBeGreaterThan(1);

    act(() => result.current.clearMessages());
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe("assistant");
    expect(result.current.prompt).toBe("");
  });
});
