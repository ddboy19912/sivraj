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
