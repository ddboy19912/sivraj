import { describe, expect, it } from "vitest";
import {
  attachLocalPreviewUrlToMessage,
  buildChatAttachmentArtifact,
  formatChatAttachmentStatus,
  readChatMessageAttachments,
} from "@/lib/chat/chat-attachments";
import type { ChatMessage } from "@/lib/chat/chat-api";

describe("buildChatAttachmentArtifact", () => {
  it("reads PDFs as data URLs for encrypted artifact upload", async () => {
    const file = new File(["%PDF-1.7"], "playbook.pdf", {
      type: "application/pdf",
      lastModified: Date.UTC(2026, 0, 1),
    });

    const artifact = await buildChatAttachmentArtifact(file);

    expect(artifact.sourceType).toBe("pdf");
    expect(artifact.title).toBe("playbook.pdf");
    expect(artifact.content).toMatch(/^data:application\/pdf;base64,/u);
    expect(artifact.metadata).toMatchObject({
      uploadSurface: "chat",
      fileName: "playbook.pdf",
      fileType: "application/pdf",
    });
  });

  it("reads text uploads as text", async () => {
    const file = new File(["Remember that the launch date is June 30."], "notes.txt", {
      type: "text/plain",
    });

    const artifact = await buildChatAttachmentArtifact(file);

    expect(artifact.sourceType).toBe("upload");
    expect(artifact.content).toBe("Remember that the launch date is June 30.");
  });

  it("reads hydrated chat attachment metadata", () => {
    const message = chatAttachmentMessage({
      artifactId: "artifact-1",
      sourceType: "pdf",
      fileName: "oliver-twist.pdf",
      fileType: "application/pdf",
      fileSize: 1024,
      status: "processing",
      processing: {
        documentIndex: {
          embeddedChunks: 12,
          chunkCount: 40,
        },
      },
    });

    const [attachment] = readChatMessageAttachments(message);

    expect(attachment).toEqual(
      expect.objectContaining({
        artifactId: "artifact-1",
        sourceType: "pdf",
        fileName: "oliver-twist.pdf",
        status: "processing",
        fileSize: 1024,
      }),
    );
    expect(formatChatAttachmentStatus(attachment!)).toBe("Indexing 12/40 chunks");
  });

  it("adds a local preview URL without losing persisted attachment metadata", () => {
    const message = chatAttachmentMessage({
      artifactId: "artifact-1",
      sourceType: "pdf",
      fileName: "oliver-twist.pdf",
      fileType: "application/pdf",
      fileSize: 1024,
      status: "completed",
    });

    const next = attachLocalPreviewUrlToMessage(message, "artifact-1", "blob:preview");

    expect(readChatMessageAttachments(next)).toEqual([
      expect.objectContaining({
        artifactId: "artifact-1",
        localPreviewUrl: "blob:preview",
        status: "completed",
      }),
    ]);
  });

  it("surfaces candidate memory archive failures on completed attachments", () => {
    const message = chatAttachmentMessage({
      artifactId: "artifact-1",
      sourceType: "pdf",
      fileName: "oliver-twist.pdf",
      status: "completed",
      processing: {
        candidateMemoryArchive: {
          status: "failed",
          reason: "storage_wallet_insufficient_balance",
        },
      },
    });

    const [attachment] = readChatMessageAttachments(message);

    expect(formatChatAttachmentStatus(attachment!)).toBe("Memory archive blocked");
  });
});

function chatAttachmentMessage(attachment: Record<string, unknown>): ChatMessage {
  return {
    id: "message-1",
    threadId: "thread-1",
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
      attachments: [attachment],
    },
    createdAt: "2026-06-15T00:00:00.000Z",
  };
}
