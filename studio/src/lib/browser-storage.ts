const storageSnapshotCache = new Map<string, { raw: string | null; value: unknown }>();

export function subscribeStorageKey(key: string, callback: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = (event: Event) => {
    if (event instanceof StorageEvent) {
      if (event.key && event.key !== key) {
        return;
      }

      callback();
      return;
    }

    if (event instanceof CustomEvent) {
      const detail = event.detail as { key?: string } | undefined;
      if (detail?.key && detail.key !== key) {
        return;
      }

      callback();
    }
  };

  window.addEventListener("storage", handler);
  window.addEventListener("studyspace:storage-change", handler as EventListener);

  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener("studyspace:storage-change", handler as EventListener);
  };
}

export function getStorageSnapshot<T>(
  key: string,
  parser: (raw: string | null) => T,
  fallback: T,
): T {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(key);
    const cached = storageSnapshotCache.get(key);

    if (cached && cached.raw === raw) {
      return cached.value as T;
    }

    const value = parser(raw);
    storageSnapshotCache.set(key, { raw, value });
    return value;
  } catch {
    return fallback;
  }
}

export function setStorageValueAndNotify(key: string, value: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, value);
    storageSnapshotCache.delete(key);
  } catch {}

  window.dispatchEvent(new CustomEvent("studyspace:storage-change", { detail: { key } }));
}
