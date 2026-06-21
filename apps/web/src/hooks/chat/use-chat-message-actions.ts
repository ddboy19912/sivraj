import {
  chatErrorNotice,
  replaceOptimisticMessages,
  sendStreamingChatPageMessage,
} from "@/lib/chat/chat-page-actions";
import { createOptimisticUserMessage } from "@/lib/chat/chat-formatters";
import type {
  ChatMemoryIntent,
  ChatMessage,
  ChatRetrievalStatus,
  ChatTurnStreamEvent,
} from "@/lib/chat/chat-api";
import type { Session } from "@/lib/session";
import type { ChatPageStatus } from "@/types/chat.types";

type Notice = {
  tone: "error" | "info";
  text: string;
} | null;

type ChatMessageActionsInput = {
  session: Session | null;
  activeThreadId: string | null;
  draft: string;
  memoryIntent: ChatMemoryIntent;
  isSending: boolean;
  status: ChatPageStatus;
  lastFailedContent: string | null;
  lastFailedMemoryIntent: ChatMemoryIntent;
  lastFailedRetryAttempt: number;
  onSessionRefreshed: (session: Session) => void;
  setDraft: (value: string) => void;
  clearActiveDraft: (threadId: string | null) => void;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setThreads: React.Dispatch<React.SetStateAction<import("@/lib/chat/chat-api").ChatThread[]>>;
  setActiveThreadId: React.Dispatch<React.SetStateAction<string | null>>;
  setStatus: React.Dispatch<React.SetStateAction<ChatPageStatus>>;
  setNotice: React.Dispatch<React.SetStateAction<Notice | null>>;
  setLastFailedContent: React.Dispatch<React.SetStateAction<string | null>>;
  setLastFailedMemoryIntent: React.Dispatch<React.SetStateAction<ChatMemoryIntent>>;
  setLastFailedRetryAttempt: React.Dispatch<React.SetStateAction<number>>;
  setMemoryIntent: React.Dispatch<React.SetStateAction<ChatMemoryIntent>>;
  activeStreamAbortRef: React.RefObject<AbortController | null>;
};

const COMPLETED_TYPING_MIN_MS = 320;
const COMPLETED_TYPING_MAX_MS = 2_400;
const COMPLETED_TYPING_CHAR_MS = 14;

export function useChatMessageActions(input: ChatMessageActionsInput) {
  async function sendMessage() {
    await sendContent(input.draft, {
      allowFailedRetry: false,
      memoryIntent: input.memoryIntent,
    });
  }

  async function sendContent(
    rawContent: string,
    options: {
      allowFailedRetry: boolean;
      memoryIntent: ChatMemoryIntent;
      retryAttempt?: number;
    },
  ) {
    if (!input.session || input.isSending) {
      return;
    }

    if (input.status === "failed" && !options.allowFailedRetry) {
      input.setNotice({
        tone: "error",
        text: "The last message failed. Retry it or fix the provider before sending another message.",
      });
      return;
    }

    const content = rawContent.trim();
    if (!content) {
      return;
    }

    const retryingFailedTurn = options.allowFailedRetry && input.status === "failed";
    const memoryIntent = options.memoryIntent;
    const retryAttempt = retryingFailedTurn ? options.retryAttempt ?? 0 : 0;

    input.setStatus("sending");
    input.setNotice(null);
    input.setLastFailedContent(null);
    input.setLastFailedMemoryIntent("auto");
    input.setLastFailedRetryAttempt(0);
    input.clearActiveDraft(input.activeThreadId);
    const optimistic = createOptimisticUserMessage(
      input.activeThreadId,
      content,
      memoryIntent,
    );
    input.setMessages((current) =>
      retryingFailedTurn
        ? replaceLastMatchingUserMessage(current, content, optimistic)
        : [...current, optimistic],
    );

    try {
      const abortController = new AbortController();
      let terminalStatus: "completed" | "failed" | "cancelled" = "completed";
      input.activeStreamAbortRef.current = abortController;
      const result = await sendStreamingChatPageMessage({
        session: input.session,
        activeThreadId: input.activeThreadId,
        content,
        memoryIntent,
        retryAttempt,
        onSessionRefreshed: input.onSessionRefreshed,
        signal: abortController.signal,
        onEvent: (event) => {
          const nextTerminalStatus = applyStreamEvent(
            event,
            optimistic.id,
            content,
            memoryIntent,
            retryAttempt,
          );
          if (nextTerminalStatus) {
            terminalStatus = nextTerminalStatus;
          }
        },
      });
      if (!input.activeThreadId) {
        input.setActiveThreadId(result.threadId);
      }
      input.setThreads(result.threads);
      if (terminalStatus === "completed" || terminalStatus === "cancelled") {
        input.setLastFailedRetryAttempt(0);
        input.setStatus("ready");
      }
    } catch (error) {
      if (abortControllerError(error)) {
        input.setStatus("ready");
        return;
      }

      input.setDraft(content);
      input.setMemoryIntent(memoryIntent);
      input.setLastFailedContent(content);
      input.setLastFailedMemoryIntent(memoryIntent);
      input.setLastFailedRetryAttempt(nextRetryAttempt(retryAttempt));
      input.setNotice(chatErrorNotice(error, "Message failed."));
      input.setStatus("failed");
    } finally {
      input.activeStreamAbortRef.current = null;
    }
  }

  function applyStreamEvent(
    event: ChatTurnStreamEvent,
    optimisticId: string,
    content: string,
    memoryIntent: ChatMemoryIntent,
    retryAttempt: number,
  ): "failed" | "cancelled" | null {
    if (event.type === "turn.created") {
      input.setMessages((current) =>
        replaceOptimisticMessages(current, optimisticId, [
          event.userMessage,
          event.assistantMessage,
        ]),
      );
      return null;
    }

    if (event.type === "context.ready") {
      input.setStatus("retrieving_context");
      const retrievalNotice = retrievalDegradationNotice(event.retrievalStatus);
      if (retrievalNotice) {
        input.setNotice({ tone: "error", text: retrievalNotice });
      }
      return null;
    }

    if (event.type === "assistant.delta") {
      input.setStatus("streaming");
      input.setMessages((current) =>
        current.map((message) =>
          message.id === event.assistantMessageId
            ? {
                ...message,
                status: "streaming",
                content: `${message.content}${event.delta}`,
              }
            : message,
        ),
      );
      return null;
    }

    if (event.type === "assistant.completed") {
      const typingMs = completedTypingDurationMs(event.assistantMessage.content);
      input.setMessages((current) =>
        current.map((message) =>
          message.id === event.assistantMessage.id
            ? { ...event.assistantMessage, status: "streaming" }
          : message,
        ),
      );
      window.setTimeout(() => {
        input.setMessages((current) =>
          current.map((message) =>
            message.id === event.assistantMessage.id
              ? event.assistantMessage
              : message,
          ),
        );
      }, typingMs);
      return null;
    }

    if (event.type === "turn.failed") {
      input.setStatus("failed");
      input.setLastFailedContent(content);
      input.setLastFailedMemoryIntent(memoryIntent);
      input.setLastFailedRetryAttempt(
        event.error.nextRetryAttempt ?? nextRetryAttempt(retryAttempt),
      );
      input.setNotice({ tone: "error", text: publicChatFailureMessage(event.error.message) });
      input.setMessages((current) =>
        current.filter((message) =>
          event.assistantMessageId
            ? message.id !== event.assistantMessageId
            : !(message.role === "assistant" && message.turnId === event.turnId),
        ),
      );
      return "failed";
    }

    if (event.type === "turn.cancelled") {
      input.setStatus("ready");
      input.setLastFailedRetryAttempt(0);
      return "cancelled";
    }

    return null;
  }

  function stopStreaming() {
    input.activeStreamAbortRef.current?.abort();
  }

  async function retryLastMessage() {
    if (!input.lastFailedContent || input.isSending) {
      return;
    }

    await sendContent(input.lastFailedContent, {
      allowFailedRetry: true,
      memoryIntent: input.lastFailedMemoryIntent,
      retryAttempt: input.lastFailedRetryAttempt,
    });
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return {
    handleComposerKeyDown,
    retryLastMessage,
    sendMessage,
    stopStreaming,
  };
}

function completedTypingDurationMs(content: string) {
  return Math.min(
    Math.max(content.length * COMPLETED_TYPING_CHAR_MS, COMPLETED_TYPING_MIN_MS),
    COMPLETED_TYPING_MAX_MS,
  );
}

function nextRetryAttempt(retryAttempt: number) {
  return Math.min(Math.max(0, Math.floor(retryAttempt)) + 1, 4);
}

function abortControllerError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}


function replaceLastMatchingUserMessage(
  messages: ChatMessage[],
  content: string,
  optimistic: ChatMessage,
) {
  const index = messages.findLastIndex((message) =>
    message.role === "user" &&
    message.content.trim() === content,
  );

  if (index === -1) {
    return [...messages, optimistic];
  }

  return messages.map((message, messageIndex) =>
    messageIndex === index ? optimistic : message,
  );
}

function publicChatFailureMessage(message: string) {
  if (
    message.includes("Cannot connect to API") ||
    message.includes("Connect Timeout Error") ||
    message.includes("UND_ERR_CONNECT_TIMEOUT")
  ) {
    return "The model provider timed out before returning a response. Retry once your connection or provider is healthy.";
  }

  if (message.includes("storage_wallet_insufficient_balance")) {
    return "Private memory storage needs more SUI before it can save new memory.";
  }

  return message;
}

function retrievalDegradationNotice(status: ChatRetrievalStatus | undefined) {
  if (status?.state !== "degraded") {
    return null;
  }

  const target = status.target === "document" ? "Document" : "Memory";
  if (status.reason === "timeout") {
    return `${target} retrieval timed out. I replied with a safe fallback.`;
  }
  return `${target} retrieval failed. I replied with a safe fallback.`;
}
