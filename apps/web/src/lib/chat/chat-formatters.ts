import type { ProviderConfigResponse } from "@/lib/chat/chat-api";
import type { ChatMessage } from "@/lib/chat/chat-api";

export type ProviderPresentation = {
  label: string;
  mode: string;
};

export function resolveProviderPresentation(
  providerState: ProviderConfigResponse | null,
): ProviderPresentation {
  if (providerState?.config) {
    return {
      label: `${providerState.config.displayName} ${providerState.config.model}`,
      mode:
        providerState.config.providerKind === "ollama"
          ? "Local model"
          : "User model",
    };
  }

  if (providerState?.fallback) {
    return {
      label: `${providerState.fallback.displayName} ${providerState.fallback.model}`,
      mode: "Sivraj default",
    };
  }

  return { label: "No model connected", mode: "Setup needed" };
}

export function createOptimisticUserMessage(
  activeThreadId: string | null,
  content: string,
): ChatMessage {
  return {
    id: `local-${Date.now()}`,
    threadId: activeThreadId ?? "pending",
    role: "user",
    content,
    providerKind: null,
    model: null,
    memoryFragmentIds: [],
    citations: null,
    usage: null,
    metadata: { contextSaved: true, optimistic: true },
    createdAt: new Date().toISOString(),
  };
}

export function titleFromMessage(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 64) || "New chat";
}

const messageTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});

const messageDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

export function formatTime(value: string): string {
  return messageTimeFormatter.format(new Date(value));
}

export function formatRelativeTime(value: string): string {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60_000));

  if (diffMinutes < 1) {
    return "Just now";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  return messageDateFormatter.format(date);
}
