import { describe, expect, it } from "vitest";
import type { CoreCommsContext } from "./turn-types.js";
import {
  resolveCoreCommsAnswer,
  resolveCoreCommsAnswerTarget,
  shouldFastReplyMissingMemory,
} from "./turn-policy.js";

describe("resolveCoreCommsAnswerTarget", () => {
  it("resolves user name questions from display name context", () => {
    expect(resolveCoreCommsAnswerTarget(
      "What is my name?",
      coreCommsContext({ displayName: "Fortune" }),
    )).toBe("user_name");
  });

  it("resolves planner-rewritten user name questions from display name context", () => {
    expect(resolveCoreCommsAnswerTarget(
      "What is the user's name?",
      coreCommsContext({ displayName: "Fortune" }),
    )).toBe("user_name");
  });

  it("resolves assistant name questions from assistant name context", () => {
    expect(resolveCoreCommsAnswerTarget(
      "What is your name?",
      coreCommsContext({ assistantName: "Hulk" }),
    )).toBe("assistant_name");
  });

  it("does not claim an answer when the needed core comms fact is absent", () => {
    expect(resolveCoreCommsAnswerTarget(
      "What is my name?",
      coreCommsContext({ displayName: null }),
    )).toBeNull();
  });
});

describe("resolveCoreCommsAnswer", () => {
  it("answers the user's name directly from core comms", () => {
    expect(resolveCoreCommsAnswer(
      "What is my name?",
      coreCommsContext({ displayName: "Fortune" }),
    )).toEqual({
      target: "user_name",
      content: "Your name is Fortune.",
    });
  });

  it("answers the assistant's name directly from core comms", () => {
    expect(resolveCoreCommsAnswer(
      "What is your name?",
      coreCommsContext({ assistantName: "Hulk" }),
    )).toEqual({
      target: "assistant_name",
      content: "My name is Hulk.",
    });
  });
});

describe("shouldFastReplyMissingMemory", () => {
  it("does not fast-reply missing memory when core comms can answer the user's name", () => {
    expect(shouldFastReplyMissingMemory({
      query: "What is my name?",
      contextResolution: {
        retrieval: "hot_memory",
        answerTarget: "memory",
        intent: "memory_qa",
      },
      coreCommsContext: coreCommsContext({ displayName: "Fortune" }),
      memoryContext: { results: [] },
    })).toBe(false);
  });

  it("keeps the missing-memory fallback when no core comms fact can answer", () => {
    expect(shouldFastReplyMissingMemory({
      query: "What did I tell you about the launch checklist?",
      contextResolution: {
        retrieval: "hot_memory",
        answerTarget: "memory",
        intent: "memory_qa",
      },
      coreCommsContext: coreCommsContext({ displayName: "Fortune" }),
      memoryContext: { results: [] },
    })).toBe(true);
  });
});

function coreCommsContext(
  overrides: Partial<CoreCommsContext> = {},
): CoreCommsContext {
  return {
    assistantName: "Hulk",
    displayName: "Fortune",
    aliases: [],
    emails: [],
    phones: [],
    handles: {},
    ...overrides,
  };
}
