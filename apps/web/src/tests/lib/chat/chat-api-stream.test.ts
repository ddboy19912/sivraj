import { afterEach, describe, expect, it, vi } from "vitest";
import {
  streamArtifactStatus,
  streamChatTurn,
  type ArtifactStatusEvent,
  type ChatTurnStreamEvent,
} from "@/lib/chat/chat-api";
import type { Session } from "@/lib/session";

describe("streamChatTurn", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses Sivraj chat turn SSE events in order", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        [
          "event: turn.created",
          `data: ${JSON.stringify({
            turn: turnPayload("turn-1", "queued"),
            userMessage: messagePayload("msg-user", "user", "Hello"),
            assistantMessage: messagePayload("msg-assistant", "assistant", "", "pending"),
          })}`,
          "",
          "event: context.ready",
          `data: ${JSON.stringify({
            turnId: "turn-1",
            memoryCount: 1,
            citations: [{
              id: "memory-1",
              label: "MEM_1",
              sourceArtifactId: "artifact-1",
              score: 0.8,
              matchedTerms: ["hello"],
            }],
            tokenContextSaved: 12,
            retrievalStatus: {
              state: "degraded",
              target: "memory",
              reason: "timeout",
              message: "I couldn’t retrieve that memory right now, so I can’t answer it safely.",
            },
          })}`,
          "",
          "event: assistant.delta",
          `data: ${JSON.stringify({
            turnId: "turn-1",
            assistantMessageId: "msg-assistant",
            delta: "Hi",
          })}`,
          "",
          "event: assistant.completed",
          `data: ${JSON.stringify({
            turnId: "turn-1",
            assistantMessage: messagePayload("msg-assistant", "assistant", "Hi", "completed"),
            context: {
              citations: [],
              memoryCount: 1,
              tokenContextSaved: 12,
              policy: { rawArtifactsIncluded: false, memory: "bounded" },
            },
          })}`,
          "",
        ].join("\n"),
        { headers: { "content-type": "text/event-stream" } },
      ),
    );
    const events: ChatTurnStreamEvent[] = [];

    await streamChatTurn({
      threadId: "thread-1",
      content: "Hello",
      memoryIntent: "remember",
      session: createSession(),
      onSessionRefreshed: vi.fn(),
      onEvent: (event) => events.push(event),
    });

    expect(events.map((event) => event.type)).toEqual([
      "turn.created",
      "context.ready",
      "assistant.delta",
      "assistant.completed",
    ]);
    expect(events[2]).toMatchObject({
      type: "assistant.delta",
      delta: "Hi",
    });
    expect(events[1]).toMatchObject({
      type: "context.ready",
      retrievalStatus: {
        state: "degraded",
        target: "memory",
        reason: "timeout",
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/v1/twins/twin-1/chat/threads/thread-1/turns",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          accept: "text/event-stream",
          authorization: "Bearer token",
        }),
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      content: "Hello",
      memoryIntent: "remember",
      retryAttempt: 0,
      surface: "web_chat",
    });
  });

  it("marks voice chat streams with the voice surface", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { headers: { "content-type": "text/event-stream" } }),
    );

    await streamChatTurn({
      threadId: "thread-1",
      content: "Hello by voice",
      memoryIntent: "auto",
      surface: "voice_chat",
      session: createSession(),
      onSessionRefreshed: vi.fn(),
      onEvent: vi.fn(),
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      content: "Hello by voice",
      memoryIntent: "auto",
      retryAttempt: 0,
      surface: "voice_chat",
    });
  });

  it("sends the retry attempt with chat streams", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { headers: { "content-type": "text/event-stream" } }),
    );

    await streamChatTurn({
      threadId: "thread-1",
      content: "Try again",
      memoryIntent: "auto",
      retryAttempt: 2,
      session: createSession(),
      onSessionRefreshed: vi.fn(),
      onEvent: vi.fn(),
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      content: "Try again",
      memoryIntent: "auto",
      retryAttempt: 2,
      surface: "web_chat",
    });
  });
});

describe("streamArtifactStatus", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses artifact status SSE events in order", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        [
          "event: artifact.status",
          `data: ${JSON.stringify({
            artifactId: "artifact-1",
            twinId: "twin-1",
            sourceType: "pdf",
            status: "processing",
            intelligenceStatus: "queued",
            reason: null,
            occurredAt: new Date().toISOString(),
          })}`,
          "",
          "event: artifact.status",
          `data: ${JSON.stringify({
            artifactId: "artifact-1",
            twinId: "twin-1",
            sourceType: "pdf",
            status: "completed",
            intelligenceStatus: "completed",
            reason: null,
            occurredAt: new Date().toISOString(),
          })}`,
          "",
        ].join("\n"),
        { headers: { "content-type": "text/event-stream" } },
      ),
    );
    const events: ArtifactStatusEvent[] = [];

    await streamArtifactStatus({
      artifactId: "artifact-1",
      session: createSession(),
      onSessionRefreshed: vi.fn(),
      onEvent: (event) => events.push(event),
    });

    expect(events.map((event) => event.status)).toEqual(["processing", "completed"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/v1/twins/twin-1/artifacts/artifact-1/events",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          accept: "text/event-stream",
          authorization: "Bearer token",
        }),
      }),
    );
  });
});

function createSession(): Session {
  return {
    token: "token",
    refreshToken: "refresh",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    twinId: "twin-1",
    walletAddress: "0xabc",
  };
}

function turnPayload(
  id: string,
  status: "queued" | "completed",
) {
  return {
    id,
    threadId: "thread-1",
    userMessageId: "msg-user",
    assistantMessageId: "msg-assistant",
    status,
    providerKind: null,
    model: null,
    errorCode: null,
    errorMessage: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    cancelledAt: null,
    metadata: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function messagePayload(
  id: string,
  role: "user" | "assistant",
  content: string,
  status: "pending" | "completed" = "completed",
) {
  return {
    id,
    threadId: "thread-1",
    turnId: "turn-1",
    role,
    status,
    content,
    providerKind: null,
    model: null,
    memoryFragmentIds: [],
    citations: null,
    usage: null,
    metadata: null,
    createdAt: new Date().toISOString(),
  };
}
