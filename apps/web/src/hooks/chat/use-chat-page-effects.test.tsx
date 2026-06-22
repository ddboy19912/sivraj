import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatPageEffects } from "@/hooks/chat/use-chat-page-effects";
import type { ChatMessage } from "@/lib/chat/chat-api";

const scrollIntoViewMock = vi.fn();

describe("useChatPageEffects", () => {
  beforeEach(() => {
    scrollIntoViewMock.mockReset();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoViewMock,
    });
  });

  it("auto-scrolls while the chat composer has focus", () => {
    const { rerender } = render(
      <ChatPageEffectsHarness messages={[messageFixture("message-1")]} />,
    );
    scrollIntoViewMock.mockClear();

    const composer = screen.getByLabelText("Message test twin");
    composer.focus();
    expect(document.activeElement).toBe(composer);

    rerender(
      <ChatPageEffectsHarness
        messages={[messageFixture("message-1"), messageFixture("message-2")]}
      />,
    );

    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      block: "end",
      behavior: "smooth",
    });
  });

  it("auto-scrolls when focus is outside the chat composer", () => {
    const { rerender } = render(
      <ChatPageEffectsHarness messages={[messageFixture("message-1")]} />,
    );
    scrollIntoViewMock.mockClear();

    screen.getByRole("button", { name: "Outside composer" }).focus();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Outside composer" }));

    rerender(
      <ChatPageEffectsHarness
        messages={[messageFixture("message-1"), messageFixture("message-2")]}
      />,
    );

    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      block: "end",
      behavior: "smooth",
    });
  });
});

function ChatPageEffectsHarness({ messages }: { messages: ChatMessage[] }) {
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useChatPageEffects({
    refreshChatState: async () => undefined,
    refreshKey: "test",
    messages,
    isSending: false,
    messagesEndRef,
  });

  return (
    <div>
      <button type="button">Outside composer</button>
      <footer data-chat-composer="true">
        <textarea aria-label="Message test twin" />
      </footer>
      <div ref={messagesEndRef} />
    </div>
  );
}

function messageFixture(id: string): ChatMessage {
  return {
    id,
    threadId: "thread-1",
    turnId: null,
    role: "user",
    content: id,
    status: "completed",
    providerKind: null,
    model: null,
    memoryFragmentIds: [],
    citations: null,
    usage: null,
    metadata: null,
    createdAt: "2026-06-22T00:00:00.000Z",
  };
}
