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
  type ParserMetadata,
} from "@sivraj/ingestion";
import type { SpeechToTextTranscriber } from "@sivraj/llm";

export type IngestionStatus = "pending" | "queued" | "processing" | "completed" | "failed" | "cancelled";

export type QueuedArtifact = {
  id: string;
  twinId: string;
  sourceType: string;
  rawStorageRef: string | null;
  metadata: unknown;
};

export type ArtifactRepository = {
  findQueuedArtifacts(limit: number): Promise<QueuedArtifact[]>;
  claimArtifact(id: string): Promise<QueuedArtifact | null>;
  claimRecoverableArtifact(id: string): Promise<QueuedArtifact | null>;
  markArtifactPending(id: string, metadata: Record<string, unknown>): Promise<void>;
  markArtifactCompleted(id: string, metadata: Record<string, unknown>): Promise<void>;
  markArtifactFailed(id: string, metadata: Record<string, unknown>): Promise<void>;
  findMemoryFragmentBySourceArtifactId(sourceArtifactId: string): Promise<{ id: string } | null>;
  createMemoryFragment(input: {
    twinId: string;
    sourceArtifactId: string;
    contentStorageRef: string;
    contentSha256?: string | null;
    metadata?: Record<string, unknown> | null;
    importanceScore: number;
    confidenceScore: number;
  }): Promise<{ id: string }>;
  createAuditEvent(input: {
    twinId: string;
    eventType: string;
    resourceId: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
};

export type PrivateMemoryReader = {
  readPrivateMemory(input: {
    rawStorageRef: string;
    artifactId: string;
    twinId: string;
    expectedCiphertextSha256?: string | null;
  }): Promise<string>;
};

export type PrivateFragmentStorage = {
  storePrivateFragment(input: {
    twinId: string;
    sourceArtifactId: string;
    sourceType: string;
    content: string;
  }): Promise<{
    contentStorageRef: string;
    contentSha256: string;
    metadata: Record<string, unknown>;
  }>;
};

type PrivateSourcePayload = {
  content: string;
  title: string | null;
  metadata: Record<string, unknown>;
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
  },
): Promise<"completed" | "pending" | "failed"> {
  const metadata = asRecord(artifact.metadata);

  if (isEncryptedPrivateArtifact(metadata)) {
    const { privateMemoryReader, speechToTextTranscriber } = options;

    if (privateMemoryReader && artifact.rawStorageRef) {
      const plaintext = await privateMemoryReader
        .readPrivateMemory({
          rawStorageRef: artifact.rawStorageRef,
          artifactId: artifact.id,
          twinId: artifact.twinId,
          expectedCiphertextSha256: readCiphertextSha256(metadata),
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
        const nextMetadata = withProcessingState(metadata, {
          status: "completed",
          memoryFragmentId: fragment.id,
          processedAt: now.toISOString(),
          decryptPath: "seal_walrus",
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

      if (parsed.content.length > 0) {
        if (!options.privateFragmentStorage) {
          await markPrivateFragmentStorageRequired(repository, artifact, metadata, now);
          return "pending";
        }

        const fragment = await getOrCreateMemoryFragment(repository, {
          twinId: artifact.twinId,
          sourceArtifactId: artifact.id,
          content: parsed.content,
          privateFragmentStorage: options.privateFragmentStorage,
          sourceType: artifact.sourceType,
          importanceScore: 0.5,
          confidenceScore: 0.7,
        });
        const nextMetadata = withProcessingState(metadata, {
          status: "completed",
          memoryFragmentId: fragment.id,
          processedAt: now.toISOString(),
          decryptPath: "seal_walrus",
          ...(parsed.parser ? { parser: parsed.parser } : {}),
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
            ...(parsed.parser ? { parser: parsed.parser } : {}),
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
          ...(parsed.parser ? { parser: parsed.parser } : {}),
        });

        await repository.markArtifactFailed(artifact.id, nextMetadata);
        await repository.createAuditEvent({
          twinId: artifact.twinId,
          eventType: "artifact.processing_failed",
          resourceId: artifact.id,
          metadata: {
            reason: emptyParseReason,
            rawStorageRef: artifact.rawStorageRef,
            ...(parsed.parser ? { parser: parsed.parser } : {}),
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

  if (!parsed.content) {
    const reason = readEmptyParseReason(artifact.sourceType) ?? MISSING_PROCESSABLE_CONTENT;
    const nextMetadata = withProcessingState(metadata, {
      status: "failed",
      reason,
      detail: readEmptyParseReason(artifact.sourceType)
        ? `${readSourceLabel(artifact.sourceType)} artifact did not produce retrievable text after parsing.`
        : "No plaintext processing input was available for this non-encrypted artifact.",
      processedAt: now.toISOString(),
      ...(parsed.parser ? { parser: parsed.parser } : {}),
    });

    await repository.markArtifactFailed(artifact.id, nextMetadata);
    await repository.createAuditEvent({
      twinId: artifact.twinId,
      eventType: "artifact.processing_failed",
      resourceId: artifact.id,
      metadata: {
        reason,
        ...(parsed.parser ? { parser: parsed.parser } : {}),
      },
    });
    return "failed";
  }

  const fragment = await getOrCreateMemoryFragment(repository, {
    twinId: artifact.twinId,
    sourceArtifactId: artifact.id,
    content: parsed.content,
    privateFragmentStorage: options.privateFragmentStorage,
    sourceType: artifact.sourceType,
    importanceScore: 0.5,
    confidenceScore: 0.6,
  });
  const nextMetadata = withProcessingState(metadata, {
    status: "completed",
    memoryFragmentId: fragment.id,
    processedAt: now.toISOString(),
    ...(parsed.parser ? { parser: parsed.parser } : {}),
  });

  await repository.markArtifactCompleted(artifact.id, nextMetadata);
  await repository.createAuditEvent({
    twinId: artifact.twinId,
    eventType: "artifact.processed",
    resourceId: artifact.id,
    metadata: {
      memoryFragmentId: fragment.id,
      ...(parsed.parser ? { parser: parsed.parser } : {}),
    },
  });
  return "completed";
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

async function getOrCreateMemoryFragment(
  repository: ArtifactRepository,
  input: {
    twinId: string;
    sourceArtifactId: string;
    content: string;
    importanceScore: number;
    confidenceScore: number;
    privateFragmentStorage?: PrivateFragmentStorage;
    sourceType?: string;
  },
) {
  const existing = await repository.findMemoryFragmentBySourceArtifactId(input.sourceArtifactId);

  if (existing) {
    return existing;
  }

  if (!input.privateFragmentStorage) {
    throw new Error("Encrypted fragment storage is required before creating memory fragments");
  }

  const stored = await input.privateFragmentStorage.storePrivateFragment({
    twinId: input.twinId,
    sourceArtifactId: input.sourceArtifactId,
    sourceType: input.sourceType ?? "unknown",
    content: input.content,
  });

  return repository.createMemoryFragment({
    twinId: input.twinId,
    sourceArtifactId: input.sourceArtifactId,
    contentStorageRef: stored.contentStorageRef,
    contentSha256: stored.contentSha256,
    metadata: stored.metadata,
    importanceScore: input.importanceScore,
    confidenceScore: input.confidenceScore,
  });
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

async function parseProcessableContent(
  artifact: QueuedArtifact,
  payload: PrivateSourcePayload,
): Promise<{ content: string; parser?: ParserMetadata }> {
  switch (artifact.sourceType) {
    case "markdown": {
      const parsed = parseMarkdown({
        content: payload.content,
        title: payload.title,
      });

      return {
        content: parsed.content,
        parser: parsed.parser,
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
