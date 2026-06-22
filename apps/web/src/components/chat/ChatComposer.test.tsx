import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatComposer } from "@/components/chat/ChatComposer";
import type { ChatAttachmentUploadStatus, ChatPageStatus } from "@/types/chat.types";

describe("ChatComposer", () => {
  it("focuses the textarea when autofocus is enabled", () => {
    render(<ChatComposer {...defaultComposerProps()} autoFocus />);

    expect(document.activeElement).toBe(screen.getByLabelText("Message test twin"));
  });

  it("does not focus the textarea by default", () => {
    render(<ChatComposer {...defaultComposerProps()} />);

    expect(document.activeElement).not.toBe(screen.getByLabelText("Message test twin"));
  });
});

function defaultComposerProps() {
  return {
    draft: "",
    memoryIntent: "auto" as const,
    twinName: "test twin",
    status: "ready" as ChatPageStatus,
    notice: null,
    isSending: false,
    attachmentUploadStatus: { phase: "idle", fileName: null } satisfies ChatAttachmentUploadStatus,
    onDraftChange: vi.fn(),
    onMemoryIntentChange: vi.fn(),
    onComposerKeyDown: vi.fn(),
    onSendMessage: vi.fn(),
    onStopStreaming: vi.fn(),
    onRetryLastMessage: vi.fn(),
    failedAttachmentCount: 0,
    onAttachFiles: vi.fn(),
    onRetryFailedAttachments: vi.fn(),
    onSaveDraftAsSource: vi.fn(),
  };
}
