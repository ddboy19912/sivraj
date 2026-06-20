import { sourceArtifacts } from "@sivraj/db";
import { and, eq, inArray } from "drizzle-orm";
import type { ApiDb } from "../../app.js";
import { optionalString, readRecord } from "../http/route-helpers.js";
import { readIntelligenceStatus, readProcessingMetadata } from "../safe-metadata.js";
import type {
  ChatAttachmentMetadata,
  ChatAttachmentRef,
  ChatMessageRow,
  SourceArtifactRow,
} from "../../types/chat.types.js";

export function readFiniteNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function loadChatAttachmentArtifactStatuses(
  db: ApiDb,
  twinId: string,
  messages: ChatMessageRow[],
): Promise<Map<string, ChatAttachmentMetadata>> {
  const ids = Array.from(new Set(messages.flatMap(readChatMessageAttachmentIds)));

  if (ids.length === 0) {
    return new Map();
  }

  const rows = await db
    .select()
    .from(sourceArtifacts)
    .where(and(eq(sourceArtifacts.twinId, twinId), inArray(sourceArtifacts.id, ids)));

  return new Map(rows.map((artifact) => [
    artifact.id,
    buildChatAttachmentMetadata({ artifact }),
  ]));
}

export function hydrateChatMessageAttachmentMetadata(
  message: ChatMessageRow,
  artifactStatuses: Map<string, ChatAttachmentMetadata>,
): ChatMessageRow {
  const metadata = readRecord(message.metadata);
  const attachments = readChatMessageAttachments(metadata);

  if (attachments.length === 0) {
    return message;
  }

  return {
    ...message,
    metadata: {
      ...metadata,
      attachments: attachments.map((attachment) => ({
        ...(artifactStatuses.get(attachment.artifactId) ?? {}),
        ...attachment,
        status: artifactStatuses.get(attachment.artifactId)?.status ?? attachment.status,
        intelligenceStatus: artifactStatuses.get(attachment.artifactId)?.intelligenceStatus ??
          attachment.intelligenceStatus,
        processing: artifactStatuses.get(attachment.artifactId)?.processing ?? attachment.processing,
        updatedAt: artifactStatuses.get(attachment.artifactId)?.updatedAt ?? attachment.updatedAt,
      })),
    },
  };
}

export function readChatMessageAttachmentIds(message: ChatMessageRow): string[] {
  return readChatMessageAttachments(readRecord(message.metadata))
    .map((attachment) => attachment.artifactId);
}

export function readChatMessageAttachments(metadata: Record<string, unknown>): ChatAttachmentRef[] {
  const attachments = metadata["attachments"];

  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments.flatMap((value) => {
    const attachment = readRecord(value);
    const artifactId = optionalString(attachment["artifactId"]);

    return artifactId && isUuid(artifactId)
      ? [{
          ...attachment,
          artifactId,
        }]
      : [];
  });
}

export function buildChatAttachmentMetadata(input: {
  artifact: SourceArtifactRow;
  fileName?: string;
  fileType?: string | null;
  fileSize?: number | null;
}): ChatAttachmentMetadata {
  const metadata = readRecord(input.artifact.metadata);
  const fileName = input.fileName ?? optionalString(metadata["fileName"]) ?? input.artifact.sourceType;
  const fileType = input.fileType ?? optionalString(metadata["fileType"]);
  const fileSize = input.fileSize ?? readFiniteNonNegativeNumber(metadata["fileSize"]);

  return {
    artifactId: input.artifact.id,
    sourceType: input.artifact.sourceType,
    fileName,
    fileType,
    fileSize,
    status: input.artifact.ingestionStatus,
    intelligenceStatus: readIntelligenceStatus(input.artifact.metadata),
    processing: readProcessingMetadata(input.artifact.metadata),
    createdAt: input.artifact.createdAt.toISOString(),
    updatedAt: input.artifact.updatedAt.toISOString(),
  };
}
