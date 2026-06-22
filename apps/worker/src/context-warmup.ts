import { canonicalMemories, contextRuntimePackets } from "@sivraj/db";
import type { ContextWarmupJobData } from "@sivraj/queue";
import { and, desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { createWorkerDb } from "./db.js";

type WorkerDb = ReturnType<typeof createWorkerDb>["db"];

export async function processContextWarmup(input: {
  db: Pick<WorkerDb, "select" | "insert" | "update">;
  data: ContextWarmupJobData;
}) {
  const now = new Date();
  const items = await loadPersonalHotMemoryItems(input.db, input.data.twinId);
  const sourceRefs = collectSourceRefs(items);
  const scopeKey = input.data.scope ?? "default";
  const payload = {
    kind: "personal_hot_memory",
    scopeKey,
    items,
    counts: {
      items: items.length,
      sourceRefs: sourceRefs.length,
    },
    rawPrivateSourceIncluded: false,
  };
  const versionHash = createHash("sha256")
    .update(JSON.stringify({ payload, sourceRefs }))
    .digest("hex");
  const [existing] = await input.db
    .select({ id: contextRuntimePackets.id })
    .from(contextRuntimePackets)
    .where(
      and(
        eq(contextRuntimePackets.twinId, input.data.twinId),
        eq(contextRuntimePackets.kind, "personal_hot_memory"),
        eq(contextRuntimePackets.scopeKey, scopeKey),
      ),
    )
    .limit(1);

  if (existing) {
    await input.db
      .update(contextRuntimePackets)
      .set({
        status: "ready",
        payload,
        sourceRefs,
        versionHash,
        generatedAt: now,
        staleAt: null,
        expiresAt: null,
        metadata: {
          reason: input.data.reason,
          surface: input.data.surface,
          requestedBy: input.data.requestedBy,
        },
        updatedAt: now,
      })
      .where(eq(contextRuntimePackets.id, existing.id));
  } else {
    await input.db
      .insert(contextRuntimePackets)
      .values({
        twinId: input.data.twinId,
        kind: "personal_hot_memory",
        scopeKey,
        status: "ready",
        payload,
        sourceRefs,
        versionHash,
        generatedAt: now,
        metadata: {
          reason: input.data.reason,
          surface: input.data.surface,
          requestedBy: input.data.requestedBy,
        },
      });
  }

  return {
    status: "completed" as const,
    itemCount: items.length,
    sourceRefCount: sourceRefs.length,
  };
}

async function loadPersonalHotMemoryItems(db: Parameters<typeof processContextWarmup>[0]["db"], twinId: string) {
  const rows = await db
    .select()
    .from(canonicalMemories)
    .where(and(eq(canonicalMemories.twinId, twinId), eq(canonicalMemories.status, "approved")))
    .orderBy(desc(canonicalMemories.lastSeenAt))
    .limit(50);

  return rows.flatMap((row) => {
    const currentTruth = readCurrentTruth(row.metadata);
    if (!currentTruth || currentTruth.kind === "engineering_memory") {
      return [];
    }

    return [{
      id: `canonical:${row.id}`,
      kind: "current_fact",
      label: currentTruth.slot.replace(/_/g, " "),
      content: `${row.subject ?? "the user"}'s ${currentTruth.slot.replace(/_/g, " ")} is ${currentTruth.value}.`,
      status: "approved",
      confidenceScore: row.confidenceScore,
      sourceRefs: [{
        type: "canonical_memory",
        id: row.id,
        label: row.canonicalKey,
      }],
    }];
  });
}

function collectSourceRefs(items: Array<{ sourceRefs: Array<{ type: string; id: string; label?: string | null }> }>) {
  const sourceRefs = new Map<string, { type: string; id: string; label?: string | null }>();
  for (const item of items) {
    for (const ref of item.sourceRefs) {
      sourceRefs.set(`${ref.type}:${ref.id}`, ref);
    }
  }
  return Array.from(sourceRefs.values());
}

function readCurrentTruth(metadata: unknown) {
  const record = readRecord(metadata);
  const currentTruth = readRecord(record["currentTruth"]);
  const slot = readString(currentTruth["slot"]);
  const value = readString(currentTruth["value"]);
  if (!slot || !value || readString(currentTruth["status"]) === "inactive") {
    return null;
  }
  return {
    kind: readString(currentTruth["kind"]) ?? "profile_fact",
    slot,
    value,
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
