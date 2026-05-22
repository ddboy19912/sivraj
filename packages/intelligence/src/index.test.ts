import { describe, expect, it } from "vitest";
import {
  extractEntities,
  extractMemories,
  mapEntityTypeToGraphNodeType,
  normalizeEntityName,
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
});

describe("entity helpers", () => {
  it("normalizes names and maps rich entity types to graph node types", () => {
    expect(normalizeEntityName("  Polytope   Labs ")).toBe("polytope labs");
    expect(mapEntityTypeToGraphNodeType("technology")).toBe("concept");
    expect(mapEntityTypeToGraphNodeType("document")).toBe("artifact");
  });
});
