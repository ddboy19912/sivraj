/**
 * Post-turn memory learning — enqueue completed chat turns for background ingestion.
 *
 * Stores an encrypted chat-export artifact and queues worker processing so durable
 * memories can be extracted from live conversations.
 */
import { auditEvents } from "@sivraj/db";
import type { ArtifactProcessingQueue } from "@sivraj/queue";
import type { ApiDb, PrivateMemoryStorage } from "../../app.js";
import type { ChatMemoryIntent, ChatThreadGate } from "../../types/chat.types.js";
import {
  enqueueArtifactProcessingJob,
  insertQueuedSourceArtifact,
  sha256Hex,
} from "../http/route-helpers.js";
import { shouldAttachTransientCiphertextBase64 } from "../artifacts/helpers.js";
import { errorMessage, titleFromMessage } from "./helpers.js";
import {
  buildChatTurnLearningArtifactContent,
  buildChatTurnLearningEncryptedStorageMetadata,
} from "./chat-learning-artifact.js";
import { loadCachedCoreCommsContext } from "./chat-cache.js";

export type EnqueueCompletedChatTurnLearningInput = {
  db: ApiDb;
  privateMemoryStorage?: PrivateMemoryStorage;
  artifactProcessingQueue?: ArtifactProcessingQueue;
  gate: ChatThreadGate;
  userMessage: string;
  assistantMessage: string;
  userMessageId: string;
  assistantMessageId: string;
  turnId: string | null;
  model: string | null;
  providerKind: string | null;
  memoryIntent: ChatMemoryIntent;
};

/** Queue a completed turn for worker-side memory extraction (skipped when storage is unset). */
export async function enqueueCompletedChatTurnLearning(
  input: EnqueueCompletedChatTurnLearningInput,
): Promise<void> {
  if (!input.privateMemoryStorage) {
    await recordChatLearningEvent(input.db, {
      twinId: input.gate.twinId,
      threadId: input.gate.thread.id,
      turnId: input.turnId,
      eventType: "chat.memory_learning.skipped",
      metadata: { reason: "private_memory_storage_not_configured" },
    });
    return;
  }
  try {
    const coreCommsContext = await loadCachedCoreCommsContext(input.db, input.gate.twinId);
    const content = buildChatTurnLearningArtifactContent({
      userMessage: input.userMessage,
      assistantMessage: input.assistantMessage,
      coreCommsContext,
    });
    const title = titleFromMessage(input.userMessage);
    const stored = await input.privateMemoryStorage.storePrivateMemory({
      twinId: input.gate.twinId,
      sourceType: "chat_export",
      title,
      content,
      metadata: {
        sourceKind: "live_chat_turn",
        threadId: input.gate.thread.id,
        turnId: input.turnId,
        userMessageId: input.userMessageId,
        assistantMessageId: input.assistantMessageId,
        providerKind: input.providerKind,
        model: input.model,
        memoryIntent: input.memoryIntent,
        attributionAware: true,
        speakerRolePolicy: "self_claims_only_for_user_memory",
        ...buildChatTurnLearningEncryptedStorageMetadata(),
      },
    });
    const artifact = await insertQueuedSourceArtifact({
      db: input.db,
      twinId: input.gate.twinId,
      sourceType: "chat_export",
      hash: sha256Hex(
        [
          "live_chat_turn",
          input.gate.thread.id,
          input.turnId ?? input.userMessageId,
          input.userMessage,
          input.assistantMessage,
        ].join("\n"),
      ),
      storageMetadata: {
        uploadKind: "live_chat_turn",
        sourceKind: "live_chat_turn",
        threadId: input.gate.thread.id,
        turnId: input.turnId,
        userMessageId: input.userMessageId,
        assistantMessageId: input.assistantMessageId,
        providerKind: input.providerKind,
        model: input.model,
        memoryIntent: input.memoryIntent,
        attributionAware: true,
        speakerRolePolicy: "self_claims_only_for_user_memory",
        ...buildChatTurnLearningEncryptedStorageMetadata(),
      },
      stored,
    });
    const queueResult = await enqueueArtifactProcessingJob({
      db: input.db,
      artifactProcessingQueue: input.artifactProcessingQueue,
      twinId: input.gate.twinId,
      artifactId: artifact.id,
      sourceType: "chat_export",
      ...(stored.encryptedBytesBase64 &&
      shouldAttachTransientCiphertextBase64(stored.encryptedBytesBase64)
        ? {
            transientCiphertext: {
              base64: stored.encryptedBytesBase64,
              sha256: stored.ciphertextSha256,
            },
          }
        : {}),
    });
    await recordChatLearningEvent(input.db, {
      twinId: input.gate.twinId,
      threadId: input.gate.thread.id,
      turnId: input.turnId,
      eventType: queueResult.warning
        ? "chat.memory_learning.queue_failed"
        : "chat.memory_learning.queued",
      resourceId: artifact.id,
      metadata: {
        artifactId: artifact.id,
        processingJobId: queueResult.processingJobId,
        warning: queueResult.warning,
      },
    });
  } catch (error) {
    console.warn("chat memory learning enqueue failed", {
      threadId: input.gate.thread.id,
      turnId: input.turnId,
      error: errorMessage(error),
    });
    await recordChatLearningEvent(input.db, {
      twinId: input.gate.twinId,
      threadId: input.gate.thread.id,
      turnId: input.turnId,
      eventType: "chat.memory_learning.failed",
      metadata: {
        errorMessage: errorMessage(error).slice(0, 500),
      },
    });
  }
}

async function recordChatLearningEvent(
  db: ApiDb,
  input: {
    twinId: string;
    threadId: string;
    turnId: string | null;
    eventType: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db
    .insert(auditEvents)
    .values({
      twinId: input.twinId,
      actorType: "system",
      actorId: "sivraj-chat",
      eventType: input.eventType,
      resourceType: input.resourceId ? "source_artifact" : "chat_thread",
      resourceId: input.resourceId ?? input.threadId,
      metadata: {
        threadId: input.threadId,
        turnId: input.turnId,
        ...input.metadata,
      },
    })
    .catch((error) => {
      console.warn("chat memory learning audit failed", {
        eventType: input.eventType,
        error: errorMessage(error),
      });
    });
}
