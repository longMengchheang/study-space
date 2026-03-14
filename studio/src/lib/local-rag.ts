const DEFAULT_LOCAL_RAG_API_BASE_URL = "http://127.0.0.1:9999";

export function getLocalRagApiBaseUrl(): string {
  return (process.env.LOCAL_RAG_API_BASE_URL?.trim() || DEFAULT_LOCAL_RAG_API_BASE_URL).replace(
    /\/+$/,
    "",
  );
}

export function buildLocalRagApiUrl(pathname: string): string {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${getLocalRagApiBaseUrl()}${normalizedPath}`;
}
