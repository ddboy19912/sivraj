import { auditEvents, twins } from "@sivraj/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppDependencies } from "../app.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { twinScopedHandler, twinScopedJsonHandler } from "../lib/http/route-auth.js";

type TwinProfileResponse = {
  twinId: string;
  name: string;
};

export function createTwinProfileRoutes({ db }: AppDependencies) {
  const routes = new Hono<AuthEnv>();

  routes.get("/profile", requireAuth, twinScopedHandler(undefined, async (c, { twinId }) => {
    const [twin] = await db
      .select()
      .from(twins)
      .where(eq(twins.id, twinId))
      .limit(1);

    if (!twin) {
      return c.json({ error: "twin_not_found" }, 404);
    }

    return c.json(formatTwinProfile(twinId, twin));
  }));

  routes.put("/profile", requireAuth, twinScopedJsonHandler(undefined, async (c, { auth, twinId, body }) => {
    const name = requiredTrimmedString(body["name"]);

    if (!name || name.length > 80) {
      return c.json({ error: "invalid_twin_name" }, 400);
    }

    const [profile] = await db
      .update(twins)
      .set({
        name,
        updatedAt: new Date(),
      })
      .where(eq(twins.id, twinId))
      .returning();

    if (!profile) {
      return c.json({ error: "twin_not_found" }, 404);
    }

    writeTwinProfileAuditEvent(db, {
      twinId,
      actorType: auth.type,
      actorId: auth.sub,
      eventType: "twin_profile.updated",
      resourceType: "twin",
      resourceId: twinId,
      metadata: {
        walletAddress: auth.walletAddress,
        nameLength: name.length,
      },
    });

    return c.json(formatTwinProfile(twinId, profile));
  }));

  return routes;
}

function formatTwinProfile(twinId: string, twin: unknown): TwinProfileResponse {
  const record = twin && typeof twin === "object"
    ? twin as Record<string, unknown>
    : {};

  return {
    twinId,
    name: requiredTrimmedString(record["name"]) ?? "Primary Twin",
  };
}

function requiredTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function writeTwinProfileAuditEvent(
  db: AppDependencies["db"],
  event: typeof auditEvents.$inferInsert,
) {
  void Promise.resolve(db.insert(auditEvents).values(event)).catch(
    (error: unknown) => {
      console.error("twin profile audit write failed", error);
    },
  );
}
