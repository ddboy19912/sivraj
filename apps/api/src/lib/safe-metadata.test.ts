import { describe, expect, it } from "vitest";
import {
  metadataContainsPlaintextLikeFields,
  readIntelligenceMetadata,
  readIntelligenceStatus,
  readProcessingMetadata,
  readProcessingReason,
} from "./safe-metadata.js";

describe("safe metadata helpers", () => {
  it("detects plaintext-like metadata fields", () => {
    expect(metadataContainsPlaintextLikeFields({ content: "secret" })).toBe(true);
    expect(metadataContainsPlaintextLikeFields({ title: "My note" })).toBe(true);
    expect(metadataContainsPlaintextLikeFields({ fileName: "notes.md" })).toBe(true);
  });

  it("reads processing and intelligence metadata", () => {
    const metadata = {
      processing: {
        reason: "timeout",
        documentIndex: {
          status: "processing",
          phase: "embedding_chunks",
          embeddedChunks: 12,
          chunkCount: 40,
          text: "private document text",
        },
        intelligence: { status: "completed", model: "gpt" },
      },
    };

    expect(readProcessingMetadata(metadata)).toMatchObject({
      reason: "timeout",
      documentIndex: {
        status: "processing",
        phase: "embedding_chunks",
        embeddedChunks: 12,
        chunkCount: 40,
      },
    });
    expect(readProcessingMetadata(metadata).documentIndex).not.toMatchObject({
      text: expect.any(String),
    });
    expect(readProcessingReason(metadata)).toBe("timeout");
    expect(readIntelligenceStatus(metadata)).toBe("completed");
    expect(readIntelligenceMetadata(metadata)).toMatchObject({
      status: "completed",
      model: "gpt",
    });
  });
});
