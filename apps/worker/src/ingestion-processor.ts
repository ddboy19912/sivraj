import {
  extractEntities,
  extractEngineeringMemories,
  extractMemories,
  type ExtractedEntity,
} from "@sivraj/intelligence";
import type { StructuredGenerator } from "@sivraj/llm";
import type { PrivateMemoryReader } from "@sivraj/private-memory-reader";
import { WalrusStorageError } from "@sivraj/storage-walrus";
import {
  aggregateExtractionResults,
  createIntelligenceChunks,
  mapWithConcurrency,
  measureStage,
} from "./ingestion/chunk-utils.js";
import { ENCRYPTED_DECRYPTION_FAILED } from "./ingestion/constants.js";
import { RetryableArtifactProcessingError } from "./ingestion/errors.js";
import {
  clusterProjectsFromEntities,
  upsertArtifactGraphNode,
} from "./ingestion/graph-linking.js";
import { processMemoryExtraction } from "./ingestion/memory-extraction.js";
import { processClaimedArtifact } from "./ingestion/process-claimed-artifact.js";
import { parseCanonicalMemoryMergeResponse } from "./ingestion/canonical-memory-merge.js";
import type {
  ArtifactProcessingRequestOptions,
  ArtifactProcessingRuntimeOptions,
  ArtifactRepository,
  CanonicalMemoryMergeJudge,
  CandidateMemoryArchiveQueue,
  EngineeringMemoryExtractor,
  EntityExtractor,
  IntelligenceChunk,
  IntelligenceProcessingQueue,
  MemoryExtractor,
  PrivateFragmentStorage,
  ProcessArtifactResult,
  ProcessQueuedArtifactsResult,
  QueuedArtifact,
  WeeklyReflectionSignals,
} from "./types/ingestion.types.js";
import { errorMessage } from "./ingestion/errors.js";
import { approximateBase64Bytes } from "./ingestion/readers.js";
import {
  withCandidateMemoryArchiveState,
  withIntelligenceState,
} from "./ingestion/processing-metadata.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export { ENCRYPTED_DECRYPTION_FAILED } from "./ingestion/constants.js";
export { RetryableArtifactProcessingError } from "./ingestion/errors.js";
export type {
  ArtifactRepository,
  CanonicalMemoryMergeJudge,
  EngineeringMemoryExtractor,
  EntityExtractor,
  IntelligenceProcessingQueue,
  MemoryExtractor,
  ProcessArtifactResult,
  ProcessQueuedArtifactsResult,
  QueuedArtifact,
} from "./types/ingestion.types.js";

function artifactProcessingRuntimeOptions(
  options: ArtifactProcessingRequestOptions,
): ArtifactProcessingRuntimeOptions {
  return {
    privateMemoryReader: options.privateMemoryReader,
    privateFragmentStorage: options.privateFragmentStorage,
    speechToTextTranscriber: options.speechToTextTranscriber,
    textEmbedder: options.textEmbedder,
    structuredGenerator: options.structuredGenerator,
    intelligenceQueue: options.intelligenceQueue,
    transientCiphertextBase64: options.transientCiphertextBase64,
    transientCiphertextSha256: options.transientCiphertextSha256,
    publishArtifactStatus: options.publishArtifactStatus,
  };
}

export async function processArtifact(
  repository: ArtifactRepository,
  artifactId: string,
  options: ArtifactProcessingRequestOptions = {},
): Promise<ProcessArtifactResult> {
  const now = options.now ?? new Date();
  const claimed = await repository.claimArtifact(artifactId);

  if (!claimed) {
    return "skipped";
  }

  return processClaimedArtifact(repository, claimed, now, artifactProcessingRuntimeOptions(options));
}

async function recoverArtifact(
  repository: ArtifactRepository,
  artifactId: string,
  options: ArtifactProcessingRequestOptions = {},
): Promise<ProcessArtifactResult> {
  const now = options.now ?? new Date();
  const claimed = await repository.claimRecoverableArtifact(artifactId);

  if (!claimed) {
    return "skipped";
  }

  return processClaimedArtifact(repository, claimed, now, artifactProcessingRuntimeOptions(options));
}

export async function processQueuedArtifacts(
  repository: ArtifactRepository,
  options: {
    limit?: number;
    now?: Date;
    privateMemoryReader?: PrivateMemoryReader;
    privateFragmentStorage?: PrivateFragmentStorage;
    speechToTextTranscriber?: ArtifactProcessingRuntimeOptions["speechToTextTranscriber"];
    textEmbedder?: ArtifactProcessingRuntimeOptions["textEmbedder"];
    structuredGenerator?: ArtifactProcessingRuntimeOptions["structuredGenerator"];
    intelligenceQueue?: IntelligenceProcessingQueue;
  } = {},
): Promise<ProcessQueuedArtifactsResult> {
  const limit = options.limit ?? 10;
  const now = options.now ?? new Date();
  const artifacts = await repository.findQueuedArtifacts(limit);
  const result: ProcessQueuedArtifactsResult = {
    scanned: artifacts.length,
    completed: 0,
    pending: 0,
    failed: 0,
  };

  for (const artifact of artifacts) {
    const outcome = await recoverArtifact(repository, artifact.id, {
      now,
      privateMemoryReader: options.privateMemoryReader,
      privateFragmentStorage: options.privateFragmentStorage,
      speechToTextTranscriber: options.speechToTextTranscriber,
      textEmbedder: options.textEmbedder,
      structuredGenerator: options.structuredGenerator,
      intelligenceQueue: options.intelligenceQueue,
    }).catch((error: unknown) => {
      if (error instanceof RetryableArtifactProcessingError) {
        return "pending" as const;
      }

      throw error;
    });

    if (outcome === "skipped") {
      continue;
    }

    result[outcome] += 1;
  }

  return result;
}

export async function enqueueDueCandidateMemoryArchives(
  repository: ArtifactRepository,
  input: {
    limit?: number;
    now?: Date;
    candidateMemoryArchiveQueue?: CandidateMemoryArchiveQueue;
  },
): Promise<{ scanned: number; queued: number; failed: number }> {
  const due = await repository.findDueCandidateMemoryArchives({
    limit: input.limit ?? 10,
    now: input.now ?? new Date(),
  });
  const result = {
    scanned: due.length,
    queued: 0,
    failed: 0,
  };

  if (!input.candidateMemoryArchiveQueue) {
    return result;
  }

  for (const archive of due) {
    try {
      const queued = await input.candidateMemoryArchiveQueue.enqueueCandidateMemoryArchive({
        archiveId: archive.id,
        artifactId: archive.sourceArtifactId,
        twinId: archive.twinId,
        memoryFragmentId: archive.memoryFragmentId,
        sourceType: archive.sourceType,
        candidateMemoryIds: archive.candidateMemoryIds,
        encryptedBytesBase64: archive.encryptedBytesBase64,
        contentSha256: archive.contentSha256,
        metadata: archive.metadata,
      });

      await repository.markCandidateMemoryArchiveQueued({
        archiveId: archive.id,
        candidateMemoryIds: archive.candidateMemoryIds,
        jobId: queued.jobId,
      });
      result.queued += 1;
    } catch (error) {
      result.failed += 1;
      console.error("candidate memory archive reconcile enqueue failed", {
        archiveId: archive.id,
        error: errorMessage(error),
      });
    }
  }

  return result;
}

type ArtifactIntelligenceInput = {
  artifactId: string;
  twinId: string;
  memoryFragmentId: string;
  sourceType: string;
  transientFragmentCiphertextBase64?: string;
  transientFragmentCiphertextSha256?: string;
  privateMemoryReader?: PrivateMemoryReader;
  entityExtractor?: EntityExtractor;
  memoryExtractor?: MemoryExtractor;
  engineeringMemoryExtractor?: EngineeringMemoryExtractor;
  canonicalMemoryMergeJudge?: CanonicalMemoryMergeJudge;
  privateFragmentStorage?: PrivateFragmentStorage;
  candidateMemoryArchiveQueue?: CandidateMemoryArchiveQueue;
  intelligenceChunkChars?: number;
  intelligenceChunkConcurrency?: number;
};

export async function processArtifactIntelligence(
  repository: ArtifactRepository,
  input: ArtifactIntelligenceInput,
): Promise<Record<string, unknown>> {
  const context = await loadArtifactIntelligenceContext(repository, input);
  await markArtifactIntelligenceProcessing(repository, context, input.memoryFragmentId);

  const startedAt = Date.now();
  const timings: Record<string, number> = {};
  const content = await decryptArtifactIntelligenceFragment(context, input, timings);
  const chunks = createIntelligenceChunks(content, input.intelligenceChunkChars ?? 18_000);
  logArtifactIntelligenceChunking(input, content, chunks);
  const entityExtraction = await runArtifactEntityExtraction(repository, context, input, chunks, timings);
  const memoryExtraction = await runArtifactMemoryExtraction(repository, context, input, chunks, timings);

  if (memoryExtraction && typeof memoryExtraction.candidateMemoryEncryptMs === "number") {
    timings.candidateMemoryEncryptMs = memoryExtraction.candidateMemoryEncryptMs;
  }

  timings.totalIntelligenceMs = Date.now() - startedAt;
  const intelligence = buildArtifactIntelligenceResult(entityExtraction, memoryExtraction, timings);

  await finalizeArtifactIntelligence(repository, context.artifact.id, intelligence);
  throwIfArtifactIntelligenceFailed(context.artifact.id, intelligence);

  return intelligence;
}

async function loadArtifactIntelligenceContext(
  repository: ArtifactRepository,
  input: ArtifactIntelligenceInput,
) {
  if (!input.privateMemoryReader) {
    throw new Error("private_memory_reader_not_configured");
  }

  const artifact = await repository.findArtifactById(input.artifactId);
  const fragment = await repository.findMemoryFragmentById(input.memoryFragmentId);

  if (!artifact || artifact.twinId !== input.twinId) {
    throw new Error("artifact_not_found");
  }

  if (!fragment || fragment.twinId !== input.twinId || fragment.sourceArtifactId !== input.artifactId) {
    throw new Error("memory_fragment_not_found");
  }

  if (!fragment.contentStorageRef) {
    throw new Error("memory_fragment_storage_ref_missing");
  }

  return { artifact, fragment };
}

async function markArtifactIntelligenceProcessing(
  repository: ArtifactRepository,
  context: Awaited<ReturnType<typeof loadArtifactIntelligenceContext>>,
  memoryFragmentId: string,
) {
  await repository.markArtifactCompleted(
    context.artifact.id,
    withIntelligenceState(asRecord(context.artifact.metadata), {
      status: "processing",
      memoryFragmentId,
      startedAt: new Date().toISOString(),
    }),
  );
}

async function decryptArtifactIntelligenceFragment(
  context: Awaited<ReturnType<typeof loadArtifactIntelligenceContext>>,
  input: ArtifactIntelligenceInput,
  timings: Record<string, number>,
) {
  console.log("artifact intelligence stage started", {
    artifactId: input.artifactId,
    stage: "fragment_decrypt",
  });

  const content = await measureStage("fragmentDecryptMs", timings, () =>
    readArtifactIntelligenceFragment(context, input),
  );

  console.log("artifact intelligence stage completed", {
    artifactId: input.artifactId,
    stage: "fragment_decrypt",
    contentChars: content.length,
    durationMs: timings.fragmentDecryptMs,
  });

  return content;
}

function readArtifactIntelligenceFragment(
  context: Awaited<ReturnType<typeof loadArtifactIntelligenceContext>>,
  input: ArtifactIntelligenceInput,
) {
  const reader = input.privateMemoryReader!;

  if (input.transientFragmentCiphertextBase64 && reader.readPrivateMemoryFromEncryptedBytes) {
    console.log("intelligence transient fragment ciphertext handoff used", {
      artifactId: input.artifactId,
      memoryFragmentId: input.memoryFragmentId,
      ciphertextBytesApprox: approximateBase64Bytes(input.transientFragmentCiphertextBase64),
    });

    return reader.readPrivateMemoryFromEncryptedBytes({
      encryptedBytesBase64: input.transientFragmentCiphertextBase64,
      artifactId: input.artifactId,
      twinId: input.twinId,
      expectedCiphertextSha256: input.transientFragmentCiphertextSha256 ?? context.fragment.contentSha256,
      source: "intelligence_queue",
    });
  }

  return reader.readPrivateMemory({
    rawStorageRef: context.fragment.contentStorageRef!,
    artifactId: input.artifactId,
    twinId: input.twinId,
    expectedCiphertextSha256: context.fragment.contentSha256,
  });
}

function logArtifactIntelligenceChunking(
  input: ArtifactIntelligenceInput,
  content: string,
  chunks: IntelligenceChunk[],
) {
  console.log("artifact intelligence chunking completed", {
    artifactId: input.artifactId,
    memoryFragmentId: input.memoryFragmentId,
    contentChars: content.length,
    chunkCount: chunks.length,
    chunkChars: input.intelligenceChunkChars ?? 18_000,
    chunkConcurrency: input.intelligenceChunkConcurrency ?? 2,
  });
}

async function runArtifactEntityExtraction(
  repository: ArtifactRepository,
  context: Awaited<ReturnType<typeof loadArtifactIntelligenceContext>>,
  input: ArtifactIntelligenceInput,
  chunks: IntelligenceChunk[],
  timings: Record<string, number>,
) {
  console.log("artifact intelligence stage started", {
    artifactId: input.artifactId,
    stage: "entity_extraction",
  });

  const entityExtraction = await measureStage("entityExtractionMs", timings, () =>
    processEntityExtractionChunks(repository, {
      artifact: context.artifact,
      memoryFragmentId: input.memoryFragmentId,
      chunks,
      title: null,
      entityExtractor: input.entityExtractor,
      concurrency: input.intelligenceChunkConcurrency ?? 2,
    }),
  );

  console.log("artifact intelligence stage completed", {
    artifactId: input.artifactId,
    stage: "entity_extraction",
    status: entityExtraction?.status,
    durationMs: timings.entityExtractionMs,
    llmMs: entityExtraction?.llmMs,
    graphWriteMs: entityExtraction?.graphWriteMs,
  });

  return entityExtraction;
}

async function runArtifactMemoryExtraction(
  repository: ArtifactRepository,
  context: Awaited<ReturnType<typeof loadArtifactIntelligenceContext>>,
  input: ArtifactIntelligenceInput,
  chunks: IntelligenceChunk[],
  timings: Record<string, number>,
) {
  console.log("artifact intelligence stage started", {
    artifactId: input.artifactId,
    stage: "memory_extraction",
  });

  const memoryExtraction = await measureStage("memoryExtractionMs", timings, () =>
    processMemoryExtractionChunks(repository, {
      artifact: context.artifact,
      memoryFragmentId: input.memoryFragmentId,
      chunks,
      title: null,
      memoryExtractor: input.memoryExtractor,
      engineeringMemoryExtractor: input.engineeringMemoryExtractor,
      canonicalMemoryMergeJudge: input.canonicalMemoryMergeJudge,
      privateFragmentStorage: input.privateFragmentStorage,
      candidateMemoryArchiveQueue: input.candidateMemoryArchiveQueue,
      concurrency: input.intelligenceChunkConcurrency ?? 2,
    }),
  );

  console.log("artifact intelligence stage completed", {
    artifactId: input.artifactId,
    stage: "memory_extraction",
    status: memoryExtraction?.status,
    durationMs: timings.memoryExtractionMs,
    llmMs: memoryExtraction?.llmMs,
    candidateMemoryEncryptMs: memoryExtraction?.candidateMemoryEncryptMs,
    candidateMemoryDbWriteMs: memoryExtraction?.candidateMemoryDbWriteMs,
    candidateMemoryArchiveQueued: memoryExtraction?.candidateMemoryArchiveQueued,
  });

  return memoryExtraction;
}

function buildArtifactIntelligenceResult(
  entityExtraction: Record<string, unknown> | null | undefined,
  memoryExtraction: Record<string, unknown> | null | undefined,
  timings: Record<string, number>,
) {
  const failed = entityExtraction?.status === "failed" || memoryExtraction?.status === "failed";

  return {
    status: failed ? "failed" : "completed",
    completedAt: new Date().toISOString(),
    ...(entityExtraction
      ? { entityExtraction: { ...entityExtraction, durationMs: timings.entityExtractionMs } }
      : {}),
    ...(memoryExtraction
      ? { memoryExtraction: { ...memoryExtraction, durationMs: timings.memoryExtractionMs } }
      : {}),
    timing: timings,
  };
}

async function finalizeArtifactIntelligence(
  repository: ArtifactRepository,
  artifactId: string,
  intelligence: Record<string, unknown>,
) {
  const latest = await repository.findArtifactById(artifactId);

  await repository.markArtifactCompleted(
    artifactId,
    withIntelligenceState(asRecord(latest?.metadata), intelligence),
  );
}

export function throwIfArtifactIntelligenceFailed(
  artifactId: string,
  intelligence: Record<string, unknown>,
) {
  if (intelligence["status"] !== "failed") {
    return;
  }

  throw new RetryableArtifactProcessingError({
    artifactId,
    reason: "artifact_intelligence_failed",
    detail: readArtifactIntelligenceFailureDetail(intelligence),
  });
}

function readArtifactIntelligenceFailureDetail(intelligence: Record<string, unknown>) {
  const entityExtraction = asRecord(intelligence["entityExtraction"]);
  const memoryExtraction = asRecord(intelligence["memoryExtraction"]);
  const reason = [
    readFailureReason(entityExtraction),
    readFailureReason(memoryExtraction),
  ].filter(Boolean).join("; ");

  return reason || "artifact intelligence processing failed";
}

function readFailureReason(result: Record<string, unknown>) {
  if (result["status"] !== "failed") {
    return null;
  }

  return [
    typeof result["reason"] === "string" ? result["reason"] : null,
    typeof result["errorMessage"] === "string" ? result["errorMessage"] : null,
  ].filter(Boolean).join(": ") || "failed";
}

async function processEntityExtraction(
  repository: ArtifactRepository,
  input: {
    artifact: QueuedArtifact;
    memoryFragmentId: string;
    content: string;
    title?: string | null;
    entityExtractor?: EntityExtractor;
  },
): Promise<Record<string, unknown> | null> {
  if (!input.entityExtractor) {
    return {
      status: "skipped",
      reason: "entity_extractor_not_configured",
    };
  }

  try {
    const llmStartedAt = Date.now();
    const result = await input.entityExtractor.extract({
      twinId: input.artifact.twinId,
      sourceArtifactId: input.artifact.id,
      memoryFragmentId: input.memoryFragmentId,
      sourceType: input.artifact.sourceType,
      content: input.content,
      title: input.title,
    });
    const llmMs = Date.now() - llmStartedAt;
    const graphStartedAt = Date.now();
    const artifactNode = await upsertArtifactGraphNode(repository, input.artifact, input.memoryFragmentId);
    const entityNodes: Array<{
      nodeId: string;
      entity: ExtractedEntity;
    }> = [];

    for (const entity of result.entities) {
      const entityNode = await repository.upsertGraphNode({
        twinId: input.artifact.twinId,
        nodeType: entity.graphNodeType,
        name: entity.name,
        normalizedName: entity.normalizedName,
        description: describeExtractedEntityNode(entity, input.artifact.sourceType),
        properties: {
          normalizedName: entity.normalizedName,
          entityType: entity.type,
          aliases: entity.aliases,
          sourceArtifactId: input.artifact.id,
          memoryFragmentId: input.memoryFragmentId,
          sourceType: input.artifact.sourceType,
          evidenceHash: entity.evidenceHash,
          evidenceLength: entity.evidenceLength,
          extractionMethod: result.metadata.extractor,
          metadata: entity.metadata,
        },
        confidenceScore: entity.confidence,
      });
      entityNodes.push({
        nodeId: entityNode.id,
        entity,
      });

      await repository.upsertGraphEdge({
        twinId: input.artifact.twinId,
        fromNodeId: artifactNode.id,
        toNodeId: entityNode.id,
        edgeType: "mentions",
        evidenceMemoryIds: [input.memoryFragmentId],
        confidenceScore: entity.confidence,
      });
    }
    const projectClustering = await clusterProjectsFromEntities(repository, {
      artifact: input.artifact,
      memoryFragmentId: input.memoryFragmentId,
      artifactNodeId: artifactNode.id,
      entityNodes,
    });
    const graphWriteMs = Date.now() - graphStartedAt;

    await repository.createAuditEvent({
      twinId: input.artifact.twinId,
      eventType: "artifact.entities_extracted",
      resourceId: input.artifact.id,
      metadata: {
        memoryFragmentId: input.memoryFragmentId,
        entityCount: result.entities.length,
        extractor: result.metadata.extractor,
        provider: result.metadata.provider,
        model: result.metadata.model,
        llmMs,
        graphWriteMs,
        projectClusterCount: projectClustering.projectClusterCount,
        projectLinkCount: projectClustering.projectLinkCount,
      },
    });

    return {
      status: "completed",
      entityCount: result.entities.length,
      extractor: result.metadata.extractor,
      provider: result.metadata.provider,
      model: result.metadata.model,
      warnings: result.metadata.warnings,
      llmMs,
      graphWriteMs,
      projectClustering,
    };
  } catch (error) {
    console.warn("artifact entity extraction failed", {
      artifactId: input.artifact.id,
      sourceType: input.artifact.sourceType,
      memoryFragmentId: input.memoryFragmentId,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: errorMessage(error),
    });

    await repository.createAuditEvent({
      twinId: input.artifact.twinId,
      eventType: "artifact.entity_extraction_failed",
      resourceId: input.artifact.id,
      metadata: {
        memoryFragmentId: input.memoryFragmentId,
        error: errorMessage(error),
      },
    });

    return {
      status: "failed",
      reason: "entity_extraction_failed",
      detail: errorMessage(error),
    };
  }
}

function describeExtractedEntityNode(entity: ExtractedEntity, sourceType: string) {
  return `${formatGraphLabel(entity.type)} detected in ${formatGraphLabel(sourceType)} memory and connected to related evidence.`;
}

function formatGraphLabel(value: string) {
  return value.replace(/[_-]+/gu, " ").replace(/\s+/gu, " ").trim();
}

async function processEntityExtractionChunks(
  repository: ArtifactRepository,
  input: {
    artifact: QueuedArtifact;
    memoryFragmentId: string;
    chunks: IntelligenceChunk[];
    title?: string | null;
    entityExtractor?: EntityExtractor;
    concurrency: number;
  },
): Promise<Record<string, unknown> | null> {
  if (input.chunks.length === 1) {
    return processEntityExtraction(repository, {
      artifact: input.artifact,
      memoryFragmentId: input.memoryFragmentId,
      content: input.chunks[0]?.content ?? "",
      title: input.title,
      entityExtractor: input.entityExtractor,
    });
  }

  const results = await mapWithConcurrency(input.chunks, input.concurrency, (chunk) =>
    processEntityExtraction(repository, {
      artifact: input.artifact,
      memoryFragmentId: input.memoryFragmentId,
      content: chunk.content,
      title: input.title,
      entityExtractor: input.entityExtractor,
    }),
  );

  return aggregateExtractionResults(results, {
    countKey: "entityCount",
    chunkCount: input.chunks.length,
  });
}

async function processMemoryExtractionChunks(
  repository: ArtifactRepository,
  input: {
    artifact: QueuedArtifact;
    memoryFragmentId: string;
    chunks: IntelligenceChunk[];
    title?: string | null;
    memoryExtractor?: MemoryExtractor;
    engineeringMemoryExtractor?: EngineeringMemoryExtractor;
    privateFragmentStorage?: PrivateFragmentStorage;
    candidateMemoryArchiveQueue?: CandidateMemoryArchiveQueue;
    canonicalMemoryMergeJudge?: CanonicalMemoryMergeJudge;
    concurrency: number;
  },
): Promise<Record<string, unknown> | null> {
  if (input.chunks.length === 1) {
    return processMemoryExtraction(repository, {
      artifact: input.artifact,
      memoryFragmentId: input.memoryFragmentId,
      content: input.chunks[0]?.content ?? "",
      title: input.title,
      memoryExtractor: input.memoryExtractor,
      engineeringMemoryExtractor: input.engineeringMemoryExtractor,
      privateFragmentStorage: input.privateFragmentStorage,
      candidateMemoryArchiveQueue: input.candidateMemoryArchiveQueue,
      canonicalMemoryMergeJudge: input.canonicalMemoryMergeJudge,
    });
  }

  const results = await mapWithConcurrency(input.chunks, input.concurrency, (chunk) =>
    processMemoryExtraction(repository, {
      artifact: input.artifact,
      memoryFragmentId: input.memoryFragmentId,
      content: chunk.content,
      title: input.title,
      memoryExtractor: input.memoryExtractor,
      engineeringMemoryExtractor: input.engineeringMemoryExtractor,
      privateFragmentStorage: input.privateFragmentStorage,
      candidateMemoryArchiveQueue: input.candidateMemoryArchiveQueue,
      canonicalMemoryMergeJudge: input.canonicalMemoryMergeJudge,
    }),
  );

  return aggregateExtractionResults(results, {
    countKey: "candidateMemoryCount",
    chunkCount: input.chunks.length,
  });
}

export async function processCandidateMemoryArchive(
  repository: ArtifactRepository,
  input: {
    archiveId?: string | null;
    artifactId: string;
    twinId: string;
    memoryFragmentId: string;
    sourceType: string;
    candidateMemoryIds: string[];
    encryptedBytesBase64: string;
    contentSha256: string;
    metadata: Record<string, unknown>;
    privateFragmentStorage?: PrivateFragmentStorage;
  },
): Promise<Record<string, unknown>> {
  if (!input.privateFragmentStorage?.storeEncryptedPrivateFragment) {
    throw new Error("encrypted_candidate_memory_archive_storage_not_configured");
  }

  await repository.markCandidateMemoryArchiveArchiving({
    archiveId: input.archiveId,
    candidateMemoryIds: input.candidateMemoryIds,
  });

  const startedAt = Date.now();
  const stored = await input.privateFragmentStorage.storeEncryptedPrivateFragment({
    twinId: input.twinId,
    sourceArtifactId: input.artifactId,
    sourceType: input.sourceType,
    encryptedBytesBase64: input.encryptedBytesBase64,
    contentSha256: input.contentSha256,
    metadata: input.metadata,
    contentKind: "candidate_memory",
  }).catch(async (error: unknown) => {
    if (!isCandidateArchiveFailureError(error)) {
      await recordRetryableCandidateArchiveFailure(repository, input, error, Date.now() - startedAt);
      throw error;
    }

    const archiveMs = Date.now() - startedAt;
    const failure = candidateArchiveFailureMetadata(input, error, archiveMs);
    await repository.markCandidateMemoriesArchiveFailed({
      archiveId: input.archiveId,
      candidateMemoryIds: input.candidateMemoryIds,
      metadata: failure.candidateMetadata,
    });

    const artifact = await repository.findArtifactById(input.artifactId);
    if (artifact) {
      await repository.markArtifactCompleted(
        input.artifactId,
        withCandidateMemoryArchiveState(asRecord(artifact.metadata), failure.processingMetadata),
      );
    }

    await repository.createAuditEvent({
      twinId: input.twinId,
      eventType: "artifact.candidate_memories_archive_failed",
      resourceId: input.artifactId,
      metadata: {
        memoryFragmentId: input.memoryFragmentId,
        candidateMemoryCount: input.candidateMemoryIds.length,
        archiveMs,
        reason: failure.processingMetadata.reason,
        errorCode: failure.processingMetadata.errorCode,
        retryable: false,
      },
    });

    return null;
  });

  if (!stored) {
    return {
      status: "failed",
      reason: "storage_wallet_insufficient_balance",
      candidateMemoryCount: input.candidateMemoryIds.length,
      retryable: false,
      archiveMs: Date.now() - startedAt,
    };
  }
  const archiveMs = Date.now() - startedAt;

  await repository.markCandidateMemoriesArchived({
    archiveId: input.archiveId,
    candidateMemoryIds: input.candidateMemoryIds,
    statementStorageRef: stored.contentStorageRef,
    statementSha256: stored.contentSha256,
    metadata: {
      archiveStatus: "completed",
      archiveCompletedAt: new Date().toISOString(),
      archiveMs,
      storage: stored.metadata,
    },
  });

  await repository.createAuditEvent({
    twinId: input.twinId,
    eventType: "artifact.candidate_memories_archived",
    resourceId: input.artifactId,
    metadata: {
      memoryFragmentId: input.memoryFragmentId,
      candidateMemoryCount: input.candidateMemoryIds.length,
      statementStorageRef: stored.contentStorageRef,
      archiveMs,
    },
  });

  return {
    status: "completed",
    archiveId: input.archiveId ?? null,
    candidateMemoryCount: input.candidateMemoryIds.length,
    archiveMs,
    statementStorageRef: stored.contentStorageRef,
  };
}

function isCandidateArchiveFailureError(error: unknown): error is WalrusStorageError {
  return error instanceof WalrusStorageError && error.code === "walrus_insufficient_balance";
}

async function recordRetryableCandidateArchiveFailure(
  repository: ArtifactRepository,
  input: {
    archiveId?: string | null;
    artifactId: string;
    twinId: string;
    memoryFragmentId: string;
    candidateMemoryIds: string[];
  },
  error: unknown,
  archiveMs: number,
) {
  const message = archiveErrorMessage(error);
  const failedAt = new Date().toISOString();
  const metadata = {
    archiveStatus: "failed",
    archiveFailedAt: failedAt,
    archiveReason: "archive_retryable_failure",
    archiveErrorCode: "archive_retryable_failure",
    archiveErrorMessage: message,
    archiveRetryable: true,
    archiveMs,
  };

  await repository.markCandidateMemoriesArchiveFailed({
    archiveId: input.archiveId,
    candidateMemoryIds: input.candidateMemoryIds,
    metadata,
  });

  await repository.createAuditEvent({
    twinId: input.twinId,
    eventType: "artifact.candidate_memories_archive_retryable_failed",
    resourceId: input.artifactId,
    metadata: {
      archiveId: input.archiveId ?? null,
      memoryFragmentId: input.memoryFragmentId,
      candidateMemoryCount: input.candidateMemoryIds.length,
      archiveMs,
      errorMessage: message,
      retryable: true,
    },
  });
}

function archiveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function candidateArchiveFailureMetadata(
  input: {
    archiveId?: string | null;
    memoryFragmentId: string;
    candidateMemoryIds: string[];
  },
  error: WalrusStorageError,
  archiveMs: number,
) {
  const failedAt = new Date().toISOString();
  const reason = "storage_wallet_insufficient_balance";
  const storageWallet = error.storageWallet
    ? {
        network: error.storageWallet.network,
        address: error.storageWallet.address,
        coinType: error.storageWallet.coinType,
        balanceSui: error.storageWallet.balanceSui,
        requiredSui: error.storageWallet.requiredSui,
        shortfallSui: error.storageWallet.shortfallSui,
      }
    : undefined;

  return {
    candidateMetadata: {
      archiveStatus: "failed",
      archiveFailedAt: failedAt,
      archiveReason: reason,
      archiveErrorCode: error.code,
      archiveErrorMessage: error.message,
      archiveRetryable: false,
      archiveMs,
      ...(storageWallet ? { storageWallet } : {}),
    },
    processingMetadata: {
      status: "failed",
      reason,
      errorCode: error.code,
      errorMessage: error.message,
      retryable: false,
      failedAt,
      archiveMs,
      archiveId: input.archiveId ?? null,
      memoryFragmentId: input.memoryFragmentId,
      candidateMemoryCount: input.candidateMemoryIds.length,
      ...(storageWallet ? { storageWallet } : {}),
    },
  };
}

export async function generateWeeklyReflection(
  repository: ArtifactRepository,
  input: {
    reflectionRunId?: string;
    twinId: string;
    periodStart: Date;
    periodEnd: Date;
    generator?: StructuredGenerator;
    privateFragmentStorage?: PrivateFragmentStorage;
  },
): Promise<Record<string, unknown>> {
  const signals = await repository.findWeeklyReflectionSignals({
    twinId: input.twinId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
  });
  const signalCount = reflectionSignalCount(signals);

  if (signalCount === 0) {
    const run = await upsertReflectionRun(repository, {
      reflectionRunId: input.reflectionRunId,
      twinId: input.twinId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: "skipped",
      metadata: {
        reason: "no_weekly_reflection_signals",
        signals,
      },
    });

    return {
      status: "skipped",
      reflectionRunId: run.id,
      reason: "no_weekly_reflection_signals",
      signalCount,
    };
  }

  if (!input.generator) {
    const run = await upsertReflectionRun(repository, {
      reflectionRunId: input.reflectionRunId,
      twinId: input.twinId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: "skipped",
      metadata: {
        reason: "reflection_generator_not_configured",
        signals,
      },
    });

    return {
      status: "skipped",
      reflectionRunId: run.id,
      reason: "reflection_generator_not_configured",
      signalCount,
    };
  }

  if (!input.privateFragmentStorage) {
    const run = await upsertReflectionRun(repository, {
      reflectionRunId: input.reflectionRunId,
      twinId: input.twinId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: "failed",
      metadata: {
        reason: "encrypted_reflection_storage_not_configured",
        signals,
      },
    });

    return {
      status: "failed",
      reflectionRunId: run.id,
      reason: "encrypted_reflection_storage_not_configured",
      signalCount,
    };
  }

  const startedAt = Date.now();
  if (input.reflectionRunId) {
    await repository.updateReflectionRun({
      id: input.reflectionRunId,
      status: "processing",
      metadata: {
        startedAt: new Date().toISOString(),
        signals,
      },
    });
  }
  const generationStartedAt = Date.now();
  const generation = await input.generator.generateJson({
    system: [
      "You generate weekly reflections for Sivraj, a private AI Twin.",
      "Use only the provided aggregate metadata and IDs.",
      "Do not invent private facts or quote memory text.",
      "Return JSON with: reflection, highlights, questions, warnings.",
    ].join(" "),
    prompt: JSON.stringify({
      twinId: input.twinId,
      periodStart: input.periodStart.toISOString(),
      periodEnd: input.periodEnd.toISOString(),
      signals,
    }),
    temperature: 0.2,
  });
  const generationMs = Date.now() - generationStartedAt;
  const reflectionText = readReflectionText(generation.json);

  if (!reflectionText) {
    const run = await upsertReflectionRun(repository, {
      reflectionRunId: input.reflectionRunId,
      twinId: input.twinId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: "failed",
      metadata: {
        reason: "reflection_generation_empty",
        provider: generation.provider,
        model: generation.model,
        generationMs,
        signals,
      },
    });

    return {
      status: "failed",
      reflectionRunId: run.id,
      reason: "reflection_generation_empty",
      signalCount,
    };
  }

  const storageStartedAt = Date.now();
  const stored = await input.privateFragmentStorage.storePrivateFragment({
    twinId: input.twinId,
    sourceArtifactId: "00000000-0000-0000-0000-000000000000",
    sourceType: "weekly_reflection",
    content: JSON.stringify({
      kind: "weekly_reflection",
      version: 1,
      periodStart: input.periodStart.toISOString(),
      periodEnd: input.periodEnd.toISOString(),
      reflection: reflectionText,
      metadata: sanitizeReflectionOutput(generation.json),
    }),
    contentKind: "reflection",
  });
  const storageMs = Date.now() - storageStartedAt;
  const totalMs = Date.now() - startedAt;
  const run = await upsertReflectionRun(repository, {
    reflectionRunId: input.reflectionRunId,
    twinId: input.twinId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    status: "completed",
    summaryStorageRef: stored.contentStorageRef,
    summarySha256: stored.contentSha256,
    metadata: {
      storageMode: "encrypted_walrus",
      sensitivity: "private",
      provider: generation.provider,
      model: generation.model,
      generationMs,
      storageMs,
      totalMs,
      signalCount,
      signals,
      output: sanitizeReflectionOutput(generation.json),
      storage: stored.metadata,
    },
  });

  await repository.createAuditEvent({
    twinId: input.twinId,
    eventType: "reflection.weekly_generated",
    resourceId: run.id,
    metadata: {
      periodStart: input.periodStart.toISOString(),
      periodEnd: input.periodEnd.toISOString(),
      provider: generation.provider,
      model: generation.model,
      generationMs,
      storageMs,
      signalCount,
      summaryStorageRef: stored.contentStorageRef,
    },
  });

  return {
    status: "completed",
    reflectionRunId: run.id,
    summaryStorageRef: stored.contentStorageRef,
    signalCount,
    generationMs,
    storageMs,
    totalMs,
  };
}

async function upsertReflectionRun(
  repository: ArtifactRepository,
  input: {
    reflectionRunId?: string;
    twinId: string;
    periodStart: Date;
    periodEnd: Date;
    status: "completed" | "failed" | "skipped";
    summaryStorageRef?: string | null;
    summarySha256?: string | null;
    metadata: Record<string, unknown>;
  },
): Promise<{ id: string }> {
  if (!input.reflectionRunId) {
    return repository.createReflectionRun(input);
  }

  await repository.updateReflectionRun({
    id: input.reflectionRunId,
    status: input.status,
    summaryStorageRef: input.summaryStorageRef ?? null,
    summarySha256: input.summarySha256 ?? null,
    metadata: input.metadata,
  });

  return { id: input.reflectionRunId };
}

export function createEntityExtractor(generator: StructuredGenerator): EntityExtractor {
  return {
    extract(input) {
      return extractEntities(input, { generator });
    },
  };
}

export function createMemoryExtractor(generator: StructuredGenerator): MemoryExtractor {
  return {
    extract(input) {
      return extractMemories(input, { generator });
    },
  };
}

export function createEngineeringMemoryExtractor(generator: StructuredGenerator): EngineeringMemoryExtractor {
  return {
    extract(input) {
      return extractEngineeringMemories(input, { generator });
    },
  };
}

const CANONICAL_MEMORY_MERGE_SYSTEM_PROMPT = [
  "You judge whether a newly extracted private memory is semantically the same as an existing canonical memory.",
  "Return only JSON.",
  "Use same only when the candidate expresses the same underlying user fact, preference, goal, decision, relationship, experience, or project update, even if wording differs.",
  "Use related when it is about the same topic but adds a distinct fact.",
  "Use conflicting when it contradicts an existing canonical memory.",
  "Use separate when it is new.",
  "Do not invent facts. Match only against the provided canonical IDs.",
].join(" ");

export function createCanonicalMemoryMergeJudge(generator: StructuredGenerator): CanonicalMemoryMergeJudge {
  return {
    async judge(input) {
      if (input.existing.length === 0) {
        return {
          decision: "separate",
          canonicalMemoryId: null,
          confidence: 1,
          reason: "No existing canonical memories to compare.",
        };
      }

      const generation = await generator.generateJson({
        system: CANONICAL_MEMORY_MERGE_SYSTEM_PROMPT,
        prompt: buildCanonicalMemoryMergePrompt(input),
        temperature: 0,
        timeoutMs: 20_000,
      });

      return parseCanonicalMemoryMergeResponse(generation.json, input.existing);
    },
  };
}

function buildCanonicalMemoryMergePrompt(input: Parameters<CanonicalMemoryMergeJudge["judge"]>[0]): string {
  return JSON.stringify({
    task: "semantic_canonical_memory_merge_judgment",
    outputSchema: {
      decision: "same | related | conflicting | separate",
      canonicalMemoryId: "existing canonical memory id or null",
      confidence: "number from 0 to 1",
      reason: "short source-grounded reason",
    },
    candidate: {
      memoryType: input.candidate.memoryType,
      statement: input.candidate.statement,
      normalizedStatement: input.candidate.normalizedStatement,
      subject: input.candidate.subject,
      metadata: redactMergeJudgeMetadata(input.candidate.metadata),
    },
    existingCanonicalMemories: input.existing.map((memory) => ({
      id: memory.id,
      memoryType: memory.memoryType,
      subject: memory.subject,
      confidenceScore: memory.confidenceScore,
      metadata: redactMergeJudgeMetadata(memory.metadata),
    })),
  });
}

function redactMergeJudgeMetadata(value: unknown): Record<string, unknown> {
  const metadata = asRecord(value);
  const memoryMetadata = asRecord(metadata.memoryMetadata);

  return {
    subject: typeof metadata.subject === "string" ? metadata.subject : null,
    sourceType: typeof metadata.sourceType === "string" ? metadata.sourceType : null,
    memoryMetadata: {
      category: typeof memoryMetadata.category === "string" ? memoryMetadata.category : null,
      importance: typeof memoryMetadata.importance === "string" ? memoryMetadata.importance : null,
    },
    consolidationMethod: typeof metadata.consolidationMethod === "string"
      ? metadata.consolidationMethod
      : null,
  };
}

function reflectionSignalCount(signals: WeeklyReflectionSignals): number {
  return signals.sourceArtifactCount +
    signals.memoryFragmentCount +
    signals.candidateMemoryCount +
    signals.graphNodeCount +
    signals.feedbackCount;
}

function readReflectionText(value: unknown): string | null {
  const record = asRecord(value);
  const reflection = record.reflection;

  return typeof reflection === "string" && reflection.trim().length > 0
    ? reflection.trim()
    : null;
}

function sanitizeReflectionOutput(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  const sanitized: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(record)) {
    if (key === "reflection") {
      continue;
    }

    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean" || item === null) {
      sanitized[key] = item;
      continue;
    }

    if (Array.isArray(item)) {
      sanitized[key] = item
        .filter((arrayItem) =>
          typeof arrayItem === "string" ||
          typeof arrayItem === "number" ||
          typeof arrayItem === "boolean" ||
          arrayItem === null,
        )
        .slice(0, 20);
    }
  }

  return sanitized;
}
