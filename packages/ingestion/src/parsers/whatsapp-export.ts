import type { ParsedArtifact, ParsedConversationMessage } from "../types.js";

const WHATSAPP_EXPORT_PARSER_NAME = "whatsapp_export";

const WHATSAPP_LINE_PATTERNS = [
  /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?:\s?[AP]M)?)\s+-\s+([^:]+):\s+(.+)$/,
  /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?)\]\s+([^:]+):\s+(.+)$/,
];

export function parseWhatsAppExport(input: {
  content: string;
  title?: string | null;
}): ParsedArtifact {
  const originalLength = input.content.length;
  const warnings: string[] = [];
  const messages = parseMessages(input.content);
  const content = messages.map(renderConversationMessage).join("\n").trim();
  const speakers = Array.from(new Set(messages.map((message) => message.speaker).filter(Boolean)));

  if (!content) {
    warnings.push("whatsapp_export_empty_after_parse");
  }

  return {
    content,
    parser: {
      name: WHATSAPP_EXPORT_PARSER_NAME,
      originalLength,
      parsedLength: content.length,
      warnings,
      speakers,
    },
    conversation: {
      messages,
    },
  };
}

function parseMessages(content: string): ParsedConversationMessage[] {
  const messages: ParsedConversationMessage[] = [];

  for (const rawLine of content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const parsed = parseMessageLine(line);

    if (parsed) {
      messages.push(parsed);
      continue;
    }

    if (messages.length > 0) {
      const last = messages[messages.length - 1];
      messages[messages.length - 1] = {
        ...last,
        text: `${last.text}\n${line}`,
      };
    }
  }

  return messages;
}

function parseMessageLine(line: string): ParsedConversationMessage | null {
  for (const pattern of WHATSAPP_LINE_PATTERNS) {
    const match = pattern.exec(line);

    if (match) {
      const [, date, time, author, message] = match;
      const normalizedMessage = normalizeWhatsAppText(message ?? "");

      return normalizedMessage
        ? {
            timestamp: `${date} ${time}`,
            speaker: author?.trim() ?? "unknown",
            text: normalizedMessage,
          }
        : null;
    }
  }

  return null;
}

function renderConversationMessage(message: ParsedConversationMessage): string {
  return message.timestamp
    ? `[${message.timestamp}] ${message.speaker}: ${message.text}`
    : `${message.speaker}: ${message.text}`;
}

function normalizeWhatsAppText(content: string): string {
  return content
    .replace(/[ \t]+/g, " ")
    .replace("<Media omitted>", "")
    .trim();
}
