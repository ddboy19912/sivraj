import { resolveSpeakerAttribution, type SpeakerRole } from "@sivraj/intelligence";
import type { ParsedConversationMessage } from "@sivraj/ingestion";
import { ARTIFACT_PARSE_FAILED, ENCRYPTED_FRAGMENT_STORAGE_REQUIRED } from "./constants.js";
import { parseProcessableContent } from "./parse-content.js";
import { readSourceLabel } from "./source-metadata.js";
import type {
  ArtifactRepository,
  AttributedProcessableContent,
  IntelligenceProcessingQueue,
  MemoryFragmentProcessingRef,
  ParsedProcessableContent,
  PrivateFragmentStorage,
  PrivateSourcePayload,
  QueuedArtifact,
} from "../types/ingestion.types.js";
import { errorMessage } from "./errors.js";
import { withProcessingState } from "./processing-metadata.js";

export async function markPrivateFragmentStorageRequired(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  metadata: Record<string, unknown>,
  now: Date,
): Promise<void> {
  const nextMetadata = withProcessingState(metadata, {
    status: "pending",
    reason: ENCRYPTED_FRAGMENT_STORAGE_REQUIRED,
    detail: "Private artifacts require encrypted derived-fragment storage before memory fragments can be persisted.",
    processedAt: now.toISOString(),
    decryptPath: "seal_walrus",
  });

  await repository.markArtifactPending(artifact.id, nextMetadata);
  await repository.createAuditEvent({
    twinId: artifact.twinId,
    eventType: "artifact.processing_pending",
    resourceId: artifact.id,
    metadata: {
      reason: ENCRYPTED_FRAGMENT_STORAGE_REQUIRED,
      decryptPath: "seal_walrus",
      rawStorageRef: artifact.rawStorageRef,
    },
  });
}

export async function getOrCreateMemoryFragment(
  repository: ArtifactRepository,
  input: {
    twinId: string;
    sourceArtifactId: string;
    content: string;
    metadata?: Record<string, unknown>;
    importanceScore: number;
    confidenceScore: number;
    privateFragmentStorage?: PrivateFragmentStorage;
    sourceType?: string;
  },
): Promise<MemoryFragmentProcessingRef> {
  const existing = await repository.findMemoryFragmentBySourceArtifactId(input.sourceArtifactId);

  if (existing) {
    return existing;
  }

  if (!input.privateFragmentStorage) {
    throw new Error("Encrypted fragment storage is required before creating memory fragments");
  }

  const storageStartedAt = Date.now();
  const stored = await input.privateFragmentStorage.storePrivateFragment({
    twinId: input.twinId,
    sourceArtifactId: input.sourceArtifactId,
    sourceType: input.sourceType ?? "unknown",
    content: input.content,
  });
  console.log("artifact memory fragment storage completed", {
    artifactId: input.sourceArtifactId,
    twinId: input.twinId,
    sourceType: input.sourceType ?? "unknown",
    contentChars: input.content.length,
    contentStorageRef: stored.contentStorageRef,
    durationMs: Date.now() - storageStartedAt,
  });

  const dbStartedAt = Date.now();
  const fragment = await repository.createMemoryFragment({
    twinId: input.twinId,
    sourceArtifactId: input.sourceArtifactId,
    contentStorageRef: stored.contentStorageRef,
    contentSha256: stored.contentSha256,
    metadata: {
      ...stored.metadata,
      ...input.metadata,
    },
    importanceScore: input.importanceScore,
    confidenceScore: input.confidenceScore,
  });
  console.log("artifact memory fragment db write completed", {
    artifactId: input.sourceArtifactId,
    memoryFragmentId: fragment.id,
    durationMs: Date.now() - dbStartedAt,
  });

  return {
    id: fragment.id,
    transientCiphertextBase64: stored.encryptedBytesBase64,
    transientCiphertextSha256: stored.contentSha256,
  };
}

export async function queueIntelligenceProcessing(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  fragment: MemoryFragmentProcessingRef,
  intelligenceQueue?: IntelligenceProcessingQueue,
): Promise<Record<string, unknown>> {
  if (!intelligenceQueue) {
    return {
      intelligence: {
        status: "skipped",
        reason: "intelligence_queue_not_configured",
      },
    };
  }

  const job = await intelligenceQueue.enqueueIntelligenceProcessing({
    artifactId: artifact.id,
    twinId: artifact.twinId,
    memoryFragmentId: fragment.id,
    sourceType: artifact.sourceType,
    ...(fragment.transientCiphertextBase64
      ? {
          transientFragmentCiphertextBase64: fragment.transientCiphertextBase64,
          transientFragmentCiphertextSha256: fragment.transientCiphertextSha256,
        }
      : {}),
  });

  await repository.createAuditEvent({
    twinId: artifact.twinId,
    eventType: "artifact.intelligence_queued",
    resourceId: artifact.id,
    metadata: {
      memoryFragmentId: fragment.id,
      intelligenceJobId: job.jobId,
      transientCiphertextHandoff: Boolean(fragment.transientCiphertextBase64),
    },
  });

  return {
    intelligence: {
      status: "queued",
      memoryFragmentId: fragment.id,
      jobId: job.jobId,
      transientCiphertextHandoff: Boolean(fragment.transientCiphertextBase64),
      queuedAt: new Date().toISOString(),
    },
  };
}

function renderAttributedConversationMessage(
  message: ParsedConversationMessage,
  role: SpeakerRole,
): string {
  const speaker = `${role}/${message.speaker}`;

  return message.timestamp
    ? `[${message.timestamp}] ${speaker}: ${message.text}`
    : `${speaker}: ${message.text}`;
}

async function applySpeakerAttribution(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  parsed: ParsedProcessableContent,
): Promise<AttributedProcessableContent> {
  const messages = parsed.conversation?.messages ?? [];

  if (messages.length === 0) {
    return parsed;
  }

  const [profile, mappings] = await Promise.all([
    repository.findTwinIdentityProfile(artifact.twinId),
    repository.findSourceSpeakerMappings(artifact.twinId, artifact.id),
  ]);
  const fallbackProfile = profile ?? {};
  const counts: Record<SpeakerRole, number> = {
    self: 0,
    other: 0,
    system: 0,
    unknown: 0,
  };
  const unknownSpeakers = new Set<string>();
  let mappedSpeakers = 0;
  const attributedLines = messages.map((message) => {
    const attribution = resolveSpeakerAttribution({
      label: message.speaker,
      sourceSpeakerId: message.sourceSpeakerId,
      profile: fallbackProfile,
      mappings,
    });

    counts[attribution.role] += 1;

    if (attribution.method === "source_mapping") {
      mappedSpeakers += 1;
    }

    if (attribution.role === "unknown") {
      unknownSpeakers.add(message.speaker);
    }

    return renderAttributedConversationMessage(message, attribution.role);
  });
  const speakers = Array.from(new Set(messages.map((message) => message.speaker).filter(Boolean)));
  const warnings = [
    ...(parsed.parser?.warnings ?? []),
    ...(unknownSpeakers.size > 0 ? ["conversation_speakers_unmapped"] : []),
  ];
  const parser = parsed.parser
    ? {
        ...parsed.parser,
        warnings,
        speakers,
      }
    : parsed.parser;

  return {
    ...parsed,
    content: attributedLines.join("\n").trim(),
    parser,
    attribution: {
      messageCount: messages.length,
      speakers,
      counts,
      unknownSpeakers: Array.from(unknownSpeakers),
      mappedSpeakers,
    },
  };
}

async function markArtifactParseFailed(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  metadata: Record<string, unknown>,
  now: Date,
  error: unknown,
): Promise<void> {
  const nextMetadata = withProcessingState(metadata, {
    status: "failed",
    reason: ARTIFACT_PARSE_FAILED,
    detail: `${readSourceLabel(artifact.sourceType)} parser failed: ${errorMessage(error)}`,
    processedAt: now.toISOString(),
  });

  await repository.markArtifactFailed(artifact.id, nextMetadata);
  await repository.createAuditEvent({
    twinId: artifact.twinId,
    eventType: "artifact.processing_failed",
    resourceId: artifact.id,
    metadata: {
      reason: ARTIFACT_PARSE_FAILED,
      sourceType: artifact.sourceType,
      error: errorMessage(error),
    },
  });
}

export async function parseAttributedProcessableContent(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  contentInput: PrivateSourcePayload,
  metadata: Record<string, unknown>,
  now: Date,
): Promise<AttributedProcessableContent | null> {
  const parsed = await parseProcessableContent(artifact, contentInput).catch(async (error: unknown) => {
    await markArtifactParseFailed(repository, artifact, metadata, now, error);
    return null;
  });

  if (parsed === null) {
    return null;
  }

  return applySpeakerAttribution(repository, artifact, parsed);
}

export async function markEmptyParsedArtifactFailure(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  metadata: Record<string, unknown>,
  now: Date,
  attributed: AttributedProcessableContent,
  params: {
    reason: string;
    detail: string;
    includeRawStorageRef?: boolean;
  },
): Promise<"failed"> {
  const nextMetadata = withProcessingState(metadata, {
    status: "failed",
    reason: params.reason,
    detail: params.detail,
    processedAt: now.toISOString(),
    ...(attributed.parser ? { parser: attributed.parser } : {}),
  });

  await repository.markArtifactFailed(artifact.id, nextMetadata);
  await repository.createAuditEvent({
    twinId: artifact.twinId,
    eventType: "artifact.processing_failed",
    resourceId: artifact.id,
    metadata: {
      reason: params.reason,
      ...(params.includeRawStorageRef ? { rawStorageRef: artifact.rawStorageRef } : {}),
      ...(attributed.parser ? { parser: attributed.parser } : {}),
    },
  });

  return "failed";
}

export async function finalizeParsedArtifactCompletion(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  metadata: Record<string, unknown>,
  now: Date,
  options: {
    privateFragmentStorage?: PrivateFragmentStorage;
    intelligenceQueue?: IntelligenceProcessingQueue;
  },
  attributed: AttributedProcessableContent,
  params: {
    confidenceScore: number;
    requirePrivateFragmentStorage?: boolean;
    processingStateExtras?: Record<string, unknown>;
    auditMetadataExtras?: Record<string, unknown>;
  },
): Promise<"completed" | "pending"> {
  if (params.requirePrivateFragmentStorage && !options.privateFragmentStorage) {
    await markPrivateFragmentStorageRequired(repository, artifact, metadata, now);
    return "pending";
  }

  const fragment = await getOrCreateMemoryFragment(repository, {
    twinId: artifact.twinId,
    sourceArtifactId: artifact.id,
    content: attributed.content,
    privateFragmentStorage: options.privateFragmentStorage,
    sourceType: artifact.sourceType,
    metadata: attributed.attribution ? { conversation: attributed.attribution } : undefined,
    importanceScore: 0.5,
    confidenceScore: params.confidenceScore,
  });
  const intelligence = await queueIntelligenceProcessing(repository, artifact, fragment, options.intelligenceQueue);
  const attributedExtras = {
    ...(attributed.parser ? { parser: attributed.parser } : {}),
    ...(attributed.attribution ? { conversation: attributed.attribution } : {}),
  };
  const nextMetadata = withProcessingState(metadata, {
    status: "completed",
    memoryFragmentId: fragment.id,
    processedAt: now.toISOString(),
    ...intelligence,
    ...attributedExtras,
    ...params.processingStateExtras,
  });

  await repository.markArtifactCompleted(artifact.id, nextMetadata);
  await repository.createAuditEvent({
    twinId: artifact.twinId,
    eventType: "artifact.processed",
    resourceId: artifact.id,
    metadata: {
      memoryFragmentId: fragment.id,
      ...attributedExtras,
      ...params.auditMetadataExtras,
    },
  });

  return "completed";
}
