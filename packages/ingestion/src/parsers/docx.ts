import { Buffer } from "node:buffer";
import mammoth from "mammoth";
import { parsePlainText } from "./plain-text.js";
import type { ParsedArtifact } from "../types.js";

const DOCX_PARSER_NAME = "docx";

export async function parseDocx(input: {
  content: string;
  title?: string | null;
}): Promise<ParsedArtifact> {
  const originalLength = input.content.length;

  if (!looksLikeBase64Docx(input.content)) {
    const parsed = parsePlainText({ content: input.content, title: input.title });

    return {
      content: parsed.content,
      parser: {
        name: DOCX_PARSER_NAME,
        originalLength,
        parsedLength: parsed.content.length,
        warnings: parsed.content
          ? ["docx_text_input_without_binary_parse", ...parsed.parser.warnings]
          : ["docx_text_input_without_binary_parse", "docx_empty_after_parse"],
      },
    };
  }

  const warnings: string[] = [];

  try {
    const result = await mammoth.extractRawText({
      buffer: Buffer.from(input.content, "base64"),
    });
    const parsed = parsePlainText({ content: result.value, title: input.title });
    const content = parsed.content;

    warnings.push(...result.messages.map((message) => `docx_${message.type}`));
    warnings.push(...parsed.parser.warnings);

    if (!content) {
      warnings.push("docx_empty_after_parse");
    }

    return {
      content,
      parser: {
        name: DOCX_PARSER_NAME,
        originalLength,
        parsedLength: content.length,
        warnings,
      },
    };
  } catch {
    return {
      content: "",
      parser: {
        name: DOCX_PARSER_NAME,
        originalLength,
        parsedLength: 0,
        warnings: ["docx_binary_parse_failed", "docx_empty_after_parse"],
      },
    };
  }
}

function looksLikeBase64Docx(content: string): boolean {
  const trimmed = content.trim();

  return trimmed.startsWith("UEs") && /^[A-Za-z0-9+/=\s]+$/.test(trimmed);
}
