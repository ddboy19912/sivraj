import type { Context } from "hono";
import type { AppDependencies } from "../app.js";
import type { AuthEnv } from "../middleware/auth.js";
import {
  authorizeConversationReview,
  buildConversationSummary,
  conversationArtifactSummary,
  conversationPolicy,
  finalizeConversationReview,
  formatConversationSummaryText,
  isConversationReviewActionsError,
  loadConversationCandidates,
  persistConversationSummaryResult,
  processConversationReviewActions,
  readReviewActions,
  storeConversationSummary,
  toConversationCandidateReviewItem,
} from "../lib/conversations/helpers.js";

export async function handleConversationReviewGet(
  c: Context<AuthEnv>,
  { db }: Pick<AppDependencies, "db">,
) {
  const gate = await authorizeConversationReview(c, db);
  if ("response" in gate) {
    return gate.response;
  }

  const candidates = await loadConversationCandidates(db, gate.twinId, gate.artifact.id);

  return c.json({
    policy: conversationPolicy(),
    artifact: conversationArtifactSummary(gate.artifact),
    summary: buildConversationSummary(gate.artifact, candidates),
    candidateMemories: candidates.map(toConversationCandidateReviewItem),
  });
}

export async function handleConversationSummaryPost(
  c: Context<AuthEnv>,
  { db, privateMemoryStorage }: Pick<AppDependencies, "db" | "privateMemoryStorage">,
) {
  const gate = await authorizeConversationReview(c, db);
  if ("response" in gate) {
    return gate.response;
  }

  if (!privateMemoryStorage) {
    return c.json({ error: "encrypted_storage_not_configured" }, 503);
  }

  const candidates = await loadConversationCandidates(db, gate.twinId, gate.artifact.id);
  const summary = buildConversationSummary(gate.artifact, candidates);
  const summaryText = formatConversationSummaryText(summary);
  const stored = await storeConversationSummary(privateMemoryStorage, {
    twinId: gate.twinId,
    artifactId: gate.artifact.id,
    summaryText,
  });

  if (!stored) {
    return c.json({ error: "encrypted_storage_failed" }, 503);
  }

  await persistConversationSummaryResult({
    db,
    gate,
    candidates,
    summary,
    stored,
  });

  return c.json({
    artifactId: gate.artifact.id,
    status: "generated",
    summaryStorageRef: stored.rawStorageRef,
    summarySha256: stored.ciphertextSha256,
    summary,
  }, 201);
}

export async function handleConversationMemoriesReviewPost(
  c: Context<AuthEnv>,
  { db, privateMemoryStorage, artifactProcessingQueue }: Pick<AppDependencies, "db" | "privateMemoryStorage" | "artifactProcessingQueue">,
) {
  const gate = await authorizeConversationReview(c, db);
  if ("response" in gate) {
    return gate.response;
  }

  const body = await c.req.json().catch(() => null);
  const actions = readReviewActions(body);
  if (!actions) {
    return c.json({ error: "invalid_conversation_review_actions" }, 400);
  }

  const reviewResult = await processConversationReviewActions({
    db,
    privateMemoryStorage,
    artifactProcessingQueue,
    gate,
    actions,
  });

  if (isConversationReviewActionsError(reviewResult)) {
    return c.json(reviewResult.error.body, reviewResult.error.status);
  }

  await finalizeConversationReview(db, gate, actions, reviewResult);

  return c.json({
    artifactId: gate.artifact.id,
    status: "reviewed",
    approvedCount: reviewResult.approvedCount,
    rejectedCount: reviewResult.rejectedCount,
    editedArtifactCount: reviewResult.editedArtifactCount,
    results: reviewResult.results,
  });
}
