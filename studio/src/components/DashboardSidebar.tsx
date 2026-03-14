"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AudioLines,
  Brain,
  BookMarked,
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  Code2,
  LayoutDashboard,
  MessagesSquare,
  Zap,
} from "lucide-react";
import {
  getStorageSnapshot,
  setStorageValueAndNotify,
  subscribeStorageKey,
} from "@/lib/browser-storage";
import {
  applyTheme,
  STUDYSPACE_THEME_STORAGE_KEY,
  type StudyTheme,
} from "@/lib/theme";

const NAV_ITEMS = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: <LayoutDashboard className="h-5 w-5" />,
  },
  {
    href: "/dashboard/transcript-whisper",
    label: "Transcript",
    icon: <AudioLines className="h-5 w-5" />,
  },
  {
    href: "/dashboard/study-rag",
    label: "RAG",
    icon: <Brain className="h-5 w-5" />,
  },
  {
    href: "/dashboard/docs",
    label: "Docs",
    icon: <BookOpenText className="h-5 w-5" />,
  },
  {
    href: "/dashboard/forum",
    label: "Forum",
    icon: <MessagesSquare className="h-5 w-5" />,
  },
  {
    href: "/dashboard/ide",
    label: "IDE",
    icon: <Code2 className="h-5 w-5" />,
  },
];

const SIDEBAR_STORAGE_KEY = "studyspace:sidebar-collapsed";

function OwlIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 19v-5.5c0-3.4 2.8-6.2 6.2-6.2h0c3.4 0 6.2 2.8 6.2 6.2V19" />
      <path d="M9.2 8.3 7.7 5.9" />
      <path d="m14.8 8.3 1.5-2.4" />
      <circle cx="10" cy="13.2" r="1.2" />
      <circle cx="14" cy="13.2" r="1.2" />
      <path d="M12 14.6v1.7" />
      <path d="M10.9 16.1h2.2" />
      <path d="M8.5 19h7" />
    </svg>
  );
}

export default function DashboardSidebar() {
  const pathname = usePathname();
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
  const storedCollapsed = useSyncExternalStore(
    (callback) => subscribeStorageKey(SIDEBAR_STORAGE_KEY, callback),
    () => getStorageSnapshot(SIDEBAR_STORAGE_KEY, (raw) => raw === "1", false),
    () => false,
  );
  const [compact, setCompact] = useState(false);
  const collapsed = compact || storedCollapsed;
  const activeTheme: StudyTheme = storedTheme === "dark" ? "dark" : "light";

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 960px)");

    const syncViewport = () => {
      setCompact(mediaQuery.matches);
    };

    syncViewport();
    mediaQuery.addEventListener("change", syncViewport);

    return () => {
      mediaQuery.removeEventListener("change", syncViewport);
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--sidebar-width",
      collapsed ? "4.75rem" : "16rem",
    );
  }, [collapsed]);

  useEffect(() => {
    applyTheme(activeTheme);
  }, [activeTheme]);

  function updateCollapsed(nextValue: boolean) {
    if (compact) {
      return;
    }

    setStorageValueAndNotify(SIDEBAR_STORAGE_KEY, nextValue ? "1" : "0");
  }

  function toggleTheme() {
    const nextTheme: StudyTheme = activeTheme === "dark" ? "light" : "dark";
    setStorageValueAndNotify(STUDYSPACE_THEME_STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
  }

  return (
    <aside className="fixed z-[1000] flex h-screen w-[var(--sidebar-width)] flex-col overflow-hidden border-r border-border/85 bg-bg-sidebar/95 shadow-[8px_0_24px_rgba(15,23,42,0.04)] backdrop-blur-xl transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]">
      <div
        className={[
          "group relative min-h-[5.25rem] overflow-hidden border-b border-border/75",
          collapsed ? "px-2" : "px-4",
        ].join(" ")}
      >
        <div
          className={[
            "absolute inset-0 flex items-center justify-center transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            collapsed
              ? "translate-x-0 opacity-100"
              : "pointer-events-none translate-x-2 opacity-0",
          ].join(" ")}
        >
          <button
            type="button"
            onClick={() => updateCollapsed(false)}
            className="group/logo relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border border-border bg-bg-elevated text-text-primary shadow-sm transition-all duration-200 hover:border-text-muted hover:bg-border"
            title="Expand sidebar"
            disabled={compact}
          >
            <span className="transition-[opacity,transform] duration-200 group-hover/logo:-translate-x-1 group-hover/logo:opacity-0">
              <BookMarked className="h-5 w-5" />
            </span>
            <span className="absolute inset-0 flex translate-x-1 items-center justify-center opacity-0 transition-[opacity,transform] duration-200 group-hover/logo:translate-x-0 group-hover/logo:opacity-100">
              <ChevronRight className="h-4 w-4" />
            </span>
          </button>
        </div>

        <div
          className={[
            "absolute inset-0 flex items-center transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            collapsed
              ? "pointer-events-none -translate-x-3 opacity-0"
              : "translate-x-0 opacity-100",
          ].join(" ")}
        >
          <div className="flex w-full items-center justify-between gap-3 px-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-elevated text-text-primary shadow-sm">
                <BookMarked className="h-5 w-5" />
              </div>
              <div className="min-w-0 overflow-hidden">
                <div className="text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-text-muted">
                  Study Workspace
                </div>
                <div className="truncate font-display text-[1.05rem] font-semibold tracking-[-0.04em] text-text-primary">
                  Studyspace
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => updateCollapsed(true)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted opacity-100 transition-all duration-200 hover:bg-bg-elevated hover:text-text-primary"
              title="Collapse sidebar"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div
        className={[
          "overflow-hidden px-3 transition-[max-height,opacity,padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          collapsed ? "max-h-0 pt-0 opacity-0" : "max-h-10 pt-4 opacity-100",
        ].join(" ")}
      >
        <div className="px-2 text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
          Navigate
        </div>
      </div>

      <nav className={`flex-1 space-y-1 px-3 py-3 ${collapsed ? "pt-4" : ""}`}>
        {NAV_ITEMS.map((item) => {
          const active =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={[
                "group relative flex items-center overflow-hidden rounded-lg text-[0.92rem] font-medium transition",
                collapsed ? "justify-center px-3 py-2.5" : "gap-3 px-3 py-2.5",
                active
                  ? "bg-bg-elevated text-text-primary"
                  : "text-text-secondary hover:bg-bg-elevated hover:text-text-primary",
              ].join(" ")}
            >
              <span
                className={active ? "text-accent" : "text-text-muted group-hover:text-accent"}
              >
                {item.icon}
              </span>
              <span
                className={`origin-left overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-200 ease-out ${
                  collapsed
                    ? "max-w-0 -translate-x-2 opacity-0"
                    : "max-w-[9rem] translate-x-0 opacity-100"
                }`}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={toggleTheme}
          title={collapsed ? (activeTheme === "dark" ? "Night Owl" : "Spark") : undefined}
          className={[
            "group relative flex w-full items-center overflow-hidden rounded-lg border border-border/85 bg-bg-elevated/70 text-[0.9rem] font-medium text-text-secondary transition",
            collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
            "hover:border-accent/25 hover:text-text-primary",
          ].join(" ")}
        >
          <span className="text-text-muted transition-colors group-hover:text-accent">
            {activeTheme === "dark" ? (
              <OwlIcon className="h-5 w-5" />
            ) : (
              <Zap className="h-5 w-5" />
            )}
          </span>
          <span
            className={`origin-left overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-200 ease-out ${
              collapsed
                ? "max-w-0 -translate-x-2 opacity-0"
                : "max-w-[9rem] translate-x-0 opacity-100"
            }`}
          >
            {activeTheme === "dark" ? "Night Owl" : "Spark"}
          </span>
        </button>
      </div>
    </aside>
  );
}
