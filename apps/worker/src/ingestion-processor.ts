import {
  detectPatterns,
  extractEntities,
  extractMemories,
  resolveSpeakerAttribution,
  type DetectedPattern,
  type EntityExtractionResult,
  type ExtractedEntity,
  type ExtractedMemory,
  type MemoryExtractionResult,
  type PatternSignal,
  type SourceSpeakerMapping,
  type SpeakerRole,
  type TwinIdentityProfile,
} from "@sivraj/intelligence";
import { createHash } from "node:crypto";
import {
  parseBrowserHistory,
  parseChatExport,
  parseCsv,
  parseDocx,
  parseEmail,
  parseGitHubImport,
  parseImage,
  parseMarkdown,
  parseOcrScannedPdf,
  parsePlainText,
  parseSlackExport,
  parseWhatsAppExport,
  type ParsedConversationMessage,
  type ParserMetadata,
} from "@sivraj/ingestion";
import type { SpeechToTextTranscriber, StructuredGenerator } from "@sivraj/llm";

export type IngestionStatus = "pending" | "queued" | "processing" | "completed" | "failed" | "cancelled";

export type QueuedArtifact = {
  id: string;
  twinId: string;
  sourceType: string;
  rawStorageRef: string | null;
  metadata: unknown;
};

export type ArtifactRepository = {
  findArtifactById(id: string): Promise<QueuedArtifact | null>;
  findQueuedArtifacts(limit: number): Promise<QueuedArtifact[]>;
  claimArtifact(id: string): Promise<QueuedArtifact | null>;
  claimRecoverableArtifact(id: string): Promise<QueuedArtifact | null>;
  markArtifactPending(id: string, metadata: Record<string, unknown>): Promise<void>;
  markArtifactCompleted(id: string, metadata: Record<string, unknown>): Promise<void>;
  markArtifactFailed(id: string, metadata: Record<string, unknown>): Promise<void>;
  findMemoryFragmentBySourceArtifactId(sourceArtifactId: string): Promise<{ id: string } | null>;
  findMemoryFragmentById(id: string): Promise<{
    id: string;
    twinId: string;
    sourceArtifactId: string;
    contentStorageRef: string | null;
    contentSha256: string | null;
  } | null>;
  findTwinIdentityProfile(twinId: string): Promise<TwinIdentityProfile | null>;
  findSourceSpeakerMappings(twinId: string, sourceArtifactId: string): Promise<SourceSpeakerMapping[]>;
  findRecentPatternSignals(twinId: string, limit: number): Promise<PatternSignal[]>;
  createMemoryFragment(input: {
    twinId: string;
    sourceArtifactId: string;
    contentStorageRef: string;
    contentSha256?: string | null;
    metadata?: Record<string, unknown> | null;
    importanceScore: number;
    confidenceScore: number;
  }): Promise<{ id: string }>;
  upsertGraphNode(input: {
    twinId: string;
    nodeType: ExtractedEntity["graphNodeType"];
    name: string;
    normalizedName?: string | null;
    description?: string | null;
    properties: Record<string, unknown>;
    confidenceScore: number;
  }): Promise<{ id: string }>;
  upsertGraphEdge(input: {
    twinId: string;
    fromNodeId: string;
    toNodeId: string;
    edgeType: string;
    description?: string | null;
    evidenceMemoryIds: string[];
    confidenceScore: number;
  }): Promise<{ id: string }>;
  createCandidateMemory(input: {
    twinId: string;
    sourceArtifactId: string;
    memoryFragmentId: string;
    memoryType: ExtractedMemory["memoryType"];
    statementStorageRef: string;
    statementSha256: string;
    evidenceHash: string;
    evidenceLength: number;
    confidenceScore: number;
    metadata: Record<string, unknown>;
  }): Promise<{ id: string }>;
  markCandidateMemoriesArchived(input: {
    candidateMemoryIds: string[];
    statementStorageRef: string;
    statementSha256: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  findWeeklyReflectionSignals(input: {
    twinId: string;
    periodStart: Date;
    periodEnd: Date;
  }): Promise<WeeklyReflectionSignals>;
  createReflectionRun(input: {
    twinId: string;
    periodStart: Date;
    periodEnd: Date;
    status: "completed" | "failed" | "skipped";
    summaryStorageRef?: string | null;
    summarySha256?: string | null;
    metadata: Record<string, unknown>;
  }): Promise<{ id: string }>;
  updateReflectionRun(input: {
    id: string;
    status: "processing" | "completed" | "failed" | "skipped";
    summaryStorageRef?: string | null;
    summarySha256?: string | null;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  createAuditEvent(input: {
    twinId: string;
    eventType: string;
    resourceId: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
};

export type EntityExtractor = {
  extract(input: {
    twinId: string;
    sourceArtifactId: string;
    memoryFragmentId: string;
    sourceType: string;
    content: string;
    title?: string | null;
  }): Promise<EntityExtractionResult>;
};

export type MemoryExtractor = {
  extract(input: {
    twinId: string;
    sourceArtifactId: string;
    memoryFragmentId: string;
    sourceType: string;
    content: string;
    title?: string | null;
  }): Promise<MemoryExtractionResult>;
};

export type WeeklyReflectionSignals = {
  sourceArtifactCount: number;
  memoryFragmentCount: number;
  candidateMemoryCount: number;
  approvedCandidateMemoryCount: number;
  rejectedCandidateMemoryCount: number;
  graphNodeCount: number;
  projectCount: number;
  goalCount: number;
  decisionCount: number;
  patternCount: number;
  feedbackCount: number;
  usefulFeedbackCount: number;
  negativeFeedbackCount: number;
  candidateSubjects: Array<{
    subject: string;
    memoryType: ExtractedMemory["memoryType"];
    count: number;
  }>;
  graphSubjects: Array<{
    name: string;
    nodeType: ExtractedEntity["graphNodeType"];
  }>;
  feedbackBreakdown: Record<string, number>;
  sourceArtifactIds: string[];
  memoryFragmentIds: string[];
  candidateMemoryIds: string[];
  graphNodeIds: string[];
};

export type PrivateMemoryReader = {
  readPrivateMemory(input: {
    rawStorageRef: string;
    artifactId: string;
    twinId: string;
    expectedCiphertextSha256?: string | null;
  }): Promise<string>;
  readPrivateMemoryFromEncryptedBytes?(input: {
    encryptedBytesBase64: string;
    artifactId: string;
    twinId: string;
    expectedCiphertextSha256?: string | null;
    source: "artifact_queue" | "intelligence_queue";
  }): Promise<string>;
};

export type PrivateFragmentStorage = {
  storePrivateFragment(input: {
    twinId: string;
    sourceArtifactId: string;
    sourceType: string;
    content: string;
    contentKind?: "memory_fragment" | "candidate_memory" | "reflection";
  }): Promise<{
    contentStorageRef: string;
    contentSha256: string;
    encryptedBytesBase64?: string;
    metadata: Record<string, unknown>;
  }>;
  encryptPrivateFragment?(input: {
    twinId: string;
    sourceArtifactId: string;
    sourceType: string;
    content: string;
    contentKind?: "memory_fragment" | "candidate_memory" | "reflection";
  }): Promise<{
    encryptedBytesBase64: string;
    contentSha256: string;
    metadata: Record<string, unknown>;
  }>;
  storeEncryptedPrivateFragment?(input: {
    twinId: string;
    sourceArtifactId: string;
    sourceType: string;
    encryptedBytesBase64: string;
    contentSha256: string;
    metadata: Record<string, unknown>;
    contentKind?: "memory_fragment" | "candidate_memory" | "reflection";
  }): Promise<{
    contentStorageRef: string;
    contentSha256: string;
    encryptedBytesBase64?: string;
    metadata: Record<string, unknown>;
  }>;
};

export type IntelligenceProcessingQueue = {
  enqueueIntelligenceProcessing(data: {
    artifactId: string;
    twinId: string;
    memoryFragmentId: string;
    sourceType: string;
    transientFragmentCiphertextBase64?: string;
    transientFragmentCiphertextSha256?: string;
  }): Promise<{ jobId: string }>;
};

export type CandidateMemoryArchiveQueue = {
  enqueueCandidateMemoryArchive(data: {
    artifactId: string;
    twinId: string;
    memoryFragmentId: string;
    sourceType: string;
    candidateMemoryIds: string[];
    encryptedBytesBase64: string;
    contentSha256: string;
    metadata: Record<string, unknown>;
  }): Promise<{ jobId: string }>;
};

type PrivateSourcePayload = {
  content: string;
  title: string | null;
  metadata: Record<string, unknown>;
};

type MemoryFragmentProcessingRef = {
  id: string;
  transientCiphertextBase64?: string;
  transientCiphertextSha256?: string;
};

type ParsedProcessableContent = {
  content: string;
  parser?: ParserMetadata;
  conversation?: {
    messages: ParsedConversationMessage[];
  };
};

type AttributionMetadata = {
  messageCount: number;
  speakers: string[];
  counts: Record<SpeakerRole, number>;
  unknownSpeakers: string[];
  mappedSpeakers: number;
};

type ProjectClusterCandidate = {
  name: string;
  normalizedName: string;
  confidence: number;
  signals: string[];
  source: "entity" | "candidate_memory";
};

type DecisionGraphCandidate = {
  memory: ExtractedMemory;
  candidateMemoryId: string;
  statementIndex: number;
};

type GoalGraphCandidate = {
  memory: ExtractedMemory;
  candidateMemoryId: string;
  statementIndex: number;
};

export type ProcessQueuedArtifactsResult = {
  scanned: number;
  completed: number;
  pending: number;
  failed: number;
};

export type ProcessArtifactResult = "completed" | "pending" | "failed" | "skipped";

export const ENCRYPTED_DECRYPTION_REQUIRED = "encrypted_decryption_required";
export const MISSING_PROCESSABLE_CONTENT = "missing_processable_content";
export const ENCRYPTED_DECRYPTION_FAILED = "encrypted_decryption_failed";
export const ENCRYPTED_DECRYPTION_RETRYING = "encrypted_decryption_retrying";
export const ENCRYPTED_FRAGMENT_STORAGE_REQUIRED = "encrypted_fragment_storage_required";
export const SPEECH_TO_TEXT_REQUIRED = "speech_to_text_required";
export const SPEECH_TO_TEXT_FAILED = "speech_to_text_failed";
export const SPEECH_TO_TEXT_EMPTY = "speech_to_text_empty";
export const PARSED_MARKDOWN_EMPTY = "parsed_markdown_empty";
export const PARSED_PLAIN_TEXT_EMPTY = "parsed_plain_text_empty";
export const PARSED_DOCX_EMPTY = "parsed_docx_empty";
export const PARSED_CSV_EMPTY = "parsed_csv_empty";
export const PARSED_EMAIL_EMPTY = "parsed_email_empty";
export const PARSED_OCR_PDF_EMPTY = "parsed_ocr_pdf_empty";
export const PARSED_IMAGE_EMPTY = "parsed_image_empty";
export const PARSED_GITHUB_EMPTY = "parsed_github_empty";
export const PARSED_BROWSER_HISTORY_EMPTY = "parsed_browser_history_empty";
export const PARSED_CHAT_EXPORT_EMPTY = "parsed_chat_export_empty";
export const PARSED_SLACK_EXPORT_EMPTY = "parsed_slack_export_empty";
export const PARSED_WHATSAPP_EXPORT_EMPTY = "parsed_whatsapp_export_empty";
export const ARTIFACT_PARSE_FAILED = "artifact_parse_failed";

export class RetryableArtifactProcessingError extends Error {
  readonly artifactId: string;
  readonly reason: string;
  readonly detail: string;

  constructor(params: {
    artifactId: string;
    reason: string;
    detail: string;
  }) {
    super(params.detail);
    this.name = "RetryableArtifactProcessingError";
    this.artifactId = params.artifactId;
    this.reason = params.reason;
    this.detail = params.detail;
  }
}

export async function processArtifact(
  repository: ArtifactRepository,
  artifactId: string,
  options: {
    now?: Date;
    privateMemoryReader?: PrivateMemoryReader;
    privateFragmentStorage?: PrivateFragmentStorage;
    speechToTextTranscriber?: SpeechToTextTranscriber;
    intelligenceQueue?: IntelligenceProcessingQueue;
    transientCiphertextBase64?: string;
    transientCiphertextSha256?: string;
  } = {},
): Promise<ProcessArtifactResult> {
  const now = options.now ?? new Date();
  const claimed = await repository.claimArtifact(artifactId);

  if (!claimed) {
    return "skipped";
  }

  return processClaimedArtifact(repository, claimed, now, {
    privateMemoryReader: options.privateMemoryReader,
    privateFragmentStorage: options.privateFragmentStorage,
    speechToTextTranscriber: options.speechToTextTranscriber,
    intelligenceQueue: options.intelligenceQueue,
    transientCiphertextBase64: options.transientCiphertextBase64,
    transientCiphertextSha256: options.transientCiphertextSha256,
  });
}

export async function recoverArtifact(
  repository: ArtifactRepository,
  artifactId: string,
  options: {
    now?: Date;
    privateMemoryReader?: PrivateMemoryReader;
    privateFragmentStorage?: PrivateFragmentStorage;
    speechToTextTranscriber?: SpeechToTextTranscriber;
    intelligenceQueue?: IntelligenceProcessingQueue;
    transientCiphertextBase64?: string;
    transientCiphertextSha256?: string;
  } = {},
): Promise<ProcessArtifactResult> {
  const now = options.now ?? new Date();
  const claimed = await repository.claimRecoverableArtifact(artifactId);

  if (!claimed) {
    return "skipped";
  }

  return processClaimedArtifact(repository, claimed, now, {
    privateMemoryReader: options.privateMemoryReader,
    privateFragmentStorage: options.privateFragmentStorage,
    speechToTextTranscriber: options.speechToTextTranscriber,
    intelligenceQueue: options.intelligenceQueue,
    transientCiphertextBase64: options.transientCiphertextBase64,
    transientCiphertextSha256: options.transientCiphertextSha256,
  });
}

export async function processQueuedArtifacts(
  repository: ArtifactRepository,
  options: {
    limit?: number;
    now?: Date;
    privateMemoryReader?: PrivateMemoryReader;
    privateFragmentStorage?: PrivateFragmentStorage;
    speechToTextTranscriber?: SpeechToTextTranscriber;
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

async function processClaimedArtifact(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  now: Date,
  options: {
    privateMemoryReader?: PrivateMemoryReader;
    privateFragmentStorage?: PrivateFragmentStorage;
    speechToTextTranscriber?: SpeechToTextTranscriber;
    intelligenceQueue?: IntelligenceProcessingQueue;
    transientCiphertextBase64?: string;
    transientCiphertextSha256?: string;
  },
): Promise<"completed" | "pending" | "failed"> {
  const metadata = asRecord(artifact.metadata);

  if (isEncryptedPrivateArtifact(metadata)) {
    const { privateMemoryReader, speechToTextTranscriber } = options;

    if (privateMemoryReader && artifact.rawStorageRef) {
      const plaintext = await readArtifactPrivateMemory({
        privateMemoryReader,
        artifact,
        metadata,
        transientCiphertextBase64: options.transientCiphertextBase64,
        transientCiphertextSha256: options.transientCiphertextSha256,
      })
        .catch(async (error: unknown) => {
          const detail = errorMessage(error);

          if (isRetryablePrivateMemoryReadError(error)) {
            const nextMetadata = withProcessingState(metadata, {
              status: "pending",
              reason: ENCRYPTED_DECRYPTION_RETRYING,
              detail,
              processedAt: now.toISOString(),
              rawStorageRef: artifact.rawStorageRef,
            });

            await repository.markArtifactPending(artifact.id, nextMetadata);
            await repository.createAuditEvent({
              twinId: artifact.twinId,
              eventType: "artifact.processing_retrying",
              resourceId: artifact.id,
              metadata: {
                reason: ENCRYPTED_DECRYPTION_RETRYING,
                detail,
                rawStorageRef: artifact.rawStorageRef,
              },
            });

            throw new RetryableArtifactProcessingError({
              artifactId: artifact.id,
              reason: ENCRYPTED_DECRYPTION_RETRYING,
              detail,
            });
          }

          const nextMetadata = withProcessingState(metadata, {
            status: "failed",
            reason: ENCRYPTED_DECRYPTION_FAILED,
            detail,
            processedAt: now.toISOString(),
          });

          await repository.markArtifactFailed(artifact.id, nextMetadata);
          await repository.createAuditEvent({
            twinId: artifact.twinId,
            eventType: "artifact.processing_failed",
            resourceId: artifact.id,
            metadata: {
              reason: ENCRYPTED_DECRYPTION_FAILED,
              rawStorageRef: artifact.rawStorageRef,
            },
          });
          return null;
        });

      if (plaintext === null) {
        return "failed";
      }

      const privatePayload = decodePrivateSourcePayload(plaintext);

      if (isSpeechToTextSource(artifact.sourceType)) {
        const sourceLabel = artifact.sourceType === "voice_conversation" ? "Voice conversation" : "Voice note";

        if (!speechToTextTranscriber) {
          const nextMetadata = withProcessingState(metadata, {
            status: "pending",
            reason: SPEECH_TO_TEXT_REQUIRED,
            detail: `${sourceLabel} artifacts require a configured speech-to-text transcriber before memory fragments can be derived.`,
            processedAt: now.toISOString(),
            decryptPath: "seal_walrus",
          });

          await repository.markArtifactPending(artifact.id, nextMetadata);
          await repository.createAuditEvent({
            twinId: artifact.twinId,
            eventType: "artifact.processing_pending",
            resourceId: artifact.id,
            metadata: {
              reason: SPEECH_TO_TEXT_REQUIRED,
              rawStorageRef: artifact.rawStorageRef,
              decryptPath: "seal_walrus",
            },
          });
          return "pending";
        }

        const transcription = await speechToTextTranscriber
          .transcribe({
            audioBase64: privatePayload.content,
            fileName: readMetadataString(privatePayload.metadata, "fileName"),
            mimeType: readMetadataString(privatePayload.metadata, "fileType"),
          })
          .catch(async (error: unknown) => {
            const nextMetadata = withProcessingState(metadata, {
              status: "failed",
              reason: SPEECH_TO_TEXT_FAILED,
              detail: errorMessage(error),
              processedAt: now.toISOString(),
              decryptPath: "seal_walrus",
            });

            await repository.markArtifactFailed(artifact.id, nextMetadata);
            await repository.createAuditEvent({
              twinId: artifact.twinId,
              eventType: "artifact.processing_failed",
              resourceId: artifact.id,
              metadata: {
                reason: SPEECH_TO_TEXT_FAILED,
                rawStorageRef: artifact.rawStorageRef,
                decryptPath: "seal_walrus",
              },
            });
            return null;
          });

        if (transcription === null) {
          return "failed";
        }

        const transcript = transcription.text.trim();

        if (!transcript) {
          const nextMetadata = withProcessingState(metadata, {
            status: "failed",
            reason: SPEECH_TO_TEXT_EMPTY,
            detail: "Speech-to-text completed but did not produce transcript text.",
            processedAt: now.toISOString(),
            decryptPath: "seal_walrus",
            transcription: {
              provider: transcription.provider,
              model: transcription.model,
              ...(transcription.metadata ? { metadata: transcription.metadata } : {}),
            },
          });

          await repository.markArtifactFailed(artifact.id, nextMetadata);
          await repository.createAuditEvent({
            twinId: artifact.twinId,
            eventType: "artifact.processing_failed",
            resourceId: artifact.id,
            metadata: {
              reason: SPEECH_TO_TEXT_EMPTY,
              rawStorageRef: artifact.rawStorageRef,
              decryptPath: "seal_walrus",
              transcription: {
                provider: transcription.provider,
                model: transcription.model,
              },
            },
          });
          return "failed";
        }

        if (!options.privateFragmentStorage) {
          await markPrivateFragmentStorageRequired(repository, artifact, metadata, now);
          return "pending";
        }

        const fragment = await getOrCreateMemoryFragment(repository, {
          twinId: artifact.twinId,
          sourceArtifactId: artifact.id,
          content: transcript,
          privateFragmentStorage: options.privateFragmentStorage,
          sourceType: artifact.sourceType,
          importanceScore: 0.5,
          confidenceScore: 0.7,
        });
        const intelligence = await queueIntelligenceProcessing(repository, artifact, fragment, options.intelligenceQueue);
        const nextMetadata = withProcessingState(metadata, {
          status: "completed",
          memoryFragmentId: fragment.id,
          processedAt: now.toISOString(),
          decryptPath: "seal_walrus",
          ...intelligence,
          transcription: {
            provider: transcription.provider,
            model: transcription.model,
            transcriptLength: transcript.length,
            ...(transcription.metadata ? { metadata: transcription.metadata } : {}),
          },
        });

        await repository.markArtifactCompleted(artifact.id, nextMetadata);
        await repository.createAuditEvent({
          twinId: artifact.twinId,
          eventType: "artifact.processed",
          resourceId: artifact.id,
          metadata: {
            memoryFragmentId: fragment.id,
            rawStorageRef: artifact.rawStorageRef,
            decryptPath: "seal_walrus",
            transcription: {
              provider: transcription.provider,
              model: transcription.model,
              transcriptLength: transcript.length,
            },
          },
        });
        return "completed";
      }

      const parsed = await parseProcessableContent(artifact, privatePayload).catch(async (error: unknown) => {
        await markArtifactParseFailed(repository, artifact, metadata, now, error);
        return null;
      });

      if (parsed === null) {
        return "failed";
      }

      const attributed = await applySpeakerAttribution(repository, artifact, parsed);

      if (attributed.content.length > 0) {
        if (!options.privateFragmentStorage) {
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
          confidenceScore: 0.7,
        });
        const intelligence = await queueIntelligenceProcessing(repository, artifact, fragment, options.intelligenceQueue);
        const nextMetadata = withProcessingState(metadata, {
          status: "completed",
          memoryFragmentId: fragment.id,
          processedAt: now.toISOString(),
          decryptPath: "seal_walrus",
          ...intelligence,
          ...(attributed.parser ? { parser: attributed.parser } : {}),
          ...(attributed.attribution ? { conversation: attributed.attribution } : {}),
        });

        await repository.markArtifactCompleted(artifact.id, nextMetadata);
        await repository.createAuditEvent({
          twinId: artifact.twinId,
          eventType: "artifact.processed",
          resourceId: artifact.id,
          metadata: {
            memoryFragmentId: fragment.id,
            decryptPath: "seal_walrus",
            rawStorageRef: artifact.rawStorageRef,
            ...(attributed.parser ? { parser: attributed.parser } : {}),
            ...(attributed.attribution ? { conversation: attributed.attribution } : {}),
          },
        });
        return "completed";
      }

      const emptyParseReason = readEmptyParseReason(artifact.sourceType);

      if (emptyParseReason) {
        const nextMetadata = withProcessingState(metadata, {
          status: "failed",
          reason: emptyParseReason,
          detail: `${readSourceLabel(artifact.sourceType)} artifact did not produce retrievable text after parsing.`,
          processedAt: now.toISOString(),
          ...(attributed.parser ? { parser: attributed.parser } : {}),
        });

        await repository.markArtifactFailed(artifact.id, nextMetadata);
        await repository.createAuditEvent({
          twinId: artifact.twinId,
          eventType: "artifact.processing_failed",
          resourceId: artifact.id,
          metadata: {
            reason: emptyParseReason,
            rawStorageRef: artifact.rawStorageRef,
            ...(attributed.parser ? { parser: attributed.parser } : {}),
          },
        });
        return "failed";
      }
    }

    const nextMetadata = withProcessingState(metadata, {
      status: "pending",
      reason: ENCRYPTED_DECRYPTION_REQUIRED,
      detail: "Encrypted private artifacts require a scoped Seal decrypt path before memory fragments can be derived.",
      processedAt: now.toISOString(),
    });

    await repository.markArtifactPending(artifact.id, nextMetadata);
    await repository.createAuditEvent({
      twinId: artifact.twinId,
      eventType: "artifact.processing_pending",
      resourceId: artifact.id,
      metadata: {
        reason: ENCRYPTED_DECRYPTION_REQUIRED,
        rawStorageRef: artifact.rawStorageRef,
      },
    });
    return "pending";
  }

  const plaintext = readPlaintextProcessingInput(metadata);

  if (!plaintext) {
    const nextMetadata = withProcessingState(metadata, {
      status: "failed",
      reason: MISSING_PROCESSABLE_CONTENT,
      detail: "No plaintext processing input was available for this non-encrypted artifact.",
      processedAt: now.toISOString(),
    });

    await repository.markArtifactFailed(artifact.id, nextMetadata);
    await repository.createAuditEvent({
      twinId: artifact.twinId,
      eventType: "artifact.processing_failed",
      resourceId: artifact.id,
      metadata: { reason: MISSING_PROCESSABLE_CONTENT },
    });
    return "failed";
  }

  const parsed = await parseProcessableContent(artifact, {
    content: plaintext,
    title: null,
    metadata,
  }).catch(async (error: unknown) => {
    await markArtifactParseFailed(repository, artifact, metadata, now, error);
    return null;
  });

  if (parsed === null) {
    return "failed";
  }

  const attributed = await applySpeakerAttribution(repository, artifact, parsed);

  if (!attributed.content) {
    const reason = readEmptyParseReason(artifact.sourceType) ?? MISSING_PROCESSABLE_CONTENT;
    const nextMetadata = withProcessingState(metadata, {
      status: "failed",
      reason,
      detail: readEmptyParseReason(artifact.sourceType)
        ? `${readSourceLabel(artifact.sourceType)} artifact did not produce retrievable text after parsing.`
        : "No plaintext processing input was available for this non-encrypted artifact.",
      processedAt: now.toISOString(),
      ...(attributed.parser ? { parser: attributed.parser } : {}),
    });

    await repository.markArtifactFailed(artifact.id, nextMetadata);
    await repository.createAuditEvent({
      twinId: artifact.twinId,
      eventType: "artifact.processing_failed",
      resourceId: artifact.id,
      metadata: {
        reason,
        ...(attributed.parser ? { parser: attributed.parser } : {}),
      },
    });
    return "failed";
  }

  const fragment = await getOrCreateMemoryFragment(repository, {
    twinId: artifact.twinId,
    sourceArtifactId: artifact.id,
    content: attributed.content,
    privateFragmentStorage: options.privateFragmentStorage,
    sourceType: artifact.sourceType,
    metadata: attributed.attribution ? { conversation: attributed.attribution } : undefined,
    importanceScore: 0.5,
    confidenceScore: 0.6,
  });
  const intelligence = await queueIntelligenceProcessing(repository, artifact, fragment, options.intelligenceQueue);
  const nextMetadata = withProcessingState(metadata, {
    status: "completed",
    memoryFragmentId: fragment.id,
    processedAt: now.toISOString(),
    ...intelligence,
    ...(attributed.parser ? { parser: attributed.parser } : {}),
    ...(attributed.attribution ? { conversation: attributed.attribution } : {}),
  });

  await repository.markArtifactCompleted(artifact.id, nextMetadata);
  await repository.createAuditEvent({
    twinId: artifact.twinId,
    eventType: "artifact.processed",
    resourceId: artifact.id,
    metadata: {
      memoryFragmentId: fragment.id,
      ...(attributed.parser ? { parser: attributed.parser } : {}),
      ...(attributed.attribution ? { conversation: attributed.attribution } : {}),
    },
  });
  return "completed";
}

async function applySpeakerAttribution(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  parsed: ParsedProcessableContent,
): Promise<ParsedProcessableContent & { attribution?: AttributionMetadata }> {
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

function renderAttributedConversationMessage(
  message: ParsedConversationMessage,
  role: SpeakerRole,
): string {
  const speaker = `${role}/${message.speaker}`;

  return message.timestamp
    ? `[${message.timestamp}] ${speaker}: ${message.text}`
    : `${speaker}: ${message.text}`;
}

function isRetryablePrivateMemoryReadError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();

  return [
    "fetch failed",
    "network",
    "timeout",
    "timed out",
    "econnreset",
    "econnrefused",
    "socket",
    "429",
    "500",
    "502",
    "503",
    "504",
    "walrus_read failed",
    "seal_decrypt failed",
  ].some((fragment) => message.includes(fragment));
}

function readArtifactPrivateMemory(input: {
  privateMemoryReader: PrivateMemoryReader;
  artifact: QueuedArtifact;
  metadata: Record<string, unknown>;
  transientCiphertextBase64?: string;
  transientCiphertextSha256?: string;
}): Promise<string> {
  const expectedCiphertextSha256 = readCiphertextSha256(input.metadata);

  if (
    input.transientCiphertextBase64 &&
    input.privateMemoryReader.readPrivateMemoryFromEncryptedBytes
  ) {
    console.log("artifact transient ciphertext handoff used", {
      artifactId: input.artifact.id,
      sourceType: input.artifact.sourceType,
      ciphertextBytesApprox: approximateBase64Bytes(input.transientCiphertextBase64),
    });

    return input.privateMemoryReader.readPrivateMemoryFromEncryptedBytes({
      encryptedBytesBase64: input.transientCiphertextBase64,
      artifactId: input.artifact.id,
      twinId: input.artifact.twinId,
      expectedCiphertextSha256: input.transientCiphertextSha256 ?? expectedCiphertextSha256,
      source: "artifact_queue",
    });
  }

  return input.privateMemoryReader.readPrivateMemory({
    rawStorageRef: input.artifact.rawStorageRef!,
    artifactId: input.artifact.id,
    twinId: input.artifact.twinId,
    expectedCiphertextSha256,
  });
}

async function getOrCreateMemoryFragment(
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
) {
  const existing = await repository.findMemoryFragmentBySourceArtifactId(input.sourceArtifactId);

  if (existing) {
    return existing satisfies MemoryFragmentProcessingRef;
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
  } satisfies MemoryFragmentProcessingRef;
}

async function queueIntelligenceProcessing(
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

export async function processArtifactIntelligence(
  repository: ArtifactRepository,
  input: {
    artifactId: string;
    twinId: string;
    memoryFragmentId: string;
    sourceType: string;
    transientFragmentCiphertextBase64?: string;
    transientFragmentCiphertextSha256?: string;
    privateMemoryReader?: PrivateMemoryReader;
    entityExtractor?: EntityExtractor;
    memoryExtractor?: MemoryExtractor;
    privateFragmentStorage?: PrivateFragmentStorage;
    candidateMemoryArchiveQueue?: CandidateMemoryArchiveQueue;
    intelligenceChunkChars?: number;
    intelligenceChunkConcurrency?: number;
  },
): Promise<Record<string, unknown>> {
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

  const metadata = asRecord(artifact.metadata);
  await repository.markArtifactCompleted(
    artifact.id,
    withIntelligenceState(metadata, {
      status: "processing",
      memoryFragmentId: input.memoryFragmentId,
      startedAt: new Date().toISOString(),
    }),
  );

  const startedAt = Date.now();
  const timings: Record<string, number> = {};
  console.log("artifact intelligence stage started", {
    artifactId: input.artifactId,
    stage: "fragment_decrypt",
  });
  const content = await measureStage("fragmentDecryptMs", timings, () => {
    if (
      input.transientFragmentCiphertextBase64 &&
      input.privateMemoryReader!.readPrivateMemoryFromEncryptedBytes
    ) {
      console.log("intelligence transient fragment ciphertext handoff used", {
        artifactId: input.artifactId,
        memoryFragmentId: input.memoryFragmentId,
        ciphertextBytesApprox: approximateBase64Bytes(input.transientFragmentCiphertextBase64),
      });

      return input.privateMemoryReader!.readPrivateMemoryFromEncryptedBytes({
        encryptedBytesBase64: input.transientFragmentCiphertextBase64,
        artifactId: input.artifactId,
        twinId: input.twinId,
        expectedCiphertextSha256: input.transientFragmentCiphertextSha256 ?? fragment.contentSha256,
        source: "intelligence_queue",
      });
    }

    return input.privateMemoryReader!.readPrivateMemory({
      rawStorageRef: fragment.contentStorageRef!,
      artifactId: input.artifactId,
      twinId: input.twinId,
      expectedCiphertextSha256: fragment.contentSha256,
    });
  });
  console.log("artifact intelligence stage completed", {
    artifactId: input.artifactId,
    stage: "fragment_decrypt",
    contentChars: content.length,
    durationMs: timings.fragmentDecryptMs,
  });
  const chunks = createIntelligenceChunks(content, input.intelligenceChunkChars ?? 18_000);
  console.log("artifact intelligence chunking completed", {
    artifactId: input.artifactId,
    memoryFragmentId: input.memoryFragmentId,
    contentChars: content.length,
    chunkCount: chunks.length,
    chunkChars: input.intelligenceChunkChars ?? 18_000,
    chunkConcurrency: input.intelligenceChunkConcurrency ?? 2,
  });
  console.log("artifact intelligence stage started", {
    artifactId: input.artifactId,
    stage: "entity_extraction",
  });
  const entityExtraction = await measureStage("entityExtractionMs", timings, () =>
    processEntityExtractionChunks(repository, {
      artifact,
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
  console.log("artifact intelligence stage started", {
    artifactId: input.artifactId,
    stage: "memory_extraction",
  });
  const memoryExtraction = await measureStage("memoryExtractionMs", timings, () =>
    processMemoryExtractionChunks(repository, {
      artifact,
      memoryFragmentId: input.memoryFragmentId,
      chunks,
      title: null,
      memoryExtractor: input.memoryExtractor,
      privateFragmentStorage: input.privateFragmentStorage,
      candidateMemoryArchiveQueue: input.candidateMemoryArchiveQueue,
      concurrency: input.intelligenceChunkConcurrency ?? 2,
    }),
  );
  if (memoryExtraction && typeof memoryExtraction.candidateMemoryEncryptMs === "number") {
    timings.candidateMemoryEncryptMs = memoryExtraction.candidateMemoryEncryptMs;
  }
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
  timings.totalIntelligenceMs = Date.now() - startedAt;

  const intelligence = {
    status: entityExtraction?.status === "failed" || memoryExtraction?.status === "failed" ? "failed" : "completed",
    completedAt: new Date().toISOString(),
    ...(entityExtraction ? { entityExtraction: { ...entityExtraction, durationMs: timings.entityExtractionMs } } : {}),
    ...(memoryExtraction ? { memoryExtraction: { ...memoryExtraction, durationMs: timings.memoryExtractionMs } } : {}),
    timing: timings,
  };

  await repository.markArtifactCompleted(
    artifact.id,
    withIntelligenceState(asRecord((await repository.findArtifactById(artifact.id))?.metadata), intelligence),
  );

  return intelligence;
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
    const result = await input.entityExtractor
      .extract({
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
        properties: {
          normalizedName: entity.normalizedName,
          entityType: entity.type,
          aliases: entity.aliases,
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

async function upsertArtifactGraphNode(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  memoryFragmentId: string,
): Promise<{ id: string }> {
  return repository.upsertGraphNode({
    twinId: artifact.twinId,
    nodeType: "artifact",
    name: `source_artifact:${artifact.id}`,
    normalizedName: `source_artifact:${artifact.id}`,
    properties: {
      sourceArtifactId: artifact.id,
      memoryFragmentId,
      sourceType: artifact.sourceType,
    },
    confidenceScore: 1,
  });
}

async function clusterProjectsFromEntities(
  repository: ArtifactRepository,
  input: {
    artifact: QueuedArtifact;
    memoryFragmentId: string;
    artifactNodeId: string;
    entityNodes: Array<{
      nodeId: string;
      entity: ExtractedEntity;
    }>;
  },
): Promise<Record<string, unknown>> {
  const candidates = input.entityNodes
    .map(({ entity }) => readProjectCandidateFromEntity(entity))
    .filter((candidate): candidate is ProjectClusterCandidate => Boolean(candidate));
  const deduped = dedupeProjectCandidates(candidates);
  let projectLinkCount = 0;

  for (const candidate of deduped) {
    const projectNode = await upsertProjectClusterNode(repository, input.artifact, candidate);

    await repository.upsertGraphEdge({
      twinId: input.artifact.twinId,
      fromNodeId: input.artifactNodeId,
      toNodeId: projectNode.id,
      edgeType: "belongs_to_project",
      description: "Source artifact is clustered into this project context.",
      evidenceMemoryIds: [input.memoryFragmentId],
      confidenceScore: candidate.confidence,
    });
    projectLinkCount += 1;

    for (const { nodeId, entity } of input.entityNodes) {
      if (entity.normalizedName === candidate.normalizedName && entity.graphNodeType === "project") {
        continue;
      }

      await repository.upsertGraphEdge({
        twinId: input.artifact.twinId,
        fromNodeId: projectNode.id,
        toNodeId: nodeId,
        edgeType: "project_context",
        description: "Entity appears in the same source context as this project cluster.",
        evidenceMemoryIds: [input.memoryFragmentId],
        confidenceScore: Math.min(candidate.confidence, entity.confidence),
      });
      projectLinkCount += 1;
    }
  }

  return {
    status: "completed",
    method: "deterministic_project_clustering",
    projectClusterCount: deduped.length,
    projectLinkCount,
    signals: Array.from(new Set(deduped.flatMap((candidate) => candidate.signals))),
  };
}

async function clusterProjectsFromCandidates(
  repository: ArtifactRepository,
  input: {
    artifact: QueuedArtifact;
    memoryFragmentId: string;
    artifactNodeId: string;
    candidates: ProjectClusterCandidate[];
  },
): Promise<Record<string, unknown>> {
  const deduped = dedupeProjectCandidates(input.candidates);

  for (const candidate of deduped) {
    const projectNode = await upsertProjectClusterNode(repository, input.artifact, candidate);

    await repository.upsertGraphEdge({
      twinId: input.artifact.twinId,
      fromNodeId: input.artifactNodeId,
      toNodeId: projectNode.id,
      edgeType: "belongs_to_project",
      description: "Candidate memory subject is clustered into this project context.",
      evidenceMemoryIds: [input.memoryFragmentId],
      confidenceScore: candidate.confidence,
    });
  }

  return {
    status: "completed",
    method: "deterministic_project_clustering",
    projectClusterCount: deduped.length,
    projectLinkCount: deduped.length,
    signals: Array.from(new Set(deduped.flatMap((candidate) => candidate.signals))),
  };
}

async function linkDecisionGraphNodes(
  repository: ArtifactRepository,
  input: {
    artifact: QueuedArtifact;
    memoryFragmentId: string;
    artifactNodeId: string;
    decisions: DecisionGraphCandidate[];
  },
): Promise<Record<string, unknown>> {
  let decisionLinkCount = 0;
  let projectDecisionLinkCount = 0;

  for (const decision of input.decisions) {
    const decisionHash = sha256Text(decision.memory.normalizedStatement);
    const decisionNode = await repository.upsertGraphNode({
      twinId: input.artifact.twinId,
      nodeType: "decision",
      name: `decision:${decisionHash.slice(0, 12)}`,
      normalizedName: `decision:${decisionHash}`,
      properties: {
        decisionHash,
        sourceArtifactId: input.artifact.id,
        memoryFragmentId: input.memoryFragmentId,
        candidateMemoryId: decision.candidateMemoryId,
        sourceType: input.artifact.sourceType,
        subject: decision.memory.subject,
        evidenceHash: decision.memory.evidenceHash,
        evidenceLength: decision.memory.evidenceLength,
        statementIndex: decision.statementIndex,
        extractionMethod: "llm_structured_memory_extractor",
        privateStatementStoredEncrypted: true,
        metadata: decision.memory.metadata,
      },
      confidenceScore: decision.memory.confidence,
    });

    await repository.upsertGraphEdge({
      twinId: input.artifact.twinId,
      fromNodeId: input.artifactNodeId,
      toNodeId: decisionNode.id,
      edgeType: "records_decision",
      description: "Source artifact contains an encrypted candidate memory classified as a decision.",
      evidenceMemoryIds: [input.memoryFragmentId],
      confidenceScore: decision.memory.confidence,
    });
    decisionLinkCount += 1;

    const projectCandidate = readProjectCandidateFromMemory(decision.memory);

    if (projectCandidate) {
      const projectNode = await upsertProjectClusterNode(repository, input.artifact, projectCandidate);

      await repository.upsertGraphEdge({
        twinId: input.artifact.twinId,
        fromNodeId: projectNode.id,
        toNodeId: decisionNode.id,
        edgeType: "project_decision",
        description: "Decision candidate is associated with this project context.",
        evidenceMemoryIds: [input.memoryFragmentId],
        confidenceScore: Math.min(decision.memory.confidence, projectCandidate.confidence),
      });
      projectDecisionLinkCount += 1;
    }
  }

  return {
    status: "completed",
    method: "candidate_memory_decision_graph_linking",
    decisionCount: input.decisions.length,
    decisionLinkCount,
    projectDecisionLinkCount,
  };
}

async function linkGoalGraphNodes(
  repository: ArtifactRepository,
  input: {
    artifact: QueuedArtifact;
    memoryFragmentId: string;
    artifactNodeId: string;
    goals: GoalGraphCandidate[];
  },
): Promise<Record<string, unknown>> {
  let goalLinkCount = 0;
  let projectGoalLinkCount = 0;

  for (const goal of input.goals) {
    const goalHash = sha256Text(goal.memory.normalizedStatement);
    const goalNode = await repository.upsertGraphNode({
      twinId: input.artifact.twinId,
      nodeType: "goal",
      name: `goal:${goalHash.slice(0, 12)}`,
      normalizedName: `goal:${goalHash}`,
      properties: {
        goalHash,
        sourceArtifactId: input.artifact.id,
        memoryFragmentId: input.memoryFragmentId,
        candidateMemoryId: goal.candidateMemoryId,
        sourceType: input.artifact.sourceType,
        subject: goal.memory.subject,
        evidenceHash: goal.memory.evidenceHash,
        evidenceLength: goal.memory.evidenceLength,
        statementIndex: goal.statementIndex,
        extractionMethod: "llm_structured_memory_extractor",
        inferenceMethod: "candidate_memory_goal_graph_linking",
        privateStatementStoredEncrypted: true,
        metadata: goal.memory.metadata,
      },
      confidenceScore: goal.memory.confidence,
    });

    await repository.upsertGraphEdge({
      twinId: input.artifact.twinId,
      fromNodeId: input.artifactNodeId,
      toNodeId: goalNode.id,
      edgeType: "states_goal",
      description: "Source artifact contains an encrypted candidate memory classified as a goal.",
      evidenceMemoryIds: [input.memoryFragmentId],
      confidenceScore: goal.memory.confidence,
    });
    goalLinkCount += 1;

    const projectCandidate = readProjectCandidateFromMemory(goal.memory);

    if (projectCandidate) {
      const projectNode = await upsertProjectClusterNode(repository, input.artifact, projectCandidate);

      await repository.upsertGraphEdge({
        twinId: input.artifact.twinId,
        fromNodeId: projectNode.id,
        toNodeId: goalNode.id,
        edgeType: "project_goal",
        description: "Goal candidate is associated with this project context.",
        evidenceMemoryIds: [input.memoryFragmentId],
        confidenceScore: Math.min(goal.memory.confidence, projectCandidate.confidence),
      });
      projectGoalLinkCount += 1;
    }
  }

  return {
    status: "completed",
    method: "candidate_memory_goal_graph_linking",
    goalCount: input.goals.length,
    goalLinkCount,
    projectGoalLinkCount,
  };
}

async function detectAndLinkPatterns(
  repository: ArtifactRepository,
  input: {
    artifact: QueuedArtifact;
    memoryFragmentId: string;
    artifactNodeId: string;
    currentSignals: PatternSignal[];
  },
): Promise<Record<string, unknown>> {
  const historicalSignals = await repository.findRecentPatternSignals(input.artifact.twinId, 250);
  const result = detectPatterns({
    twinId: input.artifact.twinId,
    currentSignals: input.currentSignals,
    historicalSignals,
  });
  let patternLinkCount = 0;
  let projectPatternLinkCount = 0;

  for (const pattern of result.patterns) {
    const patternNode = await upsertPatternGraphNode(repository, input.artifact, pattern);

    await repository.upsertGraphEdge({
      twinId: input.artifact.twinId,
      fromNodeId: input.artifactNodeId,
      toNodeId: patternNode.id,
      edgeType: "supports_pattern",
      description: "Source artifact contributes private-safe evidence for this detected pattern.",
      evidenceMemoryIds: [input.memoryFragmentId],
      confidenceScore: pattern.confidence,
    });
    patternLinkCount += 1;

    const projectNode = await upsertProjectClusterNode(repository, input.artifact, {
      name: pattern.subject,
      normalizedName: pattern.normalizedSubject,
      confidence: pattern.confidence,
      signals: [pattern.patternType],
      source: "candidate_memory",
    });

    await repository.upsertGraphEdge({
      twinId: input.artifact.twinId,
      fromNodeId: projectNode.id,
      toNodeId: patternNode.id,
      edgeType: "project_pattern",
      description: "Detected pattern is associated with this project or subject context.",
      evidenceMemoryIds: [input.memoryFragmentId],
      confidenceScore: pattern.confidence,
    });
    projectPatternLinkCount += 1;
  }

  return {
    status: "completed",
    ...result.metadata,
    patternLinkCount,
    projectPatternLinkCount,
  };
}

async function upsertPatternGraphNode(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  pattern: DetectedPattern,
): Promise<{ id: string }> {
  return repository.upsertGraphNode({
    twinId: artifact.twinId,
    nodeType: "other",
    name: `pattern:${pattern.patternHash.slice(0, 12)}`,
    normalizedName: `pattern:${pattern.patternHash}`,
    properties: {
      kind: "pattern",
      patternType: pattern.patternType,
      patternHash: pattern.patternHash,
      subject: pattern.subject,
      normalizedSubject: pattern.normalizedSubject,
      evidenceCount: pattern.evidenceCount,
      sourceArtifactIds: pattern.sourceArtifactIds,
      memoryFragmentIds: pattern.memoryFragmentIds,
      candidateMemoryIds: pattern.candidateMemoryIds,
      memoryTypes: pattern.memoryTypes,
      sourceTypes: pattern.sourceTypes,
      detector: pattern.detector,
      privateStatementStoredEncrypted: true,
    },
    confidenceScore: pattern.confidence,
  });
}

function toPatternSignal(
  artifact: QueuedArtifact,
  memoryFragmentId: string,
  candidateMemoryId: string,
  memory: ExtractedMemory,
): PatternSignal | null {
  if (!memory.subject) {
    return null;
  }

  return {
    twinId: artifact.twinId,
    sourceArtifactId: artifact.id,
    memoryFragmentId,
    candidateMemoryId,
    memoryType: memory.memoryType,
    subject: memory.subject,
    confidence: memory.confidence,
    evidenceHash: memory.evidenceHash,
    evidenceLength: memory.evidenceLength,
    sourceType: artifact.sourceType,
    metadata: memory.metadata,
  };
}

async function upsertProjectClusterNode(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  candidate: ProjectClusterCandidate,
): Promise<{ id: string }> {
  return repository.upsertGraphNode({
    twinId: artifact.twinId,
    nodeType: "project",
    name: candidate.name,
    normalizedName: candidate.normalizedName,
    properties: {
      normalizedName: candidate.normalizedName,
      sourceType: artifact.sourceType,
      projectCluster: true,
      clusterMethod: "deterministic_project_clustering",
      clusterSignals: candidate.signals,
      clusterSources: [candidate.source],
    },
    confidenceScore: candidate.confidence,
  });
}

function readProjectCandidateFromEntity(entity: ExtractedEntity): ProjectClusterCandidate | null {
  if (entity.graphNodeType === "project") {
    return {
      name: entity.name,
      normalizedName: entity.normalizedName,
      confidence: Math.max(entity.confidence, 0.85),
      signals: ["project_entity"],
      source: "entity",
    };
  }

  if (entity.type === "product") {
    return {
      name: entity.name,
      normalizedName: normalizeProjectName(entity.name),
      confidence: Math.min(entity.confidence, 0.78),
      signals: ["product_entity"],
      source: "entity",
    };
  }

  return null;
}

function readProjectCandidateFromMemory(memory: ExtractedMemory): ProjectClusterCandidate | null {
  const subject = typeof memory.subject === "string" ? memory.subject.trim() : "";

  if (!subject || subject.length < 2 || subject.length > 100) {
    return null;
  }

  if (memory.memoryType === "project_update") {
    return {
      name: subject,
      normalizedName: normalizeProjectName(subject),
      confidence: Math.max(memory.confidence, 0.78),
      signals: ["project_update_subject"],
      source: "candidate_memory",
    };
  }

  if (
    memory.memoryType === "decision"
    || memory.memoryType === "goal"
    || memory.memoryType === "commitment"
  ) {
    return {
      name: subject,
      normalizedName: normalizeProjectName(subject),
      confidence: Math.min(memory.confidence, 0.7),
      signals: [`${memory.memoryType}_subject`],
      source: "candidate_memory",
    };
  }

  return null;
}

function dedupeProjectCandidates(candidates: ProjectClusterCandidate[]): ProjectClusterCandidate[] {
  const deduped = new Map<string, ProjectClusterCandidate>();

  for (const candidate of candidates) {
    const existing = deduped.get(candidate.normalizedName);

    if (!existing) {
      deduped.set(candidate.normalizedName, candidate);
      continue;
    }

    deduped.set(candidate.normalizedName, {
      ...existing,
      confidence: Math.max(existing.confidence, candidate.confidence),
      signals: Array.from(new Set([...existing.signals, ...candidate.signals])),
    });
  }

  return Array.from(deduped.values());
}

function normalizeProjectName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

async function measureStage<T>(
  key: string,
  timings: Record<string, number>,
  task: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();

  try {
    return await task();
  } finally {
    timings[key] = Date.now() - startedAt;
  }
}

type IntelligenceChunk = {
  index: number;
  total: number;
  startOffset: number;
  endOffset: number;
  content: string;
};

function createIntelligenceChunks(content: string, chunkChars: number): IntelligenceChunk[] {
  const normalizedChunkChars = Math.max(1_000, chunkChars);

  if (content.length <= normalizedChunkChars) {
    return [
      {
        index: 0,
        total: 1,
        startOffset: 0,
        endOffset: content.length,
        content,
      },
    ];
  }

  const chunks: IntelligenceChunk[] = [];
  let startOffset = 0;

  while (startOffset < content.length) {
    const hardEnd = Math.min(content.length, startOffset + normalizedChunkChars);
    const nextBreak = findChunkBreak(content, startOffset, hardEnd);
    const endOffset = nextBreak > startOffset ? nextBreak : hardEnd;
    const chunkContent = content.slice(startOffset, endOffset).trim();

    if (chunkContent) {
      chunks.push({
        index: chunks.length,
        total: 0,
        startOffset,
        endOffset,
        content: chunkContent,
      });
    }

    startOffset = endOffset;
  }

  return chunks.map((chunk) => ({
    ...chunk,
    total: chunks.length,
  }));
}

function findChunkBreak(content: string, startOffset: number, hardEnd: number): number {
  if (hardEnd >= content.length) {
    return content.length;
  }

  const searchStart = Math.max(startOffset, hardEnd - 2_000);
  const paragraphBreak = content.lastIndexOf("\n\n", hardEnd);

  if (paragraphBreak >= searchStart) {
    return paragraphBreak + 2;
  }

  const sentenceBreak = content.lastIndexOf(". ", hardEnd);

  if (sentenceBreak >= searchStart) {
    return sentenceBreak + 2;
  }

  const lineBreak = content.lastIndexOf("\n", hardEnd);

  if (lineBreak >= searchStart) {
    return lineBreak + 1;
  }

  const spaceBreak = content.lastIndexOf(" ", hardEnd);

  return spaceBreak >= searchStart ? spaceBreak + 1 : hardEnd;
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  task: (item: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  const limit = Math.max(1, concurrency);
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await task(items[currentIndex]!);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );

  return results;
}

function aggregateExtractionResults(
  results: Array<Record<string, unknown> | null>,
  options: {
    countKey: "entityCount" | "candidateMemoryCount";
    chunkCount: number;
  },
): Record<string, unknown> | null {
  const present = results.filter((result): result is Record<string, unknown> => Boolean(result));

  if (present.length === 0) {
    return null;
  }

  const failedCount = present.filter((result) => result.status === "failed").length;
  const completedCount = present.filter((result) => result.status === "completed").length;
  const first = present[0] ?? {};

  return {
    status: failedCount > 0 && completedCount === 0 ? "failed" : "completed",
    ...(failedCount > 0 ? { failedChunkCount: failedCount } : {}),
    chunkCount: options.chunkCount,
    completedChunkCount: completedCount,
    [options.countKey]: present.reduce((sum, result) => sum + readNumber(result[options.countKey]), 0),
    ...(typeof first.extractor === "string" ? { extractor: first.extractor } : {}),
    ...(typeof first.provider === "string" ? { provider: first.provider } : {}),
    ...(typeof first.model === "string" ? { model: first.model } : {}),
    warnings: present.flatMap((result) => readStringArray(result.warnings)),
    llmMs: present.reduce((sum, result) => sum + readNumber(result.llmMs), 0),
    graphWriteMs: present.reduce((sum, result) => sum + readNumber(result.graphWriteMs), 0),
    candidateMemoryEncryptMs: present.reduce((sum, result) => sum + readNumber(result.candidateMemoryEncryptMs), 0),
    candidateMemoryDbWriteMs: present.reduce((sum, result) => sum + readNumber(result.candidateMemoryDbWriteMs), 0),
    candidateMemoryArchiveQueued: present.some((result) => result.candidateMemoryArchiveQueued === true),
  };
}

async function processMemoryExtraction(
  repository: ArtifactRepository,
  input: {
    artifact: QueuedArtifact;
    memoryFragmentId: string;
    content: string;
    title?: string | null;
    memoryExtractor?: MemoryExtractor;
    privateFragmentStorage?: PrivateFragmentStorage;
    candidateMemoryArchiveQueue?: CandidateMemoryArchiveQueue;
  },
): Promise<Record<string, unknown> | null> {
  if (!input.memoryExtractor) {
    return {
      status: "skipped",
      reason: "memory_extractor_not_configured",
    };
  }

  if (!input.privateFragmentStorage?.encryptPrivateFragment) {
    return {
      status: "skipped",
      reason: "encrypted_candidate_memory_encryption_not_configured",
    };
  }

  try {
    const llmStartedAt = Date.now();
    const result = await input.memoryExtractor.extract({
      twinId: input.artifact.twinId,
      sourceArtifactId: input.artifact.id,
      memoryFragmentId: input.memoryFragmentId,
      sourceType: input.artifact.sourceType,
      content: input.content,
      title: input.title,
    });
    const llmMs = Date.now() - llmStartedAt;
    const conversationPolicy = readConversationMemoryPolicy(input.content, input.artifact.sourceType);
    let storedCount = 0;
    let candidateMemoryEncryptMs = 0;
    let candidateMemoryDbWriteMs = 0;
    let archiveQueued = false;
    let encrypted:
      | {
          encryptedBytesBase64: string;
          contentSha256: string;
          metadata: Record<string, unknown>;
        }
      | null = null;

    if (result.memories.length > 0) {
      const encryptStartedAt = Date.now();
      encrypted = await input.privateFragmentStorage.encryptPrivateFragment({
        twinId: input.artifact.twinId,
        sourceArtifactId: input.artifact.id,
        sourceType: "candidate_memory_batch",
        content: JSON.stringify({
          kind: "candidate_memory_batch",
          version: 1,
          sourceArtifactId: input.artifact.id,
          memoryFragmentId: input.memoryFragmentId,
          ...(conversationPolicy
            ? {
                sourceKind: conversationPolicy.sourceKind,
                conversationUnderstanding: result.metadata.conversationUnderstanding ?? null,
              }
            : {}),
          memories: result.memories.map((memory, index) => ({
            statementIndex: index,
            statement: memory.statement,
            memoryType: memory.memoryType,
            subject: memory.subject,
          })),
        }),
        contentKind: "candidate_memory",
      });
      candidateMemoryEncryptMs = Date.now() - encryptStartedAt;
    }

    const dbWriteStartedAt = Date.now();
    const candidateMemoryIds: string[] = [];
    const projectCandidates: ProjectClusterCandidate[] = [];
    const decisionCandidates: DecisionGraphCandidate[] = [];
    const goalCandidates: GoalGraphCandidate[] = [];
    const currentPatternSignals: PatternSignal[] = [];
    for (const [statementIndex, memory] of result.memories.entries()) {
      if (!encrypted) {
        continue;
      }

      const candidate = await repository.createCandidateMemory({
        twinId: input.artifact.twinId,
        sourceArtifactId: input.artifact.id,
        memoryFragmentId: input.memoryFragmentId,
        memoryType: memory.memoryType,
        statementStorageRef: pendingCandidateMemoryArchiveRef(input.artifact.id, input.memoryFragmentId),
        statementSha256: encrypted.contentSha256,
        evidenceHash: memory.evidenceHash,
        evidenceLength: memory.evidenceLength,
        confidenceScore: memory.confidence,
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
          archiveStatus: input.candidateMemoryArchiveQueue ? "pending" : "deferred",
          extractor: result.metadata.extractor,
          provider: result.metadata.provider,
          model: result.metadata.model,
          subject: memory.subject,
          normalizedStatementHash: sha256Text(memory.normalizedStatement),
          evidenceHash: memory.evidenceHash,
          evidenceLength: memory.evidenceLength,
          sourceType: input.artifact.sourceType,
          statementIndex,
          statementCount: result.memories.length,
          batchStorage: true,
          ...(conversationPolicy ? conversationPolicy : {}),
          ...(result.metadata.conversationUnderstanding
            ? { conversationUnderstanding: result.metadata.conversationUnderstanding }
            : {}),
          ...(Object.keys(memory.metadata).length > 0 ? { memoryMetadata: memory.metadata } : {}),
          storage: encrypted.metadata,
        },
      });
      candidateMemoryIds.push(candidate.id);
      storedCount += 1;
      const projectCandidate = readProjectCandidateFromMemory(memory);

      if (projectCandidate) {
        projectCandidates.push(projectCandidate);
      }

      if (memory.memoryType === "decision") {
        decisionCandidates.push({
          memory,
          candidateMemoryId: candidate.id,
          statementIndex,
        });
      }

      if (memory.memoryType === "goal") {
        goalCandidates.push({
          memory,
          candidateMemoryId: candidate.id,
          statementIndex,
        });
      }

      const patternSignal = toPatternSignal(input.artifact, input.memoryFragmentId, candidate.id, memory);

      if (patternSignal) {
        currentPatternSignals.push(patternSignal);
      }
    }
    const artifactNode = projectCandidates.length > 0 || decisionCandidates.length > 0 || goalCandidates.length > 0
      ? await upsertArtifactGraphNode(repository, input.artifact, input.memoryFragmentId)
      : null;
    const projectClustering = artifactNode && projectCandidates.length > 0
      ? await clusterProjectsFromCandidates(repository, {
          artifact: input.artifact,
          memoryFragmentId: input.memoryFragmentId,
          artifactNodeId: artifactNode.id,
          candidates: projectCandidates,
        })
      : null;
    const decisionExtraction = artifactNode && decisionCandidates.length > 0
      ? await linkDecisionGraphNodes(repository, {
          artifact: input.artifact,
          memoryFragmentId: input.memoryFragmentId,
          artifactNodeId: artifactNode.id,
          decisions: decisionCandidates,
        })
      : null;
    const goalInference = artifactNode && goalCandidates.length > 0
      ? await linkGoalGraphNodes(repository, {
          artifact: input.artifact,
          memoryFragmentId: input.memoryFragmentId,
          artifactNodeId: artifactNode.id,
          goals: goalCandidates,
        })
      : null;
    const patternDetection = artifactNode && currentPatternSignals.length > 0
      ? await detectAndLinkPatterns(repository, {
          artifact: input.artifact,
          memoryFragmentId: input.memoryFragmentId,
          artifactNodeId: artifactNode.id,
          currentSignals: currentPatternSignals,
        })
      : null;
    candidateMemoryDbWriteMs = Date.now() - dbWriteStartedAt;

    if (encrypted && candidateMemoryIds.length > 0 && input.candidateMemoryArchiveQueue) {
      await input.candidateMemoryArchiveQueue.enqueueCandidateMemoryArchive({
        artifactId: input.artifact.id,
        twinId: input.artifact.twinId,
        memoryFragmentId: input.memoryFragmentId,
        sourceType: "candidate_memory_batch",
        candidateMemoryIds,
        encryptedBytesBase64: encrypted.encryptedBytesBase64,
        contentSha256: encrypted.contentSha256,
        metadata: encrypted.metadata,
      });
      archiveQueued = true;
    }

    await repository.createAuditEvent({
      twinId: input.artifact.twinId,
      eventType: "artifact.memories_extracted",
      resourceId: input.artifact.id,
      metadata: {
        memoryFragmentId: input.memoryFragmentId,
        candidateMemoryCount: storedCount,
        extractor: result.metadata.extractor,
        provider: result.metadata.provider,
        model: result.metadata.model,
        llmMs,
        candidateMemoryEncryptMs,
        candidateMemoryDbWriteMs,
        candidateMemoryArchiveQueued: archiveQueued,
        ...(projectClustering ? { projectClustering } : {}),
        ...(decisionExtraction ? { decisionExtraction } : {}),
        ...(goalInference ? { goalInference } : {}),
        ...(patternDetection ? { patternDetection } : {}),
        ...(conversationPolicy
          ? {
              sourceKind: conversationPolicy.sourceKind,
              conversationSourceType: conversationPolicy.conversationSourceType,
              attributionAware: conversationPolicy.attributionAware,
              speakerRolePolicy: conversationPolicy.speakerRolePolicy,
              voiceDerived: conversationPolicy.voiceDerived,
              conversationUnderstanding: result.metadata.conversationUnderstanding,
            }
          : {}),
      },
    });

    return {
      status: "completed",
      candidateMemoryCount: storedCount,
      extractor: result.metadata.extractor,
      provider: result.metadata.provider,
      model: result.metadata.model,
      warnings: result.metadata.warnings,
      llmMs,
      candidateMemoryEncryptMs,
      candidateMemoryDbWriteMs,
      candidateMemoryArchiveQueued: archiveQueued,
      ...(projectClustering ? { projectClustering } : {}),
      ...(decisionExtraction ? { decisionExtraction } : {}),
      ...(goalInference ? { goalInference } : {}),
      ...(patternDetection ? { patternDetection } : {}),
      ...(conversationPolicy
        ? {
            sourceKind: conversationPolicy.sourceKind,
            conversationSourceType: conversationPolicy.conversationSourceType,
            attributionAware: conversationPolicy.attributionAware,
            speakerRolePolicy: conversationPolicy.speakerRolePolicy,
            voiceDerived: conversationPolicy.voiceDerived,
            conversationUnderstanding: result.metadata.conversationUnderstanding,
          }
        : {}),
    };
  } catch (error) {
    console.warn("artifact memory extraction failed", {
      artifactId: input.artifact.id,
      sourceType: input.artifact.sourceType,
      memoryFragmentId: input.memoryFragmentId,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: errorMessage(error),
    });

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

async function processMemoryExtractionChunks(
  repository: ArtifactRepository,
  input: {
    artifact: QueuedArtifact;
    memoryFragmentId: string;
    chunks: IntelligenceChunk[];
    title?: string | null;
    memoryExtractor?: MemoryExtractor;
    privateFragmentStorage?: PrivateFragmentStorage;
    candidateMemoryArchiveQueue?: CandidateMemoryArchiveQueue;
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
      privateFragmentStorage: input.privateFragmentStorage,
      candidateMemoryArchiveQueue: input.candidateMemoryArchiveQueue,
    });
  }

  const results = await mapWithConcurrency(input.chunks, input.concurrency, (chunk) =>
    processMemoryExtraction(repository, {
      artifact: input.artifact,
      memoryFragmentId: input.memoryFragmentId,
      content: chunk.content,
      title: input.title,
      memoryExtractor: input.memoryExtractor,
      privateFragmentStorage: input.privateFragmentStorage,
      candidateMemoryArchiveQueue: input.candidateMemoryArchiveQueue,
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

  const startedAt = Date.now();
  const stored = await input.privateFragmentStorage.storeEncryptedPrivateFragment({
    twinId: input.twinId,
    sourceArtifactId: input.artifactId,
    sourceType: input.sourceType,
    encryptedBytesBase64: input.encryptedBytesBase64,
    contentSha256: input.contentSha256,
    metadata: input.metadata,
    contentKind: "candidate_memory",
  });
  const archiveMs = Date.now() - startedAt;

  await repository.markCandidateMemoriesArchived({
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
    candidateMemoryCount: input.candidateMemoryIds.length,
    archiveMs,
    statementStorageRef: stored.contentStorageRef,
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

async function markPrivateFragmentStorageRequired(
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

function isEncryptedPrivateArtifact(metadata: Record<string, unknown>): boolean {
  return metadata["storageMode"] === "encrypted_walrus" && metadata["sensitivity"] === "private";
}

function readPlaintextProcessingInput(metadata: Record<string, unknown>): string | null {
  const processingInput = asRecord(metadata["processingInput"]);
  const content = processingInput["content"];

  return typeof content === "string" && content.trim().length > 0 ? content.trim() : null;
}

function pendingCandidateMemoryArchiveRef(artifactId: string, memoryFragmentId: string): string {
  return `pending://candidate-memory-archive/${artifactId}/${memoryFragmentId}`;
}

async function parseProcessableContent(
  artifact: QueuedArtifact,
  payload: PrivateSourcePayload,
): Promise<ParsedProcessableContent> {
  switch (artifact.sourceType) {
    case "markdown": {
      const parsed = parseMarkdown({
        content: payload.content,
        title: payload.title,
      });

      return {
        content: parsed.content,
        parser: parsed.parser,
        conversation: parsed.conversation,
      };
    }
    case "upload": {
      const parsed = parsePlainText({
        content: payload.content,
        title: payload.title,
      });

      return {
        content: parsed.content,
        parser: parsed.parser,
        conversation: parsed.conversation,
      };
    }
    case "docx": {
      const parsed = await parseDocx({
        content: payload.content,
        title: payload.title,
      });

      return {
        content: parsed.content,
        parser: parsed.parser,
        conversation: parsed.conversation,
      };
    }
    case "csv": {
      const parsed = parseCsv({
        content: payload.content,
        title: payload.title,
      });

      return {
        content: parsed.content,
        parser: parsed.parser,
        conversation: parsed.conversation,
      };
    }
    case "email": {
      const parsed = await parseEmail({
        content: payload.content,
        title: payload.title,
      });

      return {
        content: parsed.content,
        parser: parsed.parser,
        conversation: parsed.conversation,
      };
    }
    case "ocr_pdf": {
      const parsed = await parseOcrScannedPdf({
        content: payload.content,
        title: payload.title,
      });

      return {
        content: parsed.content,
        parser: parsed.parser,
        conversation: parsed.conversation,
      };
    }
    case "image": {
      const parsed = await parseImage({
        content: payload.content,
        title: payload.title,
        mimeType: readMetadataString(payload.metadata, "fileType"),
      });

      return {
        content: parsed.content,
        parser: parsed.parser,
      };
    }
    case "github": {
      const parsed = parseGitHubImport({
        content: payload.content,
        title: payload.title,
      });

      return {
        content: parsed.content,
        parser: parsed.parser,
      };
    }
    case "browser_history": {
      const parsed = parseBrowserHistory({
        content: payload.content,
        title: payload.title,
      });

      return {
        content: parsed.content,
        parser: parsed.parser,
      };
    }
    case "chat_export": {
      const parsed = parseChatExport({
        content: payload.content,
        title: payload.title,
      });

      return {
        content: parsed.content,
        parser: parsed.parser,
        conversation: parsed.conversation,
      };
    }
    case "slack_export": {
      const parsed = parseSlackExport({
        content: payload.content,
        title: payload.title,
      });

      return {
        content: parsed.content,
        parser: parsed.parser,
        conversation: parsed.conversation,
      };
    }
    case "whatsapp_export": {
      const parsed = parseWhatsAppExport({
        content: payload.content,
        title: payload.title,
      });

      return {
        content: parsed.content,
        parser: parsed.parser,
        conversation: parsed.conversation,
      };
    }
    default:
      return { content: payload.content.trim() };
  }
}

function decodePrivateSourcePayload(value: string): PrivateSourcePayload {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;

    if (
      parsed["kind"] === "source_artifact" &&
      parsed["version"] === 1 &&
      typeof parsed["content"] === "string"
    ) {
      return {
        content: parsed["content"],
        title: typeof parsed["title"] === "string" ? parsed["title"] : null,
        metadata: asRecord(parsed["metadata"]),
      };
    }
  } catch {
    // Older testnet artifacts stored the raw content string directly.
  }

  return {
    content: value,
    title: null,
    metadata: {},
  };
}

function readEmptyParseReason(sourceType: string): string | null {
  if (sourceType === "markdown") {
    return PARSED_MARKDOWN_EMPTY;
  }

  if (sourceType === "upload") {
    return PARSED_PLAIN_TEXT_EMPTY;
  }

  if (sourceType === "docx") {
    return PARSED_DOCX_EMPTY;
  }

  if (sourceType === "csv") {
    return PARSED_CSV_EMPTY;
  }

  if (sourceType === "email") {
    return PARSED_EMAIL_EMPTY;
  }

  if (sourceType === "ocr_pdf") {
    return PARSED_OCR_PDF_EMPTY;
  }

  if (sourceType === "image") {
    return PARSED_IMAGE_EMPTY;
  }

  if (sourceType === "github") {
    return PARSED_GITHUB_EMPTY;
  }

  if (sourceType === "browser_history") {
    return PARSED_BROWSER_HISTORY_EMPTY;
  }

  if (sourceType === "chat_export") {
    return PARSED_CHAT_EXPORT_EMPTY;
  }

  if (sourceType === "slack_export") {
    return PARSED_SLACK_EXPORT_EMPTY;
  }

  if (sourceType === "whatsapp_export") {
    return PARSED_WHATSAPP_EXPORT_EMPTY;
  }

  return null;
}

function readSourceLabel(sourceType: string): string {
  if (sourceType === "markdown") {
    return "Markdown";
  }

  if (sourceType === "upload") {
    return "Plain text";
  }

  if (sourceType === "docx") {
    return "DOCX";
  }

  if (sourceType === "csv") {
    return "CSV";
  }

  if (sourceType === "email") {
    return "Email";
  }

  if (sourceType === "ocr_pdf") {
    return "OCR scanned PDF";
  }

  if (sourceType === "image") {
    return "Image";
  }

  if (sourceType === "voice_note") {
    return "Voice note";
  }

  if (sourceType === "voice_conversation") {
    return "Voice conversation";
  }

  if (sourceType === "github") {
    return "GitHub import";
  }

  if (sourceType === "browser_history") {
    return "Browser history";
  }

  if (sourceType === "chat_export") {
    return "Chat export";
  }

  if (sourceType === "slack_export") {
    return "Slack export";
  }

  if (sourceType === "whatsapp_export") {
    return "WhatsApp export";
  }

  return "Source";
}

function readConversationMemoryPolicy(content: string, sourceType: string): Record<string, unknown> | null {
  const attributionMarkersPresent =
    /(^|\n)(?:\[[^\]]+\]\s+)?(?:self|other|unknown|system)\/[^:\n]+:/i.test(content);
  const voiceDerived = sourceType === "voice_conversation";
  const conversationSource =
    voiceDerived || sourceType === "chat_export" || sourceType === "slack_export" || sourceType === "whatsapp_export";

  if (!attributionMarkersPresent && !conversationSource) {
    return null;
  }

  return {
    sourceKind: "conversation",
    conversationSourceType: sourceType,
    ...(voiceDerived ? { voiceDerived: true } : {}),
    ...(attributionMarkersPresent
      ? {
          attributionAware: true,
          speakerRolePolicy: "self_claims_only_for_user_memory",
        }
      : {}),
  };
}

function isSpeechToTextSource(sourceType: string): boolean {
  return sourceType === "voice_note" || sourceType === "voice_conversation";
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

function withProcessingState(
  metadata: Record<string, unknown>,
  processing: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...metadata,
    processing,
  };
}

function withIntelligenceState(
  metadata: Record<string, unknown>,
  intelligence: Record<string, unknown>,
): Record<string, unknown> {
  const processing = asRecord(metadata["processing"]);

  return {
    ...metadata,
    processing: {
      ...processing,
      intelligence,
    },
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readMetadataString(metadata: unknown, key: string): string | null {
  const value = asRecord(metadata)[key];

  return typeof value === "string" ? value : null;
}

function readCiphertextSha256(metadata: unknown): string | null {
  return readMetadataString(metadata, "ciphertextSha256");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown decrypt error";
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function approximateBase64Bytes(value: string): number {
  return Math.ceil((value.length * 3) / 4);
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
