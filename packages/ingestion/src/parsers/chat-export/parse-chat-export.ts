import type { ParsedArtifact } from "../../types.js";
import { parseJsonConversationExport } from "../shared/conversation-export.js";
import { normalizeWhitespaceText } from "../shared/text.js";
import { extractMessages } from "./extract-messages.js";
import { buildChatExportMetadata } from "./metadata.js";
import { extractSpeakers, toConversationMessage } from "./normalize-message.js";
import type { ChatExportProvider } from "./types.js";

const CHAT_EXPORT_PARSER_NAME = "chat_export";

export function parseChatExport(input: {
  content: string;
  title?: string | null;
}): ParsedArtifact {
  let provider: ChatExportProvider = "generic";

  return parseJsonConversationExport({
    content: input.content,
    parserName: CHAT_EXPORT_PARSER_NAME,
    parseFailureWarning: "chat_export_parse_recovered_with_plain_text",
    emptyWarning: "chat_export_empty_after_parse",
    recoverPlainText: normalizeWhitespaceText,
    extractMessages: (value) => {
      const extraction = extractMessages(value);
      provider = extraction.provider;
      return extraction.messages;
    },
    extractSpeakers,
    toConversationMessage,
    extraParserFields: (messages) => ({
      chatExport: buildChatExportMetadata(provider, messages),
    }),
  });
}
