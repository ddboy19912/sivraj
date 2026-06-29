import { describe, expect, it } from "vitest";
import {
  isExplicitTelegramCaptureText,
  readTelegramRememberCommandText,
  routeTelegramPlainText,
} from "./text-intent.js";

describe("Telegram text intent routing", () => {
  it("routes natural questions to ask mode without requiring question marks", () => {
    expect(routeTelegramPlainText("Can you tell me about the Sivraj_Demo_Launch_Notes.pdf file")).toMatchObject({
      kind: "ask",
      reason: "request_starter",
    });
    expect(routeTelegramPlainText("Tell me what you know about my launch notes")).toMatchObject({
      kind: "ask",
      reason: "memory_lookup",
    });
    expect(routeTelegramPlainText("What is my occupation")).toMatchObject({
      kind: "ask",
      reason: "question_starter",
    });
  });

  it("routes explicit memory phrases to capture even when phrased politely", () => {
    expect(routeTelegramPlainText("Remember that I prefer morning investor calls on Tuesdays.")).toEqual({
      kind: "capture",
      reason: "explicit_capture",
    });
    expect(routeTelegramPlainText("Can you remember that I prefer morning investor calls on Tuesdays.")).toEqual({
      kind: "capture",
      reason: "explicit_capture",
    });
    expect(routeTelegramPlainText("Please save this note: the launch call is at 9")).toEqual({
      kind: "capture",
      reason: "explicit_capture",
    });
  });

  it("keeps declarative facts in capture mode", () => {
    expect(routeTelegramPlainText("The launch call is at 9.")).toEqual({
      kind: "capture",
      reason: "declarative",
    });
  });

  it("does not treat memory lookup phrasing as capture", () => {
    expect(isExplicitTelegramCaptureText("Remember what I said about investor calls")).toBe(false);
    expect(routeTelegramPlainText("Remember what I said about investor calls")).toMatchObject({
      kind: "ask",
      reason: "memory_lookup",
    });
  });

  it("extracts explicit remember command text", () => {
    expect(readTelegramRememberCommandText("/remember I am a lawyer")).toEqual({
      text: "I am a lawyer",
    });
    expect(readTelegramRememberCommandText("/save")).toEqual({ text: null });
    expect(readTelegramRememberCommandText("/ask What is my occupation")).toBeNull();
  });
});
