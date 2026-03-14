const DEFAULT_CODE_ASSISTANT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_CODE_ASSISTANT_MODEL = "qwen2.5-coder:3b";

export function getCodeAssistantBaseUrl(): string {
  return (
    process.env.LOCAL_CODE_ASSISTANT_BASE_URL?.trim() || DEFAULT_CODE_ASSISTANT_BASE_URL
  ).replace(/\/+$/, "");
}

export function getCodeAssistantModel(): string {
  return process.env.LOCAL_CODE_ASSISTANT_MODEL?.trim() || DEFAULT_CODE_ASSISTANT_MODEL;
}

export function buildCodeAssistantUrl(pathname: string): string {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${getCodeAssistantBaseUrl()}${normalizedPath}`;
}
