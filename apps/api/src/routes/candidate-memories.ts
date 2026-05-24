import { candidateMemories } from "@sivraj/db";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppDependencies } from "../app.js";
import { sanitizeSafeMetadata } from "../lib/safe-metadata.js";
import { requireAuth, requireScope, type AuthEnv } from "../middleware/auth.js";

export function createCandidateMemoryRoutes({ db }: AppDependencies) {
  const routes = new Hono<AuthEnv>();

  routes.get("/", requireAuth, async (c) => {
    const scopeError = requireScope(c, "memory:read");

    if (scopeError) {
      return scopeError;
    }

    const auth = c.get("auth");
    const twinId = c.req.param("twinId");

    if (!twinId) {
      return c.json({ error: "missing_twin_id" }, 400);
    }

    if (auth.type !== "service" && auth.twinId !== twinId) {
      return c.json({ error: "twin_scope_mismatch" }, 403);
    }

    const artifactId = readOptionalUuid(c.req.query("artifactId"));
    const status = readOptionalStatus(c.req.query("status"));
    const limit = readLimit(c.req.query("limit"));

    const filters = [eq(candidateMemories.twinId, twinId)];

    if (artifactId) {
      filters.push(eq(candidateMemories.sourceArtifactId, artifactId));
    }

    if (status) {
      filters.push(eq(candidateMemories.status, status));
    }

    const rows = await db
      .select()
      .from(candidateMemories)
      .where(and(...filters))
      .orderBy(desc(candidateMemories.createdAt))
      .limit(limit);

    return c.json({
      policy: {
        rawArtifactsIncluded: false,
        scope: "memory:read",
      },
      candidateMemories: rows.map((row) => ({
        id: row.id,
        twinId: row.twinId,
        canonicalMemoryId: row.canonicalMemoryId,
        sourceArtifactId: row.sourceArtifactId,
        memoryFragmentId: row.memoryFragmentId,
        memoryType: row.memoryType,
        status: row.status,
        statementStorageRef: row.statementStorageRef,
        statementSha256: row.statementSha256,
        evidenceHash: row.evidenceHash,
        evidenceLength: row.evidenceLength,
        confidenceScore: row.confidenceScore,
        subject: readSafeSubject(row.metadata),
        metadata: sanitizeSafeMetadata(row.metadata),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    });
  });

  return routes;
}

function readOptionalUuid(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}

function readOptionalStatus(value: string | undefined): "candidate" | "approved" | "rejected" | "superseded" | null {
  return value === "candidate" ||
    value === "approved" ||
    value === "rejected" ||
    value === "superseded"
    ? value
    : null;
}

function readLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "50", 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return 50;
  }

  return Math.min(parsed, 200);
}

function readSafeSubject(metadata: unknown): string | null {
  const subject = sanitizeSafeMetadata(metadata)["subject"];

  return typeof subject === "string" && subject.length > 0 ? subject : null;
}
