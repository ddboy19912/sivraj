import { resolveSpeakerAttribution, type SpeakerRole } from "@sivraj/intelligence";
import type { ParsedConversationMessage, ParserMetadata } from "@sivraj/ingestion";
import { ARTIFACT_PARSE_FAILED, ENCRYPTED_FRAGMENT_STORAGE_REQUIRED } from "./constants.js";
import { parseProcessableContent } from "./parse-content.js";
import { readSourceLabel } from "./source-metadata.js";
import { extractDocumentStructure } from "./document-structure.js";
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

const CHAT_MEMORY_CONTEXT_CHAR_LIMIT = 900;
const DOCUMENT_CHUNK_CHARS = 1_800;
const DOCUMENT_CHUNK_OVERLAP_CHARS = 220;
const DOCUMENT_EMBEDDING_BATCH_SIZE = 32;
const DOCUMENT_SOURCE_TYPES = new Set(["pdf", "ocr_pdf", "docx", "markdown", "upload"]);
const DOCUMENT_EMBEDDING_REQUIRED_REASON = "document_embedding_required";
const DOCUMENT_EMBEDDING_FAILED_REASON = "document_embedding_failed";

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
    sourceRepresentedContent?: string;
    metadata?: Record<string, unknown>;
    importanceScore: number;
    confidenceScore: number;
    privateFragmentStorage?: PrivateFragmentStorage;
    sourceType?: string;
  },
): Promise<MemoryFragmentProcessingRef> {
  const existing = await repository.findMemoryFragmentBySourceArtifactId(input.sourceArtifactId);

  if (existing) {
    return {
      id: existing.id,
      contentStorageRef: existing.contentStorageRef,
      contentSha256: existing.contentSha256,
      metadata: readRecord(existing.metadata),
    };
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
      tokenAccounting: buildMemoryFragmentTokenAccounting({
        memoryContent: input.content,
        sourceRepresentedContent: input.sourceRepresentedContent ?? input.content,
      }),
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
    contentStorageRef: stored.contentStorageRef,
    contentSha256: stored.contentSha256,
    metadata: stored.metadata,
    transientCiphertextBase64: stored.encryptedBytesBase64,
    transientCiphertextSha256: stored.contentSha256,
  };
}

async function indexDocumentChunks(input: {
  repository: ArtifactRepository;
  artifact: QueuedArtifact;
  metadata: Record<string, unknown>;
  fragment: MemoryFragmentProcessingRef;
  content: string;
  parser?: ParserMetadata;
  textEmbedder?: NonNullable<import("../types/ingestion.types.js").ArtifactProcessingRuntimeOptions["textEmbedder"]>;
  publishArtifactStatus?: import("../types/ingestion.types.js").ArtifactProcessingRuntimeOptions["publishArtifactStatus"];
}): Promise<Record<string, unknown>> {
  if (!DOCUMENT_SOURCE_TYPES.has(input.artifact.sourceType)) {
    return {};
  }

  if (!input.fragment.contentStorageRef || !input.fragment.contentSha256) {
    return {
      documentIndex: {
        status: "skipped",
        reason: "memory_fragment_storage_ref_missing",
      },
    };
  }

  const chunks = splitDocumentIntoIndexedChunks(
    input.content,
    DOCUMENT_CHUNK_CHARS,
    DOCUMENT_CHUNK_OVERLAP_CHARS,
  );
  const pages = readParsedDocumentPages(input.parser);
  const pageResult = pages.length > 0
    ? await input.repository.replaceDocumentPages({
        twinId: input.artifact.twinId,
        sourceArtifactId: input.artifact.id,
        memoryFragmentId: input.fragment.id,
        pages: pages.map((page) => ({
          pageNumber: page.pageNumber,
          contentStorageRef: input.fragment.contentStorageRef!,
          contentSha256: input.fragment.contentSha256!,
          tokenCount: estimateTextTokens(input.content.slice(page.charStart, page.charEnd)),
          charStart: page.charStart,
          charEnd: page.charEnd,
          metadata: {
            ...readRecord(input.fragment.metadata),
            storageMode: "shared_memory_fragment_ref",
            contentKind: "document_page",
            sourceType: input.artifact.sourceType,
            memoryFragmentId: input.fragment.id,
            pageNumber: page.pageNumber,
          },
        })),
      })
    : { count: 0 };

  await markDocumentIndexingProgress(input.repository, input.artifact, input.metadata, input.publishArtifactStatus, {
    status: "processing",
    phase: "embedding_chunks",
    chunkCount: chunks.length,
    embeddedChunks: 0,
  });

  const embeddingResult = await embedDocumentChunks({
    artifactId: input.artifact.id,
    textEmbedder: input.textEmbedder,
    chunks,
    onProgress: async (progress) => {
      await markDocumentIndexingProgress(input.repository, input.artifact, input.metadata, input.publishArtifactStatus, {
        status: "processing",
        phase: "embedding_chunks",
        chunkCount: chunks.length,
        embeddedChunks: progress.embeddedChunks,
        provider: progress.provider,
        model: progress.model,
      });
    },
  });
  const result = await input.repository.replaceDocumentChunks({
    twinId: input.artifact.twinId,
    sourceArtifactId: input.artifact.id,
    memoryFragmentId: input.fragment.id,
    chunks: chunks.map((chunk, index) => ({
      chunkIndex: chunk.index,
      contentStorageRef: input.fragment.contentStorageRef!,
      contentSha256: input.fragment.contentSha256!,
      tokenCount: estimateTextTokens(chunk.content),
      charStart: chunk.startOffset,
      charEnd: chunk.endOffset,
      ...pageRangeForOffsets(chunk, pages),
      embedding: embeddingResult.embeddings[index] ?? null,
      embeddingModel: embeddingResult.model,
      embeddingProvider: embeddingResult.provider,
      embeddingGeneratedAt: embeddingResult.generatedAt,
      metadata: {
        storageMode: "shared_memory_fragment_ref",
        contentKind: "document_chunk",
        sourceType: input.artifact.sourceType,
        memoryFragmentId: input.fragment.id,
        chunkIndex: chunk.index,
        ...pageRangeForOffsets(chunk, pages),
        embedding: embeddingResult.metadata,
      },
    })),
  });

  return {
    documentIndex: {
      status: "completed",
      chunkCount: result.count,
      pageCount: pageResult.count,
      embedding: embeddingResult.metadata,
      chunkChars: DOCUMENT_CHUNK_CHARS,
      overlapChars: DOCUMENT_CHUNK_OVERLAP_CHARS,
    },
  };
}

type ParsedDocumentPageRange = {
  pageNumber: number;
  charStart: number;
  charEnd: number;
};

function readParsedDocumentPages(parser: ParserMetadata | undefined): ParsedDocumentPageRange[] {
  const pages = parser?.document?.pages ?? [];

  return pages
    .map((page) => ({
      pageNumber: page.pageNumber,
      charStart: page.charStart,
      charEnd: page.charEnd,
    }))
    .filter((page) =>
      Number.isInteger(page.pageNumber) &&
      page.pageNumber > 0 &&
      Number.isInteger(page.charStart) &&
      Number.isInteger(page.charEnd) &&
      page.charStart >= 0 &&
      page.charEnd > page.charStart
    )
    .sort((a, b) => a.pageNumber - b.pageNumber);
}

function pageRangeForOffsets(
  chunk: { startOffset: number; endOffset: number },
  pages: ParsedDocumentPageRange[],
): { pageStart: number | null; pageEnd: number | null } {
  if (pages.length === 0) {
    return { pageStart: null, pageEnd: null };
  }

  const overlappingPages = pages.filter((page) =>
    page.charEnd > chunk.startOffset && page.charStart < chunk.endOffset
  );

  if (overlappingPages.length === 0) {
    return { pageStart: null, pageEnd: null };
  }

  return {
    pageStart: overlappingPages[0]?.pageNumber ?? null,
    pageEnd: overlappingPages[overlappingPages.length - 1]?.pageNumber ?? null,
  };
}

async function markDocumentIndexingProgress(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  metadata: Record<string, unknown>,
  publishArtifactStatus: import("../types/ingestion.types.js").ArtifactProcessingRuntimeOptions["publishArtifactStatus"],
  documentIndex: {
    status: "processing";
    phase: "embedding_chunks";
    chunkCount: number;
    embeddedChunks: number;
    provider?: string | null;
    model?: string | null;
  },
) {
  const processing = {
    status: "processing",
    reason: "document_indexing",
    phase: "indexing_document",
    documentIndex,
    processedAt: new Date().toISOString(),
  };

  await repository.markArtifactProcessing(artifact.id, withProcessingState(metadata, processing));
  await publishArtifactStatus?.({
    artifactId: artifact.id,
    twinId: artifact.twinId,
    sourceType: artifact.sourceType,
    status: "processing",
    reason: "document_indexing",
    processing,
    occurredAt: new Date().toISOString(),
  });
}

async function embedDocumentChunks(input: {
  artifactId: string;
  textEmbedder?: NonNullable<import("../types/ingestion.types.js").ArtifactProcessingRuntimeOptions["textEmbedder"]>;
  chunks: Array<{ content: string }>;
  onProgress?: (progress: {
    embeddedChunks: number;
    provider: string | null;
    model: string | null;
  }) => Promise<void>;
}): Promise<{
  embeddings: number[][];
  provider: string;
  model: string;
  generatedAt: Date;
  metadata: Record<string, unknown>;
}> {
  if (!input.textEmbedder) {
    throw new Error(`${DOCUMENT_EMBEDDING_REQUIRED_REASON}:text_embedder_not_configured`);
  }

  const embeddings: number[][] = [];
  let provider: string | null = null;
  let model: string | null = null;
  const generatedAt = new Date();

  for (let start = 0; start < input.chunks.length; start += DOCUMENT_EMBEDDING_BATCH_SIZE) {
    const batch = input.chunks.slice(start, start + DOCUMENT_EMBEDDING_BATCH_SIZE);
    const output = await input.textEmbedder.embedTexts({
      texts: batch.map((chunk) => chunk.content),
    }).catch((error: unknown) => {
      throw new Error(`${DOCUMENT_EMBEDDING_FAILED_REASON}:${errorMessage(error)}`);
    });

    provider = output.provider;
    model = output.model;
    embeddings.push(...output.embeddings);
    console.log("document chunk embedding batch completed", {
      artifactId: input.artifactId,
      provider,
      model,
      embeddedChunks: embeddings.length,
      totalChunks: input.chunks.length,
      batchSize: batch.length,
    });
    await input.onProgress?.({
      embeddedChunks: embeddings.length,
      provider,
      model,
    });
  }

  if (!provider || !model || embeddings.length !== input.chunks.length) {
    throw new Error(
      `${DOCUMENT_EMBEDDING_FAILED_REASON}:expected_${input.chunks.length}_embeddings_got_${embeddings.length}`,
    );
  }

  return {
    embeddings,
    provider,
    model,
    generatedAt,
    metadata: {
      status: "completed",
      provider,
      model,
      chunkCount: input.chunks.length,
      generatedAt: generatedAt.toISOString(),
    },
  };
}

function splitDocumentIntoIndexedChunks(
  content: string,
  chunkChars: number,
  overlapChars: number,
): Array<{ index: number; startOffset: number; endOffset: number; content: string }> {
  const normalized = content;
  const chunks: Array<{ index: number; startOffset: number; endOffset: number; content: string }> = [];
  let start = 0;

  while (start < normalized.length) {
    const targetEnd = Math.min(start + chunkChars, normalized.length);
    const end = chooseDocumentChunkEnd(normalized, start, targetEnd);
    const chunk = normalized.slice(start, end).trim();

    if (chunk) {
      chunks.push({
        index: chunks.length,
        startOffset: start,
        endOffset: end,
        content: chunk,
      });
    }

    if (end >= normalized.length) {
      break;
    }

    start = Math.max(end - overlapChars, start + 1);
  }

  return chunks;
}

function chooseDocumentChunkEnd(content: string, start: number, targetEnd: number): number {
  if (targetEnd >= content.length) {
    return content.length;
  }

  const window = content.slice(start, targetEnd);
  const paragraphBreak = window.lastIndexOf("\n\n");
  if (paragraphBreak > Math.floor(window.length * 0.55)) {
    return start + paragraphBreak;
  }

  const sentenceBreak = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("? "),
    window.lastIndexOf("! "),
  );
  if (sentenceBreak > Math.floor(window.length * 0.55)) {
    return start + sentenceBreak + 1;
  }

  return targetEnd;
}

function buildMemoryFragmentTokenAccounting(input: {
  memoryContent: string;
  sourceRepresentedContent: string;
}) {
  const memoryContextTokens = estimateTextTokens(
    truncate(input.memoryContent, CHAT_MEMORY_CONTEXT_CHAR_LIMIT),
  );
  const sourceTokensRepresented = estimateTextTokens(input.sourceRepresentedContent);

  return {
    method: "source_vs_memory_estimate",
    sourceTokensRepresented,
    memoryContextTokens,
    estimatedTokensSaved: Math.max(sourceTokensRepresented - memoryContextTokens, 0),
  };
}

function estimateTextTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
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
    textEmbedder?: import("../types/ingestion.types.js").ArtifactProcessingRuntimeOptions["textEmbedder"];
    structuredGenerator?: import("../types/ingestion.types.js").ArtifactProcessingRuntimeOptions["structuredGenerator"];
    intelligenceQueue?: IntelligenceProcessingQueue;
    publishArtifactStatus?: import("../types/ingestion.types.js").ArtifactProcessingRuntimeOptions["publishArtifactStatus"];
  },
  attributed: AttributedProcessableContent,
  params: {
    confidenceScore: number;
    sourceRepresentedContent?: string;
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
    sourceRepresentedContent: params.sourceRepresentedContent,
    privateFragmentStorage: options.privateFragmentStorage,
    sourceType: artifact.sourceType,
    metadata: attributed.attribution ? { conversation: attributed.attribution } : undefined,
    importanceScore: 0.5,
    confidenceScore: params.confidenceScore,
  });
  const documentIndex = await indexDocumentChunks({
    repository,
    artifact,
    metadata,
    fragment,
    content: attributed.content,
    parser: attributed.parser,
    textEmbedder: options.textEmbedder,
    publishArtifactStatus: options.publishArtifactStatus,
  });
  const documentStructure = await extractDocumentStructure({
    content: attributed.content,
    parser: attributed.parser,
    title: attributed.parser?.document?.title,
    generator: options.structuredGenerator,
  }).catch((error: unknown) => {
    console.warn("document structure extraction failed", {
      artifactId: artifact.id,
      error: errorMessage(error),
    });
    return [];
  });
  const documentStructureIndex = await repository.replaceDocumentStructureItems({
    twinId: artifact.twinId,
    sourceArtifactId: artifact.id,
    memoryFragmentId: fragment.id,
    items: documentStructure,
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
    ...documentIndex,
    documentStructure: {
      status: options.structuredGenerator ? "completed" : "skipped",
      itemCount: documentStructureIndex.count,
      extractor: options.structuredGenerator ? "llm_document_structure" : "not_configured",
    },
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
      ...documentIndex,
      documentStructureItemCount: documentStructureIndex.count,
      ...attributedExtras,
      ...params.auditMetadataExtras,
    },
  });

  return "completed";
}
