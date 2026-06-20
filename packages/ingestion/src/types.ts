export type ParsedArtifact = {
  content: string;
  parser: ParserMetadata;
  conversation?: ParsedConversation;
};

export type ParserMetadata = {
  name: string;
  originalLength: number;
  parsedLength: number;
  warnings: string[];
  speakers?: string[];
  document?: ParsedDocumentMetadata;
  chatExport?: ChatExportParserMetadata;
};

export type ParsedDocumentMetadata = {
  title?: string;
  pageCount?: number;
  pages?: Array<{
    pageNumber: number;
    charStart: number;
    charEnd: number;
    textLength: number;
  }>;
};

export type ChatExportParserMetadata = {
  provider: "chatgpt" | "claude" | "generic";
  conversations: ChatExportConversationMetadata[];
};

export type ChatExportConversationMetadata = {
  sourceConversationId?: string;
  title?: string;
  messageCount: number;
  firstMessageAt?: string;
  lastMessageAt?: string;
  sourceMessageIds?: string[];
};

export type ParsedConversation = {
  messages: ParsedConversationMessage[];
};

export type ParsedConversationMessage = {
  timestamp?: string;
  speaker: string;
  sourceSpeakerId?: string;
  text: string;
};
