import { canonicalMemories, contextRuntimePackets, twinIdentityProfiles, twins } from "@sivraj/db";
import { and, desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { ApiDb } from "../../app.js";
import type {
  ContextRuntimeItem,
  ContextRuntimePacketKind,
  ContextRuntimeSourceRef,
  ContextRuntimeSurface,
} from "./types.js";

export type RefreshContextRuntimePacketsInput = {
  db: ApiDb;
  twinId: string;
  surface?: ContextRuntimeSurface;
  reason?: string;
  scopeKey?: string;
  now?: Date;
};

export async function refreshContextRuntimePackets(input: RefreshContextRuntimePacketsInput): Promise<{
  packetIds: string[];
  items: ContextRuntimeItem[];
}> {
  const now = input.now ?? new Date();
  const scopeKey = input.scopeKey ?? "default";
  const coreProfileItems = await loadCoreProfileItems(input.db, input.twinId);
  const hotMemoryItems = await loadCanonicalHotMemoryItems(input.db, input.twinId);
  const packetIds: string[] = [];

  const corePacket = await upsertContextRuntimePacket({
    db: input.db,
    twinId: input.twinId,
    kind: "core_profile",
    scopeKey,
    items: coreProfileItems,
    sourceRefs: collectSourceRefs(coreProfileItems),
    now,
    metadata: {
      reason: input.reason ?? "manual",
      surface: input.surface ?? null,
    },
  });
  packetIds.push(corePacket.id);

  const personalPacket = await upsertContextRuntimePacket({
    db: input.db,
    twinId: input.twinId,
    kind: "personal_hot_memory",
    scopeKey,
    items: hotMemoryItems,
    sourceRefs: collectSourceRefs(hotMemoryItems),
    now,
    metadata: {
      reason: input.reason ?? "manual",
      surface: input.surface ?? null,
      candidateIncluded: false,
      rawPrivateSourceIncluded: false,
    },
  });
  packetIds.push(personalPacket.id);

  return {
    packetIds,
    items: [...coreProfileItems, ...hotMemoryItems],
  };
}

export async function loadReadyContextRuntimePackets(input: {
  db: ApiDb;
  twinId: string;
  kinds?: ContextRuntimePacketKind[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const rows = await input.db
    .select()
    .from(contextRuntimePackets)
    .where(
      and(
        eq(contextRuntimePackets.twinId, input.twinId),
        eq(contextRuntimePackets.status, "ready"),
      ),
    )
    .orderBy(desc(contextRuntimePackets.generatedAt))
    .limit(24);

  const kinds = input.kinds ? new Set(input.kinds) : null;
  return rows.filter((row) =>
    (!kinds || kinds.has(row.kind)) &&
    (!row.expiresAt || row.expiresAt > now)
  );
}

export function contextItemsFromRuntimePackets(rows: Array<typeof contextRuntimePackets.$inferSelect>): ContextRuntimeItem[] {
  return rows.flatMap((row) => {
    const payload = readRecord(row.payload);
    const items = payload["items"];
    return Array.isArray(items)
      ? items.flatMap((item) => readContextRuntimeItem(item, row.id))
      : [];
  });
}

async function loadCoreProfileItems(db: ApiDb, twinId: string): Promise<ContextRuntimeItem[]> {
  const [twin] = await db
    .select({
      id: twins.id,
      name: twins.name,
      summary: twins.summary,
    })
    .from(twins)
    .where(eq(twins.id, twinId))
    .limit(1);
  const [identity] = await db
    .select()
    .from(twinIdentityProfiles)
    .where(eq(twinIdentityProfiles.twinId, twinId))
    .limit(1);
  const sourceRefs: ContextRuntimeSourceRef[] = [];

  if (!twin && !identity) {
    return [];
  }

  const lines = [
    twin?.name ? `Twin name: ${twin.name}` : null,
    identity?.displayName ? `User display name: ${identity.displayName}` : null,
    identity?.aliases?.length ? `User aliases: ${identity.aliases.join(", ")}` : null,
    twin?.summary ? `Twin summary: ${twin.summary}` : null,
  ].filter((line): line is string => Boolean(line));

  return lines.length === 0
    ? []
    : [{
        id: `core-profile:${twinId}`,
        kind: "core_profile",
        label: "Core profile",
        content: lines.join("\n"),
        status: "derived",
        confidenceScore: 1,
        sourceRefs,
      }];
}

async function loadCanonicalHotMemoryItems(db: ApiDb, twinId: string): Promise<ContextRuntimeItem[]> {
  const rows = await db
    .select()
    .from(canonicalMemories)
    .where(
      and(
        eq(canonicalMemories.twinId, twinId),
        eq(canonicalMemories.status, "approved"),
      ),
    )
    .orderBy(desc(canonicalMemories.lastSeenAt))
    .limit(50);

  return rows.flatMap((row) => {
    const currentTruth = readCurrentTruth(row.metadata);
    if (!currentTruth) {
      return [];
    }
    const content = formatCurrentTruthItem({
      subject: row.subject ?? "the user",
      currentTruth,
    });

    return [{
      id: `canonical:${row.id}`,
      kind: currentTruth.kind === "engineering_memory" ? "engineering_memory" : "current_fact",
      label: currentTruth.slot.replace(/_/g, " "),
      content,
      status: "approved",
      confidenceScore: row.confidenceScore,
      sourceRefs: [{
        type: "canonical_memory",
        id: row.id,
        label: row.canonicalKey,
      }],
    } satisfies ContextRuntimeItem];
  });
}

async function upsertContextRuntimePacket(input: {
  db: ApiDb;
  twinId: string;
  kind: ContextRuntimePacketKind;
  scopeKey: string;
  items: ContextRuntimeItem[];
  sourceRefs: ContextRuntimeSourceRef[];
  now: Date;
  metadata: Record<string, unknown>;
}) {
  const payload = {
    kind: input.kind,
    scopeKey: input.scopeKey,
    items: input.items,
    counts: {
      items: input.items.length,
      sourceRefs: input.sourceRefs.length,
    },
    rawPrivateSourceIncluded: false,
  };
  const versionHash = hashJson({
    payload,
    sourceRefs: input.sourceRefs,
  });
  const [existing] = await input.db
    .select({ id: contextRuntimePackets.id })
    .from(contextRuntimePackets)
    .where(
      and(
        eq(contextRuntimePackets.twinId, input.twinId),
        eq(contextRuntimePackets.kind, input.kind),
        eq(contextRuntimePackets.scopeKey, input.scopeKey),
      ),
    )
    .limit(1);

  if (existing) {
    const [updated] = await input.db
      .update(contextRuntimePackets)
      .set({
        status: "ready",
        payload,
        sourceRefs: input.sourceRefs,
        versionHash,
        generatedAt: input.now,
        staleAt: null,
        expiresAt: null,
        metadata: input.metadata,
        updatedAt: input.now,
      })
      .where(eq(contextRuntimePackets.id, existing.id))
      .returning({ id: contextRuntimePackets.id });

    return updated ?? existing;
  }

  const [inserted] = await input.db
    .insert(contextRuntimePackets)
    .values({
      twinId: input.twinId,
      kind: input.kind,
      scopeKey: input.scopeKey,
      status: "ready",
      payload,
      sourceRefs: input.sourceRefs,
      versionHash,
      generatedAt: input.now,
      metadata: input.metadata,
    })
    .returning({ id: contextRuntimePackets.id });

  return inserted ?? { id: `${input.kind}:${input.scopeKey}` };
}

function collectSourceRefs(items: ContextRuntimeItem[]): ContextRuntimeSourceRef[] {
  const sourceRefs = new Map<string, ContextRuntimeSourceRef>();
  for (const item of items) {
    for (const ref of item.sourceRefs) {
      sourceRefs.set(`${ref.type}:${ref.id}`, ref);
    }
  }
  return Array.from(sourceRefs.values());
}

function readContextRuntimeItem(value: unknown, packetId: string): ContextRuntimeItem[] {
  const item = readRecord(value);
  const id = readString(item["id"]) ?? `packet-item:${packetId}`;
  const kind = readString(item["kind"]);
  const label = readString(item["label"]) ?? "Context";
  const content = readString(item["content"]);
  const status = readString(item["status"]);

  if (!content || !isContextItemKind(kind) || !isContextItemStatus(status)) {
    return [];
  }

  return [{
    id,
    kind,
    label,
    content,
    status,
    confidenceScore: typeof item["confidenceScore"] === "number" ? item["confidenceScore"] : null,
    sourceRefs: readSourceRefs(item["sourceRefs"]),
  }];
}

function readSourceRefs(value: unknown): ContextRuntimeSourceRef[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const record = readRecord(entry);
    const type = readString(record["type"]);
    const id = readString(record["id"]);
    if (!id || !isSourceRefType(type)) {
      return [];
    }
    return [{
      type,
      id,
      label: readString(record["label"]),
    }];
  });
}

function readCurrentTruth(metadata: unknown) {
  const metadataRecord = readRecord(metadata);
  const currentTruth = readRecord(metadataRecord["currentTruth"]);
  const slot = readString(currentTruth["slot"]);
  const value = readString(currentTruth["value"]);
  if (!slot || !value || readString(currentTruth["status"]) === "inactive") {
    return null;
  }

  return {
    kind: readString(currentTruth["kind"]) ?? "profile_fact",
    slot,
    qualifier: readString(currentTruth["qualifier"]),
    value,
    agentContextLine: readString(currentTruth["agentContextLine"]) ?? readString(metadataRecord["agentContextLine"]),
    engineeringMemoryType: readString(currentTruth["engineeringMemoryType"]) ?? readString(metadataRecord["engineeringMemoryType"]),
    engineeringSubject: readString(currentTruth["subject"]) ?? readString(metadataRecord["engineeringSubject"]),
  };
}

function formatCurrentTruthItem(input: {
  subject: string;
  currentTruth: NonNullable<ReturnType<typeof readCurrentTruth>>;
}) {
  if (input.currentTruth.kind === "engineering_memory") {
    const type = input.currentTruth.engineeringMemoryType ?? input.currentTruth.slot;
    const subject = input.currentTruth.engineeringSubject ?? input.subject;
    return [
      `Engineering memory: ${input.currentTruth.agentContextLine ?? input.currentTruth.value}`,
      `Subject: ${subject}`,
      `Type: ${type}`,
      `Value: ${input.currentTruth.value}`,
    ].join("\n");
  }

  const slot = input.currentTruth.slot.replace(/_/g, " ");
  const qualifier = input.currentTruth.qualifier?.replace(/_/g, " ");
  const label = qualifier ? `${qualifier} ${slot}` : slot;
  return `${input.subject}'s ${label} is ${input.currentTruth.value}.`;
}

function hashJson(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isContextItemKind(value: string | null): value is ContextRuntimeItem["kind"] {
  return value === "core_profile" ||
    value === "current_fact" ||
    value === "engineering_memory" ||
    value === "context_packet";
}

function isContextItemStatus(value: string | null): value is ContextRuntimeItem["status"] {
  return value === "approved" || value === "candidate" || value === "derived";
}

function isSourceRefType(value: string | null): value is ContextRuntimeSourceRef["type"] {
  return value === "canonical_memory" ||
    value === "context_runtime_packet" ||
    value === "source_artifact" ||
    value === "memory_fragment" ||
    value === "candidate_memory";
}
