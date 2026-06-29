import { describe, expect, it } from "vitest";
import type { ChatMessageRow } from "../../types/chat.types.js";
import type { ConversationContextResolution } from "../chat/turn-types.js";
import { coerceTelegramAskDocumentContext } from "./ask-context.js";

describe("Telegram ask context resolution", () => {
  it("coerces explicit private PDF asks into document retrieval", () => {
    const contextResolution = coerceTelegramAskDocumentContext({
      currentMessage: "Do you have access to my sivraj launch notes pdf ?",
      recentMessages: [],
      contextResolution: memoryResolution("Do you have access to my sivraj launch notes pdf ?"),
    });

    expect(contextResolution).toMatchObject({
      intent: "document_qa",
      answerTarget: "document",
      retrieval: "document",
      memoryWrite: "skip",
      memoryRequest: { kind: "none" },
    });
  });

  it("resolves Telegram document pronoun follow-ups to the recent document title", () => {
    const contextResolution = coerceTelegramAskDocumentContext({
      currentMessage: "can you summarize it for me",
      recentMessages: [
        chatMessage({
          id: "assistant-1",
          role: "assistant",
          content: 'Yes, I have access to your document titled "Sivraj_Demo_Launch_Notes.pdf".',
        }),
      ],
      contextResolution: memoryResolution("can you summarize it for me"),
    });

    expect(contextResolution).toMatchObject({
      standaloneQuery: "Summarize Sivraj_Demo_Launch_Notes.pdf.",
      intent: "document_qa",
      answerTarget: "document",
      retrieval: "document",
      memoryRequest: { kind: "none" },
    });
  });

  it("does not coerce ordinary personal-memory questions", () => {
    const original = memoryResolution("What is my dog's name?");

    expect(coerceTelegramAskDocumentContext({
      currentMessage: "What is my dog's name?",
      recentMessages: [
        chatMessage({
          id: "assistant-1",
          role: "assistant",
          content: 'Yes, I have access to your document titled "Sivraj_Demo_Launch_Notes.pdf".',
        }),
      ],
      contextResolution: original,
    })).toBe(original);
  });
});

function memoryResolution(standaloneQuery: string): ConversationContextResolution {
  return {
    source: "fallback",
    standaloneQuery,
    intent: "memory_qa",
    turnKind: "question",
    answerTarget: "memory",
    memoryWrite: "skip",
    retrieval: "hot_memory",
    confidence: 1,
    referencedMessageIds: [],
    memoryRequest: {
      kind: "specific_fact",
      query: standaloneQuery,
      scope: "profile",
      searchTerms: [],
    },
    reason: "telegram_ask_command",
  };
}

function chatMessage(input: {
  id: string;
  role: "user" | "assistant";
  content: string;
}): ChatMessageRow {
  return {
    id: input.id,
    twinId: "twin-1",
    threadId: "thread-1",
    turnId: null,
    role: input.role,
    status: "completed",
    content: input.content,
    providerKind: null,
    model: null,
    memoryFragmentIds: [],
    citations: null,
    usage: null,
    metadata: {},
    createdAt: new Date("2026-06-29T20:39:00.000Z"),
  };
}
