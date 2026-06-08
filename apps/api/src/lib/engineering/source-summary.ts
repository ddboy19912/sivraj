import type { candidateMemories, sourceArtifacts } from "@sivraj/db";
import { recordMetadata } from "../safe-metadata.js";

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function toEngineeringSourceCandidate(row: typeof candidateMemories.$inferSelect) {
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

function countEngineeringCandidates(
  candidateSummaries: ReturnType<typeof toEngineeringSourceCandidate>[],
) {
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byScope: Record<string, number> = {};

  for (const candidate of candidateSummaries) {
    byType[candidate.engineeringMemoryType] = (byType[candidate.engineeringMemoryType] ?? 0) + 1;
    byStatus[candidate.status] = (byStatus[candidate.status] ?? 0) + 1;
    byScope[candidate.scope] = (byScope[candidate.scope] ?? 0) + 1;
  }

  return { byType, byStatus, byScope };
}

export function toEngineeringSourceSummary(
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
  const counts = countEngineeringCandidates(candidateSummaries);

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
    counts,
    candidates: candidateSummaries,
  };
}
