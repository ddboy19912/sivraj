import { simpleParser, type AddressObject } from "mailparser";
import type { ParsedArtifact } from "../types.js";

const EMAIL_PARSER_NAME = "email";

export async function parseEmail(input: {
  content: string;
  title?: string | null;
}): Promise<ParsedArtifact> {
  const originalLength = input.content.length;
  const warnings: string[] = [];

  try {
    const parsed = await simpleParser(input.content);
    const parts = [
      parsed.subject ? `Subject: ${parsed.subject}` : null,
      addressText(parsed.from) ? `From: ${addressText(parsed.from)}` : null,
      addressText(parsed.to) ? `To: ${addressText(parsed.to)}` : null,
      parsed.date ? `Date: ${parsed.date.toISOString()}` : null,
      normalizeEmailBody(parsed.text || stripHtml(parsed.html || "")),
    ].filter((part): part is string => Boolean(part && part.trim()));
    const content = parts.join("\n").trim();

    if (!content) {
      warnings.push("email_empty_after_parse");
    }

    return {
      content,
      parser: {
        name: EMAIL_PARSER_NAME,
        originalLength,
        parsedLength: content.length,
        warnings,
      },
    };
  } catch {
    warnings.push("email_parse_recovered_with_plain_text");
    const content = normalizeEmailBody(input.content);

    if (!content) {
      warnings.push("email_empty_after_parse");
    }

    return {
      content,
      parser: {
        name: EMAIL_PARSER_NAME,
        originalLength,
        parsedLength: content.length,
        warnings,
      },
    };
  }
}

function normalizeEmailBody(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function addressText(value: AddressObject | AddressObject[] | undefined): string | null {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((address) => address.text).filter(Boolean).join(", ") || null;
  }

  return value.text || null;
}

function stripHtml(content: string): string {
  return content
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
