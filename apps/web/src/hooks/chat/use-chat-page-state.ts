import { useReducer, useRef, useState } from "react";
import { resolveProviderPresentation } from "@/lib/chat/chat-formatters";
import type { ChatMessage, ChatThread, ProviderConfigResponse } from "@/lib/chat/chat-api";

type Notice = {
  tone: "error" | "info";
  text: string;
} | null;

function booleanReducer(_current: boolean, next: boolean) {
  return next;
}

export function useChatPageState(providerState: ProviderConfigResponse | null) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useReducer(booleanReducer, false);
  const [isSending, setIsSending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const providerPresentation = resolveProviderPresentation(providerState);

  return {
    activeThreadId,
    draft,
    isLoading,
    isSending,
    messages,
    messagesEndRef,
    notice,
    providerPresentation,
    setActiveThreadId,
    setDraft,
    setIsLoading,
    setIsSending,
    setMessages,
    setNotice,
    setThreads,
    threads,
  };
}
