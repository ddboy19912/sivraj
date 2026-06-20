import type { StructuredGenerator } from "@sivraj/llm";
import type { ParserMetadata } from "@sivraj/ingestion";

const MAX_STRUCTURE_INPUT_CHARS = 80_000;
const MAX_STRUCTURE_ITEMS = 250;

export type DocumentStructureItem = {
  itemType: string;
  label: string;
  normalizedLabel: string;
  ordinal: number | null;
  pageStart: number | null;
  pageEnd: number | null;
  charStart: number | null;
  charEnd: number | null;
  confidenceScore: number | null;
  extractionMethod: string;
  metadata: Record<string, unknown>;
};

export async function extractDocumentStructure(input: {
  content: string;
  parser: ParserMetadata | null | undefined;
  title?: string | null;
  fileName?: string | null;
  generator?: StructuredGenerator | null;
}): Promise<DocumentStructureItem[]> {
  if (!input.generator || input.content.trim().length === 0) {
    return [];
  }

  const output = await input.generator.generateJson({
    temperature: 0,
    timeoutMs: 45_000,
    system: [
      "You extract durable document structure for a private user-owned memory system.",
      "Use the supplied document text and page metadata. Do not invent chapters, headings, or page numbers.",
      "Prefer semantic intelligence over brittle formatting. The text may be OCR or PDF extraction output.",
      "Return only JSON with shape {\"items\":[{\"itemType\":\"chapter|heading|section|part|toc_entry|other\",\"label\":\"string\",\"ordinal\":1,\"pageStart\":1,\"pageEnd\":2,\"charStart\":0,\"charEnd\":100,\"confidence\":0.0,\"notes\":\"short\"}]}",
      "For books, capture chapters and parts. For documents, capture headings and sections. Include pageStart/pageEnd when inferable from page metadata or explicit page references.",
      "If there is no reliable structure, return {\"items\":[]}.",
    ].join("\n"),
    prompt: JSON.stringify({
      title: input.title ?? input.parser?.document?.title ?? null,
      fileName: input.fileName ?? null,
      parser: input.parser
        ? {
            name: input.parser.name,
            warnings: input.parser.warnings,
            document: input.parser.document
              ? {
                  title: input.parser.document.title,
                  pageCount: input.parser.document.pageCount,
                  pages: input.parser.document.pages?.slice(0, 500),
                }
              : null,
          }
        : null,
      text: input.content.slice(0, MAX_STRUCTURE_INPUT_CHARS),
      truncated: input.content.length > MAX_STRUCTURE_INPUT_CHARS,
    }),
  });

  return readDocumentStructureItems(output.json);
}

export function readDocumentStructureItems(value: unknown): DocumentStructureItem[] {
  const record = readRecord(value);
  const items = Array.isArray(record["items"]) ? record["items"] : [];

  return items
    .map(readDocumentStructureItem)
    .filter((item): item is DocumentStructureItem => item !== null)
    .slice(0, MAX_STRUCTURE_ITEMS);
}

function readDocumentStructureItem(value: unknown): DocumentStructureItem | null {
  const record = readRecord(value);
  const label = readString(record["label"]);
  const itemType = readItemType(record["itemType"]);

  if (!label || !itemType) {
    return null;
  }

  return {
    itemType,
    label,
    normalizedLabel: normalizeStructureLabel(label),
    ordinal: readPositiveInteger(record["ordinal"]),
    pageStart: readPositiveInteger(record["pageStart"]),
    pageEnd: readPositiveInteger(record["pageEnd"]),
    charStart: readNonNegativeInteger(record["charStart"]),
    charEnd: readNonNegativeInteger(record["charEnd"]),
    confidenceScore: readConfidence(record["confidence"]),
    extractionMethod: "llm_document_structure",
    metadata: {
      ...(readString(record["notes"]) ? { notes: readString(record["notes"]) } : {}),
    },
  };
}

function readItemType(value: unknown) {
  const itemType = readString(value)?.toLowerCase();
  return itemType === "chapter" ||
    itemType === "heading" ||
    itemType === "section" ||
    itemType === "part" ||
    itemType === "toc_entry" ||
    itemType === "other"
    ? itemType
    : null;
}

function normalizeStructureLabel(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 240);
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readPositiveInteger(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function readNonNegativeInteger(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function readConfidence(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(number, 0), 1) : null;
}
