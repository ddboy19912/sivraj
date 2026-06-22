import { describe, expect, it, vi } from "vitest";
import {
  completedChatTurnLearningSkipReason,
  enqueueCompletedChatTurnLearning,
} from "./chat-learning-queue.js";

describe("completed chat turn memory learning", () => {
  it("skips chat-export learning for assistant-derived memory answers", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const db = {
      insert: vi.fn(() => ({ values })),
    };
    const privateMemoryStorage = {
      storePrivateMemory: vi.fn(),
    };

    await enqueueCompletedChatTurnLearning({
      db: db as any,
      privateMemoryStorage: privateMemoryStorage as any,
      artifactProcessingQueue: undefined,
      gate: {
        twinId: "twin-1",
        thread: {
          id: "thread-1",
        },
      } as any,
      userMessage: "What is my occupation?",
      assistantMessage: "You are a Full Stack Developer.",
      userMessageId: "user-message-1",
      assistantMessageId: "assistant-message-1",
      turnId: "turn-1",
      model: "model-1",
      providerKind: "openrouter",
      memoryIntent: "auto",
      retrievedMemoryCount: 1,
      contextResolution: {
        intent: "memory_qa",
        retrieval: "hot_memory",
        answerTarget: "memory",
        memoryWrite: "skip",
      },
    });

    expect(privateMemoryStorage.storePrivateMemory).not.toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "chat.memory_learning.skipped",
      metadata: expect.objectContaining({
        reason: "assistant_derived_memory_answer",
        retrievedMemoryCount: 1,
      }),
    }));
  });

  it("does not skip user-authored memory writes just because retrieval ran", () => {
    expect(completedChatTurnLearningSkipReason({
      retrievedMemoryCount: 1,
      contextResolution: {
        intent: "general_chat",
        retrieval: "hot_memory",
        answerTarget: "none",
        memoryWrite: "extract",
      },
    })).toBeNull();
  });

  it("skips memory-answer turns even when no memory was retrieved", () => {
    expect(completedChatTurnLearningSkipReason({
      retrievedMemoryCount: 0,
      contextResolution: {
        intent: "memory_qa",
        retrieval: "hot_memory",
        answerTarget: "memory",
        memoryWrite: "skip",
      },
    })).toBe("assistant_derived_memory_answer");
  });
});
