import type { ParsedArtifact, ParsedConversationMessage } from "../types.js";
import { parseJsonConversationExport } from "./shared/conversation-export.js";
import { isRecord } from "./shared/json.js";
import { normalizeWhitespaceText } from "./shared/text.js";

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
  return parseJsonConversationExport({
    content: input.content,
    parserName: SLACK_EXPORT_PARSER_NAME,
    parseFailureWarning: "slack_export_parse_recovered_with_plain_text",
    emptyWarning: "slack_export_empty_after_parse",
    recoverPlainText: normalizeSlackText,
    extractMessages,
    extractSpeakers,
    toConversationMessage,
  });
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

function extractSpeakers(messages: SlackMessage[]): string[] {
  return Array.from(new Set(
    messages
      .map((message) => message.username ?? message.user ?? message.bot_id ?? "unknown")
      .map((speaker) => speaker.trim())
      .filter(Boolean),
  ));
}

function normalizeSlackText(content: string): string {
  return normalizeWhitespaceText(content
    .replace(/<@([A-Z0-9]+)>/g, "@$1")
    .replace(/<#([A-Z0-9]+)\|([^>]+)>/g, "#$2")
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<([^>]+)>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">"));
}
