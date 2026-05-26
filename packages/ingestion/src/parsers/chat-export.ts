import type {
  ChatExportConversationMetadata,
  ChatExportParserMetadata,
  ParsedArtifact,
  ParsedConversationMessage,
} from "../types.js";

const CHAT_EXPORT_PARSER_NAME = "chat_export";

type ChatMessage = {
  author?: string;
  sender?: string;
  role?: string;
  name?: string;
  timestamp?: string;
  created_at?: string;
  createdAt?: string;
  create_time?: number | string;
  date?: string;
  text?: unknown;
  content?: unknown;
  message?: unknown;
  conversationTitle?: string;
  sourceConversationId?: string;
  sourceMessageId?: string;
  sourceSpeakerId?: string;
};

type ChatExportProvider = ChatExportParserMetadata["provider"];

type ChatExportExtraction = {
  provider: ChatExportProvider;
  messages: ChatMessage[];
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

  const extraction = extractMessages(parsedJson.value);
  const messages = extraction.messages;
  const speakers = extractSpeakers(messages);
  const conversationMessages = messages
    .map(toConversationMessage)
    .filter((message): message is ParsedConversationMessage => Boolean(message));
  const content = conversationMessages.map(renderConversationMessage).join("\n").trim();

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
      speakers,
      chatExport: buildChatExportMetadata(extraction.provider, messages),
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

function extractMessages(value: unknown): ChatExportExtraction {
  const chatGptMessages = extractChatGptMessages(value);
  if (chatGptMessages.length > 0) {
    return { provider: "chatgpt", messages: chatGptMessages };
  }

  const claudeMessages = extractClaudeMessages(value);
  if (claudeMessages.length > 0) {
    return { provider: "claude", messages: claudeMessages };
  }

  if (Array.isArray(value)) {
    return { provider: "generic", messages: value.filter(isRecord) as ChatMessage[] };
  }

  if (isRecord(value)) {
    for (const key of ["messages", "conversations", "items"]) {
      const candidate = value[key];

      if (Array.isArray(candidate)) {
        return { provider: "generic", messages: candidate.filter(isRecord) as ChatMessage[] };
      }
    }
  }

  return { provider: "generic", messages: [] };
}

function toConversationMessage(message: ChatMessage): ParsedConversationMessage | null {
  const author = message.author ?? message.sender ?? message.role ?? message.name ?? "unknown";
  const timestamp = normalizeTimestamp(
    message.timestamp ?? message.created_at ?? message.createdAt ?? message.create_time ?? message.date,
  );
  const content = normalizeChatText(extractTextContent(message.content ?? message.text ?? message.message));

  if (!content) {
    return null;
  }

  return {
    ...(timestamp ? { timestamp } : {}),
    speaker: message.conversationTitle ? `${author} (${message.conversationTitle})` : author,
    ...(message.sourceSpeakerId ? { sourceSpeakerId: message.sourceSpeakerId } : {}),
    text: content,
  };
}

function renderConversationMessage(message: ParsedConversationMessage): string {
  return message.timestamp
    ? `[${message.timestamp}] ${message.speaker}: ${message.text}`
    : `${message.speaker}: ${message.text}`;
}

function extractSpeakers(messages: ChatMessage[]): string[] {
  return Array.from(new Set(
    messages
      .map((message) => message.author ?? message.sender ?? message.role ?? message.name ?? "unknown")
      .map((speaker) => speaker.trim())
      .filter(Boolean),
  ));
}

function extractChatGptMessages(value: unknown): ChatMessage[] {
  const conversations = getConversationArray(value);
  const messages: ChatMessage[] = [];

  for (const conversation of conversations) {
    const mapping = isRecord(conversation.mapping) ? conversation.mapping : null;
    if (!mapping) {
      continue;
    }

    const conversationTitle = asString(conversation.title) ?? asString(conversation.name);
    const sourceConversationId = asString(conversation.id) ?? asString(conversation.conversation_id);
    const mappedMessages = Object.values(mapping)
      .map((node) => (isRecord(node) && isRecord(node.message) ? node.message : null))
      .filter((message): message is Record<string, unknown> => Boolean(message))
      .map((message) => {
        const author = isRecord(message.author) ? message.author : {};
        const sourceSpeakerId = asString(author.role) ?? asString(author.name);
        const timestamp = normalizeTimestamp(message.create_time ?? message.update_time);

        return {
          author: asString(author.role) ?? asString(author.name) ?? "unknown",
          ...(timestamp ? { timestamp } : {}),
          content: message.content,
          ...(conversationTitle ? { conversationTitle } : {}),
          ...(sourceConversationId ? { sourceConversationId } : {}),
          ...(asString(message.id) ? { sourceMessageId: asString(message.id) } : {}),
          ...(sourceSpeakerId ? { sourceSpeakerId } : {}),
        };
      })
      .filter((message) => extractTextContent(message.content).length > 0)
      .sort(compareMessagesByTimestamp);

    messages.push(...mappedMessages);
  }

  return messages;
}

function extractClaudeMessages(value: unknown): ChatMessage[] {
  const conversations = getConversationArray(value);
  const messages: ChatMessage[] = [];

  for (const conversation of conversations) {
    const conversationTitle = asString(conversation.name) ?? asString(conversation.title);
    const sourceConversationId = asString(conversation.uuid) ?? asString(conversation.id);
    const hasClaudeConversationShape =
      Array.isArray(conversation.chat_messages) || Boolean(conversationTitle || sourceConversationId);

    if (!hasClaudeConversationShape) {
      continue;
    }

    const candidateMessages = firstArray(conversation, ["chat_messages", "messages", "items"]);

    if (!candidateMessages) {
      continue;
    }

    for (const candidateMessage of candidateMessages) {
      if (!isRecord(candidateMessage)) {
        continue;
      }

      const sourceSpeakerId =
        asString(candidateMessage.sender) ??
        asString(candidateMessage.role) ??
        asString(candidateMessage.author) ??
        asString(candidateMessage.name);

      messages.push({
        author:
          asString(candidateMessage.sender) ??
          asString(candidateMessage.role) ??
          asString(candidateMessage.author) ??
          asString(candidateMessage.name) ??
          "unknown",
        ...((asString(candidateMessage.created_at) ??
          asString(candidateMessage.updated_at) ??
          asString(candidateMessage.timestamp))
          ? {
              timestamp:
                asString(candidateMessage.created_at) ??
                asString(candidateMessage.updated_at) ??
                asString(candidateMessage.timestamp),
            }
          : {}),
        content: candidateMessage.content ?? candidateMessage.text ?? candidateMessage.message,
        ...(conversationTitle ? { conversationTitle } : {}),
        ...(sourceConversationId ? { sourceConversationId } : {}),
        ...((asString(candidateMessage.uuid) ?? asString(candidateMessage.id))
          ? { sourceMessageId: asString(candidateMessage.uuid) ?? asString(candidateMessage.id) }
          : {}),
        ...(sourceSpeakerId ? { sourceSpeakerId } : {}),
      });
    }
  }

  return messages.filter((message) => extractTextContent(message.content).length > 0);
}

function getConversationArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  if (!isRecord(value)) {
    return [];
  }

  for (const key of ["conversations", "chats", "items"]) {
    const candidate = value[key];
    if (Array.isArray(candidate)) {
      return candidate.filter(isRecord);
    }
  }

  return [value];
}

function firstArray(record: Record<string, unknown>, keys: string[]): unknown[] | null {
  for (const key of keys) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return null;
}

function extractTextContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(extractTextContent).filter(Boolean).join("\n");
  }

  if (!isRecord(value)) {
    return "";
  }

  if (Array.isArray(value.parts)) {
    return value.parts.map(extractTextContent).filter(Boolean).join("\n");
  }

  if (Array.isArray(value.content)) {
    return value.content.map(extractTextContent).filter(Boolean).join("\n");
  }

  return (
    asString(value.text) ??
    asString(value.message) ??
    asString(value.value) ??
    ""
  );
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    return new Date(milliseconds).toISOString();
  }

  return asString(value);
}

function compareMessagesByTimestamp(left: ChatMessage, right: ChatMessage): number {
  const leftTimestamp = Date.parse(left.timestamp ?? "");
  const rightTimestamp = Date.parse(right.timestamp ?? "");

  if (Number.isNaN(leftTimestamp) || Number.isNaN(rightTimestamp)) {
    return 0;
  }

  return leftTimestamp - rightTimestamp;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildChatExportMetadata(
  provider: ChatExportProvider,
  messages: ChatMessage[],
): ChatExportParserMetadata {
  const conversations = new Map<string, ChatExportConversationMetadata>();

  for (const message of messages) {
    const key = message.sourceConversationId ?? message.conversationTitle ?? "default";
    const timestamp = normalizeTimestamp(
      message.timestamp ?? message.created_at ?? message.createdAt ?? message.create_time ?? message.date,
    );
    const current = conversations.get(key) ?? {
      ...(message.sourceConversationId ? { sourceConversationId: message.sourceConversationId } : {}),
      ...(message.conversationTitle ? { title: message.conversationTitle } : {}),
      messageCount: 0,
      sourceMessageIds: [],
    };

    current.messageCount += 1;

    if (timestamp) {
      if (!current.firstMessageAt || Date.parse(timestamp) < Date.parse(current.firstMessageAt)) {
        current.firstMessageAt = timestamp;
      }

      if (!current.lastMessageAt || Date.parse(timestamp) > Date.parse(current.lastMessageAt)) {
        current.lastMessageAt = timestamp;
      }
    }

    if (message.sourceMessageId && current.sourceMessageIds && !current.sourceMessageIds.includes(message.sourceMessageId)) {
      current.sourceMessageIds.push(message.sourceMessageId);
    }

    conversations.set(key, current);
  }

  return {
    provider,
    conversations: Array.from(conversations.values()).map((conversation) => {
      const { sourceMessageIds, ...rest } = conversation;

      return {
        ...rest,
        ...(sourceMessageIds?.length ? { sourceMessageIds } : {}),
      };
    }),
  };
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
