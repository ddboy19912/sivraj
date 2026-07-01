import { describe, expect, it } from "vitest";
import {
  buildArtifactStorageMetadata,
  detectExplicitAiChatProvider,
  readArtifactUploadFields,
  readSupportedSourceType,
  validateArtifactUploadFields,
} from "./upload-input.js";

describe("artifact upload input helpers", () => {
  it("reads supported source types", () => {
    expect(readSupportedSourceType("note")).toBe("note");
    expect(readSupportedSourceType("url")).toBe("url");
    expect(readSupportedSourceType("bogus")).toBeNull();
  });

  it("validates upload fields", () => {
    expect(validateArtifactUploadFields({
      sourceType: null,
      rawSourceType: "bogus",
      encryptedPayload: null,
      content: "hello",
    })).toMatchObject({ error: { body: { error: "unsupported_source_type" } } });
  });

  it("builds storage metadata and reads upload fields", () => {
    expect(buildArtifactStorageMetadata({
      safeUploadMetadata: { fileName: "export.json" },
      aiChatImportMetadata: { aiChatProvider: "chatgpt" },
      aiChatImportFingerprint: { version: 1, conversationCount: 1, messageCount: 2 },
      encryptedPayload: null,
    })).toMatchObject({
      fileName: "export.json",
      aiChatProvider: "chatgpt",
      aiChatMessageCount: 2,
    });

    expect(readArtifactUploadFields({
      sourceType: "note",
      content: "hello",
      contentSha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    })).toMatchObject({
      content: "hello",
      contentSha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      sourceType: "note",
    });

    expect(detectExplicitAiChatProvider({ aiChatProvider: "claude" })).toBe("claude");
  });
});
