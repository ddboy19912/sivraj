import type { SpeechToTextTranscriber } from "@sivraj/llm";
import type { PrivateMemoryReader } from "@sivraj/private-memory-reader";
import {
  finalizeParsedArtifactCompletion,
  getOrCreateMemoryFragment,
  markEmptyParsedArtifactFailure,
  markPrivateFragmentStorageRequired,
  parseAttributedProcessableContent,
  queueIntelligenceProcessing,
} from "./artifact-helpers.js";
import {
  ENCRYPTED_DECRYPTION_FAILED,
  ENCRYPTED_DECRYPTION_REQUIRED,
  ENCRYPTED_DECRYPTION_RETRYING,
  MISSING_PROCESSABLE_CONTENT,
  SPEECH_TO_TEXT_EMPTY,
  SPEECH_TO_TEXT_FAILED,
  SPEECH_TO_TEXT_REQUIRED,
} from "./constants.js";
import { RetryableArtifactProcessingError } from "./errors.js";
import { decodePrivateSourcePayload } from "./parse-content.js";
import { isRetryablePrivateMemoryReadError, readArtifactPrivateMemory } from "./private-memory.js";
import { readEmptyParseReason, readSourceLabel } from "./source-metadata.js";
import type {
  ArtifactProcessingRuntimeOptions,
  ArtifactRepository,
  PrivateSourcePayload,
  QueuedArtifact,
} from "../types/ingestion.types.js";
import {
  isEncryptedPrivateArtifact,
  isSpeechToTextSource,
  readPlaintextProcessingInput,
} from "./artifact-metadata.js";
import { errorMessage } from "./errors.js";
import { asRecord, readMetadataString } from "./metadata-utils.js";
import { withProcessingState } from "./processing-metadata.js";

type ArtifactOutcome = "completed" | "pending" | "failed";

async function markDecryptionRequired(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  metadata: Record<string, unknown>,
  now: Date,
): Promise<"pending"> {
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

async function markMissingPlaintextContent(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  metadata: Record<string, unknown>,
  now: Date,
): Promise<"failed"> {
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

async function handleDecryptionRetry(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  metadata: Record<string, unknown>,
  now: Date,
  detail: string,
): Promise<never> {
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

async function handleDecryptionFailure(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  metadata: Record<string, unknown>,
  now: Date,
  detail: string,
): Promise<null> {
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
}

async function decryptEncryptedArtifact(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  metadata: Record<string, unknown>,
  now: Date,
  privateMemoryReader: PrivateMemoryReader,
  options: ArtifactProcessingRuntimeOptions,
): Promise<string | null> {
  return readArtifactPrivateMemory({
    privateMemoryReader,
    artifact,
    metadata,
    transientCiphertextBase64: options.transientCiphertextBase64,
    transientCiphertextSha256: options.transientCiphertextSha256,
  }).catch(async (error: unknown) => {
    const detail = errorMessage(error);

    if (isRetryablePrivateMemoryReadError(error)) {
      return handleDecryptionRetry(repository, artifact, metadata, now, detail);
    }

    return handleDecryptionFailure(repository, artifact, metadata, now, detail);
  });
}

async function markSpeechToTextRequired(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  metadata: Record<string, unknown>,
  now: Date,
): Promise<"pending"> {
  const sourceLabel = artifact.sourceType === "voice_conversation" ? "Voice conversation" : "Voice note";
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

async function transcribeEncryptedAudio(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  metadata: Record<string, unknown>,
  now: Date,
  speechToTextTranscriber: SpeechToTextTranscriber,
  privatePayload: PrivateSourcePayload,
): Promise<{ text: string; provider: string; model: string; metadata?: Record<string, unknown> } | null> {
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
    return null;
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
    return null;
  }

  return {
    text: transcript,
    provider: transcription.provider,
    model: transcription.model,
    metadata: transcription.metadata,
  };
}

async function completeSpeechToTextArtifact(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  metadata: Record<string, unknown>,
  now: Date,
  options: ArtifactProcessingRuntimeOptions,
  transcript: { text: string; provider: string; model: string; metadata?: Record<string, unknown> },
): Promise<ArtifactOutcome> {
  if (!options.privateFragmentStorage) {
    await markPrivateFragmentStorageRequired(repository, artifact, metadata, now);
    return "pending";
  }

  const fragment = await getOrCreateMemoryFragment(repository, {
    twinId: artifact.twinId,
    sourceArtifactId: artifact.id,
    content: transcript.text,
    sourceRepresentedContent: transcript.text,
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
      provider: transcript.provider,
      model: transcript.model,
      transcriptLength: transcript.text.length,
      ...(transcript.metadata ? { metadata: transcript.metadata } : {}),
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
        provider: transcript.provider,
        model: transcript.model,
        transcriptLength: transcript.text.length,
      },
    },
  });

  return "completed";
}

async function processEncryptedSpeechToText(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  metadata: Record<string, unknown>,
  now: Date,
  options: ArtifactProcessingRuntimeOptions,
  privatePayload: PrivateSourcePayload,
): Promise<ArtifactOutcome> {
  if (!options.speechToTextTranscriber) {
    return markSpeechToTextRequired(repository, artifact, metadata, now);
  }

  const transcript = await transcribeEncryptedAudio(
    repository,
    artifact,
    metadata,
    now,
    options.speechToTextTranscriber,
    privatePayload,
  );

  if (transcript === null) {
    return "failed";
  }

  return completeSpeechToTextArtifact(repository, artifact, metadata, now, options, transcript);
}

async function processEncryptedParsedContent(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  metadata: Record<string, unknown>,
  now: Date,
  options: ArtifactProcessingRuntimeOptions,
  privatePayload: PrivateSourcePayload,
): Promise<ArtifactOutcome> {
  const attributed = await parseAttributedProcessableContent(
    repository,
    artifact,
    privatePayload,
    metadata,
    now,
  );

  if (!attributed) {
    return "failed";
  }

  if (attributed.content.length > 0) {
    return finalizeParsedArtifactCompletion(
      repository,
      artifact,
      metadata,
      now,
      options,
      attributed,
      {
        confidenceScore: 0.7,
        sourceRepresentedContent: privatePayload.content,
        requirePrivateFragmentStorage: true,
        processingStateExtras: { decryptPath: "seal_walrus" },
        auditMetadataExtras: {
          decryptPath: "seal_walrus",
          rawStorageRef: artifact.rawStorageRef,
        },
      },
    );
  }

  const emptyParseReason = readEmptyParseReason(artifact.sourceType);

  if (emptyParseReason) {
    return markEmptyParsedArtifactFailure(
      repository,
      artifact,
      metadata,
      now,
      attributed,
      {
        reason: emptyParseReason,
        detail: `${readSourceLabel(artifact.sourceType)} artifact did not produce retrievable text after parsing.`,
        includeRawStorageRef: true,
      },
    );
  }

  return "failed";
}

async function processEncryptedPrivateArtifact(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  metadata: Record<string, unknown>,
  now: Date,
  options: ArtifactProcessingRuntimeOptions,
): Promise<ArtifactOutcome> {
  const { privateMemoryReader } = options;

  if (!privateMemoryReader || !artifact.rawStorageRef) {
    return markDecryptionRequired(repository, artifact, metadata, now);
  }

  const plaintext = await decryptEncryptedArtifact(
    repository,
    artifact,
    metadata,
    now,
    privateMemoryReader,
    options,
  );

  if (plaintext === null) {
    return "failed";
  }

  const privatePayload = decodePrivateSourcePayload(plaintext);
  const enrichedMetadata = enrichArtifactMetadataFromPrivatePayload(metadata, privatePayload);

  if (isSpeechToTextSource(artifact.sourceType)) {
    return processEncryptedSpeechToText(repository, artifact, enrichedMetadata, now, options, privatePayload);
  }

  return processEncryptedParsedContent(repository, artifact, enrichedMetadata, now, options, privatePayload);
}

async function processPlaintextArtifact(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  metadata: Record<string, unknown>,
  now: Date,
  options: ArtifactProcessingRuntimeOptions,
  plaintext: string,
): Promise<ArtifactOutcome> {
  const attributed = await parseAttributedProcessableContent(
    repository,
    artifact,
    {
      content: plaintext,
      title: null,
      metadata,
    },
    metadata,
    now,
  );

  if (!attributed) {
    return "failed";
  }

  if (!attributed.content) {
    const emptyReason = readEmptyParseReason(artifact.sourceType);

    return markEmptyParsedArtifactFailure(
      repository,
      artifact,
      metadata,
      now,
      attributed,
      {
        reason: emptyReason ?? MISSING_PROCESSABLE_CONTENT,
        detail: emptyReason
          ? `${readSourceLabel(artifact.sourceType)} artifact did not produce retrievable text after parsing.`
          : "No plaintext processing input was available for this non-encrypted artifact.",
      },
    );
  }

  return finalizeParsedArtifactCompletion(
    repository,
    artifact,
    metadata,
    now,
    options,
    attributed,
    {
      confidenceScore: 0.6,
      sourceRepresentedContent: plaintext,
    },
  );
}

export async function processClaimedArtifact(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  now: Date,
  options: ArtifactProcessingRuntimeOptions,
): Promise<ArtifactOutcome> {
  const metadata = asRecord(artifact.metadata);

  if (isEncryptedPrivateArtifact(metadata)) {
    return processEncryptedPrivateArtifact(repository, artifact, metadata, now, options);
  }

  const plaintext = readPlaintextProcessingInput(metadata);

  if (!plaintext) {
    return markMissingPlaintextContent(repository, artifact, metadata, now);
  }

  return processPlaintextArtifact(repository, artifact, metadata, now, options, plaintext);
}

function enrichArtifactMetadataFromPrivatePayload(
  metadata: Record<string, unknown>,
  payload: PrivateSourcePayload,
): Record<string, unknown> {
  const safePayloadMetadata = readSafeAgentInstructionPayloadMetadata(payload.metadata);

  return Object.keys(safePayloadMetadata).length > 0
    ? { ...metadata, ...safePayloadMetadata }
    : metadata;
}

function readSafeAgentInstructionPayloadMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const existingSourceKind = readMetadataString(metadata, "engineeringSourceKind");
  const existingTarget = readMetadataString(metadata, "targetInstructionFile");
  const fileName = readMetadataString(metadata, "agentInstructionFileName") ??
    readMetadataString(metadata, "fileName") ??
    readMetadataString(metadata, "path");
  const inferredTarget = existingTarget ?? (fileName ? inferAgentInstructionTargetFile(fileName) : null);

  if (existingSourceKind !== "agent_instruction_file" && !inferredTarget) {
    return {};
  }

  return {
    artifactPurpose: "agent_skill_source",
    engineeringSourceKind: "agent_instruction_file",
    ...(inferredTarget ? { targetInstructionFile: inferredTarget } : {}),
    ...(fileName ? { agentInstructionFileName: safeInstructionFileName(fileName) } : {}),
    ...(readMetadataString(metadata, "agentInstructionOrigin")
      ? { agentInstructionOrigin: readMetadataString(metadata, "agentInstructionOrigin") }
      : {}),
    ...(readMetadataString(metadata, "uploadSurface")
      ? { uploadSurface: readMetadataString(metadata, "uploadSurface") }
      : {}),
  };
}

function inferAgentInstructionTargetFile(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/\\/gu, "/")
    .replace(/\/+/gu, "/")
    .toLowerCase();

  if (!normalized) {
    return null;
  }

  if (normalized.endsWith("claude.md")) {
    return "CLAUDE.md";
  }

  if (normalized.endsWith("skill.md")) {
    return "SKILL.md";
  }

  if (normalized.endsWith(".cursorrules")) {
    return ".cursorrules";
  }

  if (
    normalized === ".github/copilot-instructions.md" ||
    normalized.endsWith("/.github/copilot-instructions.md")
  ) {
    return ".github/copilot-instructions.md";
  }

  if (normalized.endsWith(".mdc")) {
    return ".cursor/rules/sivraj.mdc";
  }

  if (normalized.endsWith("agents.md") || normalized.endsWith("agent.md")) {
    return "AGENTS.md";
  }

  return null;
}

function safeInstructionFileName(value: string): string {
  const basename = value
    .replace(/\\/gu, "/")
    .split("/")
    .filter(Boolean)
    .at(-1) ?? value;

  return basename
    .replace(/["\r\n]/gu, "")
    .trim()
    .slice(0, 160) || "agent-skill.md";
}
