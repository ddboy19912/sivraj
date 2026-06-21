import type { SourceType } from "@/lib/encryption";
import type { ChatMessage, ChatMessageAttachment } from "@/lib/chat/chat-api";
import {
  agentInstructionMetadataForFile,
  sourceDisplayMetadataForFileName,
} from "@/lib/ingest/agent-instruction-source";
import { inferUploadSourceType } from "@/lib/ingest/upload-source-type";

const BINARY_SOURCE_TYPES = new Set<SourceType>(["pdf", "ocr_pdf", "image"]);
const MAX_CHAT_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export type ChatAttachmentArtifact = {
  sourceType: SourceType;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
};

export async function buildChatAttachmentArtifact(
  file: File,
): Promise<ChatAttachmentArtifact> {
  if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
    throw new Error("Files must be 50 MB or smaller.");
  }

  const sourceType = inferUploadSourceType(file);
  const content = BINARY_SOURCE_TYPES.has(sourceType)
    ? await readFileAsDataUrl(file)
    : await readFileAsText(file);

  return {
    sourceType,
    title: file.name,
    content,
    metadata: {
      uploadSurface: "chat",
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || "application/octet-stream",
      lastModified: new Date(file.lastModified).toISOString(),
      ...sourceDisplayMetadataForFileName(file.name),
      ...agentInstructionMetadataForFile(file),
    },
  };
}

export function readChatMessageAttachments(
  message: ChatMessage,
): ChatMessageAttachment[] {
  const metadata = readRecord(message.metadata);
  const attachments = metadata["attachments"];

  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments.flatMap((value) => {
    const attachment = readRecord(value);
    const artifactId = readString(attachment["artifactId"]);
    const sourceType = readString(attachment["sourceType"]);
    const fileName = readString(attachment["fileName"]);
    const status = readArtifactStatus(attachment["status"]);

    if (!artifactId || !sourceType || !fileName || !status) {
      return [];
    }

    return [
      {
        artifactId,
        sourceType,
        fileName,
        fileType: readString(attachment["fileType"]),
        fileSize: readNumber(attachment["fileSize"]),
        status,
        intelligenceStatus: readArtifactIntelligenceStatus(
          attachment["intelligenceStatus"],
        ),
        processing: readRecordOrNull(attachment["processing"]),
        createdAt: readString(attachment["createdAt"]) ?? undefined,
        updatedAt: readString(attachment["updatedAt"]) ?? undefined,
        localPreviewUrl: readString(attachment["localPreviewUrl"]) ?? undefined,
      },
    ];
  });
}

export function attachLocalPreviewUrlToMessage(
  message: ChatMessage,
  artifactId: string,
  localPreviewUrl: string,
): ChatMessage {
  const metadata = readRecord(message.metadata);
  const attachments = readChatMessageAttachments(message).map((attachment) =>
    attachment.artifactId === artifactId
      ? { ...attachment, localPreviewUrl }
      : attachment,
  );

  return {
    ...message,
    metadata: {
      ...metadata,
      attachments,
    },
  };
}

export function formatChatAttachmentStatus(
  attachment: ChatMessageAttachment,
): string {
  if (readAttachmentArchiveFailure(attachment.processing)) {
    return "Memory archive blocked";
  }

  if (attachment.status === "failed") {
    return "Failed";
  }

  if (attachment.status === "cancelled") {
    return "Cancelled";
  }

  if (attachment.status === "completed") {
    return "Ready";
  }

  const progress = readAttachmentIndexingProgress(attachment.processing);
  if (progress) {
    return `Indexing ${progress.embedded}/${progress.total} chunks`;
  }

  return attachment.status === "queued" || attachment.status === "pending"
    ? "Queued"
    : "Indexing";
}

function readAttachmentArchiveFailure(
  processing: Record<string, unknown> | null | undefined,
): boolean {
  const candidateMemoryArchive = readRecord(
    processing?.["candidateMemoryArchive"],
  );
  return candidateMemoryArchive["status"] === "failed";
}

function readAttachmentIndexingProgress(
  processing: Record<string, unknown> | null | undefined,
): { embedded: number; total: number } | null {
  const documentIndex = readRecord(processing?.["documentIndex"]);
  const embedded = readNumber(documentIndex["embeddedChunks"]);
  const total = readNumber(documentIndex["chunkCount"]);

  return embedded !== null && total !== null && total > 0
    ? { embedded: Math.max(0, Math.round(embedded)), total: Math.round(total) }
    : null;
}

function readFileAsText(file: File) {
  return readFile(file, "text");
}

function readFileAsDataUrl(file: File) {
  return readFile(file, "dataUrl");
}

function readFile(file: File, mode: "text" | "dataUrl"): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("The selected file could not be read."));
    });
    reader.addEventListener("error", () => {
      reject(new Error("The selected file could not be read."));
    });

    if (mode === "dataUrl") {
      reader.readAsDataURL(file);
      return;
    }

    reader.readAsText(file);
  });
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readRecordOrNull(value: unknown): Record<string, unknown> | null {
  const record = readRecord(value);
  return Object.keys(record).length > 0 ? record : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readArtifactStatus(
  value: unknown,
): ChatMessageAttachment["status"] | null {
  return value === "pending" ||
    value === "queued" ||
    value === "processing" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
    ? value
    : null;
}

function readArtifactIntelligenceStatus(
  value: unknown,
): ChatMessageAttachment["intelligenceStatus"] {
  return value === "pending" ||
    value === "queued" ||
    value === "processing" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled" ||
    value === "skipped"
    ? value
    : null;
}
