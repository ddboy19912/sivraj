import {
  DEFAULT_MANUAL_MEMORY_SENSITIVITY,
  ENCRYPTED_WALRUS_STORAGE_MODE,
} from "@sivraj/core";
import {
  auditEvents,
  candidateMemories,
  sourceArtifacts,
  userFeedbackEvents,
} from "@sivraj/db";
import { and, eq } from "drizzle-orm";
import type { AppDependencies } from "../../app.js";
import { readRecord } from "../http/route-helpers.js";

export type ConversationReviewGate = {
  twinId: string;
  auth: { type: string; sub: string };
  artifact: { id: string };
};

export function conversationReviewFeedbackType(action: "approve" | "reject") {
  return action === "reject" ? "rejected" : "approved";
}

export function buildApprovedVoiceMemoryMetadata(input: {
  sourceArtifactId: string;
  candidate: Pick<typeof candidateMemories.$inferSelect, "id" | "memoryType" | "metadata">;
  statement: string;
}) {
  const metadata = readRecord(input.candidate.metadata);

  return {
    statement: input.statement,
    metadata: {
      uploadKind: "approved_voice_conversation_memory",
      sourceArtifactId: input.sourceArtifactId,
      sourceCandidateMemoryId: input.candidate.id,
      memoryType: input.candidate.memoryType,
      subject: typeof metadata["subject"] === "string" ? metadata["subject"] : null,
      voiceDerived: true,
      reviewApproved: true,
      storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
      sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
    },
  };
}

export function buildConversationReviewResult(input: {
  candidateId: string;
  action: "approve" | "reject";
  status: string;
  approvedArtifactId?: string | null;
  processingJobId?: string | null;
}) {
  return {
    candidateId: input.candidateId,
    action: input.action,
    status: input.status,
    approvedArtifactId: input.approvedArtifactId ?? null,
    processingJobId: input.processingJobId ?? null,
  };
}

export function isVoiceConversationCandidate(metadata: unknown) {
  const record = readRecord(metadata);
  const conversationUnderstanding = readRecord(record["conversationUnderstanding"]);

  return record["voiceDerived"] === true ||
    record["conversationSourceType"] === "voice_conversation" ||
    conversationUnderstanding["sourceType"] === "voice_conversation";
}

export function conversationReviewNotFoundResult(candidateId: string) {
  return {
    result: {
      candidateId,
      status: "not_found",
    },
  };
}

export function shouldCreateEditedApprovalArtifact(input: {
  action: "approve" | "reject";
  editedStatement?: string;
}) {
  return input.action === "approve" && Boolean(input.editedStatement);
}

export function buildApprovedArtifactInsertMetadata(input: {
  sourceArtifactId: string;
  sourceCandidateMemoryId: string;
  stored: {
    ciphertextSha256: string;
    seal: unknown;
    walrus: unknown;
  };
}) {
  return {
    uploadKind: "approved_voice_conversation_memory",
    sourceArtifactId: input.sourceArtifactId,
    sourceCandidateMemoryId: input.sourceCandidateMemoryId,
    voiceDerived: true,
    reviewApproved: true,
    storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
    sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
    ciphertextSha256: input.stored.ciphertextSha256,
    seal: input.stored.seal,
    walrus: input.stored.walrus,
  };
}

function buildConversationReviewFeedbackMetadata(input: {
  sourceArtifactId: string;
  editedStatement?: string;
}) {
  return {
    surface: "voice_conversation_review",
    sourceArtifactId: input.sourceArtifactId,
    hasEditedStatement: Boolean(input.editedStatement),
  };
}

export function resolveConversationReviewCounters(input: {
  action: "approve" | "reject";
  editedArtifactCreated: boolean;
}) {
  return {
    approvedCount: input.action === "approve" ? 1 : 0,
    rejectedCount: input.action === "reject" ? 1 : 0,
    editedArtifactCount: input.editedArtifactCreated ? 1 : 0,
  };
}

export function readEditedApprovalStorageError(
  privateMemoryStorage: AppDependencies["privateMemoryStorage"],
) {
  return privateMemoryStorage
    ? null
    : { status: 503 as const, body: { error: "encrypted_storage_not_configured" } };
}

export function readApprovedArtifactStorageFailure(
  stored: { rawStorageRef: string } | null,
) {
  return stored
    ? null
    : { status: 503 as const, body: { error: "encrypted_storage_failed" } };
}

export async function storeApprovedConversationMemory(input: {
  privateMemoryStorage: NonNullable<AppDependencies["privateMemoryStorage"]>;
  twinId: string;
  approvedMetadata: ReturnType<typeof buildApprovedVoiceMemoryMetadata>;
}) {
  return input.privateMemoryStorage.storePrivateMemory({
    twinId: input.twinId,
    sourceType: "note",
    title: "Approved voice conversation memory",
    content: input.approvedMetadata.statement,
    metadata: input.approvedMetadata.metadata,
  }).catch((error: unknown) => {
    console.error("approved conversation memory encrypted storage failed", error);
    return null;
  });
}

export async function enqueueApprovedArtifactProcessing(input: {
  artifactProcessingQueue: AppDependencies["artifactProcessingQueue"];
  artifact: { id: string } | undefined;
  twinId: string;
}) {
  if (!input.artifact || !input.artifactProcessingQueue) {
    return null;
  }

  return input.artifactProcessingQueue.enqueueArtifactProcessing({
    artifactId: input.artifact.id,
    twinId: input.twinId,
    sourceType: "note",
  }).catch((error: unknown) => {
    console.error("approved conversation memory queue failed", error);
    return null;
  });
}

export async function createApprovedConversationMemoryArtifact(input: {
  db: AppDependencies["db"];
  privateMemoryStorage: NonNullable<AppDependencies["privateMemoryStorage"]>;
  artifactProcessingQueue: AppDependencies["artifactProcessingQueue"];
  twinId: string;
  sourceArtifactId: string;
  candidate: typeof candidateMemories.$inferSelect;
  statement: string;
}): Promise<{ artifactId: string; processingJobId: string | null } | null> {
  const approvedMetadata = buildApprovedVoiceMemoryMetadata({
    sourceArtifactId: input.sourceArtifactId,
    candidate: input.candidate,
    statement: input.statement,
  });
  const stored = await storeApprovedConversationMemory({
    privateMemoryStorage: input.privateMemoryStorage,
    twinId: input.twinId,
    approvedMetadata,
  });

  if (!stored) {
    return null;
  }

  const [artifact] = await input.db
    .insert(sourceArtifacts)
    .values({
      twinId: input.twinId,
      sourceType: "note",
      rawStorageRef: stored.rawStorageRef,
      ingestionStatus: "queued",
      metadata: buildApprovedArtifactInsertMetadata({
        sourceArtifactId: input.sourceArtifactId,
        sourceCandidateMemoryId: input.candidate.id,
        stored,
      }),
    })
    .returning({
      id: sourceArtifacts.id,
      ingestionStatus: sourceArtifacts.ingestionStatus,
    });

  const queued = await enqueueApprovedArtifactProcessing({
    artifactProcessingQueue: input.artifactProcessingQueue,
    artifact,
    twinId: input.twinId,
  });

  await input.db.insert(auditEvents).values({
    twinId: input.twinId,
    actorType: "system",
    actorId: "sivraj-api",
    eventType: "conversation.approved_memory.stored",
    resourceType: "source_artifact",
    resourceId: artifact?.id ?? input.sourceArtifactId,
    metadata: {
      sourceArtifactId: input.sourceArtifactId,
      sourceCandidateMemoryId: input.candidate.id,
      rawStorageRef: stored.rawStorageRef,
      processingJobId: queued?.jobId ?? null,
    },
  });

  return artifact ? { artifactId: artifact.id, processingJobId: queued?.jobId ?? null } : null;
}

export async function applyConversationReviewAction(input: {
  db: AppDependencies["db"];
  privateMemoryStorage: AppDependencies["privateMemoryStorage"];
  artifactProcessingQueue: AppDependencies["artifactProcessingQueue"];
  gate: ConversationReviewGate;
  action: {
    candidateId: string;
    action: "approve" | "reject";
    editedStatement?: string;
  };
  candidate: typeof candidateMemories.$inferSelect | null;
}) {
  if (!input.candidate) {
    return conversationReviewNotFoundResult(input.action.candidateId);
  }

  let approvedArtifact: Awaited<ReturnType<typeof createApprovedConversationMemoryArtifact>> | null = null;

  if (shouldCreateEditedApprovalArtifact(input.action)) {
    const storageError = readEditedApprovalStorageError(input.privateMemoryStorage);

    if (storageError) {
      return { error: storageError };
    }

    approvedArtifact = await createApprovedConversationMemoryArtifact({
      db: input.db,
      privateMemoryStorage: input.privateMemoryStorage!,
      artifactProcessingQueue: input.artifactProcessingQueue,
      twinId: input.gate.twinId,
      sourceArtifactId: input.gate.artifact.id,
      candidate: input.candidate,
      statement: input.action.editedStatement!,
    });

    if (!approvedArtifact) {
      return { error: readApprovedArtifactStorageFailure(null)! };
    }
  }

  const feedbackType = conversationReviewFeedbackType(input.action.action);
  const [updated] = await input.db
    .update(candidateMemories)
    .set({
      status: feedbackType,
      updatedAt: new Date(),
    })
    .where(and(
      eq(candidateMemories.id, input.candidate.id),
      eq(candidateMemories.twinId, input.gate.twinId),
    ))
    .returning({ status: candidateMemories.status });

  await input.db.insert(userFeedbackEvents).values({
    twinId: input.gate.twinId,
    targetType: "candidate_memory",
    targetId: input.candidate.id,
    feedbackType,
    actorType: input.gate.auth.type,
    actorId: input.gate.auth.sub,
    metadata: buildConversationReviewFeedbackMetadata({
      sourceArtifactId: input.gate.artifact.id,
      editedStatement: input.action.editedStatement,
    }),
  });

  return {
    approved: input.action.action === "approve",
    rejected: input.action.action === "reject",
    editedArtifact: approvedArtifact,
    result: buildConversationReviewResult({
      candidateId: input.candidate.id,
      action: input.action.action,
      status: updated?.status ?? feedbackType,
      approvedArtifactId: approvedArtifact?.artifactId ?? null,
      processingJobId: approvedArtifact?.processingJobId ?? null,
    }),
  };
}
