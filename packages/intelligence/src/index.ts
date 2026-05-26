import type { StructuredGenerator } from "@sivraj/llm";
import { createHash } from "node:crypto";

export * from "./patterns/index.js";
export * from "./engineering/index.js";

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
    attributionAware?: boolean;
    sourceKind?: "conversation";
    conversationUnderstanding?: {
      enabled: true;
      sourceType: string;
      goalCount: number;
      decisionCount: number;
      preferenceCount: number;
      commitmentCount: number;
      followUpCount: number;
    };
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
  const attributionAware = isAttributionAwareContent(input.content);
  const conversationAware = isConversationSource(input.sourceType) || attributionAware;
  const { memories, warnings } = parseMemoryResponse(generation.json, maxMemories, {
    attributionAware,
  });
  const conversationUnderstanding = conversationAware
    ? buildConversationUnderstandingMetadata(input.sourceType, memories)
    : null;

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
      ...(attributionAware ? { attributionAware: true } : {}),
      ...(conversationAware ? { sourceKind: "conversation" as const } : {}),
      ...(conversationUnderstanding ? { conversationUnderstanding } : {}),
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

export type TwinIdentityProfile = {
  displayName?: string | null;
  aliases?: string[];
  emails?: string[];
  phones?: string[];
  handles?: Record<string, string[]>;
  knownOtherSpeakers?: string[];
};

export type SpeakerRole = "self" | "other" | "unknown" | "system";

export type SpeakerAttributionMethod =
  | "exact_name"
  | "alias"
  | "email"
  | "phone"
  | "handle"
  | "source_mapping"
  | "known_other"
  | "system_label"
  | "unknown";

export type SpeakerAttribution = {
  role: SpeakerRole;
  confidence: number;
  method: SpeakerAttributionMethod;
  normalizedLabel: string;
};

export type SourceSpeakerMapping = {
  sourceSpeaker: string;
  sourceSpeakerId?: string | null;
  role: SpeakerRole;
  mappedName?: string | null;
};

export function resolveSpeakerAttribution(input: {
  label: string | null | undefined;
  sourceSpeakerId?: string | null;
  profile: TwinIdentityProfile;
  mappings?: SourceSpeakerMapping[];
}): SpeakerAttribution {
  const mapping = findSpeakerMapping(input.label, input.sourceSpeakerId, input.mappings ?? []);

  if (mapping) {
    return speakerAttribution(
      mapping.role,
      1,
      "source_mapping",
      normalizeSpeakerLabel(mapping.mappedName || mapping.sourceSpeaker),
    );
  }

  return classifySpeaker(input.label, input.profile);
}

export function classifySpeaker(
  label: string | null | undefined,
  profile: TwinIdentityProfile,
): SpeakerAttribution {
  const normalizedLabel = normalizeSpeakerLabel(label);

  if (!normalizedLabel) {
    return speakerAttribution("unknown", 0, "unknown", "");
  }

  if (SYSTEM_SPEAKER_LABELS.has(normalizedLabel)) {
    return speakerAttribution("system", 0.98, "system_label", normalizedLabel);
  }

  const displayName = normalizeSpeakerLabel(profile.displayName);

  if (displayName && normalizedLabel === displayName) {
    return speakerAttribution("self", 0.99, "exact_name", normalizedLabel);
  }

  if (profile.aliases?.some((alias) => normalizeSpeakerLabel(alias) === normalizedLabel)) {
    return speakerAttribution("self", 0.96, "alias", normalizedLabel);
  }

  const labelEmail = normalizeEmail(label);
  if (labelEmail && profile.emails?.some((email) => normalizeEmail(email) === labelEmail)) {
    return speakerAttribution("self", 0.99, "email", normalizedLabel);
  }

  const labelPhone = normalizePhone(label);
  if (labelPhone && profile.phones?.some((phone) => normalizePhone(phone) === labelPhone)) {
    return speakerAttribution("self", 0.98, "phone", normalizedLabel);
  }

  if (matchesHandle(label, profile.handles)) {
    return speakerAttribution("self", 0.95, "handle", normalizedLabel);
  }

  if (profile.knownOtherSpeakers?.some((speaker) => normalizeSpeakerLabel(speaker) === normalizedLabel)) {
    return speakerAttribution("other", 0.9, "known_other", normalizedLabel);
  }

  return speakerAttribution("unknown", 0.15, "unknown", normalizedLabel);
}

function speakerAttribution(
  role: SpeakerRole,
  confidence: number,
  method: SpeakerAttributionMethod,
  normalizedLabel: string,
): SpeakerAttribution {
  return {
    role,
    confidence,
    method,
    normalizedLabel,
  };
}

function normalizeSpeakerLabel(value: string | null | undefined): string {
  return typeof value === "string"
    ? value
        .trim()
        .replace(/^@/, "")
        .replace(/\s+/g, " ")
        .toLowerCase()
    : "";
}

function normalizeEmail(value: string | null | undefined): string {
  const label = normalizeSpeakerLabel(value);
  return label.includes("@") ? label : "";
}

function normalizePhone(value: string | null | undefined): string {
  const digits = typeof value === "string" ? value.replace(/[^\d+]/g, "") : "";
  return digits.length >= 7 ? digits : "";
}

function matchesHandle(
  label: string | null | undefined,
  handles: Record<string, string[]> | undefined,
): boolean {
  const normalizedLabel = normalizeSpeakerLabel(label);

  if (!normalizedLabel || !handles) {
    return false;
  }

  return Object.values(handles)
    .flat()
    .some((handle) => normalizeSpeakerLabel(handle) === normalizedLabel);
}

function findSpeakerMapping(
  label: string | null | undefined,
  sourceSpeakerId: string | null | undefined,
  mappings: SourceSpeakerMapping[],
): SourceSpeakerMapping | null {
  const normalizedLabel = normalizeSpeakerLabel(label);
  const normalizedId = normalizeSpeakerLabel(sourceSpeakerId);

  return mappings.find((mapping) => {
    const mappingId = normalizeSpeakerLabel(mapping.sourceSpeakerId);

    if (normalizedId && mappingId && normalizedId === mappingId) {
      return true;
    }

    return normalizedLabel && normalizeSpeakerLabel(mapping.sourceSpeaker) === normalizedLabel;
  }) ?? null;
}

const SYSTEM_SPEAKER_LABELS = new Set([
  "system",
  "bot",
  "slackbot",
  "github",
  "notification",
  "unknown user",
]);

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
  const attributionAware = isAttributionAwareContent(input.content);
  const conversationAware = isConversationSource(input.sourceType) || attributionAware;
  return JSON.stringify({
    task: conversationAware ? "extract_conversation_candidate_memories" : "extract_candidate_memories",
    instructions: [
      "Return a JSON object with a memories array.",
      "Each memory must include statement, type, subject, confidence, evidence, and metadata.",
      `Use at most ${maxMemories} high-signal candidate memories.`,
      "Allowed types: fact, preference, goal, decision, commitment, experience, project_update, relationship, other.",
      "The statement must be source-backed and useful to the user's future Twin.",
      "Evidence must be a short exact snippet from the source text.",
      "Do not include generic topics, filler, or claims without evidence.",
      "Do not treat every sentence as a memory; prefer durable facts, goals, preferences, decisions, commitments, relationships, and project history.",
      ...(conversationAware
        ? [
            "This source is a conversation transcript. Understand the exchange, but extract only durable candidate memories.",
            "Prefer user goals, decisions, preferences, commitments, unresolved follow-ups, relationship context, and project updates.",
            "Do not store ordinary chit-chat, greetings, filler, or transcript summaries as memories.",
            "For unresolved follow-ups or next actions, use type commitment when the user committed, or project_update when it is an open project context.",
            "Set metadata.conversationSignal to one of goal, decision, preference, commitment, follow_up, relationship, project_update, or fact.",
            "Set metadata.requiresApproval to true for memories that would update the Twin from a conversation.",
          ]
        : []),
      ...(attributionAware
        ? [
            "This source uses speaker attribution markers such as self/Name, other/Name, unknown/Name, and system/Name.",
            "Only self/* first-person claims may become user identity, preference, goal, or experience memories.",
            "Do not convert other/* first-person claims into memories about the user.",
            "Use unknown/* claims cautiously and at lower confidence unless they clearly describe a project or relationship.",
            "Ignore system/* unless it provides important source context.",
            "Project commitments involving the user and another party may become project or relationship memories when evidence supports them.",
          ]
        : []),
    ],
    source: {
      sourceType: input.sourceType,
      title: input.title ?? null,
      ...(conversationAware
        ? {
            conversation: {
              sourceType: input.sourceType,
              policy: "extract_durable_user_memory_from_transcript",
            },
          }
        : {}),
      ...(attributionAware
        ? {
            attribution: {
              markerFormat: "role/speaker: message",
              roles: ["self", "other", "unknown", "system"],
              policy: "self_claims_only_for_user_memory",
            },
          }
        : {}),
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
            ...(conversationAware
              ? {
                  conversationSignal: "project_update",
                  requiresApproval: true,
                }
              : {}),
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

function parseMemoryResponse(value: unknown, maxMemories: number, options: {
  attributionAware?: boolean;
} = {}): {
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

    const filtered = options.attributionAware ? applyAttributionMemoryPolicy(memory, warnings) : memory;

    if (!filtered) {
      continue;
    }

    const key = `${filtered.memoryType}:${filtered.normalizedStatement}`;
    const previous = deduped.get(key);

    if (!previous || filtered.confidence > previous.confidence) {
      deduped.set(key, filtered);
    }
  }

  return {
    memories: Array.from(deduped.values())
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, maxMemories),
    warnings,
  };
}

function applyAttributionMemoryPolicy(memory: ExtractedMemory, warnings: string[]): ExtractedMemory | null {
  const role = readEvidenceSpeakerRole(memory.metadata["evidenceSpeakerRole"]);

  if (!role) {
    return memory;
  }

  if (role === "system") {
    warnings.push("memory_rejected_system_speaker");
    return null;
  }

  const userStatement = refersToUser(memory.statement);

  if (role === "other" && userStatement && isPersonalClaimMemory(memory)) {
    warnings.push("memory_rejected_other_party_self_claim");
    return null;
  }

  if (role === "unknown" && userStatement && isPersonalClaimMemory(memory)) {
    warnings.push("memory_downgraded_unknown_speaker_claim");
    return {
      ...memory,
      confidence: Math.min(memory.confidence, 0.35),
      metadata: {
        ...memory.metadata,
        speakerRole: role,
        attributionPolicy: "unknown_speaker_claim_downgraded",
      },
    };
  }

  return {
    ...memory,
    metadata: {
      ...memory.metadata,
      speakerRole: role,
      attributionPolicy: "self_claims_only_for_user_memory",
    },
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

  const evidenceSpeakerRole = readEvidenceSpeakerRole(evidence);
  const metadata = sanitizeMetadata(record["metadata"]);

  return {
    statement: statement.trim().replace(/\s+/g, " "),
    normalizedStatement,
    memoryType,
    subject: readString(record["subject"]),
    confidence: clampConfidence(readNumber(record["confidence"])),
    evidenceHash: sha256Hex(evidence),
    evidenceLength: evidence.length,
    metadata: {
      ...metadata,
      ...(evidenceSpeakerRole ? { evidenceSpeakerRole } : {}),
    },
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

function isConversationSource(sourceType: string): boolean {
  return sourceType === "voice_conversation" || sourceType === "chat_export" || sourceType === "slack_export" || sourceType === "whatsapp_export";
}

function buildConversationUnderstandingMetadata(
  sourceType: string,
  memories: ExtractedMemory[],
): NonNullable<MemoryExtractionResult["metadata"]["conversationUnderstanding"]> {
  return {
    enabled: true,
    sourceType,
    goalCount: countMemoriesByType(memories, "goal"),
    decisionCount: countMemoriesByType(memories, "decision"),
    preferenceCount: countMemoriesByType(memories, "preference"),
    commitmentCount: countMemoriesByType(memories, "commitment"),
    followUpCount: memories.filter((memory) => memory.metadata["conversationSignal"] === "follow_up").length,
  };
}

function countMemoriesByType(memories: ExtractedMemory[], type: MemoryType): number {
  return memories.filter((memory) => memory.memoryType === type).length;
}

function isAttributionAwareContent(value: string): boolean {
  return /(^|\n)(?:\[[^\]]+\]\s+)?(?:self|other|unknown|system)\/[^:\n]+:/i.test(value);
}

function readEvidenceSpeakerRole(value: unknown): SpeakerRole | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (
    normalized === "self"
    || normalized === "other"
    || normalized === "unknown"
    || normalized === "system"
  ) {
    return normalized;
  }

  const match = /(?:^|\n)(?:\[[^\]]+\]\s+)?(self|other|unknown|system)\/[^:\n]+:/i.exec(normalized);
  const role = match?.[1]?.toLowerCase();

  return role === "self" || role === "other" || role === "unknown" || role === "system"
    ? role
    : null;
}

function refersToUser(statement: string): boolean {
  return /\b(the user|user|fortune|he|she|they|their|them)\b/i.test(statement);
}

function isPersonalClaimMemory(memory: ExtractedMemory): boolean {
  if (
    memory.memoryType === "preference"
    || memory.memoryType === "goal"
    || memory.memoryType === "experience"
  ) {
    return true;
  }

  return /\b(prefers?|wants?|likes?|dislikes?|believes?|plans?|hopes?|needs?|worked with|is working on)\b/i
    .test(memory.normalizedStatement);
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
