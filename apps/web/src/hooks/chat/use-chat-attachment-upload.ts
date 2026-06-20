import { useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { buildClientEncryptedArtifactBody } from "@/lib/encryption";
import {
  attachLocalPreviewUrlToMessage,
  buildChatAttachmentArtifact,
  readChatMessageAttachments,
} from "@/lib/chat/chat-attachments";
import {
  createThreadAttachmentMessage,
  getArtifactPreviewBlob,
  streamArtifactStatus,
  uploadArtifact,
  type ArtifactStatusEvent,
  type ChatMessage,
  type ChatMessageAttachment,
  type ChatThread,
} from "@/lib/chat/chat-api";
import { inferUploadSourceType } from "@/lib/ingest/upload-source-type";
import {
  chatErrorNotice,
  createChatThread,
  prependThread,
} from "@/lib/chat/chat-page-actions";
import type { Session } from "@/lib/session";
import type { ChatAttachmentUploadStatus, ChatNotice } from "@/types/chat.types";

type ChatAttachmentUploadInput = {
  session: Session | null;
  activeThreadId: string | null;
  onSessionRefreshed: (session: Session) => void;
  setActiveThreadId: Dispatch<SetStateAction<string | null>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setThreads: Dispatch<SetStateAction<ChatThread[]>>;
  setNotice: Dispatch<SetStateAction<ChatNotice>>;
};

const IDLE_UPLOAD_STATUS: ChatAttachmentUploadStatus = {
  phase: "idle",
  fileName: null,
};
const ARTIFACT_STATUS_TIMEOUT_MS = 10 * 60_000;

export function useChatAttachmentUpload(input: ChatAttachmentUploadInput) {
  const [attachmentUploadStatus, setAttachmentUploadStatus] =
    useState<ChatAttachmentUploadStatus>(IDLE_UPLOAD_STATUS);
  const statusStreamAbortRef = useRef<AbortController | null>(null);
  const [localPreviewUrls] = useState(() => new Set<string>());

  useEffect(() => {
    return () => {
      abortStatusStream(statusStreamAbortRef);
      for (const url of localPreviewUrls) {
        URL.revokeObjectURL(url);
      }
      localPreviewUrls.clear();
    };
  }, [localPreviewUrls]);

  async function attachFiles(files: FileList | null) {
    const file = files?.item(0);

    if (!file || !input.session || attachmentUploadStatus.phase !== "idle") {
      return;
    }

    statusStreamAbortRef.current?.abort();
    statusStreamAbortRef.current = null;
    let statusWatchTimedOut = false;
    let reachedSearchableReadiness = false;
    let statusWatchTimeout: number | null = null;
    let optimisticMessageId: string | null = null;
    let persistedMessageId: string | null = null;

    try {
      setAttachmentUploadStatus({ phase: "encrypting", fileName: file.name });
      const threadId = await ensureAttachmentThread({
        activeThreadId: input.activeThreadId,
        fileName: file.name,
        session: input.session,
        onSessionRefreshed: input.onSessionRefreshed,
        setActiveThreadId: input.setActiveThreadId,
        setThreads: input.setThreads,
      });
      const localPreviewUrl = createLocalPreviewUrl(file);
      if (localPreviewUrl) {
        localPreviewUrls.add(localPreviewUrl);
      }
      const optimisticMessage = buildOptimisticAttachmentMessage({
        threadId,
        file,
        localPreviewUrl,
      });
      optimisticMessageId = optimisticMessage.id;
      input.setMessages((current) => [...current, optimisticMessage]);
      input.setNotice({ tone: "info", text: `Securing ${file.name}...` });

      const artifact = await buildChatAttachmentArtifact(file);
      const metadata = {
        ...artifact.metadata,
        threadId,
      };
      const body = await buildClientEncryptedArtifactBody({
        ...artifact,
        metadata,
      });

      setAttachmentUploadStatus({ phase: "uploading", fileName: file.name });
      input.setNotice({ tone: "info", text: `Uploading ${file.name}...` });
      const receipt = await uploadArtifact(body, input.session, input.onSessionRefreshed);
      const { message } = await createThreadAttachmentMessage({
        threadId,
        artifactId: receipt.artifactId,
        fileName: file.name,
        fileType: file.type || null,
        fileSize: file.size,
      }, input.session, input.onSessionRefreshed);
      const attachmentMessage = localPreviewUrl
        ? attachLocalPreviewUrlToMessage(message, receipt.artifactId, localPreviewUrl)
        : message;
      persistedMessageId = message.id;
      input.setMessages((current) =>
        current.map((currentMessage) =>
          currentMessage.id === optimisticMessageId ? attachmentMessage : currentMessage,
        ),
      );

      setAttachmentUploadStatus({ phase: "processing", fileName: file.name });
      input.setNotice({ tone: "info", text: `Reading ${file.name} into memory...` });

      const abortController = new AbortController();
      statusStreamAbortRef.current = abortController;
      let terminalEvent: ArtifactStatusEvent | null = null;
      statusWatchTimeout = window.setTimeout(() => {
        statusWatchTimedOut = true;
        abortController.abort();
      }, ARTIFACT_STATUS_TIMEOUT_MS);

      await streamArtifactStatus({
        artifactId: receipt.artifactId,
        session: input.session,
        onSessionRefreshed: input.onSessionRefreshed,
        signal: abortController.signal,
        onEvent: (event) => {
          terminalEvent = event;
          input.setMessages((current) =>
            current.map((currentMessage) =>
              currentMessage.id === persistedMessageId
                ? updateAttachmentMessageStatus(currentMessage, event, localPreviewUrl)
                : currentMessage,
            ),
          );
          applyArtifactStatusEvent(event, file.name, input.setNotice);
          if (event.status === "completed") {
            reachedSearchableReadiness = true;
            abortController.abort();
          }
        },
      });
      window.clearTimeout(statusWatchTimeout);
      statusWatchTimeout = null;

      if (!terminalEvent || reachedSearchableReadiness || isSuccessfulArtifactEvent(terminalEvent)) {
        input.setNotice({ tone: "info", text: `${file.name} is ready for chat memory.` });
      } else if (!isFailedArtifactEvent(terminalEvent)) {
        input.setNotice({
          tone: "info",
          text: `${file.name} is queued for memory processing. You can keep chatting while it finishes.`,
        });
      }
    } catch (error) {
      if (statusWatchTimeout != null) {
        window.clearTimeout(statusWatchTimeout);
      }
      if (isAbortError(error) && reachedSearchableReadiness) {
        input.setNotice({ tone: "info", text: `${file.name} is ready for chat memory.` });
      } else if (isAbortError(error) && statusWatchTimedOut) {
        input.setNotice({
          tone: "info",
          text: `${file.name} is still processing. You can keep chatting while it finishes.`,
        });
      } else if (!isAbortError(error)) {
        if (optimisticMessageId) {
          input.setMessages((current) =>
            current.map((message) =>
              message.id === optimisticMessageId
                ? markOptimisticAttachmentFailed(message)
                : message,
            ),
          );
        }
        input.setNotice(chatErrorNotice(error, "Attachment upload failed."));
      }
      statusStreamAbortRef.current = null;
      setAttachmentUploadStatus(IDLE_UPLOAD_STATUS);
      return;
    }

    statusStreamAbortRef.current = null;
    setAttachmentUploadStatus(IDLE_UPLOAD_STATUS);
  }

  async function openAttachment(attachment: ChatMessageAttachment) {
    if (attachment.localPreviewUrl) {
      openPreviewUrl(attachment.localPreviewUrl);
      return;
    }

    if (!input.session) {
      input.setNotice({ tone: "error", text: "Sign in again to open this file." });
      return;
    }

    try {
      const blob = await getArtifactPreviewBlob({
        artifactId: attachment.artifactId,
        session: input.session,
        onSessionRefreshed: input.onSessionRefreshed,
      });
      const url = URL.createObjectURL(blob);
      localPreviewUrls.add(url);
      input.setMessages((current) =>
        current.map((message) =>
          messageHasAttachment(message, attachment.artifactId)
            ? attachLocalPreviewUrlToMessage(message, attachment.artifactId, url)
            : message,
        ),
      );
      openPreviewUrl(url);
    } catch (error) {
      input.setNotice(chatErrorNotice(error, "File preview failed."));
    }
  }

  return {
    attachFiles,
    openAttachment,
    attachmentUploadStatus,
  };
}

function messageHasAttachment(message: ChatMessage, artifactId: string) {
  return readChatMessageAttachments(message).some((attachment) => attachment.artifactId === artifactId);
}

function openPreviewUrl(url: string) {
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (opened) {
    return;
  }

  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function ensureAttachmentThread(input: {
  activeThreadId: string | null;
  fileName: string;
  session: Session;
  onSessionRefreshed: (session: Session) => void;
  setActiveThreadId: Dispatch<SetStateAction<string | null>>;
  setThreads: Dispatch<SetStateAction<ChatThread[]>>;
}) {
  if (input.activeThreadId) {
    return input.activeThreadId;
  }

  const thread = await createChatThread(
    input.session,
    input.onSessionRefreshed,
    titleFromFileName(input.fileName),
  );
  input.setActiveThreadId(thread.id);
  input.setThreads((current) => prependThread(current, thread));
  return thread.id;
}

function updateAttachmentMessageStatus(
  message: ChatMessage,
  event: ArtifactStatusEvent,
  localPreviewUrl: string | null,
): ChatMessage {
  const metadata = readRecord(message.metadata);
  const attachments = Array.isArray(metadata["attachments"])
    ? metadata["attachments"].map((value) => {
        const attachment = readRecord(value);

        if (attachment["artifactId"] !== event.artifactId) {
          return value;
        }

        return {
          ...attachment,
          status: event.status,
          intelligenceStatus: event.intelligenceStatus ?? null,
          processing: event.processing ?? null,
          localPreviewUrl: localPreviewUrl ?? attachment["localPreviewUrl"],
        };
      })
    : [];

  return {
    ...message,
    metadata: {
      ...metadata,
      attachments,
    },
  };
}

function buildOptimisticAttachmentMessage(input: {
  threadId: string;
  file: File;
  localPreviewUrl: string | null;
}): ChatMessage {
  const now = new Date().toISOString();
  const artifactId = `local-${crypto.randomUUID()}`;

  return {
    id: `local-message-${crypto.randomUUID()}`,
    threadId: input.threadId,
    turnId: null,
    role: "user",
    status: "completed",
    content: "",
    providerKind: null,
    model: null,
    memoryFragmentIds: [],
    citations: null,
    usage: null,
    metadata: {
      surface: "web_chat",
      messageKind: "attachment",
      optimistic: true,
      attachments: [{
        artifactId,
        sourceType: inferUploadSourceType(input.file),
        fileName: input.file.name,
        fileType: input.file.type || null,
        fileSize: input.file.size,
        status: "pending",
        intelligenceStatus: null,
        processing: null,
        createdAt: now,
        updatedAt: now,
        ...(input.localPreviewUrl ? { localPreviewUrl: input.localPreviewUrl } : {}),
      }],
    },
    createdAt: now,
  };
}

function markOptimisticAttachmentFailed(message: ChatMessage): ChatMessage {
  const metadata = readRecord(message.metadata);
  const attachments = Array.isArray(metadata["attachments"])
    ? metadata["attachments"].map((value) => ({
        ...readRecord(value),
        status: "failed",
      }))
    : [];

  return {
    ...message,
    metadata: {
      ...metadata,
      attachments,
    },
  };
}

function createLocalPreviewUrl(file: File): string | null {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
    ? URL.createObjectURL(file)
    : null;
}

function titleFromFileName(fileName: string): string {
  const cleaned = fileName.replace(/\.[^.]+$/u, "").replace(/[_-]+/gu, " ").trim();
  return cleaned || "Uploaded file";
}

function applyArtifactStatusEvent(
  event: ArtifactStatusEvent,
  fileName: string,
  setNotice: Dispatch<SetStateAction<ChatNotice>>,
) {
  const processing = readRecord(event.processing);
  const candidateMemoryArchive = readRecord(processing["candidateMemoryArchive"]);
  if (candidateMemoryArchive["status"] === "failed") {
    setNotice({
      tone: "error",
      text: event.reason === "storage_wallet_insufficient_balance"
        ? `${fileName} was uploaded, but memory archiving needs more SUI.`
        : `${fileName} was uploaded, but memory archiving failed.`,
    });
    return;
  }

  if (event.status === "failed" || event.intelligenceStatus === "failed") {
    setNotice({
      tone: "error",
      text: event.reason
        ? `${fileName} could not be processed: ${event.reason}`
        : `${fileName} could not be processed.`,
    });
    return;
  }

  if (event.status === "processing" || event.intelligenceStatus === "processing") {
    setNotice({ tone: "info", text: artifactProcessingNotice(event, fileName) });
  }
}

function artifactProcessingNotice(event: ArtifactStatusEvent, fileName: string): string {
  const processing = readRecord(event.processing);
  const documentIndex = readRecord(processing["documentIndex"]);
  const embeddedChunks = readNumber(documentIndex["embeddedChunks"]);
  const chunkCount = readNumber(documentIndex["chunkCount"]);
  const phase = typeof processing["phase"] === "string" ? processing["phase"] : null;

  if (phase === "indexing_document" && embeddedChunks !== null && chunkCount !== null && chunkCount > 0) {
    return `Indexing ${fileName}: ${embeddedChunks}/${chunkCount} chunks embedded.`;
  }

  if (phase === "indexing_document") {
    return `Indexing ${fileName} for memory search...`;
  }

  return `Reading ${fileName} into memory...`;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isSuccessfulArtifactEvent(event: ArtifactStatusEvent) {
  return event.status === "completed" &&
    (
      event.intelligenceStatus === "completed" ||
      event.intelligenceStatus === "skipped" ||
      event.intelligenceStatus == null
    );
}

function isFailedArtifactEvent(event: ArtifactStatusEvent) {
  return event.status === "failed" || event.intelligenceStatus === "failed";
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function abortStatusStream(ref: RefObject<AbortController | null>) {
  ref.current?.abort();
}
