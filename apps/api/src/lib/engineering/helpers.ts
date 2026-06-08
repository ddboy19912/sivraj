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
import {
  AGENT_CONTEXT_READ_SCOPE,
  AGENT_PROJECT_PROFILE_READ_SCOPE,
} from "@sivraj/auth";
import { candidateMemories } from "@sivraj/db";
import { and, desc, eq } from "drizzle-orm";
import type { Context } from "hono";
import type { AppDependencies } from "../../app.js";
import { recordMetadata, sanitizeSafeMetadata } from "../safe-metadata.js";
import type { AuthEnv } from "../../middleware/auth.js";
import { authorizeEngineeringAgentRoute, type AuthorizedTwin } from "../http/route-auth.js";
import { toEngineeringSourceCandidate } from "./source-summary.js";

export const ENGINEERING_CONTEXT_SCOPES = [
  "memory:read",
  AGENT_CONTEXT_READ_SCOPE,
  AGENT_PROJECT_PROFILE_READ_SCOPE,
] as const;

export const ENGINEERING_CONTEXT_AGENT_SCOPES = [
  AGENT_CONTEXT_READ_SCOPE,
  AGENT_PROJECT_PROFILE_READ_SCOPE,
] as const;

export function createEngineeringAgentHandler(
  db: AppDependencies["db"],
  input: {
    scopes: readonly string[];
    acceptedAgentScopes: readonly string[];
  },
) {
  return (
    handler: (
      c: Context<AuthEnv>,
      ctx: AuthorizedTwin,
    ) => Response | Promise<Response>,
  ) => {
    return async (c: Context<AuthEnv>) => {
      const routeAuth = await authorizeEngineeringAgentRoute(c, db, input);

      if (!routeAuth.ok) {
        return routeAuth.response;
      }

      return handler(c, routeAuth.value);
    };
  };
}

export async function loadEngineeringProfileMemories(
  db: AppDependencies["db"],
  twinId: string,
  input: { artifactId?: string | null; limit: number },
): Promise<EngineeringProfileMemoryRecord[]> {
  const filters = [eq(candidateMemories.twinId, twinId)];

  if (input.artifactId) {
    filters.push(eq(candidateMemories.sourceArtifactId, input.artifactId));
  }

  const rows = await db
    .select()
    .from(candidateMemories)
    .where(and(...filters))
    .orderBy(desc(candidateMemories.createdAt))
    .limit(input.limit);

  return rows
    .map(toEngineeringProfileMemory)
    .filter((memory): memory is EngineeringProfileMemoryRecord => Boolean(memory));
}

export async function loadEngineeringReviewBundle(
  db: AppDependencies["db"],
  twinId: string,
  limit: number,
) {
  const rows = await db
    .select()
    .from(candidateMemories)
    .where(eq(candidateMemories.twinId, twinId))
    .orderBy(desc(candidateMemories.createdAt))
    .limit(limit);

  return {
    rows,
    memories: rows
      .map(toEngineeringProfileMemory)
      .filter((memory): memory is EngineeringProfileMemoryRecord => Boolean(memory)),
  };
}

export function groupEngineeringCandidates(rows: Array<typeof candidateMemories.$inferSelect>) {
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

export type EngineeringReviewCandidate =
  Omit<ReturnType<typeof toEngineeringSourceCandidate>, "createdAt"> & {
    sourceArtifactId: string;
    memoryFragmentId: string;
    metadata: Record<string, unknown>;
  };

export function toEngineeringReviewCandidate(row: typeof candidateMemories.$inferSelect): EngineeringReviewCandidate | null {
  const metadata = recordMetadata(row.metadata);

  if (metadata["engineering"] !== true) {
    return null;
  }

  const summary = toEngineeringSourceCandidate(row);

  return {
    ...summary,
    sourceArtifactId: row.sourceArtifactId,
    memoryFragmentId: row.memoryFragmentId,
    metadata: sanitizeSafeMetadata(metadata),
  };
}

export function buildEngineeringContextResponse(input: {
  repoFingerprint: EngineeringRepoFingerprint;
  memories: EngineeringProfileMemoryRecord[];
  includeCandidate: boolean;
  includeRejected: boolean;
  includeSuperseded: boolean;
  includeTemporary: boolean;
  preset: CodingAgentExportPreset;
  maxItemsPerSection: number;
}) {
  const profile = buildEngineeringProjectProfile({
    projectId: input.repoFingerprint.projectId,
    projectName: input.repoFingerprint.projectName,
    repoFingerprint: input.repoFingerprint,
    memories: input.memories,
    includeCandidate: true,
    includeRejected: input.includeRejected,
    maxEntriesPerCategory: Math.max(input.maxItemsPerSection, 25),
  });
  const contextPacket = buildCodingAgentContextPacket({
    profile,
    includeCandidate: input.includeCandidate,
    includeSuperseded: input.includeSuperseded,
    maxItemsPerSection: input.maxItemsPerSection,
    scope: {
      includeTemporary: input.includeTemporary,
    },
  });
  const contextMarkdown = formatCodingAgentContextMarkdown(contextPacket, {
    maxItemsPerSection: input.maxItemsPerSection,
  });
  const contextExport = buildCodingAgentContextExport(contextPacket, {
    preset: input.preset,
    includeCandidate: input.includeCandidate,
    maxItems: input.maxItemsPerSection,
  });

  return { profile, contextPacket, contextMarkdown, contextExport };
}

export function buildEngineeringInstructionPatchResponse(input: {
  repoFingerprint: EngineeringRepoFingerprint;
  memories: EngineeringProfileMemoryRecord[];
  preset: CodingAgentExportPreset | undefined;
  targetFile: CodingAgentExportTargetFile | undefined;
  includeCandidate: boolean;
  includeTemporary: boolean;
  maxItems: number;
}) {
  const profile = buildEngineeringProjectProfile({
    projectId: input.repoFingerprint.projectId,
    projectName: input.repoFingerprint.projectName,
    repoFingerprint: input.repoFingerprint,
    memories: input.memories,
    includeCandidate: true,
    includeRejected: false,
    maxEntriesPerCategory: Math.max(input.maxItems, 25),
  });
  const contextPacket = buildCodingAgentContextPacket({
    profile,
    includeCandidate: input.includeCandidate,
    includeSuperseded: false,
    maxItemsPerSection: input.maxItems,
    scope: {
      includeTemporary: input.includeTemporary,
    },
  });
  const patch = buildEngineeringInstructionPatch(contextPacket, {
    preset: input.preset,
    targetFile: input.targetFile,
    includeCandidate: input.includeCandidate,
    maxItems: input.maxItems,
  });

  return { contextPacket, patch };
}

export function engineeringContextPolicy() {
  return {
    rawArtifactsIncluded: false,
    decryptedMemoryIncluded: false,
    plaintextStatementsIncluded: false,
    derivedEngineeringContextIncluded: true,
    scope: "memory:read" as const,
    agentScopesAccepted: [AGENT_CONTEXT_READ_SCOPE, AGENT_PROJECT_PROFILE_READ_SCOPE],
  };
}

export function emptyEngineeringSourcesResponse() {
  return {
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

  const ids = readEngineeringIdentityFields(record);
  if (!ids) {
    return null;
  }

  return {
    ...ids,
    engineeringMemoryType,
    scope,
    subject: readString(metadata["subject"]),
    confidence: readNumber(record["confidenceScore"]) ?? 0.5,
    status: readStatus(record["status"]),
    metadata: buildEngineeringSafeMetadata(metadata, engineeringMetadata),
  };
}

function readEngineeringIdentityFields(record: Record<string, unknown>) {
  const id = readString(record["id"]);
  const sourceArtifactId = readString(record["sourceArtifactId"]);
  const memoryFragmentId = readString(record["memoryFragmentId"]);
  const memoryType = readString(record["memoryType"]);
  const evidenceHash = readString(record["evidenceHash"]);

  if (!id || !sourceArtifactId || !memoryFragmentId || !memoryType || !evidenceHash) {
    return null;
  }

  return {
    id,
    sourceArtifactId,
    memoryFragmentId,
    memoryType,
    evidenceHash,
    evidenceLength: readNumber(record["evidenceLength"]),
  };
}

function buildEngineeringSafeMetadata(
  metadata: Record<string, unknown>,
  engineeringMetadata: Record<string, unknown>,
) {
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

  return safeMetadata;
}

export function readOptionalUuid(value: string | undefined): string | null {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

export function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return fallback;
}

export function readLimit(value: string | undefined): number {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, 1_000)
    : 500;
}

export function readMaxItems(value: string | undefined): number {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, 100)
    : 25;
}

export function readMaxItemsFromUnknown(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? Math.min(value, 100)
    : 25;
}

export function readLimitFromUnknown(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? Math.min(value, 1_000)
    : 500;
}

export function readBooleanPayload(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function readTargetInstructionFile(value: unknown): CodingAgentExportTargetFile | undefined {
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

export function readExportPreset(value: string | undefined): CodingAgentExportPreset {
  if (value === "claude_code" || value === "cursor" || value === "generic_mcp") {
    return value;
  }

  return "codex";
}

export function readExportPresetFromUnknown(value: unknown): CodingAgentExportPreset | undefined {
  if (value === "codex" || value === "claude_code" || value === "cursor" || value === "generic_mcp") {
    return value;
  }

  return undefined;
}

export function readRepoFingerprintFromPayload(value: Record<string, unknown>): EngineeringRepoFingerprint {
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

export type EngineeringReviewAction = "keep_active" | "supersede" | "reject" | "needs_review";

export function readReviewAction(value: unknown): EngineeringReviewAction | null {
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

export function statusForReviewAction(action: EngineeringReviewAction): "candidate" | "approved" | "rejected" | "superseded" {
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

export function feedbackTypeForReviewAction(action: EngineeringReviewAction): "approved" | "rejected" | "edited_later" {
  if (action === "keep_active") {
    return "approved";
  }

  if (action === "reject") {
    return "rejected";
  }

  return "edited_later";
}

export function readRepoFingerprint(c: {
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
