export function readAiChatProvider(value: unknown): "chatgpt" | "claude" | "codex" | "generic_chat" | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");

  if (normalized === "chatgpt" || normalized === "openai" || normalized === "chat_gpt") {
    return "chatgpt";
  }

  if (normalized === "claude" || normalized === "anthropic") {
    return "claude";
  }

  if (normalized === "codex") {
    return "codex";
  }

  if (normalized === "generic_chat" || normalized === "chat") {
    return "generic_chat";
  }

  return undefined;
}

export function detectAiChatProviderFromFilename(value?: string | null): "chatgpt" | "claude" | "codex" | "generic_chat" | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.toLowerCase();

  if (normalized.includes("chatgpt") || normalized.includes("openai")) {
    return "chatgpt";
  }

  if (normalized.includes("claude") || normalized.includes("anthropic")) {
    return "claude";
  }

  if (normalized.includes("codex")) {
    return "codex";
  }

  return undefined;
}
