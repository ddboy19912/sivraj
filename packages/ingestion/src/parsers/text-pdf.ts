import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ParsedArtifact } from "../types.js";
import {
  createEmptyParseResult,
  defaultOcrCommandRunner,
  normalizeOcrText,
  readBase64Payload,
  type OcrCommandRunner,
} from "./shared/ocr.js";
export type { OcrCommandRunner } from "./shared/ocr.js";

const TEXT_PDF_PARSER_NAME = "text_pdf";
const MAX_TEXT_PDF_BYTES = 50 * 1024 * 1024;

export async function parseTextPdf(input: {
  content: string;
  title?: string | null;
  runner?: OcrCommandRunner;
}): Promise<ParsedArtifact> {
  const originalLength = input.content.length;
  const warnings: string[] = [];
  const pdfBytes = readBase64Payload(input.content);

  if (pdfBytes.length === 0) {
    warnings.push("pdf_empty_payload");
    return createEmptyParseResult(TEXT_PDF_PARSER_NAME, originalLength, warnings);
  }

  if (pdfBytes.length > MAX_TEXT_PDF_BYTES) {
    throw new Error(`PDF payload exceeds ${MAX_TEXT_PDF_BYTES} bytes.`);
  }

  const runner = input.runner ?? defaultOcrCommandRunner;
  const directory = await mkdtemp(join(tmpdir(), "sivraj-text-pdf-"));

  try {
    const pdfPath = join(directory, "source.pdf");
    await writeFile(pdfPath, pdfBytes);

    const [textResult, pdfInfo] = await Promise.all([
      runner("pdftotext", ["-layout", pdfPath, "-"]),
      readPdfInfo(runner, pdfPath),
    ]);
    const pages = splitPdfTextPages(textResult.stdout);
    const content = pages.length > 0 ? pages.join("\n") : normalizeOcrText(textResult.stdout);
    const document = buildParsedDocumentMetadata({
      title: input.title ?? pdfInfo.title,
      pageCount: pdfInfo.pageCount ?? pages.length,
      pages,
    });

    if (!content) {
      warnings.push("pdf_empty_after_parse");
    }

    return {
      content,
      parser: {
        name: TEXT_PDF_PARSER_NAME,
        originalLength,
        parsedLength: content.length,
        warnings,
        ...(document ? { document } : {}),
      },
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function readPdfInfo(
  runner: OcrCommandRunner,
  pdfPath: string,
): Promise<{ title?: string; pageCount?: number }> {
  try {
    const result = await runner("pdfinfo", [pdfPath]);
    return parsePdfInfo(result.stdout);
  } catch {
    return {};
  }
}

function parsePdfInfo(value: string): { title?: string; pageCount?: number } {
  const output: { title?: string; pageCount?: number } = {};

  for (const line of value.split(/\r?\n/u)) {
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey?.trim().toLowerCase();
    const rawValue = rest.join(":").trim();

    if (key === "title" && rawValue) {
      output.title = rawValue;
    }

    if (key === "pages") {
      const pageCount = Number.parseInt(rawValue, 10);
      if (Number.isFinite(pageCount) && pageCount > 0) {
        output.pageCount = pageCount;
      }
    }
  }

  return output;
}

function splitPdfTextPages(value: string): string[] {
  const pages = value.split("\f").map((page) => normalizeOcrText(page));
  const trailingPage = pages.at(-1);

  return trailingPage === "" ? pages.slice(0, -1) : pages;
}

function buildParsedDocumentMetadata(input: {
  title?: string | null;
  pageCount?: number;
  pages: string[];
}) {
  if (!input.title && !input.pageCount && input.pages.length === 0) {
    return null;
  }

  let cursor = 0;
  const pages = input.pages.map((page, index) => {
    const charStart = cursor;
    const charEnd = charStart + page.length;
    cursor = charEnd + 1;

    return {
      pageNumber: index + 1,
      charStart,
      charEnd,
      textLength: page.length,
    };
  });

  return {
    ...(input.title ? { title: input.title } : {}),
    ...(input.pageCount ? { pageCount: input.pageCount } : {}),
    ...(pages.length > 0 ? { pages } : {}),
  };
}
