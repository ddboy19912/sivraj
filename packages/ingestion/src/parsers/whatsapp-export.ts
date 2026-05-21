import type { ParsedArtifact } from "../types.js";

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
  const content = messages.join("\n").trim();

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
    },
  };
}

function parseMessages(content: string): string[] {
  const messages: string[] = [];

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
      messages[messages.length - 1] = `${messages[messages.length - 1]}\n${line}`;
    }
  }

  return messages;
}

function parseMessageLine(line: string): string | null {
  for (const pattern of WHATSAPP_LINE_PATTERNS) {
    const match = pattern.exec(line);

    if (match) {
      const [, date, time, author, message] = match;
      const normalizedMessage = normalizeWhatsAppText(message ?? "");

      return normalizedMessage ? `[${date} ${time}] ${author}: ${normalizedMessage}` : null;
    }
  }

  return null;
}

function normalizeWhatsAppText(content: string): string {
  return content
    .replace(/[ \t]+/g, " ")
    .replace("<Media omitted>", "")
    .trim();
}
