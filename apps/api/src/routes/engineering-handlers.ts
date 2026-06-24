import {
  AGENT_CONTEXT_READ_SCOPE,
  AGENT_SOURCE_READ_SCOPE,
} from "@sivraj/auth";
import { auditEvents } from "@sivraj/db";
import type { Context } from "hono";
import type { AppDependencies } from "../app.js";
import type { AuthEnv } from "../middleware/auth.js";
import {
  authorizeTwinRoute,
  authorizeTwinRouteWithAgentGrant,
  type AuthorizedTwin,
} from "../lib/http/route-auth.js";
import { parseJsonObjectBody } from "../lib/http/route-helpers.js";
import {
  buildEngineeringContextResponse,
  buildEngineeringInstructionPatchResponse,
  engineeringContextPolicy,
  emptyEngineeringSourcesResponse,
  loadEngineeringProfileBundle,
  loadEngineeringProfileMemories,
  loadEngineeringReviewBundle,
  readBoolean,
  readBooleanPayload,
  readExportPreset,
  readExportPresetFromUnknown,
  readLimit,
  readLimitFromUnknown,
  readMaxItems,
  readMaxItemsFromUnknown,
  readOptionalUuid,
  readRepoFingerprint,
  readRepoFingerprintFromPayload,
  readTargetInstructionFile,
  toEngineeringReviewCandidate,
} from "../lib/engineering/helpers.js";
import {
  buildEngineeringContextAuditMetadata,
  buildEngineeringContextJsonResponse,
  buildEngineeringSourcesResponse,
  loadEngineeringSourcesBundle,
} from "./engineering-sources.js";
import { applyEngineeringReviewAction } from "./engineering-review-action.js";

export async function handleEngineeringSourcesGet(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
) {
  const routeAuth = await authorizeTwinRouteWithAgentGrant(c, {
    scopes: ["memory:read", AGENT_SOURCE_READ_SCOPE, AGENT_CONTEXT_READ_SCOPE],
    db,
    acceptedAgentScopes: [AGENT_SOURCE_READ_SCOPE, AGENT_CONTEXT_READ_SCOPE],
  });
  if (!routeAuth.ok) {
    return routeAuth.response;
  }
  const { auth, twinId } = routeAuth.value;
  const limit = readLimit(c.req.query("limit"));
  const bundle = await loadEngineeringSourcesBundle(db, twinId, limit);

  if (!bundle) {
    return c.json(emptyEngineeringSourcesResponse());
  }

  const response = buildEngineeringSourcesResponse(bundle);

  await db.insert(auditEvents).values({
    twinId,
    actorType: auth.type,
    actorId: auth.sub,
    eventType: "agent.engineering_sources.read",
    resourceType: "twin",
    resourceId: twinId,
    metadata: {
      clientId: auth.clientId,
      sourceCount: bundle.summary.sourceCount,
      engineeringMemoryCount: bundle.summary.engineeringMemoryCount,
      limit,
    },
  });

  return c.json(response);
}

export async function handleEngineeringContextGet(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  { auth, twinId }: AuthorizedTwin,
) {
  const query = readEngineeringContextQuery(c);
  const { memories, inventory } = await loadEngineeringProfileBundle(db, twinId, {
    artifactId: query.artifactId,
    limit: query.limit,
  });
  const bundle = buildEngineeringContextResponse({
    repoFingerprint: query.repoFingerprint,
    memories,
    includeCandidate: query.includeCandidate,
    includeRejected: query.includeRejected,
    includeSuperseded: query.includeSuperseded,
    includeTemporary: query.includeTemporary,
    preset: query.preset,
    maxItemsPerSection: query.maxItemsPerSection,
  });
  const response = buildEngineeringContextJsonResponse({
    memories,
    inventory,
    ...bundle,
  });

  await db.insert(auditEvents).values({
    twinId,
    actorType: auth.type,
    actorId: auth.sub,
    eventType: "agent.engineering_context.read",
    resourceType: "twin",
    resourceId: twinId,
    metadata: buildEngineeringContextAuditMetadata({
      auth,
      artifactId: query.artifactId,
      repoFingerprint: query.repoFingerprint,
      includeCandidate: query.includeCandidate,
      includeSuperseded: query.includeSuperseded,
      includeTemporary: query.includeTemporary,
      preset: query.preset,
      contextExport: bundle.contextExport,
      maxItemsPerSection: query.maxItemsPerSection,
      contextPacket: bundle.contextPacket,
    }),
  });

  return c.json(response);
}

export async function handleEngineeringReviewQueueGet(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  { auth, twinId }: AuthorizedTwin,
) {
  const limit = readLimit(c.req.query("limit"));
  const maxItemsPerSection = readMaxItems(c.req.query("maxItemsPerSection"));
  const includeTemporary = readBoolean(c.req.query("includeTemporary"), true);
  const repoFingerprint = readRepoFingerprint(c);
  const { rows, memories } = await loadEngineeringReviewBundle(db, twinId, limit);
  const candidates = rows
    .map(toEngineeringReviewCandidate)
    .filter((candidate): candidate is NonNullable<ReturnType<typeof toEngineeringReviewCandidate>> => Boolean(candidate));
  const { contextPacket } = buildEngineeringContextResponse({
    repoFingerprint,
    memories,
    includeCandidate: true,
    includeRejected: false,
    includeSuperseded: true,
    includeTemporary,
    preset: "codex",
    maxItemsPerSection,
  });
  const issueItems = buildEngineeringReviewIssueItems(contextPacket.issues, rows);

  await db.insert(auditEvents).values({
    twinId,
    actorType: auth.type,
    actorId: auth.sub,
    eventType: "agent.engineering_review_queue.read",
    resourceType: "twin",
    resourceId: twinId,
    metadata: {
      clientId: auth.clientId,
      issueCount: issueItems.length,
      repoFingerprint,
    },
  });

  return c.json({
    policy: engineeringContextPolicy(),
    summary: {
      totalEngineeringMemories: memories.length,
      pendingCandidateCount: candidates.filter((candidate) => candidate.status === "candidate").length,
      issueCount: issueItems.length,
      quality: contextPacket.quality,
    },
    repoFingerprint: contextPacket.project.repoFingerprint,
    candidates,
    issues: issueItems,
  });
}

export async function handleEngineeringInstructionPatchPost(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  { auth, twinId }: AuthorizedTwin,
) {
  const parsedBody = await parseJsonObjectBody(c);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const input = readInstructionPatchInput(parsedBody.body);
  const memories = await loadEngineeringProfileMemories(db, twinId, { limit: input.limit });
  const { contextPacket, patch } = buildEngineeringInstructionPatchResponse({
    repoFingerprint: input.repoFingerprint,
    memories,
    preset: input.preset,
    targetFile: input.targetFile,
    includeCandidate: input.includeCandidate,
    includeTemporary: input.includeTemporary,
    maxItems: input.maxItems,
  });

  await db.insert(auditEvents).values({
    twinId,
    actorType: auth.type,
    actorId: auth.sub,
    eventType: "agent.engineering_instruction_patch.generated",
    resourceType: "twin",
    resourceId: twinId,
    metadata: {
      clientId: auth.clientId,
      preset: patch.preset,
      targetFile: patch.targetFile,
      exportFormat: patch.format,
      includeCandidate: input.includeCandidate,
      includeTemporary: input.includeTemporary,
      itemCount: patch.itemCount,
      evidenceRefs: patch.evidence.length,
      quality: patch.quality.label,
      repoFingerprint: input.repoFingerprint,
    },
  });

  return c.json({
    policy: {
      ...engineeringContextPolicy(),
      autoWriteEnabled: false,
    },
    patch,
    contextPacket: {
      project: contextPacket.project,
      issues: contextPacket.issues,
      quality: contextPacket.quality,
      warnings: contextPacket.warnings,
    },
  });
}

export async function handleEngineeringReviewActionPost(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
) {
  const routeAuth = authorizeTwinRoute(c, "memory:read");
  if (!routeAuth.ok) {
    return routeAuth.response;
  }

  if (routeAuth.value.auth.type !== "user") {
    return c.json({ error: "user_review_required" }, 403);
  }

  return applyEngineeringReviewAction(c, db, routeAuth.value);
}

function readEngineeringContextQuery(c: Context<AuthEnv>) {
  return {
    artifactId: readOptionalUuid(c.req.query("artifactId")),
    limit: readLimit(c.req.query("limit")),
    maxItemsPerSection: readMaxItems(c.req.query("maxItemsPerSection")),
    includeCandidate: readBoolean(c.req.query("includeCandidate"), false),
    includeRejected: readBoolean(c.req.query("includeRejected"), false),
    includeSuperseded: readBoolean(c.req.query("includeSuperseded"), false),
    includeTemporary: readBoolean(c.req.query("includeTemporary"), false),
    preset: readExportPreset(c.req.query("preset")),
    repoFingerprint: readRepoFingerprint(c),
  };
}

function readInstructionPatchInput(payload: Record<string, unknown>) {
  return {
    preset: readExportPresetFromUnknown(payload["preset"]),
    targetFile: readTargetInstructionFile(payload["targetFile"]),
    includeCandidate: readBooleanPayload(payload["includeCandidate"], false),
    includeTemporary: readBooleanPayload(payload["includeTemporary"], false),
    limit: readLimitFromUnknown(payload["limit"]),
    maxItems: readMaxItemsFromUnknown(payload["maxItems"]),
    repoFingerprint: readRepoFingerprintFromPayload(payload),
  };
}

function buildEngineeringReviewIssueItems(
  issues: ReturnType<typeof buildEngineeringContextResponse>["contextPacket"]["issues"],
  rows: Awaited<ReturnType<typeof loadEngineeringReviewBundle>>["rows"],
) {
  const candidatesById = new Map(
    rows
      .map(toEngineeringReviewCandidate)
      .filter((candidate): candidate is NonNullable<ReturnType<typeof toEngineeringReviewCandidate>> => Boolean(candidate))
      .map((candidate) => [candidate.id, candidate]),
  );

  return issues.map((issue) => ({
    issueType: issue.issueType,
    reason: issue.reason,
    severity: issue.severity,
    subject: issue.subject,
    scope: issue.scope,
    candidate: issue.candidateId ? candidatesById.get(issue.candidateId) ?? null : null,
    existing: issue.existingId ? candidatesById.get(issue.existingId) ?? null : null,
    metadata: issue.metadata,
  }));
}
