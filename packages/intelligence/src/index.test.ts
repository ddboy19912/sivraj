import { describe, expect, it } from "vitest";
import {
  mapEntityTypeToGraphNodeType,
  normalizeEntityName,
} from "./index.js";
import {
  runExtractEntitiesDeduplicatesSourceBacked,
  runExtractEntitiesRejectsMalformed,
  runExtractMemoriesDeduplicatesSourceBacked,
  runExtractMemoriesRejectsMalformed,
  runExtractMemoriesRejectsUnsupportedEvidence,
  runExtractMemoriesKeepsSourceBackedCurrentTruth,
  runExtractMemoriesAttributionPolicy,
  runExtractMemoriesKeepsSelfSpeaker,
  runExtractMemoriesRejectsOtherPartyClaims,
  runExtractMemoriesDowngradesUnknownSpeaker,
  runExtractMemoriesVoiceConversationPolicy,
  runClassifySpeakerUserIdentity,
  runClassifySpeakerDistinctRoles,
  runClassifySpeakerSourceMappings,
} from "./index.test-scenarios.js";

describe("entity helpers", () => {
  it("normalizes names and maps rich entity types to graph node types", () => {
    expect(normalizeEntityName("  Polytope   Labs ")).toBe("polytope labs");
    expect(mapEntityTypeToGraphNodeType("technology")).toBe("concept");
    expect(mapEntityTypeToGraphNodeType("document")).toBe("artifact");
  });
});

describe("extractEntities", () => {
  it("extracts, validates, normalizes, and deduplicates source-backed entities", () => runExtractEntitiesDeduplicatesSourceBacked());
});

describe("extractEntities", () => {
  it("rejects malformed entities without throwing away valid ones", () => runExtractEntitiesRejectsMalformed());
});

describe("extractMemories", () => {
  it("extracts, validates, normalizes, and deduplicates source-backed candidate memories", () => runExtractMemoriesDeduplicatesSourceBacked());
});

describe("extractMemories", () => {
  it("rejects malformed memories without throwing away valid ones", () => runExtractMemoriesRejectsMalformed());
});

describe("extractMemories", () => {
  it("rejects memories whose evidence is not present in the source text", () => runExtractMemoriesRejectsUnsupportedEvidence());
});

describe("extractMemories", () => {
  it("keeps source-backed current truth metadata for direct self claims", () => runExtractMemoriesKeepsSourceBackedCurrentTruth());
});

describe("extractMemories", () => {
  it("adds attribution policy instructions for speaker-attributed conversation text", () => runExtractMemoriesAttributionPolicy());
});

describe("extractMemories", () => {
  it("keeps self-speaker memories and stores only safe attribution metadata", () => runExtractMemoriesKeepsSelfSpeaker());
});

describe("extractMemories", () => {
  it("rejects other-party first-person claims as user memories", () => runExtractMemoriesRejectsOtherPartyClaims());
});

describe("extractMemories", () => {
  it("downgrades unknown-speaker personal claims", () => runExtractMemoriesDowngradesUnknownSpeaker());
});

describe("extractMemories", () => {
  it("uses conversation-specific extraction policy for voice conversation transcripts", () => runExtractMemoriesVoiceConversationPolicy());
});

describe("classifySpeaker", () => {
  it("classifies the user from names, aliases, emails, phones, and handles", () => runClassifySpeakerUserIdentity());
});

describe("classifySpeaker", () => {
  it("keeps known others, system labels, and unknown speakers distinct", () => runClassifySpeakerDistinctRoles());
});

describe("classifySpeaker", () => {
  it("prefers source-specific mappings over profile inference", () => runClassifySpeakerSourceMappings());
});
