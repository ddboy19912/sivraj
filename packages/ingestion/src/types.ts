export type ParsedArtifact = {
  content: string;
  parser: ParserMetadata;
};

export type ParserMetadata = {
  name: string;
  originalLength: number;
  parsedLength: number;
  warnings: string[];
};
