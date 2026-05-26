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
  chatExport?: ChatExportParserMetadata;
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
