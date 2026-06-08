import {
  AGENT_CONTEXT_READ_SCOPE,
  AGENT_SOURCE_READ_SCOPE,
} from "@sivraj/auth";
import { candidateMemories, sourceArtifacts } from "@sivraj/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { AppDependencies } from "../app.js";
import { recordMetadata } from "../lib/safe-metadata.js";
import { toEngineeringSourceSummary } from "../lib/engineering/source-summary.js";
import {
  buildEngineeringContextResponse,
  engineeringContextPolicy,
  groupEngineeringCandidates,
} from "../lib/engineering/helpers.js";

export type EngineeringContextBundle = ReturnType<typeof buildEngineeringContextResponse>;

export async function loadEngineeringSourcesBundle(
  db: AppDependencies["db"],
  twinId: string,
  limit: number,
) {
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
    return null;
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

  return {
    sources,
    summary: {
      sourceCount: sources.length,
      engineeringMemoryCount: sources.reduce((sum, source) => sum + source.extractedEngineeringMemoryCount, 0),
    },
  };
}

export function buildEngineeringSourcesResponse(
  bundle: NonNullable<Awaited<ReturnType<typeof loadEngineeringSourcesBundle>>>,
) {
  return {
    policy: {
      rawArtifactsIncluded: false,
      decryptedMemoryIncluded: false,
      plaintextStatementsIncluded: false,
      derivedEngineeringContextIncluded: true,
      scope: "memory:read",
      agentScopesAccepted: [AGENT_SOURCE_READ_SCOPE, AGENT_CONTEXT_READ_SCOPE],
    },
    sources: bundle.sources,
    summary: bundle.summary,
  };
}

export function buildEngineeringContextAuditMetadata(input: {
  auth: { clientId?: string | null };
  artifactId: string | null;
  repoFingerprint: unknown;
  includeCandidate: boolean;
  includeSuperseded: boolean;
  includeTemporary: boolean;
  preset: string;
  contextExport: { targetFile: string; format: string };
  maxItemsPerSection: number;
  contextPacket: { counts: { totalItems: number; evidenceRefs: number } };
}) {
  return {
    clientId: input.auth.clientId,
    artifactId: input.artifactId,
    repoFingerprint: input.repoFingerprint,
    includeCandidate: input.includeCandidate,
    includeSuperseded: input.includeSuperseded,
    includeTemporary: input.includeTemporary,
    preset: input.preset,
    targetFile: input.contextExport.targetFile,
    exportFormat: input.contextExport.format,
    maxItemsPerSection: input.maxItemsPerSection,
    includedContextItems: input.contextPacket.counts.totalItems,
    evidenceRefs: input.contextPacket.counts.evidenceRefs,
  };
}

export function buildEngineeringContextJsonResponse(input: {
  memories: unknown[];
  contextPacket: EngineeringContextBundle["contextPacket"];
  contextMarkdown: EngineeringContextBundle["contextMarkdown"];
  contextExport: EngineeringContextBundle["contextExport"];
}) {
  return {
    policy: engineeringContextPolicy(),
    relationship: {
      sivraj: "Remembers encrypted engineering context, synthesizes durable preferences, and exports source-backed packets.",
      codingAgents: "Execute coding tasks inside tools such as Codex, Claude Code, Cursor, or custom agents.",
      handoff: "Use contextMarkdown or contextPacket as portable agent context. Future connectors can automate this handoff.",
    },
    contextPacket: input.contextPacket,
    contextMarkdown: input.contextMarkdown,
    contextExport: input.contextExport,
    profileSummary: {
      totalEngineeringMemories: input.memories.length,
      includedContextItems: input.contextPacket.counts.totalItems,
      evidenceRefs: input.contextPacket.counts.evidenceRefs,
      warnings: input.contextPacket.warnings,
      issues: input.contextPacket.issues,
      quality: input.contextPacket.quality,
      repoFingerprint: input.contextPacket.project.repoFingerprint,
    },
  };
}
