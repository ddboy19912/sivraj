/**
 * SSE turn event helpers — timing, serialization, and event envelope writing.
 */
import type {
  ChatTurnEventStream,
  ChatTurnResponse,
  ChatTurnRow,
  ChatTurnTimings,
} from "../../types/chat.types.js";

export async function timedPromise<T>(
  timings: ChatTurnTimings,
  key: string,
  promise: Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await promise;
  } finally {
    timings[key] = Date.now() - startedAt;
  }
}

export function readPublicChatTimings(timings: ChatTurnTimings): ChatTurnTimings {
  return Object.fromEntries(
    Object.entries(timings)
      .filter(([, value]) => Number.isFinite(value))
      .map(([key, value]) => [key, Math.max(Math.round(value), 0)]),
  );
}

export function toTurnResponse(turn: ChatTurnRow): ChatTurnResponse {
  return {
    id: turn.id,
    threadId: turn.threadId,
    userMessageId: turn.userMessageId,
    assistantMessageId: turn.assistantMessageId,
    status: turn.status,
    providerKind: turn.providerKind,
    model: turn.model,
    errorCode: turn.errorCode,
    errorMessage: turn.errorMessage,
    startedAt: turn.startedAt?.toISOString() ?? null,
    completedAt: turn.completedAt?.toISOString() ?? null,
    cancelledAt: turn.cancelledAt?.toISOString() ?? null,
    metadata: turn.metadata,
    createdAt: turn.createdAt.toISOString(),
    updatedAt: turn.updatedAt.toISOString(),
  };
}

/** Write a named SSE payload for the streaming turn protocol. */
export async function writeChatTurnEvent(
  stream: ChatTurnEventStream,
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  await stream.writeSSE({
    event,
    data: JSON.stringify(data),
  });
}
