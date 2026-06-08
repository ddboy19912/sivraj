import type { Context } from "hono";
import type { AppDependencies } from "../../app.js";
import { sanitizeSafeMetadata } from "../safe-metadata.js";
import type { AuthEnv } from "../../middleware/auth.js";
import { auditEvents } from "@sivraj/db";
import { desc, eq } from "drizzle-orm";

export const SECURITY_EXPORT_NOTICE =
  "This export contains database metadata, references, hashes, status, and safe metadata only. It does not decrypt Seal/Walrus ciphertext or include raw private source text.";

export async function rowsForTwin(
  db: AppDependencies["db"],
  table: any,
  twinId: string,
  limit = 500,
) {
  const query = db
    .select()
    .from(table)
    .where(eq(table.twinId, twinId));

  if (table.createdAt) {
    return query.orderBy(desc(table.createdAt)).limit(limit);
  }

  return query.limit(limit);
}

export async function recordSecurityAudit(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  eventType: string,
  resourceType: string,
  resourceId: string,
  metadata: Record<string, unknown>,
) {
  const auth = c.get("auth");

  await db.insert(auditEvents).values({
    twinId: c.req.param("twinId") ?? "",
    actorType: auth.type,
    actorId: auth.sub,
    eventType,
    resourceType,
    resourceId,
    metadata,
  });
}

export function redactMetadata<T extends { metadata?: unknown }>(row: T) {
  return {
    ...row,
    metadata: sanitizeSafeMetadata(row.metadata),
  };
}

export function redactConnectorAccount<T extends { metadata?: unknown; tokenRef?: unknown }>(
  row: T,
) {
  return {
    ...redactMetadata(row),
    tokenRef: row.tokenRef ? "redacted" : null,
  };
}

export function redactAgentWriteback<T extends { payload?: unknown; status?: unknown }>(row: T) {
  const payload = row.payload && typeof row.payload === "object"
    ? (row.payload as Record<string, unknown>)
    : {};

  return {
    ...row,
    payload: {
      kind: payload["kind"] ?? null,
      status: row.status ?? null,
      counts: payload["counts"] ?? null,
      storage: sanitizeSafeMetadata(payload["storage"]),
    },
  };
}
