import { auditEvents, candidateMemories, userFeedbackEvents } from "@sivraj/db";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import type { AppDependencies } from "../app.js";
import type { AuthEnv } from "../middleware/auth.js";
import type { AuthorizedTwin } from "../lib/http/route-auth.js";
import {
  feedbackTypeForReviewAction,
  readOptionalUuid,
  readReviewAction,
  statusForReviewAction,
} from "../lib/engineering/helpers.js";

export async function applyEngineeringReviewAction(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  { auth, twinId }: AuthorizedTwin,
) {
  const candidateId = readOptionalUuid(c.req.param("candidateId"));

  if (!candidateId) {
    return c.json({ error: "invalid_candidate_id" }, 400);
  }

  const body = await c.req.json().catch(() => null);
  const action = readReviewAction(body);

  if (!action) {
    return c.json({ error: "invalid_review_action" }, 400);
  }

  const status = statusForReviewAction(action);
  const feedbackType = feedbackTypeForReviewAction(action);
  const now = new Date();
  const [candidate] = await db
    .update(candidateMemories)
    .set({
      status,
      updatedAt: now,
    })
    .where(and(
      eq(candidateMemories.id, candidateId),
      eq(candidateMemories.twinId, twinId),
    ))
    .returning({
      id: candidateMemories.id,
      status: candidateMemories.status,
    });

  if (!candidate) {
    return c.json({ error: "candidate_not_found" }, 404);
  }

  const [feedback] = await db
    .insert(userFeedbackEvents)
    .values({
      twinId,
      targetType: "candidate_memory",
      targetId: candidateId,
      feedbackType,
      actorType: auth.type,
      actorId: auth.sub,
      metadata: {
        surface: "engineering_review_queue",
        action,
      },
    })
    .returning({ id: userFeedbackEvents.id });

  await db.insert(auditEvents).values({
    twinId,
    actorType: auth.type,
    actorId: auth.sub,
    eventType: "agent.engineering_review_action.created",
    resourceType: "candidate_memory",
    resourceId: candidateId,
    metadata: {
      clientId: auth.clientId,
      action,
      status: candidate.status,
      feedbackId: feedback?.id ?? null,
    },
  });

  return c.json({
    candidateId,
    action,
    status: candidate.status,
    feedbackId: feedback?.id ?? null,
  });
}
