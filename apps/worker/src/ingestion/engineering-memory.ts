import {
  detectEngineeringSourceKind,
  sanitizeSecureMetadataRecord,
  type EngineeringMemoryExtractionResult,
  type EngineeringMemoryType,
  type ExtractedEngineeringMemory,
  type ExtractedMemory,
  type MemoryExtractionResult,
} from "@sivraj/intelligence";
import type { EngineeringMemoryExtractor, QueuedArtifact } from "../types/ingestion.types.js";
import { asRecord, readMetadataString } from "./metadata-utils.js";

const ENGINEERING_MEMORY_TYPE_MAP: Record<EngineeringMemoryType, ExtractedMemory["memoryType"]> = {
  coding_preference: "preference",
  tool_preference: "preference",
  style_rule: "preference",
  architecture_decision: "decision",
  security_boundary: "decision",
  deployment_environment: "project_update",
  recurring_bug: "project_update",
  project_convention: "project_update",
  testing_practice: "fact",
  agent_instruction: "fact",
};

function mapEngineeringMemoryTypeToMemoryType(
  type: EngineeringMemoryType,
): ExtractedMemory["memoryType"] {
  return ENGINEERING_MEMORY_TYPE_MAP[type] ?? "other";
}

export function emptyMemoryExtractionResult(originalLength: number): MemoryExtractionResult {
  return {
    memories: [],
    metadata: {
      extractor: "llm_structured_memory_extractor",
      provider: "none",
      model: "none",
      originalLength,
      returnedMemories: 0,
      acceptedMemories: 0,
      warnings: ["memory_extractor_not_configured"],
    },
  };
}

function looksLikeEngineeringContent(value: string): boolean {
  return /\b(code|repo|github|pull request|pr|commit|branch|test|lint|build|deploy|api|database|postgres|redis|docker|vite|react|next\.?js|hono|drizzle|pnpm|npm|yarn|bun|typescript|javascript|rust|go|python|walrus|seal|sui|encrypt|plaintext|security|privacy|codex|claude|cursor|agent|architecture|monorepo|workspace|environment|env)\b/i
    .test(value);
}

export async function maybeExtractEngineeringMemories(input: {
  artifact: QueuedArtifact;
  memoryFragmentId: string;
  content: string;
  title?: string | null;
  engineeringMemoryExtractor?: EngineeringMemoryExtractor;
}): Promise<EngineeringMemoryExtractionResult | null> {
  if (!input.engineeringMemoryExtractor) {
    return null;
  }

  const artifactMetadata = asRecord(input.artifact.metadata);
  const sourceDetection = detectEngineeringSourceKind({
    sourceType: input.artifact.sourceType,
    metadata: artifactMetadata,
    path: readMetadataString(artifactMetadata, "path"),
    fileName: readMetadataString(artifactMetadata, "fileName"),
  });

  if (sourceDetection.sourceKind === "unknown" && !looksLikeEngineeringContent(input.content)) {
    return null;
  }

  return input.engineeringMemoryExtractor.extract({
    twinId: input.artifact.twinId,
    sourceArtifactId: input.artifact.id,
    memoryFragmentId: input.memoryFragmentId,
    sourceType: input.artifact.sourceType,
    content: input.content,
    title: input.title,
    path: sourceDetection.normalizedPath,
    fileName: readMetadataString(artifactMetadata, "fileName"),
    metadata: artifactMetadata,
  });
}

export function engineeringMemoryToCandidateMemory(
  memory: ExtractedEngineeringMemory,
): ExtractedMemory {
  return {
    statement: memory.statement,
    normalizedStatement: memory.normalizedStatement,
    memoryType: mapEngineeringMemoryTypeToMemoryType(memory.engineeringMemoryType),
    subject: memory.subject,
    confidence: memory.confidence,
    evidenceHash: memory.evidenceHash,
    evidenceLength: memory.evidenceLength,
    metadata: {
      ...sanitizeEngineeringCandidateMetadata(memory.metadata),
      engineering: true,
      engineeringMemoryType: memory.engineeringMemoryType,
      engineeringInstructionScope: memory.scope,
    },
  };
}

export function engineeringMemoryMetadata(memory: ExtractedEngineeringMemory): Record<string, unknown> {
  const metadata = sanitizeEngineeringCandidateMetadata(memory.metadata);

  return {
    engineering: true,
    engineeringMemoryType: memory.engineeringMemoryType,
    engineeringInstructionScope: memory.scope,
    engineeringSubject: memory.subject,
    engineeringEvidenceHash: memory.evidenceHash,
    engineeringEvidenceLength: memory.evidenceLength,
    ...(typeof metadata["agentContextLine"] === "string"
      ? { agentContextLine: metadata["agentContextLine"] }
      : {}),
    ...(Object.keys(metadata).length > 0 ? { engineeringMetadata: metadata } : {}),
  };
}

function sanitizeEngineeringCandidateMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return sanitizeSecureMetadataRecord(metadata, { allowAgentContextLine: true });
}

export function buildEngineeringExtractionMetadata(
  engineeringResult: EngineeringMemoryExtractionResult,
  options: {
    includeCandidateInstructionCount?: boolean;
    includeWarnings?: boolean;
  } = {},
): Record<string, unknown> {
  return {
    engineeringExtraction: {
      extractor: engineeringResult.metadata.extractor,
      provider: engineeringResult.metadata.provider,
      model: engineeringResult.metadata.model,
      sourceKind: engineeringResult.metadata.sourceKind,
      acceptedMemories: engineeringResult.metadata.acceptedMemories,
      ...(options.includeCandidateInstructionCount
        ? { candidateInstructionCount: engineeringResult.metadata.candidateInstructionCount }
        : {}),
      ...(options.includeWarnings ? { warnings: engineeringResult.metadata.warnings } : {}),
    },
  };
}
