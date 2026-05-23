import { auditEvents, twinIdentityProfiles } from "@sivraj/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppDependencies } from "../app.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";

type ProfileResponse = {
  twinId: string;
  displayName: string | null;
  aliases: string[];
  emails: string[];
  phones: string[];
  handles: Record<string, string[]>;
  selfDescriptionArtifactId: string | null;
};

export function createIdentityProfileRoutes({ db }: AppDependencies) {
  const identityRoutes = new Hono<AuthEnv>();

  identityRoutes.get("/identity-profile", requireAuth, async (c) => {
    const auth = c.get("auth");
    const twinId = c.req.param("twinId");

    if (!twinId) {
      return c.json({ error: "missing_twin_id" }, 400);
    }

    if (auth.type !== "service" && auth.twinId !== twinId) {
      return c.json({ error: "twin_scope_mismatch" }, 403);
    }

    const [profile] = await db
      .select()
      .from(twinIdentityProfiles)
      .where(eq(twinIdentityProfiles.twinId, twinId))
      .limit(1);

    return c.json(formatProfile(twinId, profile));
  });

  identityRoutes.put("/identity-profile", requireAuth, async (c) => {
    const auth = c.get("auth");
    const twinId = c.req.param("twinId");

    if (!twinId) {
      return c.json({ error: "missing_twin_id" }, 400);
    }

    if (auth.type !== "service" && auth.twinId !== twinId) {
      return c.json({ error: "twin_scope_mismatch" }, 403);
    }

    const body = await c.req.json().catch(() => null);

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "invalid_json_body" }, 400);
    }

    const payload = body as Record<string, unknown>;
    const displayName = optionalTrimmedString(payload["displayName"]);
    const aliases = readStringList(payload["aliases"]);
    const emails = readStringList(payload["emails"]);
    const phones = readStringList(payload["phones"]);
    const handles = readHandles(payload["handles"]);

    if (!aliases || !emails || !phones || !handles) {
      return c.json({ error: "invalid_identity_profile" }, 400);
    }

    const [existing] = await db
      .select()
      .from(twinIdentityProfiles)
      .where(eq(twinIdentityProfiles.twinId, twinId))
      .limit(1);

    const nextValues = {
      displayName,
      aliases,
      emails,
      phones,
      handles,
      updatedAt: new Date(),
    };

    const [profile] = existing
      ? await db
          .update(twinIdentityProfiles)
          .set(nextValues)
          .where(eq(twinIdentityProfiles.twinId, twinId))
          .returning()
      : await db
          .insert(twinIdentityProfiles)
          .values({
            twinId,
            ...nextValues,
          })
          .returning();

    await db.insert(auditEvents).values({
      twinId,
      actorType: auth.type,
      actorId: auth.sub,
      eventType: "twin_identity_profile.updated",
      resourceType: "twin_identity_profile",
      resourceId: profile.id,
      metadata: {
        walletAddress: auth.walletAddress,
        aliasCount: aliases.length,
        emailCount: emails.length,
        phoneCount: phones.length,
        handleKinds: Object.keys(handles),
      },
    });

    return c.json(formatProfile(twinId, profile));
  });

  return identityRoutes;
}

function formatProfile(twinId: string, profile: unknown): ProfileResponse {
  const record = profile && typeof profile === "object"
    ? profile as Record<string, unknown>
    : {};

  return {
    twinId,
    displayName: optionalTrimmedString(record["displayName"] ?? record["display_name"]),
    aliases: readStringList(record["aliases"]) ?? [],
    emails: readStringList(record["emails"]) ?? [],
    phones: readStringList(record["phones"]) ?? [],
    handles: readHandles(record["handles"]) ?? {},
    selfDescriptionArtifactId: optionalTrimmedString(
      record["selfDescriptionArtifactId"] ?? record["self_description_artifact_id"],
    ),
  };
}

function optionalTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return [];
  }

  const list = value
    .map((item) => optionalTrimmedString(item))
    .filter((item): item is string => Boolean(item));

  return Array.from(new Set(list)).slice(0, 50);
}

function readHandles(value: unknown): Record<string, string[]> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const handles: Record<string, string[]> = {};

  for (const [rawKey, rawValue] of entries) {
    const key = optionalTrimmedString(rawKey);

    if (!key) {
      continue;
    }

    const values = Array.isArray(rawValue)
      ? readStringList(rawValue)
      : readStringList([rawValue]);

    if (!values) {
      return null;
    }

    if (values.length > 0) {
      handles[key] = values;
    }
  }

  return handles;
}
