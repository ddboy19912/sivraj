import { createHash } from "node:crypto";
import { auditEvents, candidateMemories, canonicalMemories } from "@sivraj/db";
import { and, eq } from "drizzle-orm";
import type { AppDependencies } from "../../app.js";
import { sanitizeSafeMetadata } from "../safe-metadata.js";
import type { TelegramInboundEvent, TelegramMemoryCorrectionCommand } from "../../types/telegram.types.js";
import {
  TELEGRAM_MEMORY_CORRECTION_MAX_MATCHES,
  loadTelegramMemoryCorrectionMatches,
  normalizeTelegramMemoryCorrectionQuery,
  tokenizeTelegramMemoryCorrectionQuery,
  uniqueRowsById,
  type CandidateCorrectionRow,
  type CanonicalCorrectionRow,
} from "./memory-correction-matching.js";

type TelegramMemoryCorrectionEvent = Extract<TelegramInboundEvent, { kind: "memory_correction_command" }>;

export type TelegramMemoryCorrectionResult =
  | {
      ok: true;
      command: TelegramMemoryCorrectionCommand;
      replyText: string;
      affectedCandidateCount: number;
      affectedCanonicalCount: number;
      correctedCanonicalMemoryId: string | null;
    }
  | {
      ok: false;
      reason: "no_matches" | "too_many_matches" | "ambiguous_correction" | "missing_current_truth";
      replyText: string;
      matchCount: number;
    };

export async function applyTelegramMemoryCorrection(input: {
  deps: AppDependencies;
  twinId: string;
  connectorAccountId: string;
  connectorSourceId: string;
  event: TelegramMemoryCorrectionEvent;
  command: TelegramMemoryCorrectionCommand;
  query: string;
  replacement?: string | null;
}): Promise<TelegramMemoryCorrectionResult> {
  const query = normalizeTelegramMemoryCorrectionQuery(input.query);
  const terms = tokenizeTelegramMemoryCorrectionQuery(query);
  const matches = await loadTelegramMemoryCorrectionMatches({
    deps: input.deps,
    twinId: input.twinId,
    terms,
  });
  const matchCount = uniqueStrings([
    ...matches.candidates.map((candidate) => `candidate:${candidate.id}`),
    ...matches.canonicals.map((canonical) => `canonical:${canonical.id}`),
  ]).length;

  if (matchCount === 0) {
    return {
      ok: false,
      reason: "no_matches",
      replyText: "I could not find a matching memory to update. Try a narrower phrase from the memory, like /forget dog name or /stale investor calls.",
      matchCount,
    };
  }

  if (input.command === "correct") {
    return applyTelegramCanonicalCorrection({
      ...input,
      command: "correct",
      query,
      matches,
      matchCount,
      replacement: normalizeTelegramMemoryCorrectionQuery(input.replacement ?? ""),
    });
  }

  if (matchCount > TELEGRAM_MEMORY_CORRECTION_MAX_MATCHES) {
    return {
      ok: false,
      reason: "too_many_matches",
      replyText: `I found ${matchCount} matching memories. Please narrow the phrase before I mark them stale.`,
      matchCount,
    };
  }

  const now = new Date();
  const correctionMetadata = buildCorrectionAuditMetadata({
    command: input.command,
    query,
    event: input.event,
    connectorAccountId: input.connectorAccountId,
    connectorSourceId: input.connectorSourceId,
    now,
  });
  const [affectedCandidateCount, affectedCanonicalCount] = await Promise.all([
    supersedeCandidateMemories({
      deps: input.deps,
      twinId: input.twinId,
      rows: matches.candidates,
      correctionMetadata,
      now,
    }),
    supersedeCanonicalMemories({
      deps: input.deps,
      twinId: input.twinId,
      rows: matches.canonicals,
      correctionMetadata,
      now,
    }),
  ]);

  await recordTelegramMemoryCorrectionAudit({
    deps: input.deps,
    twinId: input.twinId,
    command: input.command,
    event: input.event,
    connectorAccountId: input.connectorAccountId,
    connectorSourceId: input.connectorSourceId,
    affectedCandidateCount,
    affectedCanonicalCount,
    correctedCanonicalMemoryId: null,
    matchCount,
    query,
  });

  return {
    ok: true,
    command: input.command,
    replyText: input.command === "forget"
      ? `Forgot ${affectedCanonicalCount + affectedCandidateCount} matching memory ${affectedCanonicalCount + affectedCandidateCount === 1 ? "entry" : "entries"}. I kept the audit trail, but they will not be used as active memory.`
      : `Marked ${affectedCanonicalCount + affectedCandidateCount} matching memory ${affectedCanonicalCount + affectedCandidateCount === 1 ? "entry" : "entries"} stale.`,
    affectedCandidateCount,
    affectedCanonicalCount,
    correctedCanonicalMemoryId: null,
  };
}

async function applyTelegramCanonicalCorrection(input: {
  deps: AppDependencies;
  twinId: string;
  connectorAccountId: string;
  connectorSourceId: string;
  event: TelegramMemoryCorrectionEvent;
  command: "correct";
  query: string;
  replacement: string;
  matches: Awaited<ReturnType<typeof loadTelegramMemoryCorrectionMatches>>;
  matchCount: number;
}): Promise<TelegramMemoryCorrectionResult> {
  if (input.matches.canonicals.length !== 1) {
    return {
      ok: false,
      reason: "ambiguous_correction",
      replyText: input.matches.canonicals.length === 0
        ? "I found matching evidence, but no active current-truth memory to correct. Try /forget for this phrase, or save the corrected fact with /remember."
        : `I found ${input.matches.canonicals.length} current-truth memories. Please narrow the old phrase before correcting it.`,
      matchCount: input.matchCount,
    };
  }

  const canonical = input.matches.canonicals[0]!;
  const currentTruth = readRecord(readRecord(canonical.metadata)["currentTruth"]);

  if (!optionalString(currentTruth["value"])) {
    return {
      ok: false,
      reason: "missing_current_truth",
      replyText: "I found that memory, but it is not a current-truth fact I can safely correct from Telegram yet. Use /forget for now, then save the corrected fact with /remember.",
      matchCount: input.matchCount,
    };
  }

  const now = new Date();
  const correctionMetadata = buildCorrectionAuditMetadata({
    command: input.command,
    query: input.query,
    event: input.event,
    connectorAccountId: input.connectorAccountId,
    connectorSourceId: input.connectorSourceId,
    now,
    replacement: input.replacement,
  });
  const affectedCandidateCount = await supersedeCandidateMemories({
    deps: input.deps,
    twinId: input.twinId,
    rows: input.matches.candidates,
    correctionMetadata,
    now,
  });
  const correctedCanonicalCount = await correctCanonicalMemory({
    deps: input.deps,
    twinId: input.twinId,
    row: canonical,
    replacement: input.replacement,
    correctionMetadata,
    now,
  });

  await recordTelegramMemoryCorrectionAudit({
    deps: input.deps,
    twinId: input.twinId,
    command: input.command,
    event: input.event,
    connectorAccountId: input.connectorAccountId,
    connectorSourceId: input.connectorSourceId,
    affectedCandidateCount,
    affectedCanonicalCount: correctedCanonicalCount,
    correctedCanonicalMemoryId: canonical.id,
    matchCount: input.matchCount,
    query: input.query,
    replacement: input.replacement,
  });

  return {
    ok: true,
    command: input.command,
    replyText: `Corrected that memory to: ${truncateForTelegram(input.replacement, 180)}\nI marked the older evidence stale.`,
    affectedCandidateCount,
    affectedCanonicalCount: correctedCanonicalCount,
    correctedCanonicalMemoryId: canonical.id,
  };
}

async function supersedeCandidateMemories(input: {
  deps: AppDependencies;
  twinId: string;
  rows: CandidateCorrectionRow[];
  correctionMetadata: Record<string, unknown>;
  now: Date;
}) {
  const rows = uniqueRowsById(input.rows);

  await Promise.all(rows.map((row) =>
    input.deps.db
      .update(candidateMemories)
      .set({
        status: "superseded",
        metadata: markMemoryCorrectionMetadata(row.metadata, input.correctionMetadata, input.now),
        updatedAt: input.now,
      })
      .where(and(
        eq(candidateMemories.id, row.id),
        eq(candidateMemories.twinId, input.twinId),
      )),
  ));

  return rows.length;
}

async function supersedeCanonicalMemories(input: {
  deps: AppDependencies;
  twinId: string;
  rows: CanonicalCorrectionRow[];
  correctionMetadata: Record<string, unknown>;
  now: Date;
}) {
  const rows = uniqueRowsById(input.rows);

  await Promise.all(rows.map((row) =>
    input.deps.db
      .update(canonicalMemories)
      .set({
        status: "superseded",
        metadata: markMemoryCorrectionMetadata(row.metadata, input.correctionMetadata, input.now),
        updatedAt: input.now,
      })
      .where(and(
        eq(canonicalMemories.id, row.id),
        eq(canonicalMemories.twinId, input.twinId),
      )),
  ));

  return rows.length;
}

async function correctCanonicalMemory(input: {
  deps: AppDependencies;
  twinId: string;
  row: CanonicalCorrectionRow;
  replacement: string;
  correctionMetadata: Record<string, unknown>;
  now: Date;
}) {
  await input.deps.db
    .update(canonicalMemories)
    .set({
      status: "approved",
      metadata: correctCanonicalMemoryMetadata({
        metadata: input.row.metadata,
        replacement: input.replacement,
        correctionMetadata: input.correctionMetadata,
        now: input.now,
      }),
      lastSeenAt: input.now,
      updatedAt: input.now,
    })
    .where(and(
      eq(canonicalMemories.id, input.row.id),
      eq(canonicalMemories.twinId, input.twinId),
    ));

  return 1;
}

async function recordTelegramMemoryCorrectionAudit(input: {
  deps: AppDependencies;
  twinId: string;
  command: TelegramMemoryCorrectionCommand;
  event: TelegramMemoryCorrectionEvent;
  connectorAccountId: string;
  connectorSourceId: string;
  affectedCandidateCount: number;
  affectedCanonicalCount: number;
  correctedCanonicalMemoryId: string | null;
  matchCount: number;
  query: string;
  replacement?: string | null;
}) {
  await input.deps.db.insert(auditEvents).values({
    twinId: input.twinId,
    actorType: "system",
    actorId: "telegram-webhook",
    eventType: "telegram.memory_correction_applied",
    resourceType: input.correctedCanonicalMemoryId ? "canonical_memory" : "telegram_message",
    resourceId: input.correctedCanonicalMemoryId ?? input.event.messageId,
    metadata: {
      command: input.command,
      connectorAccountId: input.connectorAccountId,
      connectorSourceId: input.connectorSourceId,
      telegramUserId: input.event.telegramUser.id,
      chatId: input.event.chatId,
      messageId: input.event.messageId,
      querySha256: sha256Hex(input.query),
      queryTermCount: tokenizeTelegramMemoryCorrectionQuery(input.query).length,
      replacementSha256: input.replacement ? sha256Hex(input.replacement) : null,
      affectedCandidateCount: input.affectedCandidateCount,
      affectedCanonicalCount: input.affectedCanonicalCount,
      matchCount: input.matchCount,
    },
  });
}

function markMemoryCorrectionMetadata(
  metadata: unknown,
  correctionMetadata: Record<string, unknown>,
  now: Date,
) {
  const record = readRecord(metadata);
  const currentTruth = readRecord(record["currentTruth"]);
  const nextCurrentTruth = Object.keys(currentTruth).length > 0
    ? {
        ...currentTruth,
        status: "inactive",
        validUntil: now.toISOString(),
      }
    : record["currentTruth"];

  return sanitizeSafeMetadata({
    ...record,
    ...(nextCurrentTruth ? { currentTruth: nextCurrentTruth } : {}),
    telegramMemoryCorrection: correctionMetadata,
    updatedBy: "telegram_memory_correction",
  });
}

function correctCanonicalMemoryMetadata(input: {
  metadata: unknown;
  replacement: string;
  correctionMetadata: Record<string, unknown>;
  now: Date;
}) {
  const record = readRecord(input.metadata);
  const currentTruth = readRecord(record["currentTruth"]);
  const currentTruthWithoutOldEvidence = omitKeys(currentTruth, [
    "evidenceHash",
    "sourceArtifactId",
    "sourceArtifactIds",
    "memoryFragmentId",
  ]);
  const previousValue = optionalString(currentTruth["value"]);
  const previousValues = Array.isArray(currentTruth["previousValues"])
    ? currentTruth["previousValues"]
    : [];

  return sanitizeSafeMetadata({
    ...record,
    currentTruth: {
      ...currentTruthWithoutOldEvidence,
      value: input.replacement,
      status: "active",
      updatedAt: input.now.toISOString(),
      sourceMessagePreview: "Corrected via Telegram command.",
      previousValues: previousValue
        ? [
            ...previousValues,
            {
              value: previousValue,
              evidenceHash: optionalString(currentTruth["evidenceHash"]) ?? undefined,
              sourceArtifactId: optionalString(currentTruth["sourceArtifactId"]) ?? undefined,
              validUntil: input.now.toISOString(),
              reason: "telegram_correction",
            },
          ]
        : previousValues,
      correction: {
        action: "telegram_corrected_value",
        correctedAt: input.now.toISOString(),
      },
    },
    telegramMemoryCorrection: input.correctionMetadata,
    sourceType: "telegram_memory_correction",
    updatedBy: "telegram_memory_correction",
  });
}

function buildCorrectionAuditMetadata(input: {
  command: TelegramMemoryCorrectionCommand;
  query: string;
  event: TelegramMemoryCorrectionEvent;
  connectorAccountId: string;
  connectorSourceId: string;
  now: Date;
  replacement?: string | null;
}) {
  return sanitizeSafeMetadata({
    command: input.command,
    querySha256: sha256Hex(input.query),
    queryTermCount: tokenizeTelegramMemoryCorrectionQuery(input.query).length,
    replacementSha256: input.replacement ? sha256Hex(input.replacement) : null,
    connectorAccountId: input.connectorAccountId,
    connectorSourceId: input.connectorSourceId,
    telegramUserId: input.event.telegramUser.id,
    telegramChatId: input.event.chatId,
    telegramMessageId: input.event.messageId,
    telegramUpdateId: input.event.updateId,
    correctedAt: input.now.toISOString(),
  });
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function omitKeys(
  record: Record<string, unknown>,
  keys: string[],
) {
  const omitted = new Set(keys);
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !omitted.has(key)),
  );
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function truncateForTelegram(value: string, limit: number) {
  const trimmed = value.trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit - 3).trimEnd()}...`;
}
