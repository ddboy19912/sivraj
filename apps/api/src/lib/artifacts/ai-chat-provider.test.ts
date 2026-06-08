import { describe, expect, it } from "vitest";
import {
  detectAiChatProviderFromFilename,
  readAiChatProvider,
} from "./ai-chat-provider.js";

describe("artifact ai chat provider helpers", () => {
  it("normalizes explicit provider strings", () => {
    expect(readAiChatProvider("OpenAI")).toBe("chatgpt");
    expect(readAiChatProvider("anthropic")).toBe("claude");
    expect(readAiChatProvider("chat")).toBe("generic_chat");
  });

  it("detects providers from filenames", () => {
    expect(detectAiChatProviderFromFilename("chatgpt-export.json")).toBe("chatgpt");
    expect(detectAiChatProviderFromFilename("claude-history.json")).toBe("claude");
  });
});
