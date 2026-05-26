import { describe, expect, it } from "vitest";
import { parseChatExport } from "./chat-export.js";

describe("parseChatExport", () => {
  it("extracts common message arrays from json exports", () => {
    const parsed = parseChatExport({
      content: JSON.stringify({
        messages: [
          {
            role: "user",
            timestamp: "2024-03-01T10:00:00Z",
            content: "What angle should I use?",
          },
          {
            role: "assistant",
            content: "Lead with compliance and trust.",
          },
        ],
      }),
    });

    expect(parsed.content).toBe(
      [
        "[2024-03-01T10:00:00Z] user: What angle should I use?",
        "assistant: Lead with compliance and trust.",
      ].join("\n"),
    );
    expect(parsed.parser.warnings).toEqual([]);
    expect(parsed.parser.speakers).toEqual(["user", "assistant"]);
    expect(parsed.conversation?.messages).toEqual([
      {
        timestamp: "2024-03-01T10:00:00Z",
        speaker: "user",
        text: "What angle should I use?",
      },
      {
        speaker: "assistant",
        text: "Lead with compliance and trust.",
      },
    ]);
  });

  it("falls back to readable text for non-json exports", () => {
    const parsed = parseChatExport({
      content: "Tunde: Need pitch help.\nAI: Lead with trust.",
    });

    expect(parsed.content).toBe("Tunde: Need pitch help.\nAI: Lead with trust.");
    expect(parsed.parser.warnings).toContain("chat_export_parse_recovered_with_plain_text");
  });

  it("extracts ChatGPT conversation export mappings", () => {
    const parsed = parseChatExport({
      content: JSON.stringify([
        {
          id: "chatgpt-conversation-1",
          title: "Launch plan",
          mapping: {
            userMessage: {
              message: {
                id: "message-1",
                author: { role: "user" },
                create_time: 1_710_000_000,
                content: { parts: ["What should I launch first?"] },
              },
            },
            assistantMessage: {
              message: {
                id: "message-2",
                author: { role: "assistant" },
                create_time: 1_710_000_010,
                content: { parts: ["Lead with the connector import review flow."] },
              },
            },
          },
        },
      ]),
    });

    expect(parsed.content).toBe(
      [
        "[2024-03-09T16:00:00.000Z] user (Launch plan): What should I launch first?",
        "[2024-03-09T16:00:10.000Z] assistant (Launch plan): Lead with the connector import review flow.",
      ].join("\n"),
    );
    expect(parsed.parser.speakers).toEqual(["user", "assistant"]);
    expect(parsed.parser.chatExport).toEqual({
      provider: "chatgpt",
      conversations: [
        {
          sourceConversationId: "chatgpt-conversation-1",
          title: "Launch plan",
          messageCount: 2,
          firstMessageAt: "2024-03-09T16:00:00.000Z",
          lastMessageAt: "2024-03-09T16:00:10.000Z",
          sourceMessageIds: ["message-1", "message-2"],
        },
      ],
    });
    expect(parsed.conversation?.messages[0]).toEqual({
      timestamp: "2024-03-09T16:00:00.000Z",
      speaker: "user (Launch plan)",
      sourceSpeakerId: "user",
      text: "What should I launch first?",
    });
  });

  it("extracts Claude conversation exports", () => {
    const parsed = parseChatExport({
      content: JSON.stringify({
        conversations: [
          {
            uuid: "claude-conversation-1",
            name: "Architecture notes",
            chat_messages: [
              {
                uuid: "message-1",
                sender: "human",
                created_at: "2024-04-01T12:00:00Z",
                text: "Should this be a connector?",
              },
              {
                uuid: "message-2",
                sender: "assistant",
                created_at: "2024-04-01T12:00:05Z",
                content: [{ type: "text", text: "Use an import path unless a stable history API exists." }],
              },
            ],
          },
        ],
      }),
    });

    expect(parsed.content).toBe(
      [
        "[2024-04-01T12:00:00Z] human (Architecture notes): Should this be a connector?",
        "[2024-04-01T12:00:05Z] assistant (Architecture notes): Use an import path unless a stable history API exists.",
      ].join("\n"),
    );
    expect(parsed.parser.speakers).toEqual(["human", "assistant"]);
    expect(parsed.parser.chatExport).toEqual({
      provider: "claude",
      conversations: [
        {
          sourceConversationId: "claude-conversation-1",
          title: "Architecture notes",
          messageCount: 2,
          firstMessageAt: "2024-04-01T12:00:00Z",
          lastMessageAt: "2024-04-01T12:00:05Z",
          sourceMessageIds: ["message-1", "message-2"],
        },
      ],
    });
    expect(parsed.conversation?.messages[1]).toEqual({
      timestamp: "2024-04-01T12:00:05Z",
      speaker: "assistant (Architecture notes)",
      sourceSpeakerId: "assistant",
      text: "Use an import path unless a stable history API exists.",
    });
  });

  it("returns an empty parse result for empty exports", () => {
    const parsed = parseChatExport({ content: "[]" });

    expect(parsed.content).toBe("");
    expect(parsed.parser.warnings).toContain("chat_export_empty_after_parse");
  });
});
