import {
  auditEvents,
  candidateMemories,
  userFeedbackEvents,
} from "@sivraj/db";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppDependencies } from "../app.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { authorizeTwinRoute, twinScopedJsonHandler } from "../lib/http/route-auth.js";
import { sanitizeStrictSafeMetadata } from "../lib/safe-metadata.js";

const FEEDBACK_TARGET_TYPES = [
  "candidate_memory",
  "graph_node",
  "pattern",
  "insight",
  "reflection",
  "source_artifact",
] as const;

const FEEDBACK_TYPES = [
  "useful",
  "wrong",
  "not_me",
  "too_generic",
  "too_sensitive",
  "approved",
  "rejected",
  "edited_later",
] as const;

type FeedbackTargetType = typeof FEEDBACK_TARGET_TYPES[number];
type FeedbackType = typeof FEEDBACK_TYPES[number];

export function createFeedbackRoutes({ db }: AppDependencies) {
  const feedbackRoutes = new Hono<AuthEnv>();

  feedbackRoutes.post("/", requireAuth, twinScopedJsonHandler("memory:read", async (c, { auth, twinId, body }) => {
    const targetType = readEnum(body["targetType"], FEEDBACK_TARGET_TYPES);
    const targetId = readUuid(body["targetId"]);
    const feedbackType = readEnum(body["feedbackType"], FEEDBACK_TYPES);
    const metadata = sanitizeStrictSafeMetadata(body["metadata"]);

    if (!targetType) {
      return c.json({ error: "invalid_feedback_target_type" }, 400);
    }

    if (!targetId) {
      return c.json({ error: "invalid_feedback_target_id" }, 400);
    }

    if (!feedbackType) {
      return c.json({ error: "invalid_feedback_type" }, 400);
    }

    if (metadata === null) {
      return c.json({ error: "invalid_feedback_metadata" }, 400);
    }

    const [feedback] = await db
      .insert(userFeedbackEvents)
      .values({
        twinId,
        targetType,
        targetId,
        feedbackType,
        actorType: auth.type,
        actorId: auth.sub,
        metadata,
      })
      .returning({ id: userFeedbackEvents.id });

    if (!feedback) {
      return c.json({ error: "feedback_create_failed" }, 500);
    }

    const candidateMemoryStatus = await updateCandidateMemoryStatus({
      db,
      twinId,
      targetType,
      targetId,
      feedbackType,
    });

    await db.insert(auditEvents).values({
      twinId,
      actorType: auth.type,
      actorId: auth.sub,
      eventType: "feedback.created",
      resourceType: targetType,
      resourceId: targetId,
      metadata: {
        feedbackId: feedback.id,
        feedbackType,
        candidateMemoryStatus,
      },
    });

    return c.json({
      feedbackId: feedback.id,
      targetType,
      targetId,
      feedbackType,
      candidateMemoryStatus,
    }, 201);
  }));

  return feedbackRoutes;
}

async function updateCandidateMemoryStatus(input: {
  db: AppDependencies["db"];
  twinId: string;
  targetType: FeedbackTargetType;
  targetId: string;
  feedbackType: FeedbackType;
}): Promise<"approved" | "rejected" | null> {
  if (input.targetType !== "candidate_memory") {
    return null;
  }

  if (input.feedbackType !== "approved" && input.feedbackType !== "rejected") {
    return null;
  }

  const [candidate] = await input.db
    .update(candidateMemories)
    .set({
      status: input.feedbackType,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(candidateMemories.id, input.targetId),
        eq(candidateMemories.twinId, input.twinId),
      ),
    )
    .returning({ status: candidateMemories.status });

  return candidate?.status === "approved" || candidate?.status === "rejected"
    ? candidate.status
    : null;
}

function readEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | null {
  return typeof value === "string" && allowed.includes(value)
    ? value
    : null;
}

function readUuid(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}

