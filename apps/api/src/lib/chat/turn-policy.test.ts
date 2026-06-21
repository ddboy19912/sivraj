import { describe, expect, it } from "vitest";
import type { CoreCommsContext } from "./turn-types.js";
import {
  resolveCoreCommsAnswer,
  resolveCoreCommsAnswerTarget,
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
