/**
 * Live chat memory intake — extract profile and engineering facts from a user turn.
 *
 * Runs before generation when the planner sets `memoryWrite` to `extract` or `force_note`.
 * Facts are written to canonical memory tables; failures can trigger lossless fallback.
 */
import { canonicalMemories } from "@sivraj/db";
import { and, eq, sql } from "drizzle-orm";
import type { ChatMessage } from "@sivraj/llm";
import { createOpenAICompatibleChatGenerator } from "@sivraj/llm";
import {
  ENGINEERING_INSTRUCTION_SCOPES,
  ENGINEERING_MEMORY_TYPES,
  isEngineeringInstructionScope,
  isEngineeringMemoryType,
  looksLikeSecretValue,
  type EngineeringInstructionScope,
  type EngineeringMemoryType,
} from "@sivraj/intelligence";
import type { ProviderRuntimeConfig } from "./helpers.js";
import { errorMessage, readPositiveInteger, truncate } from "./helpers.js";
import { sha256Hex } from "../http/route-helpers.js";
import type { AppDependencies } from "../../app.js";

const CHAT_MEMORY_INTAKE_TIMEOUT_DEFAULT_MS = 30_000;
const CHAT_MEMORY_INTAKE_MAX_RETRIES_DEFAULT = 1;
const MAX_MEMORY_FACTS_PER_TURN = 4;
const MAX_ENGINEERING_MEMORIES_PER_TURN = 4;

export type ProfileMemoryFact = {
  kind: "profile_fact" | "preference" | "note";
  slot: string;
  qualifier: string | null;
  value: string;
  valueType: "string" | "number" | "boolean" | "date";
  mutable: boolean;
  confidence: number;
};

export type EngineeringMemoryFact = {
  kind: "engineering_memory";
  engineeringMemoryType: EngineeringMemoryType;
  scope: EngineeringInstructionScope;
  subject: string | null;
  statement: string;
  agentContextLine: string | null;
  codeReference: string | null;
  confidence: number;
};

export type MemoryIntakeResult = {
  source: "llm" | "lossless_fallback" | "skipped";
  status: "stored" | "stored_fallback" | "no_facts" | "failed" | "skipped_question";
  facts: ProfileMemoryFact[];
  engineeringMemories: EngineeringMemoryFact[];
  acknowledgement: string | null;
  errorMessage?: string;
};

export type ChatMemoryIntent = "auto" | "remember" | "private";

type MemoryIntakeClassifierResult = Pick<MemoryIntakeResult, "facts" | "engineeringMemories" | "acknowledgement"> & {
  errorMessage?: string;
};

/** Classify and store durable memory from the current user message. */
export async function runChatMemoryIntake(input: {
  db: AppDependencies["db"];
  twinId: string;
  userMessageId: string;
  turnId: string | null;
  subject: string;
  message: string;
  intent?: Exclude<ChatMemoryIntent, "private">;
  losslessFallback?: boolean;
  runtimeConfig: ProviderRuntimeConfig;
  llmFetch?: typeof fetch;
}): Promise<MemoryIntakeResult> {
  const llmResult = await detectProfileFactsWithLlm(input).catch((error: unknown) => {
    console.warn("chat memory intake classifier failed", {
      userMessageId: input.userMessageId,
      error: errorMessage(error),
    });
    return {
      facts: [],
      engineeringMemories: [],
      acknowledgement: null,
      errorMessage: errorMessage(error),
    };
  });
  const fallbackFacts = llmResult.errorMessage && input.losslessFallback
    ? [buildLosslessFallbackNote(input.message)]
    : [];
  const facts = mergeProfileMemoryFacts([
    ...llmResult.facts,
    ...fallbackFacts,
  ])
    .slice(0, MAX_MEMORY_FACTS_PER_TURN);
  const engineeringMemories = mergeEngineeringMemoryFacts(llmResult.engineeringMemories)
    .slice(0, MAX_ENGINEERING_MEMORIES_PER_TURN);

  await persistHotProfileMemoryFacts(input, facts);
  await persistHotEngineeringMemories(input, engineeringMemories);
  const usedFallback = fallbackFacts.length > 0;
  const storedMemoryCount = facts.length + engineeringMemories.length;

  return {
    source: usedFallback ? "lossless_fallback" : "llm",
    status: usedFallback
      ? "stored_fallback"
      : llmResult.errorMessage
        ? "failed"
        : storedMemoryCount > 0
          ? "stored"
          : "no_facts",
    facts,
    engineeringMemories,
    acknowledgement: usedFallback
      ? "Got it. I saved that."
      : llmResult.acknowledgement,
    ...(llmResult.errorMessage ? { errorMessage: llmResult.errorMessage } : {}),
  };
}

function buildLosslessFallbackNote(message: string): ProfileMemoryFact {
  return {
    kind: "note",
    slot: "user_statement",
    qualifier: sha256Hex(message).slice(0, 16),
    value: truncate(message, 240),
    valueType: "string",
    mutable: true,
    confidence: 0.66,
  };
}

async function persistHotProfileMemoryFacts(
  input: {
    db: AppDependencies["db"];
    twinId: string;
    userMessageId: string;
    turnId: string | null;
    subject: string;
    message: string;
  },
  facts: ProfileMemoryFact[],
) {
  for (const fact of facts) {
    await upsertHotProfileMemory({
      db: input.db,
      twinId: input.twinId,
      userMessageId: input.userMessageId,
      turnId: input.turnId,
      subject: input.subject,
      message: input.message,
      fact,
    });
  }
}

async function persistHotEngineeringMemories(
  input: {
    db: AppDependencies["db"];
    twinId: string;
    userMessageId: string;
    turnId: string | null;
    subject: string;
    message: string;
  },
  memories: EngineeringMemoryFact[],
) {
  for (const memory of memories) {
    await upsertHotEngineeringMemory({
      db: input.db,
      twinId: input.twinId,
      userMessageId: input.userMessageId,
      turnId: input.turnId,
      subject: input.subject,
      message: input.message,
      memory,
    });
  }
}

async function detectProfileFactsWithLlm(input: {
  message: string;
  intent?: Exclude<ChatMemoryIntent, "private">;
  runtimeConfig: ProviderRuntimeConfig;
  llmFetch?: typeof fetch;
}): Promise<MemoryIntakeClassifierResult> {
  const output = await createOpenAICompatibleChatGenerator({
    provider: input.runtimeConfig.providerKind,
    apiKey: input.runtimeConfig.apiKey,
    model: input.runtimeConfig.model,
    baseUrl: input.runtimeConfig.baseUrl,
    fetch: input.llmFetch,
    timeoutMs: readPositiveInteger(
      process.env["CHAT_MEMORY_INTAKE_TIMEOUT_MS"],
      CHAT_MEMORY_INTAKE_TIMEOUT_DEFAULT_MS,
    ),
    maxRetries: readPositiveInteger(
      process.env["CHAT_MEMORY_INTAKE_MAX_RETRIES"],
      CHAT_MEMORY_INTAKE_MAX_RETRIES_DEFAULT,
    ),
  }).generateChat({
    temperature: 0,
    timeoutMs: readPositiveInteger(
      process.env["CHAT_MEMORY_INTAKE_TIMEOUT_MS"],
      CHAT_MEMORY_INTAKE_TIMEOUT_DEFAULT_MS,
    ),
    messages: buildMemoryIntakePrompt(input.message, input.intent ?? "auto"),
  });

  return parseMemoryIntakeResult(output.content);
}

function buildMemoryIntakePrompt(
  message: string,
  intent: Exclude<ChatMemoryIntent, "private">,
): ChatMessage[] {
  const rememberModeInstructions = intent === "remember"
    ? [
        "The user explicitly asked Sivraj to remember this message.",
        "If the message does not contain a clean profile_fact or preference, return one note fact that preserves the user's statement.",
        "For note facts, use kind note, a compact semantic slot, qualifier null unless the note is about a specific entity, value as the concise remembered statement, valueType string, mutable true, and confidence at least 0.8.",
        "If the message contains coding knowledge, a user skill, a code reference, or an instruction for future coding agents, prefer engineeringMemories over a generic note.",
      ]
    : [
        "Return no facts unless the message contains durable user memory worth keeping beyond this chat turn.",
        "Return no engineeringMemories unless the message contains durable engineering context worth keeping beyond this chat turn.",
      ];

  return [
    {
      role: "system",
      content: [
        "Extract durable user memory from a single chat message.",
        "Return only JSON with shape {\"facts\":[{\"kind\":\"profile_fact|preference|note\",\"slot\":\"compact_stable_slot\",\"qualifier\":\"specific object/relation/entity or null\",\"value\":\"...\",\"valueType\":\"string|number|boolean|date\",\"mutable\":true,\"confidence\":0.0}],\"engineeringMemories\":[{\"type\":\"user_skill|coding_preference|architecture_decision|project_convention|style_rule|testing_practice|deployment_environment|security_boundary|recurring_bug|tool_preference|agent_instruction\",\"scope\":\"global_user|project|organization|agent_specific|temporary\",\"subject\":\"technology/project/tool/file/symbol or null\",\"statement\":\"source-backed engineering memory\",\"agentContextLine\":\"short instruction future coding agents can use or null\",\"codeReference\":\"file path, symbol, package, command, API, or null\",\"confidence\":0.0}],\"acknowledgement\":\"short natural reply or null\"}.",
        "Only extract facts the user states about themself, their preferences, or facts they clearly want remembered.",
        "Extract engineeringMemories when the user states coding skills, coding preferences, tool preferences, project conventions, architecture decisions, testing practices, deployment/runtime facts, security boundaries, recurring bugs, coding-agent instructions, or code references they want Sivraj to carry forward.",
        `Allowed engineering memory types: ${ENGINEERING_MEMORY_TYPES.join(", ")}.`,
        `Allowed engineering scopes: ${ENGINEERING_INSTRUCTION_SCOPES.join(", ")}.`,
        "Use user_skill for statements about what the user knows, uses, is learning, is strong/weak at, or has experience with.",
        "Use codeReference only for safe references such as file paths, symbols, package names, command names, APIs, frameworks, or short identifiers. Do not copy long code blocks into codeReference.",
        "For engineeringMemories, statement should be useful even without the original chat. agentContextLine should be imperative or advisory context a future coding agent could apply.",
        "For repo-specific or project-specific knowledge, use project scope. For the user's general skills/preferences across work, use global_user. For instructions specifically aimed at coding agents, use agent_specific.",
        "Do not extract assistant claims, questions, tasks, greetings, or uncertain guesses.",
        "Do not store secrets, API keys, bearer tokens, private keys, mnemonics, passwords, database URLs, or raw credentials. Store only safe variable names or setup requirements.",
        "Use compact stable slots so later corrections update the same memory instead of creating duplicates.",
        "When a slot could apply to many different objects, relations, entities, projects, people, pets, documents, or places, set qualifier to the specific object/relation/entity from the user's message instead of collapsing them together.",
        "For messages shaped like '<named thing> is that <remembered content>', preserve '<remembered content>' as the full value. Use the named thing as slot/qualifier metadata, not as the value.",
        "For note-style messages, the value must answer 'what is the note?' directly. Do not store a shallow restatement such as only the note name, topic, or the word after the final verb.",
        "Example: 'The strange launch note is that brass lanterns matter' should produce a note whose value is 'brass lanterns matter', with slot/qualifier describing 'strange launch note'.",
        "For corrections, output the new current value for the same slot.",
        ...rememberModeInstructions,
        "When facts or engineeringMemories is non-empty, acknowledgement should be a concise first-person reply that feels conversational and does not ask a follow-up question unless the user asked one.",
        "When there is no durable memory, return {\"facts\":[],\"engineeringMemories\":[],\"acknowledgement\":null}.",
      ].join("\n"),
    },
    {
      role: "user",
      content: truncate(message, 2_000),
    },
  ];
}

function parseMemoryIntakeResult(content: string): MemoryIntakeClassifierResult {
  const parsed = parseJsonObject(content);

  return {
    facts: parseProfileMemoryFacts(content),
    engineeringMemories: parseEngineeringMemoryFacts(content),
    acknowledgement: sanitizeAcknowledgement(readNonEmptyString(parsed?.["acknowledgement"])),
  };
}

export function parseProfileMemoryFacts(content: string): ProfileMemoryFact[] {
  const parsed = parseJsonObject(content);
  const facts = Array.isArray(parsed?.["facts"]) ? parsed["facts"] : [];

  return facts.flatMap((item) => {
    const record = readRecord(item);
    const rawSlot = readNonEmptyString(record?.["slot"]);
    const rawValue = readNonEmptyString(record?.["value"]);
    if (!rawSlot || !rawValue) {
      return [];
    }

    const slot = normalizeSlot(rawSlot);
    const qualifier = normalizeQualifier(readNonEmptyString(record?.["qualifier"]));
    const value = sanitizeFactValue(rawValue);
    if (!slot || !value) {
      return [];
    }

    const kind = readFactKind(record?.["kind"]);
    const valueType = readValueType(record?.["valueType"]) ?? inferValueType(value);
    const confidence = readConfidence(record?.["confidence"]);

    if (confidence < 0.65) {
      return [];
    }

    return [{
      kind,
      slot,
      qualifier,
      value,
      valueType,
      mutable: record?.["mutable"] !== false,
      confidence,
    }];
  });
}

export function parseEngineeringMemoryFacts(content: string): EngineeringMemoryFact[] {
  const parsed = parseJsonObject(content);
  const memories = Array.isArray(parsed?.["engineeringMemories"])
    ? parsed["engineeringMemories"]
    : [];

  return memories.flatMap((item) => {
    const record = readRecord(item);
    const memoryType = readEngineeringMemoryType(record?.["type"]);
    const scope = readEngineeringScope(record?.["scope"]);
    const rawStatement = readNonEmptyString(record?.["statement"]);

    if (!memoryType || !scope || !rawStatement) {
      return [];
    }

    const statement = sanitizeEngineeringText(rawStatement, 600);
    if (!statement || containsSecretLikeValue(statement)) {
      return [];
    }

    const confidence = readConfidence(record?.["confidence"]);
    if (confidence < 0.65) {
      return [];
    }

    return [{
      kind: "engineering_memory" as const,
      engineeringMemoryType: memoryType,
      scope,
      subject: sanitizeNullableEngineeringText(readNonEmptyString(record?.["subject"]), 120),
      statement,
      agentContextLine: sanitizeNullableEngineeringText(readNonEmptyString(record?.["agentContextLine"]), 240),
      codeReference: sanitizeNullableCodeReference(readNonEmptyString(record?.["codeReference"])),
      confidence,
    }];
  });
}

function mergeProfileMemoryFacts(facts: ProfileMemoryFact[]): ProfileMemoryFact[] {
  const bySlot = new Map<string, ProfileMemoryFact>();

  for (const fact of facts) {
    const key = fact.qualifier ? `${fact.slot}:${fact.qualifier}` : fact.slot;
    const existing = bySlot.get(key);
    if (!existing || fact.confidence >= existing.confidence) {
      bySlot.set(key, fact);
    }
  }

  return [...bySlot.values()];
}

function mergeEngineeringMemoryFacts(memories: EngineeringMemoryFact[]): EngineeringMemoryFact[] {
  const byKey = new Map<string, EngineeringMemoryFact>();

  for (const memory of memories) {
    const key = [
      memory.scope,
      memory.engineeringMemoryType,
      normalizeEngineeringSubjectKey(memory.subject ?? memory.statement),
      sha256Hex(normalizeFactValue(memory.statement)).slice(0, 12),
    ].join(":");
    const existing = byKey.get(key);
    if (!existing || memory.confidence >= existing.confidence) {
      byKey.set(key, memory);
    }
  }

  return [...byKey.values()];
}

async function upsertHotProfileMemory(input: {
  db: AppDependencies["db"];
  twinId: string;
  userMessageId: string;
  turnId: string | null;
  subject: string;
  message: string;
  fact: ProfileMemoryFact;
}) {
  const now = new Date();
  const canonicalKey = [
    "profile_slot",
    normalizeSlot(input.subject),
    normalizeSlot(input.fact.slot),
    input.fact.qualifier ? normalizeSlot(input.fact.qualifier) : null,
  ].filter(Boolean).join(":");
  const evidenceHash = sha256Hex([
    input.twinId,
    input.userMessageId,
    input.fact.slot,
    input.fact.qualifier ?? "",
    input.fact.value,
  ].join("\n"));
  const [existing] = await input.db
    .select({
      id: canonicalMemories.id,
      evidenceCount: canonicalMemories.evidenceCount,
      confidenceScore: canonicalMemories.confidenceScore,
      metadata: canonicalMemories.metadata,
    })
    .from(canonicalMemories)
    .where(and(
      eq(canonicalMemories.twinId, input.twinId),
      eq(canonicalMemories.canonicalKey, canonicalKey),
    ))
    .limit(1);
  const metadata = buildHotProfileMemoryMetadata({
    existingMetadata: existing?.metadata,
    userMessageId: input.userMessageId,
    turnId: input.turnId,
    message: input.message,
    fact: input.fact,
    evidenceHash,
    now,
  });

  if (existing) {
    await input.db
      .update(canonicalMemories)
      .set({
        evidenceCount: sql`${canonicalMemories.evidenceCount} + 1`,
        confidenceScore: Math.max(existing.confidenceScore ?? 0, input.fact.confidence),
        metadata,
        status: "approved",
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(canonicalMemories.id, existing.id),
        eq(canonicalMemories.twinId, input.twinId),
      ));
    return;
  }

  await input.db
    .insert(canonicalMemories)
    .values({
      twinId: input.twinId,
      memoryType: memoryTypeForFact(input.fact),
      canonicalKey,
      subject: input.subject,
      status: "approved",
      evidenceCount: 1,
      confidenceScore: input.fact.confidence,
      metadata,
      firstSeenAt: now,
      lastSeenAt: now,
    });
}

async function upsertHotEngineeringMemory(input: {
  db: AppDependencies["db"];
  twinId: string;
  userMessageId: string;
  turnId: string | null;
  subject: string;
  message: string;
  memory: EngineeringMemoryFact;
}) {
  const now = new Date();
  const normalizedStatement = normalizeFactValue(input.memory.statement);
  const statementHash = sha256Hex(normalizedStatement).slice(0, 12);
  const subjectKey = normalizeEngineeringSubjectKey(input.memory.subject ?? input.memory.statement);
  const canonicalKey = [
    "engineering_memory",
    input.memory.scope,
    input.memory.engineeringMemoryType,
    subjectKey,
    statementHash,
  ].join(":");
  const evidenceHash = sha256Hex([
    input.twinId,
    input.userMessageId,
    input.memory.scope,
    input.memory.engineeringMemoryType,
    input.memory.subject ?? "",
    input.memory.statement,
  ].join("\n"));
  const [existing] = await input.db
    .select({
      id: canonicalMemories.id,
      evidenceCount: canonicalMemories.evidenceCount,
      confidenceScore: canonicalMemories.confidenceScore,
      metadata: canonicalMemories.metadata,
    })
    .from(canonicalMemories)
    .where(and(
      eq(canonicalMemories.twinId, input.twinId),
      eq(canonicalMemories.canonicalKey, canonicalKey),
    ))
    .limit(1);
  const metadata = buildHotEngineeringMemoryMetadata({
    existingMetadata: existing?.metadata,
    userMessageId: input.userMessageId,
    turnId: input.turnId,
    message: input.message,
    memory: input.memory,
    evidenceHash,
    now,
  });

  if (existing) {
    await input.db
      .update(canonicalMemories)
      .set({
        evidenceCount: sql`${canonicalMemories.evidenceCount} + 1`,
        confidenceScore: Math.max(existing.confidenceScore ?? 0, input.memory.confidence),
        metadata,
        status: "approved",
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(canonicalMemories.id, existing.id),
        eq(canonicalMemories.twinId, input.twinId),
      ));
    return;
  }

  await input.db
    .insert(canonicalMemories)
    .values({
      twinId: input.twinId,
      memoryType: memoryTypeForEngineeringMemory(input.memory),
      canonicalKey,
      subject: input.memory.subject ?? input.subject,
      status: "approved",
      evidenceCount: 1,
      confidenceScore: input.memory.confidence,
      metadata,
      firstSeenAt: now,
      lastSeenAt: now,
    });
}

function buildHotProfileMemoryMetadata(input: {
  existingMetadata: unknown;
  userMessageId: string;
  turnId: string | null;
  message: string;
  fact: ProfileMemoryFact;
  evidenceHash: string;
  now: Date;
}) {
  const existing = readRecord(input.existingMetadata) ?? {};
  const existingTruth = readRecord(existing["currentTruth"]);
  const nowIso = input.now.toISOString();
  const previousValues = Array.isArray(existingTruth?.["previousValues"])
    ? existingTruth["previousValues"]
    : [];
  const currentValue = readNonEmptyString(existingTruth?.["value"]);
  const normalizedCurrent = currentValue ? normalizeFactValue(currentValue) : null;
  const normalizedIncoming = normalizeFactValue(input.fact.value);
  const nextPreviousValues = currentValue && normalizedCurrent !== normalizedIncoming
    ? [
        ...previousValues,
        {
          value: currentValue,
          evidenceHash: readNonEmptyString(existingTruth?.["evidenceHash"]) ?? undefined,
          sourceArtifactId: readNonEmptyString(existingTruth?.["sourceArtifactId"]) ?? undefined,
          validUntil: nowIso,
        },
      ]
    : previousValues;

  return {
    ...existing,
    sourceType: "chat_hot_memory_intake",
    memoryMetadata: {
      ...readRecord(existing["memoryMetadata"]),
      category: memoryCategoryForFact(input.fact),
      intakeLayer: "chat_hot_memory",
      requiresApproval: false,
    },
    currentTruth: {
      kind: input.fact.kind,
      slot: input.fact.slot,
      qualifier: input.fact.qualifier,
      value: input.fact.value,
      valueType: input.fact.valueType,
      mutable: input.fact.mutable,
      status: "active",
      evidenceHash: input.evidenceHash,
      sourceArtifactId: input.userMessageId,
      memoryFragmentId: input.turnId ?? input.userMessageId,
      updatedAt: nowIso,
      previousValues: nextPreviousValues,
      ...(currentValue && normalizedCurrent !== normalizedIncoming
        ? {
            conflictResolution: {
              action: "superseded_previous_value",
              previousValue: currentValue,
              newValue: input.fact.value,
              resolvedAt: nowIso,
            },
          }
        : {}),
    },
    evidenceHashes: mergeStrings(readStringArray(existing["evidenceHashes"]), [input.evidenceHash]),
    sourceMessageIds: mergeStrings(readStringArray(existing["sourceMessageIds"]), [input.userMessageId]),
    turnIds: input.turnId
      ? mergeStrings(readStringArray(existing["turnIds"]), [input.turnId])
      : readStringArray(existing["turnIds"]),
    lastIntakeMessagePreview: truncate(input.message, 240),
    updatedBy: "chat_memory_intake",
  };
}

function buildHotEngineeringMemoryMetadata(input: {
  existingMetadata: unknown;
  userMessageId: string;
  turnId: string | null;
  message: string;
  memory: EngineeringMemoryFact;
  evidenceHash: string;
  now: Date;
}) {
  const existing = readRecord(input.existingMetadata) ?? {};
  const nowIso = input.now.toISOString();

  return {
    ...existing,
    sourceType: "chat_hot_engineering_memory_intake",
    memoryMetadata: {
      ...readRecord(existing["memoryMetadata"]),
      category: "engineering",
      intakeLayer: "chat_hot_memory",
      requiresApproval: false,
      engineering: true,
      engineeringMemoryType: input.memory.engineeringMemoryType,
      engineeringInstructionScope: input.memory.scope,
    },
    currentTruth: {
      kind: "engineering_memory",
      slot: input.memory.engineeringMemoryType,
      qualifier: input.memory.scope,
      value: input.memory.statement,
      valueType: "string",
      mutable: true,
      status: "active",
      evidenceHash: input.evidenceHash,
      sourceArtifactId: input.userMessageId,
      memoryFragmentId: input.turnId ?? input.userMessageId,
      updatedAt: nowIso,
      engineeringMemoryType: input.memory.engineeringMemoryType,
      engineeringInstructionScope: input.memory.scope,
      subject: input.memory.subject,
      agentContextLine: input.memory.agentContextLine,
      codeReference: input.memory.codeReference,
    },
    engineering: true,
    engineeringMemoryType: input.memory.engineeringMemoryType,
    engineeringInstructionScope: input.memory.scope,
    engineeringSubject: input.memory.subject,
    engineeringEvidenceHash: input.evidenceHash,
    engineeringEvidenceLength: input.memory.statement.length,
    ...(input.memory.agentContextLine ? { agentContextLine: input.memory.agentContextLine } : {}),
    ...(input.memory.codeReference ? { codeReference: input.memory.codeReference } : {}),
    evidenceHashes: mergeStrings(readStringArray(existing["evidenceHashes"]), [input.evidenceHash]),
    sourceMessageIds: mergeStrings(readStringArray(existing["sourceMessageIds"]), [input.userMessageId]),
    turnIds: input.turnId
      ? mergeStrings(readStringArray(existing["turnIds"]), [input.turnId])
      : readStringArray(existing["turnIds"]),
    lastIntakeMessagePreview: truncate(input.message, 240),
    updatedBy: "chat_engineering_memory_intake",
  };
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const json = trimmed.match(/\{[\s\S]*\}/u)?.[0] ?? trimmed;

  try {
    return readRecord(JSON.parse(json));
  } catch {
    return null;
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function mergeStrings(left: string[], right: string[]) {
  return [...new Set([...left, ...right].map((item) => item.trim()).filter(Boolean))];
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readValueType(value: unknown): ProfileMemoryFact["valueType"] | null {
  return value === "number" || value === "boolean" || value === "date" || value === "string"
    ? value
    : null;
}

function readFactKind(value: unknown): ProfileMemoryFact["kind"] {
  return value === "preference" || value === "note" ? value : "profile_fact";
}

function readEngineeringMemoryType(value: unknown): EngineeringMemoryType | null {
  return typeof value === "string" && isEngineeringMemoryType(value) ? value : null;
}

function readEngineeringScope(value: unknown): EngineeringInstructionScope | null {
  return typeof value === "string" && isEngineeringInstructionScope(value) ? value : null;
}

function memoryTypeForFact(fact: ProfileMemoryFact) {
  if (fact.kind === "preference") {
    return "preference" as const;
  }

  return fact.kind === "note" ? "other" as const : "fact" as const;
}

function memoryTypeForEngineeringMemory(memory: EngineeringMemoryFact) {
  if (memory.engineeringMemoryType === "coding_preference" ||
    memory.engineeringMemoryType === "tool_preference" ||
    memory.engineeringMemoryType === "style_rule") {
    return "preference" as const;
  }

  if (memory.engineeringMemoryType === "architecture_decision" ||
    memory.engineeringMemoryType === "security_boundary") {
    return "decision" as const;
  }

  if (memory.engineeringMemoryType === "deployment_environment" ||
    memory.engineeringMemoryType === "project_convention" ||
    memory.engineeringMemoryType === "recurring_bug") {
    return "project_update" as const;
  }

  return "fact" as const;
}

function memoryCategoryForFact(fact: ProfileMemoryFact) {
  if (fact.kind === "preference") {
    return "preference";
  }

  return fact.kind === "note" ? "note" : "profile";
}

function readConfidence(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0.8;
}

function inferValueType(value: string): ProfileMemoryFact["valueType"] {
  if (/^\d+(?:\.\d+)?$/u.test(value)) {
    return "number";
  }

  if (/^(?:true|false)$/iu.test(value)) {
    return "boolean";
  }

  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return "date";
  }

  return "string";
}

function normalizeSlot(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 64);
}

function normalizeQualifier(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 64);

  return normalized || null;
}

function normalizeEngineeringSubjectKey(value: string): string {
  return normalizeSlot(value) || sha256Hex(value).slice(0, 16);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function sanitizeFactValue(value: string): string {
  return normalizeWhitespace(value)
    .replace(/^["'“”‘’`]+|["'“”‘’`.,!?]+$/gu, "")
    .trim()
    .slice(0, 240);
}

function sanitizeEngineeringText(value: string, maxLength: number): string | null {
  const normalized = normalizeWhitespace(value)
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/gu, "")
    .trim()
    .slice(0, maxLength);

  return normalized.length >= 3 ? normalized : null;
}

function sanitizeNullableEngineeringText(value: string | null, maxLength: number): string | null {
  if (!value) {
    return null;
  }

  const normalized = sanitizeEngineeringText(value, maxLength);
  return normalized && !containsSecretLikeValue(normalized) ? normalized : null;
}

function sanitizeNullableCodeReference(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = normalizeWhitespace(value)
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/gu, "")
    .trim()
    .slice(0, 160);

  if (!normalized || containsSecretLikeValue(normalized)) {
    return null;
  }

  return normalized;
}

function containsSecretLikeValue(value: string): boolean {
  if (looksLikeSecretValue(value)) {
    return true;
  }

  return value
    .split(/\s+/u)
    .map((token) => token.replace(/^[("'`]+|[).,;:'"`]+$/gu, ""))
    .some((token) => looksLikeSecretValue(token));
}

function sanitizeAcknowledgement(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = normalizeWhitespace(value)
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/gu, "")
    .trim()
    .slice(0, 240);

  return normalized || null;
}

function normalizeFactValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}
