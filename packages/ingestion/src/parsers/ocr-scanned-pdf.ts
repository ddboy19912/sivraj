import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ParsedArtifact } from "../types.js";

const execFileAsync = promisify(execFile);
const OCR_SCANNED_PDF_PARSER_NAME = "ocr_scanned_pdf";
const MAX_OCR_PDF_BYTES = 25 * 1024 * 1024;

export type OcrCommandRunner = (
  command: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

export async function parseOcrScannedPdf(input: {
  content: string;
  title?: string | null;
  runner?: OcrCommandRunner;
}): Promise<ParsedArtifact> {
  const originalLength = input.content.length;
  const warnings: string[] = [];
  const pdfBytes = readBase64Pdf(input.content);

  if (pdfBytes.length === 0) {
    warnings.push("ocr_pdf_empty_payload");
    return emptyResult(originalLength, warnings);
  }

  if (pdfBytes.length > MAX_OCR_PDF_BYTES) {
    throw new Error(`OCR PDF payload exceeds ${MAX_OCR_PDF_BYTES} bytes.`);
  }

  const runner = input.runner ?? defaultCommandRunner;
  const directory = await mkdtemp(join(tmpdir(), "sivraj-ocr-pdf-"));

  try {
    const pdfPath = join(directory, "source.pdf");
    const imagePrefix = join(directory, "page");
    await writeFile(pdfPath, pdfBytes);

    await runner("pdftoppm", ["-png", "-r", "200", pdfPath, imagePrefix]);

    const imagePaths = (await readdir(directory))
      .filter((name) => /^page-\d+\.png$/.test(name))
      .sort((left, right) =>
        left.localeCompare(right, undefined, { numeric: true }),
      )
      .map((name) => join(directory, name));

    if (imagePaths.length === 0) {
      warnings.push("ocr_pdf_no_pages_rendered");
      return emptyResult(originalLength, warnings);
    }

    const pages: string[] = [];

    for (const imagePath of imagePaths) {
      const result = await runner("tesseract", [
        imagePath,
        "stdout",
        "-l",
        "eng",
        "--psm",
        "6",
      ]);
      const pageText = normalizeOcrText(result.stdout);

      if (pageText) {
        pages.push(pageText);
      }
    }

    const content = pages.join("\n\n").trim();

    if (!content) {
      warnings.push("ocr_pdf_empty_after_parse");
    }

    return {
      content,
      parser: {
        name: OCR_SCANNED_PDF_PARSER_NAME,
        originalLength,
        parsedLength: content.length,
        warnings,
      },
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function readBase64Pdf(content: string): Buffer {
  const trimmed = content.trim();
  const base64 = trimmed.startsWith("data:")
    ? (trimmed.split(",", 2)[1] ?? "")
    : trimmed;

  if (!base64) {
    return Buffer.alloc(0);
  }

  return Buffer.from(base64, "base64");
}

async function defaultCommandRunner(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(command, args, {
    maxBuffer: 20 * 1024 * 1024,
  });
}

function normalizeOcrText(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function emptyResult(
  originalLength: number,
  warnings: string[],
): ParsedArtifact {
  return {
    content: "",
    parser: {
      name: OCR_SCANNED_PDF_PARSER_NAME,
      originalLength,
      parsedLength: 0,
      warnings,
    },
  };
}
