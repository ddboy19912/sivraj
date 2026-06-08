import { auditEvents, reflectionRuns } from "@sivraj/db";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppDependencies } from "../app.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { authorizeTwinRoute, twinScopedHandler } from "../lib/http/route-auth.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function createReflectionRoutes({ db, weeklyReflectionQueue }: AppDependencies) {
  const reflectionRoutes = new Hono<AuthEnv>();

  reflectionRoutes.get("/", requireAuth, twinScopedHandler("memory:read", async (c, { twinId }) => {
    const rows = await db
      .select()
      .from(reflectionRuns)
      .where(eq(reflectionRuns.twinId, twinId))
      .orderBy(desc(reflectionRuns.createdAt))
      .limit(20);

    return c.json({
      reflections: rows.map((row) => ({
        id: row.id,
        twinId: row.twinId,
        periodStart: row.periodStart.toISOString(),
        periodEnd: row.periodEnd.toISOString(),
        status: row.status,
        summaryStorageRef: row.summaryStorageRef,
        summarySha256: row.summarySha256,
        metadata: row.metadata,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    });
  }));

  reflectionRoutes.post("/weekly", requireAuth, async (c) => {
    const routeAuth = authorizeTwinRoute(c, "memory:read");
    if (!routeAuth.ok) {
      return routeAuth.response;
    }
    const { auth, twinId } = routeAuth.value;

    if (!weeklyReflectionQueue) {
      return c.json({ error: "reflection_queue_not_configured" }, 503);
    }

    const body = await c.req.json().catch(() => ({}));
    const period = readWeeklyPeriod(body);
    const [existing] = await db
      .select()
      .from(reflectionRuns)
      .where(
        and(
          eq(reflectionRuns.twinId, twinId),
          eq(reflectionRuns.periodStart, period.periodStart),
          eq(reflectionRuns.periodEnd, period.periodEnd),
        ),
      )
      .limit(1);

    if (existing && existing.status !== "failed") {
      return c.json({
        reflectionRunId: existing.id,
        status: existing.status,
        periodStart: existing.periodStart.toISOString(),
        periodEnd: existing.periodEnd.toISOString(),
        reused: true,
      });
    }

    const [run] = await db
      .insert(reflectionRuns)
      .values({
        twinId,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        status: "queued",
        metadata: {
          requestedBy: auth.type,
          requestedAt: new Date().toISOString(),
          mode: "on_demand",
        },
      })
      .returning({ id: reflectionRuns.id });

    if (!run) {
      return c.json({ error: "reflection_create_failed" }, 500);
    }

    const job = await weeklyReflectionQueue.enqueueWeeklyReflection({
      reflectionRunId: run.id,
      twinId,
      periodStart: period.periodStart.toISOString(),
      periodEnd: period.periodEnd.toISOString(),
    });

    await db.insert(auditEvents).values({
      twinId,
      actorType: auth.type,
      actorId: auth.sub,
      eventType: "reflection.weekly_requested",
      resourceType: "reflection",
      resourceId: run.id,
      metadata: {
        jobId: job.jobId,
        periodStart: period.periodStart.toISOString(),
        periodEnd: period.periodEnd.toISOString(),
      },
    });

    return c.json({
      reflectionRunId: run.id,
      jobId: job.jobId,
      status: "queued",
      periodStart: period.periodStart.toISOString(),
      periodEnd: period.periodEnd.toISOString(),
      reused: false,
    }, 202);
  });

  return reflectionRoutes;
}

function readWeeklyPeriod(body: unknown): { periodStart: Date; periodEnd: Date } {
  const record = typeof body === "object" && body !== null && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const explicitStart = readDate(record.periodStart);
  const explicitEnd = readDate(record.periodEnd);

  if (explicitStart && explicitEnd && explicitEnd > explicitStart) {
    return {
      periodStart: explicitStart,
      periodEnd: explicitEnd,
    };
  }

  const now = new Date();
  const end = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  ));
  const start = new Date(end.getTime() - WEEK_MS);

  return {
    periodStart: start,
    periodEnd: end,
  };
}

function readDate(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }

  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
