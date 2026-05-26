import {
  AGENT_CONTEXT_READ_SCOPE,
  AGENT_PROJECT_PROFILE_READ_SCOPE,
  AGENT_SOURCE_READ_SCOPE,
} from "@sivraj/auth";
import {
  buildCodingAgentContextExport,
  buildCodingAgentContextPacket,
  buildEngineeringProjectProfile,
  buildEngineeringInstructionPatch,
  formatCodingAgentContextMarkdown,
  isEngineeringInstructionScope,
  isEngineeringMemoryType,
  type CodingAgentExportPreset,
  type CodingAgentExportTargetFile,
  type EngineeringProfileMemoryRecord,
  type EngineeringProfileMemoryStatus,
  type EngineeringRepoFingerprint,
} from "@sivraj/intelligence";
import { auditEvents, candidateMemories, sourceArtifacts, userFeedbackEvents } from "@sivraj/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import type { AppDependencies } from "../app.js";
import { hasActiveAgentGrantForScopes } from "../lib/agent-grants.js";
import { recordMetadata, sanitizeSafeMetadata } from "../lib/safe-metadata.js";
import { requireAnyScope, requireAuth, requireScope, type AuthEnv } from "../middleware/auth.js";

export function createEngineeringRoutes({ db }: AppDependencies) {
  const routes = new Hono<AuthEnv>();

  routes.get("/sources", requireAuth, async (c) => {
    const scopeError = requireAnyScope(c, ["memory:read", AGENT_SOURCE_READ_SCOPE, AGENT_CONTEXT_READ_SCOPE]);
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

    if (!await hasActiveAgentGrantForScopes({
      db,
      auth,
      twinId,
      acceptedScopes: [AGENT_SOURCE_READ_SCOPE, AGENT_CONTEXT_READ_SCOPE],
    })) {
      return c.json({ error: "agent_grant_inactive" }, 403);
    }

    const limit = readLimit(c.req.query("limit"));
    const candidateRows = await db
      .select()
      .from(candidateMemories)
      .where(eq(candidateMemories.twinId, twinId))
      .orderBy(desc(candidateMemories.createdAt))
      .limit(Math.min(limit * 20, 2_000));
    const engineeringCandidates = candidateRows.filter((row) => {
      const metadata = recordMetadata(row.metadata);
      return metadata["engineering"] === true;
    });
    const sourceIds = Array.from(new Set(engineeringCandidates.map((row) => row.sourceArtifactId)));

    if (sourceIds.length === 0) {
      return c.json({
        policy: {
          rawArtifactsIncluded: false,
          decryptedMemoryIncluded: false,
          plaintextStatementsIncluded: false,
          derivedEngineeringContextIncluded: true,
          scope: "memory:read",
        },
        sources: [],
        summary: {
          sourceCount: 0,
          engineeringMemoryCount: 0,
        },
      });
    }

    const artifactRows = await db
      .select()
      .from(sourceArtifacts)
      .where(and(
        eq(sourceArtifacts.twinId, twinId),
        inArray(sourceArtifacts.id, sourceIds),
      ))
      .orderBy(desc(sourceArtifacts.createdAt))
      .limit(limit);
    const candidatesByArtifact = groupEngineeringCandidates(engineeringCandidates);
    const sources = artifactRows
      .map((artifact) => toEngineeringSourceSummary(artifact, candidatesByArtifact.get(artifact.id) ?? []))
      .filter((source) => source.extractedEngineeringMemoryCount > 0);

    const response = {
      policy: {
        rawArtifactsIncluded: false,
        decryptedMemoryIncluded: false,
        plaintextStatementsIncluded: false,
        derivedEngineeringContextIncluded: true,
        scope: "memory:read",
        agentScopesAccepted: [AGENT_SOURCE_READ_SCOPE, AGENT_CONTEXT_READ_SCOPE],
      },
      sources,
      summary: {
        sourceCount: sources.length,
        engineeringMemoryCount: sources.reduce((sum, source) => sum + source.extractedEngineeringMemoryCount, 0),
      },
    };

    await db.insert(auditEvents).values({
      twinId,
      actorType: auth.type,
      actorId: auth.sub,
      eventType: "agent.engineering_sources.read",
      resourceType: "twin",
      resourceId: twinId,
      metadata: {
        clientId: auth.clientId,
        sourceCount: sources.length,
        engineeringMemoryCount: response.summary.engineeringMemoryCount,
        limit,
      },
    });

    return c.json(response);
  });

  routes.get("/context", requireAuth, async (c) => {
    const scopeError = requireAnyScope(c, [
      "memory:read",
      AGENT_CONTEXT_READ_SCOPE,
      AGENT_PROJECT_PROFILE_READ_SCOPE,
    ]);
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

    if (!await hasActiveAgentGrantForScopes({
      db,
      auth,
      twinId,
      acceptedScopes: [AGENT_CONTEXT_READ_SCOPE, AGENT_PROJECT_PROFILE_READ_SCOPE],
    })) {
      return c.json({ error: "agent_grant_inactive" }, 403);
    }

    const artifactId = readOptionalUuid(c.req.query("artifactId"));
    const limit = readLimit(c.req.query("limit"));
    const maxItemsPerSection = readMaxItems(c.req.query("maxItemsPerSection"));
    const includeCandidate = readBoolean(c.req.query("includeCandidate"), false);
    const includeRejected = readBoolean(c.req.query("includeRejected"), false);
    const includeSuperseded = readBoolean(c.req.query("includeSuperseded"), false);
    const includeTemporary = readBoolean(c.req.query("includeTemporary"), false);
    const preset = readExportPreset(c.req.query("preset"));
    const repoFingerprint = readRepoFingerprint(c);

    const filters = [eq(candidateMemories.twinId, twinId)];
    if (artifactId) {
      filters.push(eq(candidateMemories.sourceArtifactId, artifactId));
    }

    const rows = await db
      .select()
      .from(candidateMemories)
      .where(and(...filters))
      .orderBy(desc(candidateMemories.createdAt))
      .limit(limit);

    const memories = rows
      .map(toEngineeringProfileMemory)
      .filter((memory): memory is EngineeringProfileMemoryRecord => Boolean(memory));

    const profile = buildEngineeringProjectProfile({
      projectId: repoFingerprint.projectId,
      projectName: repoFingerprint.projectName,
      repoFingerprint,
      memories,
      includeCandidate: true,
      includeRejected,
      maxEntriesPerCategory: Math.max(maxItemsPerSection, 25),
    });
    const contextPacket = buildCodingAgentContextPacket({
      profile,
      includeCandidate,
      includeSuperseded,
      maxItemsPerSection,
      scope: {
        includeTemporary,
      },
    });
    const contextMarkdown = formatCodingAgentContextMarkdown(contextPacket, {
      maxItemsPerSection,
    });
    const contextExport = buildCodingAgentContextExport(contextPacket, {
      preset,
      includeCandidate,
      maxItems: maxItemsPerSection,
    });

    const response = {
      policy: {
        rawArtifactsIncluded: false,
        decryptedMemoryIncluded: false,
        plaintextStatementsIncluded: false,
        derivedEngineeringContextIncluded: true,
        scope: "memory:read",
        agentScopesAccepted: [AGENT_CONTEXT_READ_SCOPE, AGENT_PROJECT_PROFILE_READ_SCOPE],
      },
      relationship: {
        sivraj: "Remembers encrypted engineering context, synthesizes durable preferences, and exports source-backed packets.",
        codingAgents: "Execute coding tasks inside tools such as Codex, Claude Code, Cursor, or custom agents.",
        handoff: "Use contextMarkdown or contextPacket as portable agent context. Future connectors can automate this handoff.",
      },
      contextPacket,
      contextMarkdown,
      contextExport,
      profileSummary: {
        totalEngineeringMemories: memories.length,
        includedContextItems: contextPacket.counts.totalItems,
        evidenceRefs: contextPacket.counts.evidenceRefs,
        warnings: contextPacket.warnings,
        issues: contextPacket.issues,
        quality: contextPacket.quality,
        repoFingerprint: contextPacket.project.repoFingerprint,
      },
    };

    await db.insert(auditEvents).values({
      twinId,
      actorType: auth.type,
      actorId: auth.sub,
      eventType: "agent.engineering_context.read",
      resourceType: "twin",
      resourceId: twinId,
      metadata: {
        clientId: auth.clientId,
        artifactId,
        repoFingerprint,
        includeCandidate,
        includeSuperseded,
        includeTemporary,
        preset,
        targetFile: contextExport.targetFile,
        exportFormat: contextExport.format,
        maxItemsPerSection,
        includedContextItems: contextPacket.counts.totalItems,
        evidenceRefs: contextPacket.counts.evidenceRefs,
      },
    });

    return c.json(response);
  });

  routes.get("/review-queue", requireAuth, async (c) => {
    const scopeError = requireAnyScope(c, [
      "memory:read",
      AGENT_CONTEXT_READ_SCOPE,
      AGENT_PROJECT_PROFILE_READ_SCOPE,
    ]);
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

    if (!await hasActiveAgentGrantForScopes({
      db,
      auth,
      twinId,
      acceptedScopes: [AGENT_CONTEXT_READ_SCOPE, AGENT_PROJECT_PROFILE_READ_SCOPE],
    })) {
      return c.json({ error: "agent_grant_inactive" }, 403);
    }

    const limit = readLimit(c.req.query("limit"));
    const maxItemsPerSection = readMaxItems(c.req.query("maxItemsPerSection"));
    const includeTemporary = readBoolean(c.req.query("includeTemporary"), true);
    const repoFingerprint = readRepoFingerprint(c);
    const rows = await db
      .select()
      .from(candidateMemories)
      .where(eq(candidateMemories.twinId, twinId))
      .orderBy(desc(candidateMemories.createdAt))
      .limit(limit);
    const memories = rows
      .map(toEngineeringProfileMemory)
      .filter((memory): memory is EngineeringProfileMemoryRecord => Boolean(memory));
    const profile = buildEngineeringProjectProfile({
      projectId: repoFingerprint.projectId,
      projectName: repoFingerprint.projectName,
      repoFingerprint,
      memories,
      includeCandidate: true,
      includeRejected: false,
      maxEntriesPerCategory: Math.max(maxItemsPerSection, 25),
    });
    const contextPacket = buildCodingAgentContextPacket({
      profile,
      includeCandidate: true,
      includeSuperseded: true,
      maxItemsPerSection,
      scope: {
        includeTemporary,
      },
    });
    const candidatesById = new Map(
      rows
        .map(toEngineeringReviewCandidate)
        .filter((candidate): candidate is EngineeringReviewCandidate => Boolean(candidate))
        .map((candidate) => [candidate.id, candidate]),
    );
    const issueItems = contextPacket.issues.map((issue) => ({
      issueType: issue.issueType,
      reason: issue.reason,
      severity: issue.severity,
      subject: issue.subject,
      scope: issue.scope,
      candidate: issue.candidateId ? candidatesById.get(issue.candidateId) ?? null : null,
      existing: issue.existingId ? candidatesById.get(issue.existingId) ?? null : null,
      metadata: issue.metadata,
    }));

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
      policy: {
        rawArtifactsIncluded: false,
        decryptedMemoryIncluded: false,
        plaintextStatementsIncluded: false,
        derivedEngineeringContextIncluded: true,
        scope: "memory:read",
        agentScopesAccepted: [AGENT_CONTEXT_READ_SCOPE, AGENT_PROJECT_PROFILE_READ_SCOPE],
      },
      summary: {
        totalEngineeringMemories: memories.length,
        issueCount: issueItems.length,
        quality: contextPacket.quality,
      },
      repoFingerprint: contextPacket.project.repoFingerprint,
      issues: issueItems,
    });
  });

  routes.post("/instruction-patch", requireAuth, async (c) => {
    const scopeError = requireAnyScope(c, [
      "memory:read",
      AGENT_CONTEXT_READ_SCOPE,
      AGENT_PROJECT_PROFILE_READ_SCOPE,
    ]);
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

    if (!await hasActiveAgentGrantForScopes({
      db,
      auth,
      twinId,
      acceptedScopes: [AGENT_CONTEXT_READ_SCOPE, AGENT_PROJECT_PROFILE_READ_SCOPE],
    })) {
      return c.json({ error: "agent_grant_inactive" }, 403);
    }

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "invalid_json_body" }, 400);
    }

    const payload = body as Record<string, unknown>;
    const preset = readExportPresetFromUnknown(payload["preset"]);
    const targetFile = readTargetInstructionFile(payload["targetFile"]);
    const includeCandidate = readBooleanPayload(payload["includeCandidate"], false);
    const includeTemporary = readBooleanPayload(payload["includeTemporary"], false);
    const limit = readLimitFromUnknown(payload["limit"]);
    const maxItems = readMaxItemsFromUnknown(payload["maxItems"]);
    const repoFingerprint = readRepoFingerprintFromPayload(payload);
    const rows = await db
      .select()
      .from(candidateMemories)
      .where(eq(candidateMemories.twinId, twinId))
      .orderBy(desc(candidateMemories.createdAt))
      .limit(limit);
    const memories = rows
      .map(toEngineeringProfileMemory)
      .filter((memory): memory is EngineeringProfileMemoryRecord => Boolean(memory));
    const profile = buildEngineeringProjectProfile({
      projectId: repoFingerprint.projectId,
      projectName: repoFingerprint.projectName,
      repoFingerprint,
      memories,
      includeCandidate: true,
      includeRejected: false,
      maxEntriesPerCategory: Math.max(maxItems, 25),
    });
    const contextPacket = buildCodingAgentContextPacket({
      profile,
      includeCandidate,
      includeSuperseded: false,
      maxItemsPerSection: maxItems,
      scope: {
        includeTemporary,
      },
    });
    const patch = buildEngineeringInstructionPatch(contextPacket, {
      preset,
      targetFile,
      includeCandidate,
      maxItems,
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
        includeCandidate,
        includeTemporary,
        itemCount: patch.itemCount,
        evidenceRefs: patch.evidence.length,
        quality: patch.quality.label,
        repoFingerprint,
      },
    });

    return c.json({
      policy: {
        rawArtifactsIncluded: false,
        decryptedMemoryIncluded: false,
        plaintextStatementsIncluded: false,
        derivedEngineeringContextIncluded: true,
        autoWriteEnabled: false,
        scope: "memory:read",
        agentScopesAccepted: [AGENT_CONTEXT_READ_SCOPE, AGENT_PROJECT_PROFILE_READ_SCOPE],
      },
      patch,
      contextPacket: {
        project: contextPacket.project,
        issues: contextPacket.issues,
        quality: contextPacket.quality,
        warnings: contextPacket.warnings,
      },
    });
  });

  routes.post("/review-queue/:candidateId/action", requireAuth, async (c) => {
    const scopeError = requireScope(c, "memory:read");
    if (scopeError) {
      return scopeError;
    }

    const auth = c.get("auth");
    const twinId = c.req.param("twinId");
    const candidateId = readOptionalUuid(c.req.param("candidateId"));

    if (!twinId) {
      return c.json({ error: "missing_twin_id" }, 400);
    }

    if (!candidateId) {
      return c.json({ error: "invalid_candidate_id" }, 400);
    }

    if (auth.type !== "service" && auth.twinId !== twinId) {
      return c.json({ error: "twin_scope_mismatch" }, 403);
    }

    if (!await hasActiveAgentGrantForScopes({
      db,
      auth,
      twinId,
      acceptedScopes: [AGENT_CONTEXT_READ_SCOPE, AGENT_PROJECT_PROFILE_READ_SCOPE],
    })) {
      return c.json({ error: "agent_grant_inactive" }, 403);
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
  });

  return routes;
}

function groupEngineeringCandidates(rows: Array<typeof candidateMemories.$inferSelect>) {
  const grouped = new Map<string, Array<typeof candidateMemories.$inferSelect>>();

  for (const row of rows) {
    const metadata = recordMetadata(row.metadata);

    if (metadata["engineering"] !== true) {
      continue;
    }

    const existing = grouped.get(row.sourceArtifactId) ?? [];
    existing.push(row);
    grouped.set(row.sourceArtifactId, existing);
  }

  return grouped;
}

function toEngineeringSourceSummary(
  artifact: typeof sourceArtifacts.$inferSelect,
  candidates: Array<typeof candidateMemories.$inferSelect>,
) {
  const metadata = recordMetadata(artifact.metadata);
  const sourceFile = readString(metadata["fileName"]) ??
    readString(metadata["path"]) ??
    readString(metadata["source_file"]) ??
    readString(metadata["sourceFile"]) ??
    null;
  const candidateSummaries = candidates.map(toEngineeringSourceCandidate);
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byScope: Record<string, number> = {};

  for (const candidate of candidateSummaries) {
    byType[candidate.engineeringMemoryType] = (byType[candidate.engineeringMemoryType] ?? 0) + 1;
    byStatus[candidate.status] = (byStatus[candidate.status] ?? 0) + 1;
    byScope[candidate.scope] = (byScope[candidate.scope] ?? 0) + 1;
  }

  return {
    artifactId: artifact.id,
    sourceType: artifact.sourceType,
    sourceFile,
    displayName: sourceFile ?? `${artifact.sourceType} artifact`,
    ingestionStatus: artifact.ingestionStatus,
    intelligenceStatus: readString(recordMetadata(recordMetadata(metadata["processing"])["intelligence"])["status"]),
    uploadedAt: artifact.createdAt.toISOString(),
    updatedAt: artifact.updatedAt.toISOString(),
    rawStorageRef: artifact.rawStorageRef,
    extractedEngineeringMemoryCount: candidateSummaries.length,
    counts: {
      byType,
      byStatus,
      byScope,
    },
    candidates: candidateSummaries,
  };
}

function toEngineeringSourceCandidate(row: typeof candidateMemories.$inferSelect) {
  const metadata = recordMetadata(row.metadata);
  const engineeringMetadata = recordMetadata(metadata["engineeringMetadata"]);
  const agentContextLine = readString(metadata["agentContextLine"]) ??
    readString(engineeringMetadata["agentContextLine"]);

  return {
    id: row.id,
    memoryType: row.memoryType,
    engineeringMemoryType: readString(metadata["engineeringMemoryType"]) ?? "unknown",
    scope: readString(metadata["engineeringInstructionScope"]) ?? "project",
    status: row.status,
    subject: readString(metadata["subject"]) ?? readString(metadata["engineeringSubject"]),
    agentContextLine,
    confidenceScore: row.confidenceScore,
    evidenceHash: row.evidenceHash,
    evidenceLength: row.evidenceLength,
    statementStorageRef: row.statementStorageRef,
    createdAt: row.createdAt.toISOString(),
  };
}

type EngineeringReviewCandidate = ReturnType<typeof toEngineeringReviewCandidate> extends infer T ? Exclude<T, null> : never;

function toEngineeringReviewCandidate(row: typeof candidateMemories.$inferSelect): {
  id: string;
  sourceArtifactId: string;
  memoryFragmentId: string;
  memoryType: string;
  engineeringMemoryType: string;
  scope: string;
  status: string;
  subject: string | null;
  agentContextLine: string | null;
  confidenceScore: number | null;
  evidenceHash: string;
  evidenceLength: number | null;
  statementStorageRef: string;
  metadata: Record<string, unknown>;
} | null {
  const metadata = recordMetadata(row.metadata);
  const engineeringMetadata = recordMetadata(metadata["engineeringMetadata"]);

  if (metadata["engineering"] !== true) {
    return null;
  }

  return {
    id: row.id,
    sourceArtifactId: row.sourceArtifactId,
    memoryFragmentId: row.memoryFragmentId,
    memoryType: row.memoryType,
    engineeringMemoryType: readString(metadata["engineeringMemoryType"]) ?? "unknown",
    scope: readString(metadata["engineeringInstructionScope"]) ?? "project",
    status: row.status,
    subject: readString(metadata["subject"]) ?? readString(metadata["engineeringSubject"]),
    agentContextLine: readString(metadata["agentContextLine"]) ??
      readString(engineeringMetadata["agentContextLine"]),
    confidenceScore: row.confidenceScore,
    evidenceHash: row.evidenceHash,
    evidenceLength: row.evidenceLength,
    statementStorageRef: row.statementStorageRef,
    metadata: sanitizeSafeMetadata(metadata),
  };
}

function toEngineeringProfileMemory(row: unknown): EngineeringProfileMemoryRecord | null {
  const record = row as Record<string, unknown>;
  const metadata = recordMetadata(record["metadata"]);
  const engineeringMetadata = recordMetadata(metadata["engineeringMetadata"]);

  if (metadata["engineering"] !== true) {
    return null;
  }

  const engineeringMemoryType = readString(metadata["engineeringMemoryType"]);
  const scope = readString(metadata["engineeringInstructionScope"]) ?? "project";

  if (!engineeringMemoryType || !isEngineeringMemoryType(engineeringMemoryType)) {
    return null;
  }

  if (!isEngineeringInstructionScope(scope)) {
    return null;
  }

  const id = readString(record["id"]);
  const sourceArtifactId = readString(record["sourceArtifactId"]);
  const memoryFragmentId = readString(record["memoryFragmentId"]);
  const memoryType = readString(record["memoryType"]);
  const evidenceHash = readString(record["evidenceHash"]);

  if (!id || !sourceArtifactId || !memoryFragmentId || !memoryType || !evidenceHash) {
    return null;
  }
  const safeMetadata = sanitizeSafeMetadata(metadata);
  const agentContextLine = readString(metadata["agentContextLine"]) ??
    readString(engineeringMetadata["agentContextLine"]);
  const nestedSourceKind = readString(engineeringMetadata["sourceKind"]);
  const nestedSourceFile = readString(engineeringMetadata["source_file"]) ??
    readString(engineeringMetadata["sourceFile"]) ??
    readString(engineeringMetadata["fileName"]);

  if (agentContextLine) {
    safeMetadata["agentContextLine"] = agentContextLine;
  }

  if (!safeMetadata["sourceKind"] && nestedSourceKind) {
    safeMetadata["sourceKind"] = nestedSourceKind;
  }

  if (!safeMetadata["source_file"] && nestedSourceFile) {
    safeMetadata["source_file"] = nestedSourceFile;
  }

  return {
    id,
    sourceArtifactId,
    memoryFragmentId,
    memoryType,
    engineeringMemoryType,
    scope,
    subject: readString(metadata["subject"]),
    confidence: readNumber(record["confidenceScore"]) ?? 0.5,
    status: readStatus(record["status"]),
    evidenceHash,
    evidenceLength: readNumber(record["evidenceLength"]),
    metadata: safeMetadata,
  };
}

function readOptionalUuid(value: string | undefined): string | null {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return fallback;
}

function readLimit(value: string | undefined): number {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, 1_000)
    : 500;
}

function readMaxItems(value: string | undefined): number {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, 100)
    : 25;
}

function readMaxItemsFromUnknown(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? Math.min(value, 100)
    : 25;
}

function readLimitFromUnknown(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? Math.min(value, 1_000)
    : 500;
}

function readBooleanPayload(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readTargetInstructionFile(value: unknown): CodingAgentExportTargetFile | undefined {
  if (
    value === "AGENTS.md" ||
    value === "CLAUDE.md" ||
    value === ".cursor/rules/sivraj.mdc" ||
    value === "sivraj-context.json"
  ) {
    return value;
  }

  return undefined;
}

function readExportPreset(value: string | undefined): CodingAgentExportPreset {
  if (value === "claude_code" || value === "cursor" || value === "generic_mcp") {
    return value;
  }

  return "codex";
}

function readExportPresetFromUnknown(value: unknown): CodingAgentExportPreset | undefined {
  if (value === "codex" || value === "claude_code" || value === "cursor" || value === "generic_mcp") {
    return value;
  }

  return undefined;
}

function readRepoFingerprintFromPayload(value: Record<string, unknown>): EngineeringRepoFingerprint {
  return {
    projectId: readString(value["projectId"]),
    projectName: readString(value["projectName"]),
    repoName: readString(value["repoName"]),
    packageName: readString(value["packageName"]),
    gitRemote: readString(value["gitRemote"]),
    packageManager: readString(value["packageManager"]),
    frameworks: readCsvUnknown(value["frameworks"]),
    lockfiles: readCsvUnknown(value["lockfiles"]),
    rootMarkers: readCsvUnknown(value["rootMarkers"]),
  };
}

function readCsvUnknown(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }

  return typeof value === "string"
    ? value.split(",").map((item) => item.trim()).filter(Boolean)
    : [];
}

type EngineeringReviewAction = "keep_active" | "supersede" | "reject" | "needs_review";

function readReviewAction(value: unknown): EngineeringReviewAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const action = (value as Record<string, unknown>)["action"];

  return action === "keep_active" ||
    action === "supersede" ||
    action === "reject" ||
    action === "needs_review"
    ? action
    : null;
}

function statusForReviewAction(action: EngineeringReviewAction): "candidate" | "approved" | "rejected" | "superseded" {
  if (action === "keep_active") {
    return "approved";
  }

  if (action === "supersede") {
    return "superseded";
  }

  if (action === "reject") {
    return "rejected";
  }

  return "candidate";
}

function feedbackTypeForReviewAction(action: EngineeringReviewAction): "approved" | "rejected" | "edited_later" {
  if (action === "keep_active") {
    return "approved";
  }

  if (action === "reject") {
    return "rejected";
  }

  return "edited_later";
}

function readRepoFingerprint(c: {
  req: {
    query: (key: string) => string | undefined;
  };
}): EngineeringRepoFingerprint {
  return {
    projectId: readString(c.req.query("projectId")),
    projectName: readString(c.req.query("projectName")),
    repoName: readString(c.req.query("repoName")),
    packageName: readString(c.req.query("packageName")),
    gitRemote: readString(c.req.query("gitRemote")),
    packageManager: readString(c.req.query("packageManager")),
    frameworks: readCsv(c.req.query("frameworks")),
    lockfiles: readCsv(c.req.query("lockfiles")),
    rootMarkers: readCsv(c.req.query("rootMarkers")),
  };
}

function readCsv(value: string | undefined): string[] {
  return typeof value === "string"
    ? value.split(",").map((item) => item.trim()).filter(Boolean)
    : [];
}

function readStatus(value: unknown): EngineeringProfileMemoryStatus {
  return value === "approved" ||
    value === "rejected" ||
    value === "superseded" ||
    value === "active"
    ? value
    : "candidate";
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
