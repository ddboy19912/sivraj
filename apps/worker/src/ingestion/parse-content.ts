import {
  parseBrowserHistory,
  parseChatExport,
  parseCsv,
  parseDocx,
  parseEmail,
  parseGitHubImport,
  parseImage,
  parseMarkdown,
  parseOcrScannedPdf,
  parsePlainText,
  parseSlackExport,
  parseTextPdf,
  parseUrl,
  parseWhatsAppExport,
} from "@sivraj/ingestion";
import type { ParsedProcessableContent, PrivateSourcePayload, QueuedArtifact } from "../types/ingestion.types.js";
import { asRecord, readMetadataString } from "./metadata-utils.js";

export function decodePrivateSourcePayload(value: string): PrivateSourcePayload {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;

    if (
      parsed["kind"] === "source_artifact" &&
      parsed["version"] === 1 &&
      typeof parsed["content"] === "string"
    ) {
      return {
        content: parsed["content"],
        title: typeof parsed["title"] === "string" ? parsed["title"] : null,
        metadata: asRecord(parsed["metadata"]),
      };
    }
  } catch {
    // Older testnet artifacts stored the raw content string directly.
  }

  return {
    content: value,
    title: null,
    metadata: {},
  };
}

type ParserResult = {
  content: string;
  parser?: ParsedProcessableContent["parser"];
  conversation?: ParsedProcessableContent["conversation"];
};

type SourceParser = (payload: PrivateSourcePayload) => ParserResult | Promise<ParserResult>;

const SOURCE_PARSERS: Record<string, SourceParser> = {
  markdown: (payload) => {
    const parsed = parseMarkdown({ content: payload.content, title: payload.title });
    return { content: parsed.content, parser: parsed.parser, conversation: parsed.conversation };
  },
  upload: (payload) => {
    const parsed = parsePlainText({ content: payload.content, title: payload.title });
    return { content: parsed.content, parser: parsed.parser, conversation: parsed.conversation };
  },
  docx: async (payload) => {
    const parsed = await parseDocx({ content: payload.content, title: payload.title });
    return { content: parsed.content, parser: parsed.parser, conversation: parsed.conversation };
  },
  csv: (payload) => {
    const parsed = parseCsv({ content: payload.content, title: payload.title });
    return { content: parsed.content, parser: parsed.parser, conversation: parsed.conversation };
  },
  email: async (payload) => {
    const parsed = await parseEmail({ content: payload.content, title: payload.title });
    return { content: parsed.content, parser: parsed.parser, conversation: parsed.conversation };
  },
  pdf: parsePdfPayload,
  ocr_pdf: async (payload) => {
    const parsed = await parseOcrScannedPdf({ content: payload.content, title: payload.title });
    return { content: parsed.content, parser: parsed.parser, conversation: parsed.conversation };
  },
  image: async (payload) => {
    const parsed = await parseImage({
      content: payload.content,
      title: payload.title,
      mimeType: readMetadataString(payload.metadata, "fileType"),
    });
    return { content: parsed.content, parser: parsed.parser };
  },
  github: (payload) => {
    const parsed = parseGitHubImport({ content: payload.content, title: payload.title });
    return { content: parsed.content, parser: parsed.parser };
  },
  browser_history: (payload) => {
    const parsed = parseBrowserHistory({ content: payload.content, title: payload.title });
    return { content: parsed.content, parser: parsed.parser };
  },
  url: async (payload) => {
    const parsed = await parseUrl({ content: payload.content, title: payload.title });
    return { content: parsed.content, parser: parsed.parser };
  },
  chat_export: (payload) => {
    const parsed = parseChatExport({ content: payload.content, title: payload.title });
    return { content: parsed.content, parser: parsed.parser, conversation: parsed.conversation };
  },
  slack_export: (payload) => {
    const parsed = parseSlackExport({ content: payload.content, title: payload.title });
    return { content: parsed.content, parser: parsed.parser, conversation: parsed.conversation };
  },
  whatsapp_export: (payload) => {
    const parsed = parseWhatsAppExport({ content: payload.content, title: payload.title });
    return { content: parsed.content, parser: parsed.parser, conversation: parsed.conversation };
  },
};

async function parsePdfPayload(payload: PrivateSourcePayload): Promise<ParserResult> {
  const parsedText = await parseTextPdf({ content: payload.content, title: payload.title });

  if (parsedText.content.trim()) {
    return {
      content: parsedText.content,
      parser: parsedText.parser,
      conversation: parsedText.conversation,
    };
  }

  const parsedOcr = await parseOcrScannedPdf({ content: payload.content, title: payload.title });

  return {
    content: parsedOcr.content,
    parser: parsedOcr.parser
      ? {
          ...parsedOcr.parser,
          warnings: [
            ...(parsedText.parser?.warnings ?? []),
            "pdf_text_empty_ocr_fallback",
            ...parsedOcr.parser.warnings,
          ],
        }
      : parsedOcr.parser,
    conversation: parsedOcr.conversation,
  };
}

export async function parseProcessableContent(
  artifact: QueuedArtifact,
  payload: PrivateSourcePayload,
): Promise<ParsedProcessableContent> {
  const parser = SOURCE_PARSERS[artifact.sourceType];

  if (!parser) {
    return { content: payload.content.trim() };
  }

  return parser(payload);
}

export function readConversationMemoryPolicy(content: string, sourceType: string): Record<string, unknown> | null {
  const attributionMarkersPresent =
    /(^|\n)(?:\[[^\]]+\]\s+)?(?:self|other|unknown|system)\/[^:\n]+:/i.test(content);
  const voiceDerived = sourceType === "voice_conversation";
  const conversationSource =
    voiceDerived || sourceType === "chat_export" || sourceType === "slack_export" || sourceType === "whatsapp_export";

  if (!attributionMarkersPresent && !conversationSource) {
    return null;
  }

  return {
    sourceKind: "conversation",
    conversationSourceType: sourceType,
    ...(voiceDerived ? { voiceDerived: true } : {}),
    ...(attributionMarkersPresent
      ? {
          attributionAware: true,
          speakerRolePolicy: "self_claims_only_for_user_memory",
        }
      : {}),
  };
}
