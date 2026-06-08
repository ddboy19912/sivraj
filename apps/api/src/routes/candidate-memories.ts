import { candidateMemories } from "@sivraj/db";
import { Hono } from "hono";
import type { AppDependencies } from "../app.js";
import { sanitizeSafeMetadata } from "../lib/safe-metadata.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { authorizeTwinRoute, twinScopedHandler } from "../lib/http/route-auth.js";
import { queryTwinCandidateMemories, readOptionalQueryUuid, readQueryLimit } from "../lib/http/route-helpers.js";

export function createCandidateMemoryRoutes({ db }: AppDependencies) {
  const routes = new Hono<AuthEnv>();

  routes.get("/", requireAuth, twinScopedHandler("memory:read", async (c, { twinId }) => {
    const artifactId = readOptionalQueryUuid(c.req.query("artifactId"));
    const status = readOptionalStatus(c.req.query("status"));
    const limit = readQueryLimit(c.req.query("limit"), 50, 200);
    const rows = await queryTwinCandidateMemories({
      db,
      twinId,
      artifactId,
      status,
      limit,
    });

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
  }));

  return routes;
}

function readOptionalStatus(value: string | undefined): "candidate" | "approved" | "rejected" | "superseded" | null {
  return value === "candidate" ||
    value === "approved" ||
    value === "rejected" ||
    value === "superseded"
    ? value
    : null;
}

function readSafeSubject(metadata: unknown): string | null {
  const subject = sanitizeSafeMetadata(metadata)["subject"];

  return typeof subject === "string" && subject.length > 0 ? subject : null;
}
