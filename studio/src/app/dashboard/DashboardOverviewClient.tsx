"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  AudioLines,
  Brain,
  Check,
  Clock3,
  FileText,
  ListTodo,
  MessagesSquare,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";

type HealthState = {
  connected: boolean;
  status: string;
  detail?: string;
};

type RagHealthState = HealthState & {
  collections?: number;
  documents?: number;
};

type IdeHealthState = HealthState & {
  url?: string;
};

type DashboardDoc = {
  slug: string;
  title: string;
  summary: string;
  tags: string[];
};

type DashboardOverviewClientProps = {
  docs: DashboardDoc[];
};

type DashboardTask = {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
};

type WorkflowKey = "transcript" | "rag" | "docs" | "forum" | "ide";

const INITIAL_HEALTH: HealthState = {
  connected: false,
  status: "checking",
};

const INITIAL_RAG_HEALTH: RagHealthState = {
  connected: false,
  status: "checking",
  collections: 0,
  documents: 0,
};

const INITIAL_IDE_HEALTH: IdeHealthState = {
  connected: false,
  status: "checking",
};

const DASHBOARD_TASKS_STORAGE_KEY = "studyspace:dashboard:tasks.v1";
const DASHBOARD_NOTE_STORAGE_KEY = "studyspace:dashboard:note.v1";
const DASHBOARD_TIMER_STORAGE_KEY = "studyspace:dashboard:timer.v1";
const TIMER_PRESETS = [25, 45, 60];
const WORKFLOW_CONFIG: Record<
  WorkflowKey,
  {
    label: string;
    href: string;
    hint: string;
  }
> = {
  transcript: {
    label: "Transcript",
    href: "/dashboard/transcript-whisper",
    hint: "Capture lectures and recordings",
  },
  rag: {
    label: "RAG",
    href: "/dashboard/study-rag",
    hint: "Ask grounded questions from sources",
  },
  docs: {
    label: "Docs",
    href: "/dashboard/docs",
    hint: "Read or edit study materials",
  },
  forum: {
    label: "Forum",
    href: "/dashboard/forum",
    hint: "Experimental Discord-style study channels + AI",
  },
  ide: {
    label: "IDE",
    href: "/dashboard/ide",
    hint: "Practice implementation in code",
  },
};

function healthLabel(state: HealthState): string {
  if (state.status === "checking") {
    return "Checking";
  }

  return state.connected ? "Connected" : "Offline";
}

function getAcademicGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) {
    return {
      title: "Good morning.",
      copy: "Set up a clear study block and begin.",
    };
  }

  if (hour < 18) {
    return {
      title: "Good afternoon.",
      copy: "Keep the session moving with focus.",
    };
  }

  return {
    title: "Good evening.",
    copy: "Review what matters before you stop.",
  };
}

function formatTimer(totalSeconds: number) {
  const safeValue = Math.max(totalSeconds, 0);
  const minutes = Math.floor(safeValue / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(safeValue % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function loadStoredTasks(): DashboardTask[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(DASHBOARD_TASKS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as DashboardTask[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((task) => Boolean(task?.id && task?.text));
  } catch {
    return [];
  }
}

export default function DashboardOverviewClient({
  docs,
}: DashboardOverviewClientProps) {
  const [transcriptHealth, setTranscriptHealth] = useState<HealthState>(INITIAL_HEALTH);
  const [ragHealth, setRagHealth] = useState<RagHealthState>(INITIAL_RAG_HEALTH);
  const [ideHealth, setIdeHealth] = useState<IdeHealthState>(INITIAL_IDE_HEALTH);
  const [refreshing, setRefreshing] = useState(false);
  const [greeting, setGreeting] = useState(() => ({
    title: "Welcome back.",
    copy: "Pick one meaningful task and finish it fully.",
  }));
  const [todayLabel, setTodayLabel] = useState("");
  const [tasks, setTasks] = useState<DashboardTask[]>([]);
  const [taskDraft, setTaskDraft] = useState("");
  const [quickNote, setQuickNote] = useState("");
  const [timerMinutes, setTimerMinutes] = useState(25);
  const [timerSeconds, setTimerSeconds] = useState(25 * 60);
  const [timerRunning, setTimerRunning] = useState(false);
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowKey>("transcript");

  useEffect(() => {
    setGreeting(getAcademicGreeting());
    setTodayLabel(
      new Date().toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
      }),
    );
  }, []);

  useEffect(() => {
    setTasks(loadStoredTasks());

    try {
      const storedNote = window.localStorage.getItem(DASHBOARD_NOTE_STORAGE_KEY);
      if (storedNote) {
        setQuickNote(storedNote);
      }

      const storedTimer = window.localStorage.getItem(DASHBOARD_TIMER_STORAGE_KEY);
      if (storedTimer) {
        const parsed = JSON.parse(storedTimer) as { minutes?: number; seconds?: number };
        const minutes = typeof parsed.minutes === "number" ? parsed.minutes : 25;
        const seconds = typeof parsed.seconds === "number" ? parsed.seconds : minutes * 60;
        setTimerMinutes(minutes);
        setTimerSeconds(seconds);
      }
    } catch {
      // Ignore malformed local storage data.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(DASHBOARD_TASKS_STORAGE_KEY, JSON.stringify(tasks));
    } catch {
      // Ignore storage failures.
    }
  }, [tasks]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DASHBOARD_NOTE_STORAGE_KEY, quickNote);
    } catch {
      // Ignore storage failures.
    }
  }, [quickNote]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        DASHBOARD_TIMER_STORAGE_KEY,
        JSON.stringify({
          minutes: timerMinutes,
          seconds: timerSeconds,
        }),
      );
    } catch {
      // Ignore storage failures.
    }
  }, [timerMinutes, timerSeconds]);

  useEffect(() => {
    if (!timerRunning) {
      return;
    }

    const interval = window.setInterval(() => {
      setTimerSeconds((current) => {
        if (current <= 1) {
          setTimerRunning(false);
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [timerRunning]);

  async function refreshOverview() {
    setRefreshing(true);

    try {
      const [transcriptResponse, ragResponse, ideResponse] = await Promise.all([
        fetch("/api/transcript-whisper/health", { cache: "no-store" }),
        fetch("/api/local-rag/health", { cache: "no-store" }),
        fetch("/api/ide/health", { cache: "no-store" }),
      ]);

      const transcriptData = (await transcriptResponse.json().catch(() => ({}))) as HealthState;
      const ragData = (await ragResponse.json().catch(() => ({}))) as RagHealthState;
      const ideData = (await ideResponse.json().catch(() => ({}))) as IdeHealthState;

      setTranscriptHealth({
        connected: transcriptResponse.ok && Boolean(transcriptData.connected),
        status: transcriptData.status || (transcriptResponse.ok ? "ok" : "offline"),
        detail: transcriptData.detail,
      });

      setRagHealth({
        connected: ragResponse.ok && Boolean(ragData.connected),
        status: ragData.status || (ragResponse.ok ? "ok" : "offline"),
        detail: ragData.detail,
        collections: ragData.collections ?? 0,
        documents: ragData.documents ?? 0,
      });

      setIdeHealth({
        connected: ideResponse.ok && Boolean(ideData.connected),
        status: ideData.status || (ideResponse.ok ? "ok" : "offline"),
        detail: ideData.detail,
        url: ideData.url,
      });
    } catch {
      setTranscriptHealth({
        connected: false,
        status: "offline",
        detail: "Transcript Whisper is unavailable.",
      });
      setRagHealth({
        connected: false,
        status: "offline",
        detail: "Local RAG is unavailable.",
        collections: 0,
        documents: 0,
      });
      setIdeHealth({
        connected: false,
        status: "offline",
        detail: "The embedded IDE is unavailable.",
      });
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refreshOverview();
  }, []);

  const featuredDocs = docs.slice(0, 4);
  const completedTasks = tasks.filter((task) => task.done).length;
  const taskProgress = tasks.length === 0 ? 0 : Math.round((completedTasks / tasks.length) * 100);
  const pendingTask = tasks.find((task) => !task.done) ?? null;
  const activeWorkflowConfig = WORKFLOW_CONFIG[activeWorkflow];
  const activeWorkflowHealth = (() => {
    if (activeWorkflow === "transcript") {
      return healthLabel(transcriptHealth);
    }
    if (activeWorkflow === "rag") {
      return healthLabel(ragHealth);
    }
    if (activeWorkflow === "ide") {
      return healthLabel(ideHealth);
    }
    return "Ready";
  })();

  function addTask() {
    const text = taskDraft.trim();
    if (!text) {
      return;
    }

    setTasks((current) => [
      {
        id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        done: false,
        createdAt: new Date().toISOString(),
      },
      ...current,
    ]);
    setTaskDraft("");
  }

  function toggleTask(taskId: string) {
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId
          ? {
              ...task,
              done: !task.done,
            }
          : task,
      ),
    );
  }

  function removeTask(taskId: string) {
    setTasks((current) => current.filter((task) => task.id !== taskId));
  }

  function clearCompletedTasks() {
    setTasks((current) => current.filter((task) => !task.done));
  }

  function resetTimer() {
    setTimerRunning(false);
    setTimerSeconds(timerMinutes * 60);
  }

  function appendNoteTemplate(template: string) {
    setQuickNote((current) => {
      const spacer = current.trim().length > 0 ? "\n\n" : "";
      return `${current}${spacer}${template}`.trimStart();
    });
  }

  return (
    <div className="flex h-full w-full overflow-y-auto">
      <div className="study-page mx-auto flex w-full max-w-7xl px-6 py-8 sm:px-10">
        <section className="study-panel relative overflow-hidden p-6 sm:p-7">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(99,102,241,0.14),transparent_44%),radial-gradient(circle_at_bottom_left,rgba(34,211,238,0.12),transparent_42%)]" />
          <div className="relative z-10 flex flex-wrap items-start justify-between gap-6">
            <div className="space-y-2">
              <h1 className="font-display text-[2rem] font-semibold tracking-[-0.05em] text-text-primary sm:text-[2.4rem]">
                {greeting.title}
              </h1>
              <p className="max-w-2xl text-sm leading-7 text-text-secondary sm:text-base">
                {greeting.copy}
              </p>
              <p className="pt-1 text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                {todayLabel}
              </p>
            </div>

            <button
              type="button"
              onClick={() => void refreshOverview()}
              className="study-button-secondary shrink-0"
              disabled={refreshing}
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Sync
            </button>
          </div>

          <div className="relative z-10 mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-xl border border-border bg-bg-panel/90 p-3">
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-text-muted">
                Plan
              </div>
              <div className="mt-2 text-sm font-semibold text-text-primary">{taskProgress}% complete</div>
            </div>
            <div className="rounded-xl border border-border bg-bg-panel/90 p-3">
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-text-muted">
                Transcript
              </div>
              <div className="mt-2 text-sm font-semibold text-text-primary">{healthLabel(transcriptHealth)}</div>
            </div>
            <div className="rounded-xl border border-border bg-bg-panel/90 p-3">
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-text-muted">
                RAG Sources
              </div>
              <div className="mt-2 text-sm font-semibold text-text-primary">
                {ragHealth.documents ?? 0} indexed
              </div>
            </div>
            <div className="rounded-xl border border-border bg-bg-panel/90 p-3">
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-text-muted">
                Docs
              </div>
              <div className="mt-2 text-sm font-semibold text-text-primary">{docs.length} available</div>
            </div>
            <div className="rounded-xl border border-border bg-bg-panel/90 p-3">
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-text-muted">
                IDE
              </div>
              <div className="mt-2 text-sm font-semibold text-text-primary">{healthLabel(ideHealth)}</div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
          <article className="study-panel p-6 sm:p-7">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="study-kicker">Planner</div>
                <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-text-primary">
                  Stay focused on the next concrete task.
                </h2>
              </div>
              <div className="study-icon-frame">
                <ListTodo className="h-4 w-4" />
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <div className="study-stat">
                <div className="study-stat-label">Total</div>
                <div className="study-stat-value">{tasks.length}</div>
              </div>
              <div className="study-stat">
                <div className="study-stat-label">Done</div>
                <div className="study-stat-value">{completedTasks}</div>
              </div>
              <div className="study-stat">
                <div className="study-stat-label">Pending</div>
                <div className="study-stat-value">{Math.max(tasks.length - completedTasks, 0)}</div>
              </div>
            </div>

            <div className="mt-6 h-2 overflow-hidden rounded-full bg-bg-elevated">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300"
                style={{ width: `${taskProgress}%` }}
              />
            </div>

            <div className="mt-6 flex gap-2">
              <input
                value={taskDraft}
                onChange={(event) => setTaskDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addTask();
                  }
                }}
                placeholder="Add a concrete task..."
                className="study-field min-w-0 flex-1"
              />
              <button type="button" onClick={addTask} className="study-button-primary">
                <Plus className="h-4 w-4" />
                Add
              </button>
            </div>

            <div className="mt-4 max-h-[18rem] space-y-2 overflow-y-auto pr-1">
              {tasks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-bg-elevated p-4 text-sm text-text-secondary">
                  No tasks yet. Add your first study goal for today.
                </div>
              ) : (
                tasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-2 rounded-xl border border-border bg-bg-panel px-3 py-2.5 transition hover:border-accent/30"
                  >
                    <button
                      type="button"
                      onClick={() => toggleTask(task.id)}
                      className={[
                        "inline-flex h-6 w-6 items-center justify-center rounded-md border text-xs transition",
                        task.done
                          ? "border-accent bg-accent text-white"
                          : "border-border bg-bg-elevated text-text-muted hover:border-accent hover:text-accent",
                      ].join(" ")}
                      title={task.done ? "Mark as not done" : "Mark as done"}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <div
                      className={[
                        "min-w-0 flex-1 text-sm",
                        task.done ? "text-text-muted line-through" : "text-text-primary",
                      ].join(" ")}
                    >
                      {task.text}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeTask(task.id)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition hover:bg-bg-elevated hover:text-text-primary"
                      title="Remove task"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {completedTasks > 0 ? (
              <button
                type="button"
                onClick={clearCompletedTasks}
                className="study-button-secondary mt-3"
              >
                Clear completed
              </button>
            ) : null}
          </article>

          <aside className="study-panel-muted p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="study-icon-frame">
                  <Clock3 className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-text-primary">Focus sprint</div>
                  <div className="mt-1 text-sm text-text-secondary">
                    Run one uninterrupted block before context-switching.
                  </div>
                </div>
              </div>
              <div className="rag-mini-badge">{timerMinutes} min</div>
            </div>

            <div className="mt-6 rounded-2xl border border-border bg-bg-panel p-5 text-center shadow-sm">
              <div className="font-display text-[2.7rem] font-semibold tracking-[-0.06em] text-text-primary">
                {formatTimer(timerSeconds)}
              </div>
              <div className="mt-4 flex justify-center gap-2">
                {TIMER_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setTimerMinutes(preset);
                      setTimerSeconds(preset * 60);
                      setTimerRunning(false);
                    }}
                    className={[
                      "study-button-secondary px-3 py-1.5 text-xs",
                      timerMinutes === preset ? "border-accent text-text-primary" : "",
                    ].join(" ")}
                  >
                    {preset}m
                  </button>
                ))}
              </div>
              <div className="mt-4 flex justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setTimerRunning((current) => !current)}
                  className="study-button-primary"
                >
                  {timerRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {timerRunning ? "Pause" : "Start"}
                </button>
                <button type="button" onClick={resetTimer} className="study-button-secondary">
                  Reset
                </button>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-border bg-bg-panel px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                Next pending task
              </div>
              <div className="mt-2 text-sm text-text-primary">
                {pendingTask ? pendingTask.text : "No pending task. You are clear."}
              </div>
            </div>
          </aside>
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.92fr,1.08fr]">
          <article className="study-panel p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="study-kicker">Scratchpad</div>
                <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-text-primary">
                  Capture notes, questions, and review points.
                </h2>
              </div>
              <div className="study-icon-frame">
                <FileText className="h-4 w-4" />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => appendNoteTemplate("Session goal: ")}
                className="study-button-secondary px-3 py-1.5 text-xs"
              >
                Session goal
              </button>
              <button
                type="button"
                onClick={() => appendNoteTemplate("Questions to resolve:")}
                className="study-button-secondary px-3 py-1.5 text-xs"
              >
                Questions
              </button>
              <button
                type="button"
                onClick={() => appendNoteTemplate("Review checklist:")}
                className="study-button-secondary px-3 py-1.5 text-xs"
              >
                Checklist
              </button>
            </div>

            <textarea
              value={quickNote}
              onChange={(event) => setQuickNote(event.target.value)}
              placeholder="Write formulas, reminders, questions, and next steps..."
              className="study-textarea mt-4 min-h-[17rem]"
            />

            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-[0.14em] text-text-muted">
                {quickNote.trim().length} characters
              </div>
              <button
                type="button"
                onClick={() => setQuickNote("")}
                className="study-button-secondary"
              >
                Clear note
              </button>
            </div>
          </article>

          <article className="study-panel p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="study-kicker">Launchpad</div>
                <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-text-primary">
                  Move to the right workspace with one click.
                </h2>
              </div>
              <ArrowRight className="h-5 w-5 text-text-muted" />
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {(Object.keys(WORKFLOW_CONFIG) as WorkflowKey[]).map((key) => {
                const workflow = WORKFLOW_CONFIG[key];
                const active = activeWorkflow === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveWorkflow(key)}
                    className={[
                      "rounded-xl border px-3 py-3 text-left transition",
                      active
                        ? "border-accent bg-bg-elevated"
                        : "border-border bg-bg-card hover:border-accent/40",
                    ].join(" ")}
                  >
                    <div className="text-sm font-semibold text-text-primary">{workflow.label}</div>
                    <div className="mt-1 text-xs text-text-secondary">{workflow.hint}</div>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 rounded-xl border border-border bg-bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-text-primary">
                    {activeWorkflowConfig.label}
                  </div>
                  <div className="mt-1 text-sm text-text-secondary">{activeWorkflowConfig.hint}</div>
                </div>
                <span className="rag-mini-badge">{activeWorkflowHealth}</span>
              </div>
              <div className="mt-3">
                <Link href={activeWorkflowConfig.href} className="study-button-primary">
                  Open {activeWorkflowConfig.label}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-border bg-bg-card px-4 py-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <MessagesSquare className="h-4 w-4 text-text-muted" />
                Continue in docs
              </div>
              <div className="mt-2 space-y-2">
                {featuredDocs.length === 0 ? (
                  <div className="text-sm text-text-secondary">No docs available yet.</div>
                ) : (
                  featuredDocs.map((doc) => (
                    <Link
                      key={doc.slug}
                      href={`/dashboard/docs?doc=${encodeURIComponent(doc.slug)}`}
                      className="block rounded-lg border border-border px-3 py-2 text-sm text-text-secondary transition hover:border-accent hover:text-text-primary"
                    >
                      {doc.title}
                    </Link>
                  ))
                )}
              </div>
            </div>
          </article>
        </section>
      </div>
    </div>
  );
}
