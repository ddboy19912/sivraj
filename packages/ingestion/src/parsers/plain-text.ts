import type { ParsedArtifact } from "../types.js";
import { normalizeWhitespaceText } from "./shared/text.js";

const PLAIN_TEXT_PARSER_NAME = "plain_text";

export function parsePlainText(input: {
  content: string;
  title?: string | null;
}): ParsedArtifact {
  const originalLength = input.content.length;
  const warnings: string[] = [];
  const withoutControlCharacters = stripControlCharacters(input.content);

  if (withoutControlCharacters.length !== input.content.length) {
    warnings.push("plain_text_control_characters_removed");
  }

  const content = normalizeWhitespaceText(withoutControlCharacters);

  if (!content) {
    warnings.push("plain_text_empty_after_parse");
  }

  return {
    content,
    parser: {
      name: PLAIN_TEXT_PARSER_NAME,
      originalLength,
      parsedLength: content.length,
      warnings,
    },
  };
}

function stripControlCharacters(content: string): string {
  return content.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}
