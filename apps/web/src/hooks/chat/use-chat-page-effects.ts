import { useEffect, useRef, type RefObject } from "react";
import type { ChatMessage } from "@/lib/chat/chat-api";

export function useChatPageEffects({
  refreshChatState,
  refreshKey,
  messages,
  isSending,
  messagesEndRef,
}: {
  refreshChatState: () => Promise<void>;
  refreshKey: string;
  messages: ChatMessage[];
  isSending: boolean;
  messagesEndRef: RefObject<HTMLDivElement | null>;
}) {
  const refreshChatStateRef = useRef(refreshChatState);

  useEffect(() => {
    refreshChatStateRef.current = refreshChatState;
  }, [refreshChatState]);

  useEffect(() => {
    void refreshChatStateRef.current();
  }, [refreshKey]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, isSending, messagesEndRef]);
}
