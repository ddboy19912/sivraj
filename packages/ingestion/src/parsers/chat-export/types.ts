import type { ChatExportParserMetadata } from "../../types.js";

export type ChatMessage = {
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

export type ChatExportProvider = ChatExportParserMetadata["provider"];

export type ChatExportExtraction = {
  provider: ChatExportProvider;
  messages: ChatMessage[];
};
