import { readTrimmedStringList } from "@sivraj/core";
import { auditEvents, candidateMemories, graphNodes, memoryFragments, sourceArtifacts } from "@sivraj/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Context } from "hono";
import type { AppDependencies, SupportedArtifactSourceType } from "../../app.js";
import { readEncryptedPayload, type EncryptedPayload } from "../encrypted-payload.js";
import { recordMetadata } from "../safe-metadata.js";
import type { AuthEnv } from "../../middleware/auth.js";

export type { EncryptedPayload } from "../encrypted-payload.js";

export type JsonObjectBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response };

export async function parseJsonObjectBody(
  c: Context<AuthEnv>,
  options?: { rejectArrays?: boolean },
): Promise<JsonObjectBodyResult> {
  const body = await c.req.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return { ok: false, response: c.json({ error: "invalid_json_body" }, 400) };
  }

  if (options?.rejectArrays !== false && Array.isArray(body)) {
    return { ok: false, response: c.json({ error: "invalid_json_body" }, 400) };
  }

  return { ok: true, body: body as Record<string, unknown> };
}

export function optionalString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function optionalRawString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function requiredString(value: unknown): string | null {
  return optionalString(value);
}

export function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function readStringArray(value: unknown): string[] {
  return readTrimmedStringList(value);
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readOptionalQueryUuid(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return UUID_PATTERN.test(trimmed) ? trimmed : null;
}

export function readQueryLimit(
  value: string | undefined,
  fallback: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? String(fallback), 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, max);
}

export function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function optionalSha256(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

export async function findSourceArtifact(
  db: AppDependencies["db"],
  twinId: string,
  artifactId: string,
) {
  const [artifact] = await db
    .select()
    .from(sourceArtifacts)
    .where(
      and(
        eq(sourceArtifacts.id, artifactId),
        eq(sourceArtifacts.twinId, twinId),
      ),
    )
    .limit(1);

  return artifact ?? null;
}

export async function enqueueArtifactProcessingJob(input: {
  db: AppDependencies["db"];
  artifactProcessingQueue: AppDependencies["artifactProcessingQueue"];
  twinId: string;
  artifactId: string;
  sourceType: string;
  transientCiphertext?: {
    base64: string;
    sha256: string;
  };
}): Promise<{ processingJobId: string | null; warning: string | null }> {
  if (!input.artifactProcessingQueue) {
    return {
      processingJobId: null,
      warning: "artifact_processing_queue_not_configured",
    };
  }

  const queued = await input.artifactProcessingQueue
    .enqueueArtifactProcessing({
      artifactId: input.artifactId,
      twinId: input.twinId,
      sourceType: input.sourceType,
      ...(input.transientCiphertext
        ? {
            transientCiphertextBase64: input.transientCiphertext.base64,
            transientCiphertextSha256: input.transientCiphertext.sha256,
          }
        : {}),
    })
    .catch(async (error: unknown) => {
      console.error("artifact processing queue enqueue failed", error);

      await input.db.insert(auditEvents).values({
        twinId: input.twinId,
        actorType: "system",
        actorId: "sivraj-api",
        eventType: "artifact.queue_failed",
        resourceType: "source_artifact",
        resourceId: input.artifactId,
        metadata: {
          error: queueErrorMessage(error),
        },
      });

      return null;
    });

  return {
    processingJobId: queued?.jobId ?? null,
    warning: queued ? null : "artifact_processing_queue_failed",
  };
}

function queueErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown queue error";
}

export type StoredPrivateMemory = {
  rawStorageRef: string;
  ciphertextSha256: string;
  seal: unknown;
  walrus: unknown;
  encryptedBytesBase64?: string;
};

export function readBodyEncryptedPayload(
  body: Record<string, unknown>,
): EncryptedPayload | "invalid" | null {
  if (body["encryptedPayload"] === undefined) {
    return null;
  }

  try {
    return readEncryptedPayload(body["encryptedPayload"]);
  } catch {
    return "invalid";
  }
}

function buildQueuedArtifactMetadata(
  storageMetadata: Record<string, unknown>,
  stored: StoredPrivateMemory,
): Record<string, unknown> {
  return {
    ...storageMetadata,
    ciphertextSha256: stored.ciphertextSha256,
    seal: stored.seal,
    walrus: stored.walrus,
  };
}

export async function insertQueuedSourceArtifact(input: {
  db: AppDependencies["db"];
  twinId: string;
  sourceType: SupportedArtifactSourceType;
  storageMetadata: Record<string, unknown>;
  stored: StoredPrivateMemory;
  hash?: string;
}) {
  const [artifact] = await input.db
    .insert(sourceArtifacts)
    .values({
      twinId: input.twinId,
      sourceType: input.sourceType,
      ...(input.hash ? { hash: input.hash } : {}),
      metadata: buildQueuedArtifactMetadata(input.storageMetadata, input.stored),
      rawStorageRef: input.stored.rawStorageRef,
      ingestionStatus: "queued",
    })
    .returning();

  return artifact;
}

export async function loadPrimaryMemoryFragment(
  db: AppDependencies["db"],
  twinId: string,
  artifactId: string,
) {
  const [memoryFragment] = await db
    .select()
    .from(memoryFragments)
    .where(
      and(
        eq(memoryFragments.twinId, twinId),
        eq(memoryFragments.sourceArtifactId, artifactId),
      ),
    )
    .limit(1);

  return memoryFragment ?? null;
}

export async function selectOrderedGraphNodes(input: {
  db: AppDependencies["db"];
  twinId: string;
  nodeType?: typeof graphNodes.$inferSelect["nodeType"] | null;
  nodeIds?: string[];
  limit: number;
}) {
  const filters = [eq(graphNodes.twinId, input.twinId)];

  if (input.nodeType) {
    filters.push(eq(graphNodes.nodeType, input.nodeType));
  }

  if (input.nodeIds && input.nodeIds.length > 0) {
    filters.push(inArray(graphNodes.id, input.nodeIds));
  }

  return input.db
    .select()
    .from(graphNodes)
    .where(and(...filters))
    .orderBy(desc(graphNodes.updatedAt))
    .limit(input.limit);
}

export async function queryTwinCandidateMemories(input: {
  db: AppDependencies["db"];
  twinId: string;
  artifactId?: string | null;
  status?: typeof candidateMemories.$inferSelect["status"] | null;
  limit: number;
}) {
  const filters = [eq(candidateMemories.twinId, input.twinId)];

  if (input.artifactId) {
    filters.push(eq(candidateMemories.sourceArtifactId, input.artifactId));
  }

  if (input.status) {
    filters.push(eq(candidateMemories.status, input.status));
  }

  return input.db
    .select()
    .from(candidateMemories)
    .where(and(...filters))
    .orderBy(desc(candidateMemories.createdAt))
    .limit(input.limit);
}
