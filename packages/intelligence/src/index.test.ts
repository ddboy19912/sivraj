import { describe, expect, it } from "vitest";
import {
  classifySpeaker,
  extractEntities,
  extractMemories,
  mapEntityTypeToGraphNodeType,
  normalizeEntityName,
  resolveSpeakerAttribution,
} from "./index.js";

describe("extractEntities", () => {
  it("extracts, validates, normalizes, and deduplicates source-backed entities", async () => {
    const result = await extractEntities(
      {
        twinId: "twin-id",
        sourceArtifactId: "artifact-id",
        memoryFragmentId: "fragment-id",
        sourceType: "pdf",
        title: "resume.pdf",
        content: "Full Stack Developer at Polytope Labs working on Hyperbridge with TypeScript.",
      },
      {
        generator: {
          async generateJson() {
            return {
              provider: "openai",
              model: "gpt-4o",
              json: {
                entities: [
                  {
                    name: "Polytope Labs",
                    type: "organization",
                    aliases: ["Hyperbridge"],
                    confidence: 0.95,
                    evidence: "Polytope Labs working on Hyperbridge",
                    metadata: { relationship: "employer", privateNote: ["not allowed"] },
                  },
                  {
                    name: "  polytope   labs ",
                    type: "organization",
                    aliases: [],
                    confidence: 0.5,
                    evidence: "Polytope Labs",
                    metadata: {},
                  },
                  {
                    name: "TypeScript",
                    type: "technology",
                    aliases: ["TS"],
                    confidence: 0.88,
                    evidence: "with TypeScript",
                    metadata: {},
                  },
                ],
              },
            };
          },
        },
      },
    );

    expect(result.entities).toHaveLength(2);
    expect(result.entities[0]).toMatchObject({
      name: "Polytope Labs",
      normalizedName: "polytope labs",
      type: "organization",
      graphNodeType: "organization",
      aliases: ["Hyperbridge"],
      confidence: 0.95,
      evidenceLength: "Polytope Labs working on Hyperbridge".length,
      metadata: { relationship: "employer" },
    });
    expect(result.entities[0]?.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.entities[1]).toMatchObject({
      name: "TypeScript",
      type: "technology",
      graphNodeType: "concept",
    });
    expect(result.metadata).toMatchObject({
      extractor: "llm_structured_entity_extractor",
      provider: "openai",
      model: "gpt-4o",
      returnedEntities: 3,
      acceptedEntities: 2,
    });
  });

  it("rejects malformed entities without throwing away valid ones", async () => {
    const result = await extractEntities(
      {
        twinId: "twin-id",
        sourceArtifactId: "artifact-id",
        memoryFragmentId: "fragment-id",
        sourceType: "note",
        content: "Met Ada at Lagos.",
      },
      {
        generator: {
          async generateJson() {
            return {
              provider: "openai",
              model: "gpt-4o",
              json: {
                entities: [
                  { name: "Ada", type: "person", confidence: 0.9, evidence: "Met Ada" },
                  { name: "No evidence", type: "person", confidence: 0.9 },
                  { name: "Bad type", type: "alien", confidence: 0.9, evidence: "Bad type" },
                ],
              },
            };
          },
        },
      },
    );

    expect(result.entities.map((entity) => entity.name)).toEqual(["Ada"]);
    expect(result.metadata.warnings).toContain("entity_missing_required_fields");
  });
});

describe("extractMemories", () => {
  it("extracts, validates, normalizes, and deduplicates source-backed candidate memories", async () => {
    const result = await extractMemories(
      {
        twinId: "twin-id",
        sourceArtifactId: "artifact-id",
        memoryFragmentId: "fragment-id",
        sourceType: "pdf",
        title: "resume.pdf",
        content: "Full Stack Developer at Polytope Labs working on Hyperbridge with TypeScript.",
      },
      {
        generator: {
          async generateJson() {
            return {
              provider: "openai",
              model: "gpt-4o",
              json: {
                memories: [
                  {
                    statement: "The user worked with Polytope Labs on Hyperbridge.",
                    type: "experience",
                    subject: "Polytope Labs",
                    confidence: 0.95,
                    evidence: "Polytope Labs working on Hyperbridge",
                    metadata: { category: "work_history", privateNote: ["not allowed"] },
                  },
                  {
                    statement: " the user worked with polytope labs on hyperbridge. ",
                    type: "experience",
                    subject: "Polytope Labs",
                    confidence: 0.5,
                    evidence: "Polytope Labs",
                    metadata: {},
                  },
                  {
                    statement: "The user uses TypeScript professionally.",
                    type: "fact",
                    subject: "TypeScript",
                    confidence: 0.86,
                    evidence: "with TypeScript",
                    metadata: {},
                  },
                ],
              },
            };
          },
        },
      },
    );

    expect(result.memories).toHaveLength(2);
    expect(result.memories[0]).toMatchObject({
      statement: "The user worked with Polytope Labs on Hyperbridge.",
      normalizedStatement: "the user worked with polytope labs on hyperbridge.",
      memoryType: "experience",
      subject: "Polytope Labs",
      confidence: 0.95,
      evidenceLength: "Polytope Labs working on Hyperbridge".length,
      metadata: { category: "work_history" },
    });
    expect(result.memories[0]?.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.memories[1]).toMatchObject({
      statement: "The user uses TypeScript professionally.",
      memoryType: "fact",
    });
    expect(result.metadata).toMatchObject({
      extractor: "llm_structured_memory_extractor",
      provider: "openai",
      model: "gpt-4o",
      returnedMemories: 3,
      acceptedMemories: 2,
    });
  });

  it("rejects malformed memories without throwing away valid ones", async () => {
    const result = await extractMemories(
      {
        twinId: "twin-id",
        sourceArtifactId: "artifact-id",
        memoryFragmentId: "fragment-id",
        sourceType: "note",
        content: "User prefers quiet focused work.",
      },
      {
        generator: {
          async generateJson() {
            return {
              provider: "openai",
              model: "gpt-4o",
              json: {
                memories: [
                  {
                    statement: "The user prefers quiet focused work.",
                    type: "preference",
                    evidence: "prefers quiet focused work",
                    confidence: 0.91,
                  },
                  { statement: "No evidence", type: "fact", confidence: 0.9 },
                  { statement: "Bad type", type: "mood", confidence: 0.9, evidence: "Bad type" },
                ],
              },
            };
          },
        },
      },
    );

    expect(result.memories.map((memory) => memory.statement)).toEqual([
      "The user prefers quiet focused work.",
    ]);
    expect(result.metadata.warnings).toContain("memory_missing_required_fields");
  });

  it("adds attribution policy instructions for speaker-attributed conversation text", async () => {
    let prompt = "";
    const result = await extractMemories(
      {
        twinId: "twin-id",
        sourceArtifactId: "artifact-id",
        memoryFragmentId: "fragment-id",
        sourceType: "chat_export",
        content: "self/Fortune: I prefer async work.\nother/Ada: I prefer async work too.",
      },
      {
        generator: {
          async generateJson(input) {
            prompt = input.prompt;
            return {
              provider: "openai",
              model: "gpt-4o",
              json: { memories: [] },
            };
          },
        },
      },
    );

    expect(prompt).toContain("self_claims_only_for_user_memory");
    expect(prompt).toContain("Only self/* first-person claims");
    expect(result.metadata).toMatchObject({
      attributionAware: true,
    });
  });

  it("keeps self-speaker memories and stores only safe attribution metadata", async () => {
    const result = await extractMemories(
      {
        twinId: "twin-id",
        sourceArtifactId: "artifact-id",
        memoryFragmentId: "fragment-id",
        sourceType: "chat_export",
        content: "self/Fortune: I prefer async work.",
      },
      {
        generator: {
          async generateJson() {
            return {
              provider: "openai",
              model: "gpt-4o",
              json: {
                memories: [
                  {
                    statement: "The user prefers async work.",
                    type: "preference",
                    confidence: 0.9,
                    evidence: "self/Fortune: I prefer async work.",
                  },
                ],
              },
            };
          },
        },
      },
    );

    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]?.metadata).toMatchObject({
      evidenceSpeakerRole: "self",
      speakerRole: "self",
      attributionPolicy: "self_claims_only_for_user_memory",
    });
    expect(JSON.stringify(result.memories[0]?.metadata)).not.toContain("I prefer async work");
  });

  it("rejects other-party first-person claims as user memories", async () => {
    const result = await extractMemories(
      {
        twinId: "twin-id",
        sourceArtifactId: "artifact-id",
        memoryFragmentId: "fragment-id",
        sourceType: "chat_export",
        content: "other/Ada: I prefer async work.",
      },
      {
        generator: {
          async generateJson() {
            return {
              provider: "openai",
              model: "gpt-4o",
              json: {
                memories: [
                  {
                    statement: "The user prefers async work.",
                    type: "preference",
                    confidence: 0.9,
                    evidence: "other/Ada: I prefer async work.",
                  },
                ],
              },
            };
          },
        },
      },
    );

    expect(result.memories).toHaveLength(0);
    expect(result.metadata.warnings).toContain("memory_rejected_other_party_self_claim");
  });

  it("downgrades unknown-speaker personal claims", async () => {
    const result = await extractMemories(
      {
        twinId: "twin-id",
        sourceArtifactId: "artifact-id",
        memoryFragmentId: "fragment-id",
        sourceType: "chat_export",
        content: "unknown/Client: I prefer async work.",
      },
      {
        generator: {
          async generateJson() {
            return {
              provider: "openai",
              model: "gpt-4o",
              json: {
                memories: [
                  {
                    statement: "The user prefers async work.",
                    type: "preference",
                    confidence: 0.9,
                    evidence: "unknown/Client: I prefer async work.",
                  },
                ],
              },
            };
          },
        },
      },
    );

    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]).toMatchObject({
      confidence: 0.35,
      metadata: {
        speakerRole: "unknown",
        attributionPolicy: "unknown_speaker_claim_downgraded",
      },
    });
    expect(result.metadata.warnings).toContain("memory_downgraded_unknown_speaker_claim");
  });

  it("uses conversation-specific extraction policy for voice conversation transcripts", async () => {
    let prompt = "";
    const result = await extractMemories(
      {
        twinId: "twin-id",
        sourceArtifactId: "artifact-id",
        memoryFragmentId: "fragment-id",
        sourceType: "voice_conversation",
        content: "I decided to position Sivraj around owned memory. Remind me to write the demo script.",
      },
      {
        generator: {
          async generateJson(input) {
            prompt = input.prompt;
            return {
              provider: "openai",
              model: "gpt-4o",
              json: {
                memories: [
                  {
                    statement: "The user decided to position Sivraj around owned memory.",
                    type: "decision",
                    subject: "Sivraj positioning",
                    confidence: 0.9,
                    evidence: "I decided to position Sivraj around owned memory",
                    metadata: {
                      conversationSignal: "decision",
                      requiresApproval: true,
                    },
                  },
                  {
                    statement: "The user needs to write the Sivraj demo script.",
                    type: "commitment",
                    subject: "Sivraj demo script",
                    confidence: 0.82,
                    evidence: "Remind me to write the demo script",
                    metadata: {
                      conversationSignal: "follow_up",
                      requiresApproval: true,
                    },
                  },
                ],
              },
            };
          },
        },
      },
    );

    expect(prompt).toContain("extract_conversation_candidate_memories");
    expect(prompt).toContain("conversation transcript");
    expect(prompt).toContain("metadata.requiresApproval");
    expect(result.memories).toHaveLength(2);
    expect(result.metadata).toMatchObject({
      sourceKind: "conversation",
      conversationUnderstanding: {
        enabled: true,
        sourceType: "voice_conversation",
        decisionCount: 1,
        commitmentCount: 1,
        followUpCount: 1,
      },
    });
  });
});

describe("entity helpers", () => {
  it("normalizes names and maps rich entity types to graph node types", () => {
    expect(normalizeEntityName("  Polytope   Labs ")).toBe("polytope labs");
    expect(mapEntityTypeToGraphNodeType("technology")).toBe("concept");
    expect(mapEntityTypeToGraphNodeType("document")).toBe("artifact");
  });
});

describe("classifySpeaker", () => {
  const profile = {
    displayName: "Fortune Ogunsusi",
    aliases: ["Fortune", "DDBoy"],
    emails: ["ddboy19912@gmail.com"],
    phones: ["+234 816 934 2193"],
    handles: {
      github: ["ddboy19912"],
      x: ["@fortune"],
    },
    knownOtherSpeakers: ["Ada Lovelace"],
  };

  it("classifies the user from names, aliases, emails, phones, and handles", () => {
    expect(classifySpeaker("Fortune Ogunsusi", profile)).toMatchObject({
      role: "self",
      method: "exact_name",
    });
    expect(classifySpeaker("DDBoy", profile)).toMatchObject({
      role: "self",
      method: "alias",
    });
    expect(classifySpeaker("ddboy19912@gmail.com", profile)).toMatchObject({
      role: "self",
      method: "email",
    });
    expect(classifySpeaker("+2348169342193", profile)).toMatchObject({
      role: "self",
      method: "phone",
    });
    expect(classifySpeaker("@ddboy19912", profile)).toMatchObject({
      role: "self",
      method: "handle",
    });
  });

  it("keeps known others, system labels, and unknown speakers distinct", () => {
    expect(classifySpeaker("Ada Lovelace", profile)).toMatchObject({
      role: "other",
      method: "known_other",
    });
    expect(classifySpeaker("Slackbot", profile)).toMatchObject({
      role: "system",
      method: "system_label",
    });
    expect(classifySpeaker("Client Team", profile)).toMatchObject({
      role: "unknown",
      method: "unknown",
    });
  });

  it("prefers source-specific mappings over profile inference", () => {
    expect(resolveSpeakerAttribution({
      label: "Fortune",
      profile,
      mappings: [
        {
          sourceSpeaker: "Fortune",
          role: "other",
          mappedName: "Another Fortune",
        },
      ],
    })).toMatchObject({
      role: "other",
      method: "source_mapping",
      confidence: 1,
      normalizedLabel: "another fortune",
    });

    expect(resolveSpeakerAttribution({
      label: "Unknown User",
      sourceSpeakerId: "U123",
      profile,
      mappings: [
        {
          sourceSpeaker: "Ada",
          sourceSpeakerId: "U123",
          role: "self",
          mappedName: "Fortune Ogunsusi",
        },
      ],
    })).toMatchObject({
      role: "self",
      method: "source_mapping",
      normalizedLabel: "fortune ogunsusi",
    });
  });
});
