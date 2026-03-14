const DEFAULT_TRANSCRIPT_WHISPER_API_BASE_URL = "http://127.0.0.1:8000/api/v1";

export function getTranscriptWhisperApiBaseUrl(): string {
  return (
    process.env.TRANSCRIPT_WHISPER_API_BASE_URL?.trim() ||
    DEFAULT_TRANSCRIPT_WHISPER_API_BASE_URL
  ).replace(/\/+$/, "");
}

export function buildTranscriptWhisperApiUrl(pathname: string): string {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${getTranscriptWhisperApiBaseUrl()}${normalizedPath}`;
}
