import type {
  EngineeringMemoryExtractionResult,
  ExtractedEngineeringMemory,
  ExtractedMemory,
  MemoryExtractionResult,
  PatternSignal,
} from "@sivraj/intelligence";
import {
  buildEngineeringExtractionMetadata,
  emptyMemoryExtractionResult,
  engineeringMemoryMetadata,
  engineeringMemoryToCandidateMemory,
  maybeExtractEngineeringMemories,
} from "./engineering-memory.js";
import {
  clusterProjectsFromCandidates,
  detectAndLinkPatterns,
  linkDecisionGraphNodes,
  linkGoalGraphNodes,
  patternMetadataForMemory,
  readProjectCandidateFromMemory,
  toPatternSignal,
  upsertArtifactGraphNode,
} from "./graph-linking.js";
import { readConversationMemoryPolicy } from "./parse-content.js";
import type {
  ArtifactRepository,
  CandidateMemoryArchiveQueue,
  CanonicalMemoryMergeJudge,
  DecisionGraphCandidate,
  EngineeringMemoryExtractor,
  GoalGraphCandidate,
  MemoryExtractor,
  PrivateFragmentStorage,
  ProjectClusterCandidate,
  QueuedArtifact,
} from "../types/ingestion.types.js";
import { pendingCandidateMemoryArchiveRef } from "./artifact-metadata.js";
import { errorMessage } from "./errors.js";
import { sha256Text } from "./readers.js";

type ExtractedMemoryEntry = {
  memory: ExtractedMemory;
  engineering: ExtractedEngineeringMemory | null;
};

type EncryptedBatch = {
  encryptedBytesBase64: string;
  contentSha256: string;
  metadata: Record<string, unknown>;
};

type PersistedMemories = {
  candidateMemoryIds: string[];
  storedCount: number;
  projectCandidates: ProjectClusterCandidate[];
  decisionCandidates: DecisionGraphCandidate[];
  goalCandidates: GoalGraphCandidate[];
  currentPatternSignals: PatternSignal[];
};

type GraphLinkingResult = {
  projectClustering: Record<string, unknown> | null;
  decisionExtraction: Record<string, unknown> | null;
  goalInference: Record<string, unknown> | null;
  patternDetection: Record<string, unknown> | null;
};

function logArtifactExtractionFailure(
  input: {
    artifact: QueuedArtifact;
    memoryFragmentId: string;
  },
  error: unknown,
): void {
  console.warn("artifact memory extraction failed", {
    artifactId: input.artifact.id,
    sourceType: input.artifact.sourceType,
    memoryFragmentId: input.memoryFragmentId,
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: errorMessage(error),
  });
}

function buildMemoryExtractionOutcomeFields(input: {
  engineeringResult: EngineeringMemoryExtractionResult | null;
  engineeringOptions: {
    includeWarnings?: boolean;
    includeCandidateInstructionCount?: boolean;
  };
  candidateMemoryEncryptMs: number;
  candidateMemoryDbWriteMs: number;
  archiveQueued: boolean;
  projectClustering: Record<string, unknown> | null;
  decisionExtraction: Record<string, unknown> | null;
  goalInference: Record<string, unknown> | null;
  patternDetection: Record<string, unknown> | null;
  conversationPolicy: Record<string, unknown> | null;
  conversationUnderstanding: unknown;
}): Record<string, unknown> {
  return {
    ...(input.engineeringResult
      ? buildEngineeringExtractionMetadata(input.engineeringResult, input.engineeringOptions)
      : {}),
    candidateMemoryEncryptMs: input.candidateMemoryEncryptMs,
    candidateMemoryDbWriteMs: input.candidateMemoryDbWriteMs,
    candidateMemoryArchiveQueued: input.archiveQueued,
    ...(input.projectClustering ? { projectClustering: input.projectClustering } : {}),
    ...(input.decisionExtraction ? { decisionExtraction: input.decisionExtraction } : {}),
    ...(input.goalInference ? { goalInference: input.goalInference } : {}),
    ...(input.patternDetection ? { patternDetection: input.patternDetection } : {}),
    ...(input.conversationPolicy
      ? {
          sourceKind: input.conversationPolicy.sourceKind,
          conversationSourceType: input.conversationPolicy.conversationSourceType,
          attributionAware: input.conversationPolicy.attributionAware,
          speakerRolePolicy: input.conversationPolicy.speakerRolePolicy,
          voiceDerived: input.conversationPolicy.voiceDerived,
          conversationUnderstanding: input.conversationUnderstanding,
        }
      : {}),
  };
}

async function extractRegularMemories(
  input: {
    artifact: QueuedArtifact;
    memoryFragmentId: string;
    content: string;
    title?: string | null;
    memoryExtractor?: MemoryExtractor;
  },
): Promise<{ result: MemoryExtractionResult; llmMs: number }> {
  const llmStartedAt = Date.now();
  const result = input.memoryExtractor
    ? await input.memoryExtractor.extract({
        twinId: input.artifact.twinId,
        sourceArtifactId: input.artifact.id,
        memoryFragmentId: input.memoryFragmentId,
        sourceType: input.artifact.sourceType,
        content: input.content,
        title: input.title,
      })
    : emptyMemoryExtractionResult(input.content.length);

  return {
    result,
    llmMs: Date.now() - llmStartedAt,
  };
}

function buildExtractedMemoryEntries(
  result: MemoryExtractionResult,
  engineeringResult: EngineeringMemoryExtractionResult | null,
): ExtractedMemoryEntry[] {
  return [
    ...result.memories.map((memory) => ({
      memory,
      engineering: null,
    })),
    ...(engineeringResult?.memories ?? []).map((engineeringMemory) => ({
      memory: engineeringMemoryToCandidateMemory(engineeringMemory),
      engineering: engineeringMemory,
    })),
  ];
}

async function encryptCandidateBatch(
  input: {
    artifact: QueuedArtifact;
    memoryFragmentId: string;
    privateFragmentStorage: PrivateFragmentStorage;
    extractedMemories: ExtractedMemoryEntry[];
    conversationPolicy: Record<string, unknown> | null;
    conversationUnderstanding: unknown;
  },
): Promise<{ encrypted: EncryptedBatch | null; candidateMemoryEncryptMs: number }> {
  if (input.extractedMemories.length === 0) {
    return { encrypted: null, candidateMemoryEncryptMs: 0 };
  }

  const encryptStartedAt = Date.now();
  const encrypted = await input.privateFragmentStorage.encryptPrivateFragment!({
    twinId: input.artifact.twinId,
    sourceArtifactId: input.artifact.id,
    sourceType: "candidate_memory_batch",
    content: JSON.stringify({
      kind: "candidate_memory_batch",
      version: 1,
      sourceArtifactId: input.artifact.id,
      memoryFragmentId: input.memoryFragmentId,
      ...(input.conversationPolicy
        ? {
            sourceKind: input.conversationPolicy.sourceKind,
            conversationUnderstanding: input.conversationUnderstanding ?? null,
          }
        : {}),
      memories: input.extractedMemories.map(({ memory, engineering }, index) => ({
        statementIndex: index,
        statement: memory.statement,
        memoryType: memory.memoryType,
        subject: memory.subject,
        ...(engineering
          ? {
              engineering: {
                engineeringMemoryType: engineering.engineeringMemoryType,
                scope: engineering.scope,
              },
            }
          : {}),
      })),
    }),
    contentKind: "candidate_memory",
  });

  return {
    encrypted,
    candidateMemoryEncryptMs: Date.now() - encryptStartedAt,
  };
}

async function persistCandidateMemories(
  repository: ArtifactRepository,
  input: {
    artifact: QueuedArtifact;
    memoryFragmentId: string;
    extractedMemories: ExtractedMemoryEntry[];
    encrypted: EncryptedBatch;
    result: MemoryExtractionResult;
    engineeringResult: EngineeringMemoryExtractionResult | null;
    conversationPolicy: Record<string, unknown> | null;
    candidateMemoryArchiveQueue?: CandidateMemoryArchiveQueue;
    canonicalMemoryMergeJudge?: CanonicalMemoryMergeJudge;
  },
): Promise<PersistedMemories> {
  const candidateMemoryIds: string[] = [];
  const projectCandidates: ProjectClusterCandidate[] = [];
  const decisionCandidates: DecisionGraphCandidate[] = [];
  const goalCandidates: GoalGraphCandidate[] = [];
  const currentPatternSignals: PatternSignal[] = [];
  let storedCount = 0;

  for (const [statementIndex, extracted] of input.extractedMemories.entries()) {
    const { memory, engineering } = extracted;
    const candidate = await repository.createCandidateMemory({
      twinId: input.artifact.twinId,
      sourceArtifactId: input.artifact.id,
      memoryFragmentId: input.memoryFragmentId,
      memoryType: memory.memoryType,
      status: isAgentInstructionArtifact(input.artifact) ? "approved" : undefined,
      statement: memory.statement,
      normalizedStatement: memory.normalizedStatement,
      statementStorageRef: pendingCandidateMemoryArchiveRef(input.artifact.id, input.memoryFragmentId),
      statementSha256: input.encrypted.contentSha256,
      evidenceHash: memory.evidenceHash,
      evidenceLength: memory.evidenceLength,
      confidenceScore: memory.confidence,
      metadata: buildCandidateMemoryMetadata({
        memory,
        engineering,
        engineeringResult: input.engineeringResult,
        result: input.result,
        artifact: input.artifact,
        statementIndex,
        statementCount: input.extractedMemories.length,
        conversationPolicy: input.conversationPolicy,
        encrypted: input.encrypted,
        archiveQueueConfigured: Boolean(input.candidateMemoryArchiveQueue),
      }),
      mergeJudge: input.canonicalMemoryMergeJudge,
    });

    candidateMemoryIds.push(candidate.id);
    storedCount += 1;

    const projectCandidate = readProjectCandidateFromMemory(memory);
    if (projectCandidate) {
      projectCandidates.push(projectCandidate);
    }

    if (memory.memoryType === "decision") {
      decisionCandidates.push({ memory, candidateMemoryId: candidate.id, statementIndex });
    }

    if (memory.memoryType === "goal") {
      goalCandidates.push({ memory, candidateMemoryId: candidate.id, statementIndex });
    }

    const patternSignal = toPatternSignal(input.artifact, input.memoryFragmentId, candidate, memory);
    if (patternSignal) {
      currentPatternSignals.push(patternSignal);
    }
  }

  return {
    candidateMemoryIds,
    storedCount,
    projectCandidates,
    decisionCandidates,
    goalCandidates,
    currentPatternSignals,
  };
}

function isAgentInstructionArtifact(artifact: QueuedArtifact): boolean {
  const metadata = readRecord(artifact.metadata);

  return metadata["engineeringSourceKind"] === "agent_instruction_file" ||
    metadata["artifactPurpose"] === "agent_skill_source";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function buildCandidateMemoryMetadata(input: {
  memory: ExtractedMemory;
  engineering: ExtractedEngineeringMemory | null;
  engineeringResult: EngineeringMemoryExtractionResult | null;
  result: MemoryExtractionResult;
  artifact: QueuedArtifact;
  statementIndex: number;
  statementCount: number;
  conversationPolicy: Record<string, unknown> | null;
  encrypted: EncryptedBatch;
  archiveQueueConfigured: boolean;
}): Record<string, unknown> {
  return {
    storageMode: "encrypted_walrus",
    sensitivity: "private",
    archiveStatus: input.archiveQueueConfigured ? "pending" : "deferred",
    extractor: input.result.metadata.extractor,
    provider: input.result.metadata.provider,
    model: input.result.metadata.model,
    subject: input.memory.subject,
    normalizedStatementHash: sha256Text(input.memory.normalizedStatement),
    evidenceHash: input.memory.evidenceHash,
    evidenceLength: input.memory.evidenceLength,
    sourceType: input.artifact.sourceType,
    statementIndex: input.statementIndex,
    statementCount: input.statementCount,
    batchStorage: true,
    ...(input.engineering ? engineeringMemoryMetadata(input.engineering) : {}),
    ...(input.engineering && input.engineeringResult
      ? {
          extractor: input.engineeringResult.metadata.extractor,
          provider: input.engineeringResult.metadata.provider,
          model: input.engineeringResult.metadata.model,
        }
      : {}),
    ...(input.conversationPolicy ? input.conversationPolicy : {}),
    ...(input.result.metadata.conversationUnderstanding
      ? { conversationUnderstanding: input.result.metadata.conversationUnderstanding }
      : {}),
    ...(Object.keys(input.memory.metadata).length > 0 ? { memoryMetadata: input.memory.metadata } : {}),
    ...patternMetadataForMemory(input.memory),
    storage: input.encrypted.metadata,
  };
}

async function linkExtractedMemoryGraph(
  repository: ArtifactRepository,
  input: {
    artifact: QueuedArtifact;
    memoryFragmentId: string;
    persisted: PersistedMemories;
  },
): Promise<GraphLinkingResult> {
  const { projectCandidates, decisionCandidates, goalCandidates, currentPatternSignals } = input.persisted;
  const needsArtifactNode =
    projectCandidates.length > 0 ||
    decisionCandidates.length > 0 ||
    goalCandidates.length > 0 ||
    currentPatternSignals.length > 0;

  if (!needsArtifactNode) {
    return {
      projectClustering: null,
      decisionExtraction: null,
      goalInference: null,
      patternDetection: null,
    };
  }

  const artifactNode = await upsertArtifactGraphNode(repository, input.artifact, input.memoryFragmentId);

  const [projectClustering, decisionExtraction, goalInference, patternDetection] = await Promise.all([
    projectCandidates.length > 0
      ? clusterProjectsFromCandidates(repository, {
          artifact: input.artifact,
          memoryFragmentId: input.memoryFragmentId,
          artifactNodeId: artifactNode.id,
          candidates: projectCandidates,
        })
      : null,
    decisionCandidates.length > 0
      ? linkDecisionGraphNodes(repository, {
          artifact: input.artifact,
          memoryFragmentId: input.memoryFragmentId,
          artifactNodeId: artifactNode.id,
          decisions: decisionCandidates,
        })
      : null,
    goalCandidates.length > 0
      ? linkGoalGraphNodes(repository, {
          artifact: input.artifact,
          memoryFragmentId: input.memoryFragmentId,
          artifactNodeId: artifactNode.id,
          goals: goalCandidates,
        })
      : null,
    currentPatternSignals.length > 0
      ? detectAndLinkPatterns(repository, {
          artifact: input.artifact,
          memoryFragmentId: input.memoryFragmentId,
          artifactNodeId: artifactNode.id,
          currentSignals: currentPatternSignals,
        })
      : null,
  ]);

  return { projectClustering, decisionExtraction, goalInference, patternDetection };
}

async function queueMemoryArchiveIfNeeded(
  input: {
    repository: ArtifactRepository;
    artifact: QueuedArtifact;
    memoryFragmentId: string;
    candidateMemoryIds: string[];
    encrypted: EncryptedBatch | null;
    candidateMemoryArchiveQueue?: CandidateMemoryArchiveQueue;
  },
): Promise<boolean> {
  if (!input.encrypted || input.candidateMemoryIds.length === 0 || !input.candidateMemoryArchiveQueue) {
    return false;
  }

  const archive = await input.repository.createCandidateMemoryArchive({
    twinId: input.artifact.twinId,
    sourceArtifactId: input.artifact.id,
    memoryFragmentId: input.memoryFragmentId,
    sourceType: "candidate_memory_batch",
    candidateMemoryIds: input.candidateMemoryIds,
    encryptedBytesBase64: input.encrypted.encryptedBytesBase64,
    contentSha256: input.encrypted.contentSha256,
    metadata: input.encrypted.metadata,
  });

  const queued = await input.candidateMemoryArchiveQueue.enqueueCandidateMemoryArchive({
    archiveId: archive.id,
    artifactId: input.artifact.id,
    twinId: input.artifact.twinId,
    memoryFragmentId: input.memoryFragmentId,
    sourceType: "candidate_memory_batch",
    candidateMemoryIds: input.candidateMemoryIds,
    encryptedBytesBase64: input.encrypted.encryptedBytesBase64,
    contentSha256: input.encrypted.contentSha256,
    metadata: input.encrypted.metadata,
  });
  await input.repository.markCandidateMemoryArchiveQueued({
    archiveId: archive.id,
    candidateMemoryIds: input.candidateMemoryIds,
    jobId: queued.jobId,
  });

  return true;
}

export async function processMemoryExtraction(
  repository: ArtifactRepository,
  input: {
    artifact: QueuedArtifact;
    memoryFragmentId: string;
    content: string;
    title?: string | null;
    memoryExtractor?: MemoryExtractor;
    engineeringMemoryExtractor?: EngineeringMemoryExtractor;
    privateFragmentStorage?: PrivateFragmentStorage;
    candidateMemoryArchiveQueue?: CandidateMemoryArchiveQueue;
    canonicalMemoryMergeJudge?: CanonicalMemoryMergeJudge;
  },
): Promise<Record<string, unknown> | null> {
  if (!input.memoryExtractor && !input.engineeringMemoryExtractor) {
    return { status: "skipped", reason: "memory_extractors_not_configured" };
  }

  if (!input.privateFragmentStorage?.encryptPrivateFragment) {
    return { status: "skipped", reason: "encrypted_candidate_memory_encryption_not_configured" };
  }

  try {
    const { result, llmMs } = await extractRegularMemories(input);
    const engineeringStartedAt = Date.now();
    const engineeringResult = await maybeExtractEngineeringMemories(input);
    const engineeringExtractionMs = Date.now() - engineeringStartedAt;
    const extractedMemories = buildExtractedMemoryEntries(result, engineeringResult);
    const conversationPolicy = readConversationMemoryPolicy(input.content, input.artifact.sourceType);

    const { encrypted, candidateMemoryEncryptMs } = await encryptCandidateBatch({
      artifact: input.artifact,
      memoryFragmentId: input.memoryFragmentId,
      privateFragmentStorage: input.privateFragmentStorage,
      extractedMemories,
      conversationPolicy,
      conversationUnderstanding: result.metadata.conversationUnderstanding,
    });

    const dbWriteStartedAt = Date.now();
    const persisted = encrypted
      ? await persistCandidateMemories(repository, {
          artifact: input.artifact,
          memoryFragmentId: input.memoryFragmentId,
          extractedMemories,
          encrypted,
          result,
          engineeringResult,
          conversationPolicy,
          candidateMemoryArchiveQueue: input.candidateMemoryArchiveQueue,
          canonicalMemoryMergeJudge: input.canonicalMemoryMergeJudge,
        })
      : {
          candidateMemoryIds: [],
          storedCount: 0,
          projectCandidates: [],
          decisionCandidates: [],
          goalCandidates: [],
          currentPatternSignals: [],
        };

    const graphLinking = await linkExtractedMemoryGraph(repository, {
      artifact: input.artifact,
      memoryFragmentId: input.memoryFragmentId,
      persisted,
    });
    const candidateMemoryDbWriteMs = Date.now() - dbWriteStartedAt;
    const archiveQueued = await queueMemoryArchiveIfNeeded({
      repository,
      artifact: input.artifact,
      memoryFragmentId: input.memoryFragmentId,
      candidateMemoryIds: persisted.candidateMemoryIds,
      encrypted,
      candidateMemoryArchiveQueue: input.candidateMemoryArchiveQueue,
    });

    const outcomeFields = buildMemoryExtractionOutcomeFields({
      engineeringResult,
      engineeringOptions: { includeCandidateInstructionCount: true },
      candidateMemoryEncryptMs,
      candidateMemoryDbWriteMs,
      archiveQueued,
      ...graphLinking,
      conversationPolicy,
      conversationUnderstanding: result.metadata.conversationUnderstanding,
    });

    await repository.createAuditEvent({
      twinId: input.artifact.twinId,
      eventType: "artifact.memories_extracted",
      resourceId: input.artifact.id,
      metadata: {
        memoryFragmentId: input.memoryFragmentId,
        candidateMemoryCount: persisted.storedCount,
        regularMemoryCount: result.memories.length,
        engineeringMemoryCount: engineeringResult?.memories.length ?? 0,
        extractor: result.metadata.extractor,
        provider: result.metadata.provider,
        model: result.metadata.model,
        llmMs,
        engineeringExtractionMs,
        ...buildMemoryExtractionOutcomeFields({
          engineeringResult,
          engineeringOptions: { includeWarnings: true },
          candidateMemoryEncryptMs,
          candidateMemoryDbWriteMs,
          archiveQueued,
          ...graphLinking,
          conversationPolicy,
          conversationUnderstanding: result.metadata.conversationUnderstanding,
        }),
      },
    });

    return {
      status: "completed",
      candidateMemoryCount: persisted.storedCount,
      regularMemoryCount: result.memories.length,
      engineeringMemoryCount: engineeringResult?.memories.length ?? 0,
      extractor: result.metadata.extractor,
      provider: result.metadata.provider,
      model: result.metadata.model,
      warnings: [
        ...result.metadata.warnings,
        ...(engineeringResult?.metadata.warnings ?? []),
      ],
      llmMs,
      engineeringExtractionMs,
      ...outcomeFields,
    };
  } catch (error) {
    logArtifactExtractionFailure(input, error);

    await repository.createAuditEvent({
      twinId: input.artifact.twinId,
      eventType: "artifact.memory_extraction_failed",
      resourceId: input.artifact.id,
      metadata: {
        memoryFragmentId: input.memoryFragmentId,
        error: errorMessage(error),
      },
    });

    return {
      status: "failed",
      reason: "memory_extraction_failed",
      detail: errorMessage(error),
    };
  }
}
