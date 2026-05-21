import type { ParsedArtifact } from "../types.js";

const CHAT_EXPORT_PARSER_NAME = "chat_export";

type ChatMessage = {
  author?: string;
  sender?: string;
  role?: string;
  name?: string;
  timestamp?: string;
  createdAt?: string;
  date?: string;
  text?: string;
  content?: string;
  message?: string;
};

export function parseChatExport(input: {
  content: string;
  title?: string | null;
}): ParsedArtifact {
  const originalLength = input.content.length;
  const warnings: string[] = [];
  const parsedJson = parseJson(input.content);

  if (!parsedJson.ok) {
    warnings.push("chat_export_parse_recovered_with_plain_text");
    const content = normalizeChatText(input.content);

    return {
      content,
      parser: {
        name: CHAT_EXPORT_PARSER_NAME,
        originalLength,
        parsedLength: content.length,
        warnings: content ? warnings : [...warnings, "chat_export_empty_after_parse"],
      },
    };
  }

  const messages = extractMessages(parsedJson.value);
  const content = messages.map(renderMessage).filter(Boolean).join("\n").trim();

  if (!content) {
    warnings.push("chat_export_empty_after_parse");
  }

  return {
    content,
    parser: {
      name: CHAT_EXPORT_PARSER_NAME,
      originalLength,
      parsedLength: content.length,
      warnings,
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

function extractMessages(value: unknown): ChatMessage[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord) as ChatMessage[];
  }

  if (isRecord(value)) {
    for (const key of ["messages", "conversations", "items"]) {
      const candidate = value[key];

      if (Array.isArray(candidate)) {
        return candidate.filter(isRecord) as ChatMessage[];
      }
    }
  }

  return [];
}

function renderMessage(message: ChatMessage): string {
  const author = message.author ?? message.sender ?? message.role ?? message.name ?? "unknown";
  const timestamp = message.timestamp ?? message.createdAt ?? message.date;
  const content = normalizeChatText(
    typeof message.content === "string"
      ? message.content
      : typeof message.text === "string"
        ? message.text
        : typeof message.message === "string"
          ? message.message
          : "",
  );

  if (!content) {
    return "";
  }

  return timestamp ? `[${timestamp}] ${author}: ${content}` : `${author}: ${content}`;
}

function normalizeChatText(content: string): string {
  return content
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
