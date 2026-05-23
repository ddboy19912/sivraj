import type { ParsedArtifact, ParsedConversationMessage } from "../types.js";

const SLACK_EXPORT_PARSER_NAME = "slack_export";

type SlackMessage = {
  user?: string;
  username?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
};

export function parseSlackExport(input: {
  content: string;
  title?: string | null;
}): ParsedArtifact {
  const originalLength = input.content.length;
  const warnings: string[] = [];
  const parsedJson = parseJson(input.content);

  if (!parsedJson.ok) {
    warnings.push("slack_export_parse_recovered_with_plain_text");
    const content = normalizeSlackText(input.content);

    return {
      content,
      parser: {
        name: SLACK_EXPORT_PARSER_NAME,
        originalLength,
        parsedLength: content.length,
        warnings: content ? warnings : [...warnings, "slack_export_empty_after_parse"],
      },
    };
  }

  const messages = extractMessages(parsedJson.value);
  const speakers = extractSpeakers(messages);
  const conversationMessages = messages
    .map(toConversationMessage)
    .filter((message): message is ParsedConversationMessage => Boolean(message));
  const content = conversationMessages.map(renderConversationMessage).join("\n").trim();

  if (!content) {
    warnings.push("slack_export_empty_after_parse");
  }

  return {
    content,
    parser: {
      name: SLACK_EXPORT_PARSER_NAME,
      originalLength,
      parsedLength: content.length,
      warnings,
      speakers,
    },
    conversation: {
      messages: conversationMessages,
    },
  };
}

function parseJson(content: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(content) as unknown };
  } catch {
    return { ok: false };
  }
}

function extractMessages(value: unknown): SlackMessage[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord) as SlackMessage[];
  }

  if (isRecord(value)) {
    for (const key of ["messages", "items"]) {
      const candidate = value[key];

      if (Array.isArray(candidate)) {
        return candidate.filter(isRecord) as SlackMessage[];
      }
    }
  }

  return [];
}

function toConversationMessage(message: SlackMessage): ParsedConversationMessage | null {
  const author = message.username ?? message.user ?? message.bot_id ?? "unknown";
  const content = normalizeSlackText(message.text ?? "");

  if (!content) {
    return null;
  }

  return {
    ...(message.ts ? { timestamp: message.ts } : {}),
    speaker: author,
    sourceSpeakerId: message.user ?? message.bot_id,
    text: content,
  };
}

function renderConversationMessage(message: ParsedConversationMessage): string {
  return message.timestamp
    ? `[${message.timestamp}] ${message.speaker}: ${message.text}`
    : `${message.speaker}: ${message.text}`;
}

function extractSpeakers(messages: SlackMessage[]): string[] {
  return Array.from(new Set(
    messages
      .map((message) => message.username ?? message.user ?? message.bot_id ?? "unknown")
      .map((speaker) => speaker.trim())
      .filter(Boolean),
  ));
}

function normalizeSlackText(content: string): string {
  return content
    .replace(/<@([A-Z0-9]+)>/g, "@$1")
    .replace(/<#([A-Z0-9]+)\|([^>]+)>/g, "#$2")
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<([^>]+)>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
