import type { ParsedArtifact, ParsedConversationMessage } from "../../types.js";
import { parseJson } from "./json.js";
import { renderConversationMessage } from "./text.js";

function parseJsonExportFailure(input: {
  content: string;
  parserName: string;
  parseFailureWarning: string;
  emptyWarning: string;
  recoverPlainText: (content: string) => string;
}): ParsedArtifact {
  const originalLength = input.content.length;
  const warnings = [input.parseFailureWarning];
  const content = input.recoverPlainText(input.content);

  return {
    content,
    parser: {
      name: input.parserName,
      originalLength,
      parsedLength: content.length,
      warnings: content ? warnings : [...warnings, input.emptyWarning],
    },
  };
}

function buildConversationMessagesArtifact<TMessage>(params: {
  parserName: string;
  originalLength: number;
  warnings: string[];
  messages: TMessage[];
  speakers: string[];
  toConversationMessage: (message: TMessage) => ParsedConversationMessage | null;
  emptyWarning: string;
  extraParserFields?: Record<string, unknown>;
}): ParsedArtifact {
  const conversationMessages = params.messages
    .map(params.toConversationMessage)
    .filter((message): message is ParsedConversationMessage => Boolean(message));
  const content = conversationMessages.map(renderConversationMessage).join("\n").trim();

  if (!content) {
    params.warnings.push(params.emptyWarning);
  }

  return {
    content,
    parser: {
      name: params.parserName,
      originalLength: params.originalLength,
      parsedLength: content.length,
      warnings: params.warnings,
      speakers: params.speakers,
      ...params.extraParserFields,
    },
    conversation: {
      messages: conversationMessages,
    },
  };
}

export function parseJsonConversationExport<TMessage>(input: {
  content: string;
  parserName: string;
  parseFailureWarning: string;
  emptyWarning: string;
  recoverPlainText: (content: string) => string;
  extractMessages: (value: unknown) => TMessage[];
  extractSpeakers: (messages: TMessage[]) => string[];
  toConversationMessage: (message: TMessage) => ParsedConversationMessage | null;
  extraParserFields?: Record<string, unknown> | ((messages: TMessage[]) => Record<string, unknown>);
}): ParsedArtifact {
  const parsedJson = parseJson(input.content);

  if (!parsedJson.ok) {
    return parseJsonExportFailure(input);
  }

  const messages = input.extractMessages(parsedJson.value);
  const extraParserFields = typeof input.extraParserFields === "function"
    ? input.extraParserFields(messages)
    : input.extraParserFields;

  return buildConversationMessagesArtifact({
    parserName: input.parserName,
    originalLength: input.content.length,
    warnings: [],
    messages,
    speakers: input.extractSpeakers(messages),
    toConversationMessage: input.toConversationMessage,
    emptyWarning: input.emptyWarning,
    extraParserFields,
  });
}
