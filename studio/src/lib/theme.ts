export type StudyTheme = "light" | "dark";

export const STUDYSPACE_THEME_STORAGE_KEY = "studyspace:theme";

export function parseStoredTheme(raw: string | null | undefined): StudyTheme | null {
  if (raw === "light" || raw === "dark") {
    return raw;
  }

  return null;
}

export function getSystemTheme(): StudyTheme {
  if (typeof window === "undefined") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(raw: string | null | undefined): StudyTheme {
  return parseStoredTheme(raw) ?? getSystemTheme();
}

export function applyTheme(theme: StudyTheme) {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}
