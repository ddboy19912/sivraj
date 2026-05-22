import type { StructuredGenerator } from "@sivraj/llm";
import { createHash } from "node:crypto";

export const ENTITY_TYPES = [
  "person",
  "organization",
  "project",
  "product",
  "place",
  "role",
  "technology",
  "topic",
  "document",
  "event",
  "unknown",
] as const;

export type EntityType = typeof ENTITY_TYPES[number];

export type GraphNodeType =
  | "person"
  | "organization"
  | "project"
  | "concept"
  | "event"
  | "artifact"
  | "goal"
  | "decision"
  | "topic"
  | "other";

export type ExtractedEntity = {
  name: string;
  normalizedName: string;
  type: EntityType;
  graphNodeType: GraphNodeType;
  aliases: string[];
  confidence: number;
  evidenceHash: string;
  evidenceLength: number;
  metadata: Record<string, unknown>;
};

export type EntityExtractionInput = {
  twinId: string;
  sourceArtifactId: string;
  memoryFragmentId: string;
  sourceType: string;
  content: string;
  title?: string | null;
  maxEntities?: number;
};

export type EntityExtractionResult = {
  entities: ExtractedEntity[];
  metadata: {
    extractor: "llm_structured_entity_extractor";
    provider: string;
    model: string;
    originalLength: number;
    returnedEntities: number;
    acceptedEntities: number;
    warnings: string[];
  };
};

export const MEMORY_TYPES = [
  "fact",
  "preference",
  "goal",
  "decision",
  "commitment",
  "experience",
  "project_update",
  "relationship",
  "other",
] as const;

export type MemoryType = typeof MEMORY_TYPES[number];

export type ExtractedMemory = {
  statement: string;
  normalizedStatement: string;
  memoryType: MemoryType;
  subject: string | null;
  confidence: number;
  evidenceHash: string;
  evidenceLength: number;
  metadata: Record<string, unknown>;
};

export type MemoryExtractionInput = {
  twinId: string;
  sourceArtifactId: string;
  memoryFragmentId: string;
  sourceType: string;
  content: string;
  title?: string | null;
  maxMemories?: number;
};

export type MemoryExtractionResult = {
  memories: ExtractedMemory[];
  metadata: {
    extractor: "llm_structured_memory_extractor";
    provider: string;
    model: string;
    originalLength: number;
    returnedMemories: number;
    acceptedMemories: number;
    warnings: string[];
  };
};

export async function extractEntities(input: EntityExtractionInput, params: {
  generator: StructuredGenerator;
}): Promise<EntityExtractionResult> {
  const maxEntities = clampMaxEntities(input.maxEntities);
  const generation = await params.generator.generateJson({
    system: ENTITY_EXTRACTION_SYSTEM_PROMPT,
    prompt: buildEntityExtractionPrompt(input, maxEntities),
    temperature: 0,
  });
  const { entities, warnings } = parseEntityResponse(generation.json, maxEntities);

  return {
    entities,
    metadata: {
      extractor: "llm_structured_entity_extractor",
      provider: generation.provider,
      model: generation.model,
      originalLength: input.content.length,
      returnedEntities: readReturnedEntityCount(generation.json),
      acceptedEntities: entities.length,
      warnings,
    },
  };
}

export async function extractMemories(input: MemoryExtractionInput, params: {
  generator: StructuredGenerator;
}): Promise<MemoryExtractionResult> {
  const maxMemories = clampMaxMemories(input.maxMemories);
  const generation = await params.generator.generateJson({
    system: MEMORY_EXTRACTION_SYSTEM_PROMPT,
    prompt: buildMemoryExtractionPrompt(input, maxMemories),
    temperature: 0,
  });
  const { memories, warnings } = parseMemoryResponse(generation.json, maxMemories);

  return {
    memories,
    metadata: {
      extractor: "llm_structured_memory_extractor",
      provider: generation.provider,
      model: generation.model,
      originalLength: input.content.length,
      returnedMemories: readReturnedMemoryCount(generation.json),
      acceptedMemories: memories.length,
      warnings,
    },
  };
}

export function mapEntityTypeToGraphNodeType(type: EntityType): GraphNodeType {
  if (type === "person" || type === "organization" || type === "project" || type === "event" || type === "topic") {
    return type;
  }

  if (type === "document") {
    return "artifact";
  }

  if (type === "unknown") {
    return "other";
  }

  return "concept";
}

export function normalizeEntityName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const ENTITY_EXTRACTION_SYSTEM_PROMPT = `You are Sivraj's private entity extraction engine.
Extract source-backed entities from the user's memory text.
Return only valid JSON.
Do not infer entities that are not supported by explicit text evidence.
Do not summarize the document.
Do not include private evidence text beyond the short evidence field requested.
Prefer precise professional and life entities over generic nouns.`;

const MEMORY_EXTRACTION_SYSTEM_PROMPT = `You are Sivraj's private memory extraction engine.
Extract source-backed candidate memories from the user's memory text.
Return only valid JSON.
Do not infer facts, preferences, goals, decisions, or commitments that are not supported by explicit text evidence.
Write each memory as a concise first-person-neutral statement about the user or their world.
Do not produce generic summaries.
Do not include private evidence text beyond the short evidence field requested.`;

function buildEntityExtractionPrompt(input: EntityExtractionInput, maxEntities: number): string {
  return JSON.stringify({
    task: "extract_entities",
    instructions: [
      "Return a JSON object with an entities array.",
      "Each entity must include name, type, aliases, confidence, evidence, and metadata.",
      `Use at most ${maxEntities} high-signal entities.`,
      "Allowed types: person, organization, project, product, place, role, technology, topic, document, event, unknown.",
      "Evidence must be a short exact snippet from the source text.",
      "Never invent entities without evidence.",
    ],
    source: {
      sourceType: input.sourceType,
      title: input.title ?? null,
      content: truncateForExtraction(input.content),
    },
    outputShape: {
      entities: [
        {
          name: "Polytope Labs",
          type: "organization",
          aliases: ["Hyperbridge"],
          confidence: 0.92,
          evidence: "Full Stack Developer, Polytope Labs (Hyperbridge)",
          metadata: {
            relationship: "employer/client",
          },
        },
      ],
    },
  });
}

function buildMemoryExtractionPrompt(input: MemoryExtractionInput, maxMemories: number): string {
  return JSON.stringify({
    task: "extract_candidate_memories",
    instructions: [
      "Return a JSON object with a memories array.",
      "Each memory must include statement, type, subject, confidence, evidence, and metadata.",
      `Use at most ${maxMemories} high-signal candidate memories.`,
      "Allowed types: fact, preference, goal, decision, commitment, experience, project_update, relationship, other.",
      "The statement must be source-backed and useful to the user's future Twin.",
      "Evidence must be a short exact snippet from the source text.",
      "Do not include generic topics, filler, or claims without evidence.",
      "Do not treat every sentence as a memory; prefer durable facts, goals, preferences, decisions, commitments, relationships, and project history.",
    ],
    source: {
      sourceType: input.sourceType,
      title: input.title ?? null,
      content: truncateForExtraction(input.content),
    },
    outputShape: {
      memories: [
        {
          statement: "The user worked with Polytope Labs on Hyperbridge.",
          type: "experience",
          subject: "Polytope Labs",
          confidence: 0.92,
          evidence: "Full Stack Developer, Polytope Labs (Hyperbridge)",
          metadata: {
            category: "work_history",
          },
        },
      ],
    },
  });
}

function parseEntityResponse(value: unknown, maxEntities: number): {
  entities: ExtractedEntity[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const root = asRecord(value);
  const rawEntities = Array.isArray(root["entities"]) ? root["entities"] : [];
  const deduped = new Map<string, ExtractedEntity>();

  for (const raw of rawEntities) {
    const entity = parseEntity(raw, warnings);

    if (!entity) {
      continue;
    }

    const key = `${entity.type}:${entity.normalizedName}`;
    const previous = deduped.get(key);

    if (!previous || entity.confidence > previous.confidence) {
      deduped.set(key, entity);
    }
  }

  return {
    entities: Array.from(deduped.values())
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, maxEntities),
    warnings,
  };
}

function parseMemoryResponse(value: unknown, maxMemories: number): {
  memories: ExtractedMemory[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const root = asRecord(value);
  const rawMemories = Array.isArray(root["memories"]) ? root["memories"] : [];
  const deduped = new Map<string, ExtractedMemory>();

  for (const raw of rawMemories) {
    const memory = parseMemory(raw, warnings);

    if (!memory) {
      continue;
    }

    const key = `${memory.memoryType}:${memory.normalizedStatement}`;
    const previous = deduped.get(key);

    if (!previous || memory.confidence > previous.confidence) {
      deduped.set(key, memory);
    }
  }

  return {
    memories: Array.from(deduped.values())
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, maxMemories),
    warnings,
  };
}

function parseEntity(raw: unknown, warnings: string[]): ExtractedEntity | null {
  const record = asRecord(raw);
  const name = readString(record["name"]);
  const type = readEntityType(record["type"]);
  const evidence = readString(record["evidence"]);

  if (!name || !type || !evidence) {
    warnings.push("entity_missing_required_fields");
    return null;
  }

  const confidence = clampConfidence(readNumber(record["confidence"]));
  const normalizedName = normalizeEntityName(name);

  if (normalizedName.length < 2) {
    warnings.push("entity_name_too_short");
    return null;
  }

  return {
    name: name.trim().replace(/\s+/g, " "),
    normalizedName,
    type,
    graphNodeType: mapEntityTypeToGraphNodeType(type),
    aliases: readStringArray(record["aliases"]),
    confidence,
    evidenceHash: sha256Hex(evidence),
    evidenceLength: evidence.length,
    metadata: sanitizeMetadata(record["metadata"]),
  };
}

function parseMemory(raw: unknown, warnings: string[]): ExtractedMemory | null {
  const record = asRecord(raw);
  const statement = readString(record["statement"]);
  const memoryType = readMemoryType(record["type"]);
  const evidence = readString(record["evidence"]);

  if (!statement || !memoryType || !evidence) {
    warnings.push("memory_missing_required_fields");
    return null;
  }

  const normalizedStatement = normalizeStatement(statement);

  if (normalizedStatement.length < 12) {
    warnings.push("memory_statement_too_short");
    return null;
  }

  return {
    statement: statement.trim().replace(/\s+/g, " "),
    normalizedStatement,
    memoryType,
    subject: readString(record["subject"]),
    confidence: clampConfidence(readNumber(record["confidence"])),
    evidenceHash: sha256Hex(evidence),
    evidenceLength: evidence.length,
    metadata: sanitizeMetadata(record["metadata"]),
  };
}

function readReturnedEntityCount(value: unknown): number {
  const entities = asRecord(value)["entities"];

  return Array.isArray(entities) ? entities.length : 0;
}

function readReturnedMemoryCount(value: unknown): number {
  const memories = asRecord(value)["memories"];

  return Array.isArray(memories) ? memories.length : 0;
}

function readEntityType(value: unknown): EntityType | null {
  return ENTITY_TYPES.includes(value as EntityType) ? value as EntityType : null;
}

function readMemoryType(value: unknown): MemoryType | null {
  return MEMORY_TYPES.includes(value as MemoryType) ? value as MemoryType : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)))
    : [];
}

function sanitizeMetadata(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  const safe: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      safe[key] = item;
    }
  }

  return safe;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function clampConfidence(value: number | null): number {
  if (value === null) {
    return 0.5;
  }

  return Math.max(0, Math.min(1, value));
}

function clampMaxEntities(value: number | undefined): number {
  return Number.isInteger(value) && value && value > 0 ? Math.min(value, 50) : 30;
}

function clampMaxMemories(value: number | undefined): number {
  return Number.isInteger(value) && value && value > 0 ? Math.min(value, 50) : 20;
}

function truncateForExtraction(value: string): string {
  return value.length > 30_000 ? value.slice(0, 30_000) : value;
}

function normalizeStatement(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
