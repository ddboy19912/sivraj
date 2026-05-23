import { auditEvents, sourceArtifacts, sourceSpeakerMappings } from "@sivraj/db";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppDependencies } from "../app.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";

const SPEAKER_ROLES = ["self", "other", "system", "unknown"] as const;

type SpeakerRole = typeof SPEAKER_ROLES[number];

type SpeakerMappingResponse = {
  artifactId: string;
  detectedSpeakers: string[];
  mappings: Array<{
    id: string;
    sourceSpeaker: string;
    sourceSpeakerId: string | null;
    role: SpeakerRole;
    mappedName: string | null;
    metadata: Record<string, unknown>;
  }>;
};

export function createSpeakerMappingRoutes({ db }: AppDependencies) {
  const routes = new Hono<AuthEnv>();

  routes.get("/:artifactId/speaker-mappings", requireAuth, async (c) => {
    const auth = c.get("auth");
    const twinId = c.req.param("twinId");
    const artifactId = c.req.param("artifactId");

    if (!twinId || !artifactId) {
      return c.json({ error: "missing_path_param" }, 400);
    }

    if (auth.type !== "service" && auth.twinId !== twinId) {
      return c.json({ error: "twin_scope_mismatch" }, 403);
    }

    const artifact = await findArtifact(db, twinId, artifactId);

    if (!artifact) {
      return c.json({ error: "artifact_not_found" }, 404);
    }

    const mappings = await db
      .select()
      .from(sourceSpeakerMappings)
      .where(
        and(
          eq(sourceSpeakerMappings.twinId, twinId),
          eq(sourceSpeakerMappings.sourceArtifactId, artifactId),
        ),
      );

    return c.json(formatResponse(artifact, mappings));
  });

  routes.put("/:artifactId/speaker-mappings", requireAuth, async (c) => {
    const auth = c.get("auth");
    const twinId = c.req.param("twinId");
    const artifactId = c.req.param("artifactId");

    if (!twinId || !artifactId) {
      return c.json({ error: "missing_path_param" }, 400);
    }

    if (auth.type !== "service" && auth.twinId !== twinId) {
      return c.json({ error: "twin_scope_mismatch" }, 403);
    }

    const artifact = await findArtifact(db, twinId, artifactId);

    if (!artifact) {
      return c.json({ error: "artifact_not_found" }, 404);
    }

    const body = await c.req.json().catch(() => null);
    const mappings = readMappings(body);

    if (!mappings) {
      return c.json({ error: "invalid_speaker_mappings" }, 400);
    }

    await db
      .delete(sourceSpeakerMappings)
      .where(
        and(
          eq(sourceSpeakerMappings.twinId, twinId),
          eq(sourceSpeakerMappings.sourceArtifactId, artifactId),
        ),
      );

    const created = mappings.length > 0
      ? await db
          .insert(sourceSpeakerMappings)
          .values(mappings.map((mapping) => ({
            twinId,
            sourceArtifactId: artifactId,
            sourceSpeaker: mapping.sourceSpeaker,
            sourceSpeakerId: mapping.sourceSpeakerId,
            role: mapping.role,
            mappedName: mapping.mappedName,
            metadata: mapping.metadata,
          })))
          .returning()
      : [];

    await db.insert(auditEvents).values({
      twinId,
      actorType: auth.type,
      actorId: auth.sub,
      eventType: "source_speaker_mappings.updated",
      resourceType: "source_artifact",
      resourceId: artifactId,
      metadata: {
        mappingCount: mappings.length,
        detectedSpeakers: readDetectedSpeakers(artifact.metadata),
      },
    });

    return c.json(formatResponse(artifact, created));
  });

  return routes;
}

async function findArtifact(db: AppDependencies["db"], twinId: string, artifactId: string) {
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

function formatResponse(artifact: unknown, mappings: unknown[]): SpeakerMappingResponse {
  const artifactRecord = asRecord(artifact);

  return {
    artifactId: String(artifactRecord["id"] ?? ""),
    detectedSpeakers: readDetectedSpeakers(artifactRecord["metadata"]),
    mappings: mappings.map(formatMapping),
  };
}

function formatMapping(value: unknown): SpeakerMappingResponse["mappings"][number] {
  const record = asRecord(value);

  return {
    id: String(record["id"] ?? ""),
    sourceSpeaker: String(record["sourceSpeaker"] ?? record["source_speaker"] ?? ""),
    sourceSpeakerId: optionalString(record["sourceSpeakerId"] ?? record["source_speaker_id"]),
    role: readRole(record["role"]) ?? "unknown",
    mappedName: optionalString(record["mappedName"] ?? record["mapped_name"]),
    metadata: asRecord(record["metadata"]),
  };
}

function readMappings(value: unknown): Array<{
  sourceSpeaker: string;
  sourceSpeakerId: string | null;
  role: SpeakerRole;
  mappedName: string | null;
  metadata: Record<string, unknown>;
}> | null {
  const root = asRecord(value);
  const rawMappings = root["mappings"];

  if (!Array.isArray(rawMappings) || rawMappings.length > 100) {
    return null;
  }

  const mappings = [];
  const seen = new Set<string>();

  for (const raw of rawMappings) {
    const record = asRecord(raw);
    const sourceSpeaker = optionalString(record["sourceSpeaker"]);
    const sourceSpeakerId = optionalString(record["sourceSpeakerId"]);
    const role = readRole(record["role"]);
    const mappedName = optionalString(record["mappedName"]);

    if (!sourceSpeaker || !role) {
      return null;
    }

    const key = sourceSpeaker.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    mappings.push({
      sourceSpeaker,
      sourceSpeakerId,
      role,
      mappedName,
      metadata: sanitizeMetadata(record["metadata"]),
    });
  }

  return mappings;
}

function readDetectedSpeakers(metadata: unknown): string[] {
  const parser = asRecord(asRecord(metadata)["processing"])["parser"];
  const speakers = asRecord(parser)["speakers"];

  return Array.isArray(speakers)
    ? speakers.filter((speaker): speaker is string => typeof speaker === "string")
    : [];
}

function readRole(value: unknown): SpeakerRole | null {
  return SPEAKER_ROLES.includes(value as SpeakerRole) ? value as SpeakerRole : null;
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeMetadata(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  const safe: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      safe[key] = item;
    }
  }

  return safe;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
