/**
 * Canonical current-truth (hot memory) helpers for chat retrieval and turn planning.
 *
 * Current-truth rows are approved canonical memories surfaced without full archive search.
 */
import { canonicalMemories } from "@sivraj/db";
import { and, desc, eq, sql } from "drizzle-orm";
import type { MemoryCandidate } from "@sivraj/retrieval";
import type { ApiDb } from "../../app.js";
import type { ConversationContextResolution } from "./turn-types.js";
import type { TurnPlanningMemoryHint } from "./turn-types.js";
import { readPositiveInteger, truncate } from "./helpers.js";
import { optionalString, readRecord } from "../http/route-helpers.js";
import { readMemoryTokenAccounting } from "./token-accounting.js";

export const CHAT_CURRENT_TRUTH_CONTEXT_LIMIT_DEFAULT = 12;

export function shouldUseHotCurrentTruthFallback(
  _query: string,
  contextResolution: Pick<ConversationContextResolution, "retrieval" | "intent" | "answerTarget"> | {
    retrieval?: string;
    intent?: string;
    answerTarget?: string;
  },
): boolean {
  if (
    contextResolution?.retrieval === "document"
    || contextResolution?.intent === "document_qa"
    || contextResolution?.answerTarget === "document"
  ) {
    return false;
  }
  return contextResolution?.retrieval === "hot_memory"
    || contextResolution?.answerTarget === "memory"
    || contextResolution?.intent === "memory_qa";
}

export function selectCurrentTruthMemoryResults(candidates: MemoryCandidate[]) {
  return candidates
    .slice(
      0,
      readPositiveInteger(
        process.env["CHAT_CURRENT_TRUTH_CONTEXT_LIMIT"],
        CHAT_CURRENT_TRUTH_CONTEXT_LIMIT_DEFAULT,
      ),
    )
    .map((memory, index) => ({
      memory,
      score: Number((30 - index).toFixed(4)),
      matchedTerms: ["current-truth"],
    }));
}

/** Load approved canonical memories used as hot-memory hits and planner hints. */
export async function loadCanonicalCurrentTruthSearchCandidates(input: {
  db: ApiDb;
  twinId: string;
}) {
  const rows = await input.db
    .select()
    .from(canonicalMemories)
    .where(and(
      eq(canonicalMemories.twinId, input.twinId),
      eq(canonicalMemories.status, "approved"),
      sql`${canonicalMemories.metadata}->'currentTruth' is not null`,
    ))
    .orderBy(desc(canonicalMemories.updatedAt))
    .limit(24);
  const candidates: MemoryCandidate[] = [];
  const canonicalMemoryIdsByCandidateId = new Map<string, string>();
  const tokenAccountingByCandidateId = new Map<string, ReturnType<typeof readMemoryTokenAccounting>>();
  for (const row of rows) {
    const currentTruth = readCurrentTruthContext(row.metadata);
    if (!currentTruth) {
      continue;
    }
    const id = `canonical-current-truth:${row.id}`;
    const content = formatCurrentTruthSearchContent({
      subject: row.subject,
      currentTruth,
    });
    candidates.push({
      id,
      twinId: row.twinId,
      sourceArtifactId: currentTruth.sourceArtifactId || row.id,
      content,
      summary: content,
      importanceScore: 1,
      confidenceScore: row.confidenceScore,
      occurredAt: row.lastSeenAt,
      createdAt: row.updatedAt,
    });
    canonicalMemoryIdsByCandidateId.set(id, row.id);
    tokenAccountingByCandidateId.set(id, readMemoryTokenAccounting(null, content));
  }
  return {
    candidates,
    canonicalMemoryIdsByCandidateId,
    tokenAccountingByCandidateId,
  };
}

/** Compact hot-memory hints fed to the turn planner resolver prompt. */
export async function loadTurnPlanningMemoryHints(
  db: ApiDb,
  twinId: string,
): Promise<TurnPlanningMemoryHint[]> {
  const rows = await db
    .select({
      id: canonicalMemories.id,
      subject: canonicalMemories.subject,
      metadata: canonicalMemories.metadata,
      updatedAt: canonicalMemories.updatedAt,
    })
    .from(canonicalMemories)
    .where(and(
      eq(canonicalMemories.twinId, twinId),
      eq(canonicalMemories.status, "approved"),
      sql`${canonicalMemories.metadata}->'currentTruth' is not null`,
    ))
    .orderBy(desc(canonicalMemories.updatedAt))
    .limit(readPositiveInteger(process.env["CHAT_TURN_PLANNING_MEMORY_HINT_LIMIT"], 40));
  return rows.flatMap((row) => {
    const currentTruth = readCurrentTruthContext(row.metadata);
    return currentTruth
      ? [formatTurnPlanningMemoryHint({
          id: row.id,
          subject: row.subject,
          currentTruth,
          updatedAt: row.updatedAt,
        })]
      : [];
  });
}

export function formatTurnPlanningMemoryHint(input: {
  id: string;
  subject: string | null;
  currentTruth: NonNullable<ReturnType<typeof readCurrentTruthContext>>;
  updatedAt: Date;
}): TurnPlanningMemoryHint {
  const slot = input.currentTruth.slot.replace(/_/g, " ");
  const qualifier = input.currentTruth.qualifier?.replace(/_/g, " ");
  const subject = input.subject ?? "the user";
  const label = input.currentTruth.kind === "engineering_memory"
    ? [
        input.currentTruth.engineeringInstructionScope?.replace(/_/g, " "),
        input.currentTruth.engineeringMemoryType?.replace(/_/g, " ") ?? slot,
        input.currentTruth.engineeringSubject ?? input.subject,
      ].filter(Boolean).join(" ")
    : input.currentTruth.kind === "note"
      ? [qualifier, slot].filter(Boolean).join(" ")
      : [subject, qualifier, slot].filter(Boolean).join(" ");
  return {
    id: input.id,
    label,
    kind: input.currentTruth.kind,
    slot: input.currentTruth.slot,
    qualifier: input.currentTruth.qualifier,
    value: truncate(input.currentTruth.value, 160),
    sourceMessagePreview: input.currentTruth.sourceMessagePreview
      ? truncate(input.currentTruth.sourceMessagePreview, 220)
      : null,
    updatedAt: input.updatedAt.toISOString(),
  };
}

export function readCurrentTruthContext(metadata: unknown) {
  const metadataRecord = readRecord(metadata);
  const currentTruth = readRecord(metadataRecord?.["currentTruth"]);
  const slot = optionalString(currentTruth?.["slot"]);
  const value = optionalString(currentTruth?.["value"]);
  if (!slot || !value || optionalString(currentTruth?.["status"]) === "inactive") {
    return null;
  }
  return {
    kind: optionalString(currentTruth?.["kind"]) ?? "profile_fact",
    slot,
    qualifier: optionalString(currentTruth?.["qualifier"]),
    value,
    valueType: optionalString(currentTruth?.["valueType"]) ?? "string",
    mutable: currentTruth?.["mutable"] !== false,
    sourceArtifactId: optionalString(currentTruth?.["sourceArtifactId"]),
    sourceMessagePreview: optionalString(metadataRecord?.["lastIntakeMessagePreview"]),
    engineeringMemoryType: optionalString(currentTruth?.["engineeringMemoryType"])
      ?? optionalString(metadataRecord?.["engineeringMemoryType"]),
    engineeringInstructionScope: optionalString(currentTruth?.["engineeringInstructionScope"])
      ?? optionalString(metadataRecord?.["engineeringInstructionScope"]),
    engineeringSubject: optionalString(currentTruth?.["subject"])
      ?? optionalString(metadataRecord?.["engineeringSubject"]),
    agentContextLine: optionalString(currentTruth?.["agentContextLine"])
      ?? optionalString(metadataRecord?.["agentContextLine"]),
    codeReference: optionalString(currentTruth?.["codeReference"])
      ?? optionalString(metadataRecord?.["codeReference"]),
  };
}

export function formatCurrentTruthSearchContent(input: {
  subject: string | null;
  currentTruth: NonNullable<ReturnType<typeof readCurrentTruthContext>>;
}) {
  const subject = input.subject ?? "the user";
  if (input.currentTruth.kind === "engineering_memory") {
    const type = input.currentTruth.engineeringMemoryType ?? input.currentTruth.slot;
    const scope = input.currentTruth.engineeringInstructionScope ?? input.currentTruth.qualifier;
    const engineeringSubject = input.currentTruth.engineeringSubject ?? input.subject;
    return [
      `Engineering memory: ${input.currentTruth.agentContextLine ?? input.currentTruth.value}`,
      ...(engineeringSubject ? [`Subject: ${engineeringSubject}`] : []),
      `Type: ${type}`,
      ...(scope ? [`Scope: ${scope}`] : []),
      `Value: ${input.currentTruth.value}`,
      ...(input.currentTruth.codeReference ? [`Code reference: ${input.currentTruth.codeReference}`] : []),
      ...(input.currentTruth.sourceMessagePreview
        ? [`Original remembered statement: ${input.currentTruth.sourceMessagePreview}`]
        : []),
      `Kind: ${input.currentTruth.kind}`,
    ].join("\n");
  }
  if (input.currentTruth.kind === "note") {
    const slot = input.currentTruth.slot.replace(/_/g, " ");
    const qualifier = input.currentTruth.qualifier?.replace(/_/g, " ");
    const describedNote = qualifier ? `${qualifier} ${slot}` : slot;
    return [
      `Remembered note about ${subject}'s ${describedNote}: ${input.currentTruth.value}.`,
      `Subject: ${subject}`,
      `Slot: ${input.currentTruth.slot}`,
      ...(input.currentTruth.qualifier ? [`Qualifier: ${input.currentTruth.qualifier}`] : []),
      `Value: ${input.currentTruth.value}`,
      ...(input.currentTruth.sourceMessagePreview
        ? [`Original remembered statement: ${input.currentTruth.sourceMessagePreview}`]
        : []),
      `Kind: ${input.currentTruth.kind}`,
    ].join("\n");
  }
  const slot = input.currentTruth.slot.replace(/_/g, " ");
  const qualifier = input.currentTruth.qualifier?.replace(/_/g, " ");
  const describedSlot = qualifier ? `${qualifier} ${slot}` : slot;
  return [
    `Current profile fact: ${subject}'s ${describedSlot} is ${input.currentTruth.value}.`,
    `Subject: ${subject}`,
    `Slot: ${input.currentTruth.slot}`,
    ...(input.currentTruth.qualifier ? [`Qualifier: ${input.currentTruth.qualifier}`] : []),
    `Value: ${input.currentTruth.value}`,
    `Kind: ${input.currentTruth.kind}`,
  ].join("\n");
}

export function resolveUserMemorySubject(context: {
  displayName: string | null;
  aliases: string[];
}) {
  const alias = context.aliases
    .map(optionalString)
    .find((value): value is string => Boolean(value));
  return optionalString(context.displayName)
    ?? alias
    ?? "the user";
}
