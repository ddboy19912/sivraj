import { type Dispatch, type SetStateAction, useReducer, useRef, useState } from "react";
import { resolveProviderPresentation } from "@/lib/chat/chat-formatters";
import type {
  ChatMemoryIntent,
  ChatMessage,
  ChatThread,
  ProviderConfigResponse,
} from "@/lib/chat/chat-api";
import type { ChatPageStatus } from "@/types/chat.types";

type Notice = {
  tone: "error" | "info";
  text: string;
} | null;

const CHAT_MEMORY_INTENT_STORAGE_KEY = "sivraj.chat.memoryIntent";

function booleanReducer(_current: boolean, next: boolean) {
  return next;
}

export function useChatPageState(providerState: ProviderConfigResponse | null) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draftByThreadId, setDraftByThreadId] = useState<Record<string, string>>({});
  const [newThreadDraft, setNewThreadDraft] = useState("");
  const [isLoading, setIsLoading] = useReducer(booleanReducer, false);
  const [status, setStatus] = useState<ChatPageStatus>("booting");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [lastFailedContent, setLastFailedContent] = useState<string | null>(null);
  const [lastFailedMemoryIntent, setLastFailedMemoryIntent] =
    useState<ChatMemoryIntent>("auto");
  const [lastFailedRetryAttempt, setLastFailedRetryAttempt] = useState(0);
  const [memoryIntent, setMemoryIntentState] =
    useState<ChatMemoryIntent>(() => readStoredChatMemoryIntent());
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const activeStreamAbortRef = useRef<AbortController | null>(null);
  const providerPresentation = resolveProviderPresentation(providerState);
  const draftKey = activeThreadId ?? "__new__";
  const draft = activeThreadId ? draftByThreadId[activeThreadId] ?? "" : newThreadDraft;
  const isSending =
    status === "sending" ||
    status === "retrieving_context" ||
    status === "streaming";

  function setDraft(value: string) {
    if (!activeThreadId) {
      setNewThreadDraft(value);
      return;
    }

    setDraftByThreadId((current) => ({ ...current, [activeThreadId]: value }));
  }

  function clearActiveDraft(threadId: string | null) {
    if (!threadId) {
      setNewThreadDraft("");
      return;
    }

    setDraftByThreadId((current) => {
      const next = { ...current };
      delete next[threadId];
      return next;
    });
  }

  const setMemoryIntent: Dispatch<SetStateAction<ChatMemoryIntent>> = (nextIntent) => {
    setMemoryIntentState((currentIntent) => {
      const resolvedIntent = typeof nextIntent === "function"
        ? nextIntent(currentIntent)
        : nextIntent;
      writeStoredChatMemoryIntent(resolvedIntent);
      return resolvedIntent;
    });
  };

  return {
    activeThreadId,
    activeStreamAbortRef,
    draft,
    draftKey,
    clearActiveDraft,
    isLoading,
    isSending,
    lastFailedContent,
    lastFailedMemoryIntent,
    lastFailedRetryAttempt,
    messages,
    messagesEndRef,
    memoryIntent,
    notice,
    providerPresentation,
    setLastFailedContent,
    setLastFailedMemoryIntent,
    setLastFailedRetryAttempt,
    setMemoryIntent,
    setActiveThreadId,
    setDraft,
    setIsLoading,
    setStatus,
    setMessages,
    setNotice,
    setThreads,
    status,
    threads,
  };
}

function readStoredChatMemoryIntent(): ChatMemoryIntent {
  if (typeof window === "undefined") {
    return "auto";
  }

  try {
    return readChatMemoryIntent(window.localStorage.getItem(CHAT_MEMORY_INTENT_STORAGE_KEY));
  } catch {
    return "auto";
  }
}

function writeStoredChatMemoryIntent(intent: ChatMemoryIntent) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(CHAT_MEMORY_INTENT_STORAGE_KEY, intent);
  } catch {
    // Chat remains usable if browser storage is unavailable.
  }
}

function readChatMemoryIntent(value: unknown): ChatMemoryIntent {
  return value === "remember" || value === "private" ? value : "auto";
}
