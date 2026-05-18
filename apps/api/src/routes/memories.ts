import {
  retrieveRelevantMemories,
  type MemoryCandidate,
} from "@sivraj/retrieval";
import { auditEvents, memoryFragments } from "@sivraj/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppDependencies } from "../app.js";
import { requireAuth, requireScope, type AuthEnv } from "../middleware/auth.js";

export function createMemoryRoutes({ db }: AppDependencies) {
  const memoryRoutes = new Hono<AuthEnv>();

  memoryRoutes.post("/search", requireAuth, async (c) => {
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

    const body = await c.req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return c.json({ error: "invalid_json_body" }, 400);
    }

    const query = requiredString(body["query"]);
    const limit = optionalLimit(body["limit"]);

    if (!query) {
      return c.json({ error: "missing_query" }, 400);
    }

    const rows = await db
      .select()
      .from(memoryFragments)
      .where(eq(memoryFragments.twinId, twinId))
      .limit(200);
    const results = retrieveRelevantMemories(rows.map(toCandidate), {
      query,
      limit,
    });

    await db.insert(auditEvents).values({
      twinId,
      actorType: auth.type,
      actorId: auth.sub,
      eventType: "memory.search",
      resourceType: "twin",
      resourceId: twinId,
      metadata: {
        query,
        resultCount: results.length,
        memoryFragmentIds: results.map((result) => result.memory.id),
      },
    });

    return c.json({
      query,
      results: results.map((result) => ({
        id: result.memory.id,
        sourceArtifactId: result.memory.sourceArtifactId,
        content: result.memory.content,
        summary: result.memory.summary,
        score: result.score,
        matchedTerms: result.matchedTerms,
        citation: {
          sourceArtifactId: result.memory.sourceArtifactId,
        },
      })),
      policy: {
        rawArtifactsIncluded: false,
        scope: "memory:read",
      },
    });
  });

  return memoryRoutes;
}

function toCandidate(
  row: typeof memoryFragments.$inferSelect,
): MemoryCandidate {
  return {
    id: row.id,
    twinId: row.twinId,
    sourceArtifactId: row.sourceArtifactId,
    content: row.content,
    summary: row.summary,
    importanceScore: row.importanceScore,
    confidenceScore: row.confidenceScore,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
  };
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function optionalLimit(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
