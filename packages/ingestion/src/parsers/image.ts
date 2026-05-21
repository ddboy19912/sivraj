import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import type { ParsedArtifact } from "../types.js";

const execFileAsync = promisify(execFile);
const IMAGE_PARSER_NAME = "image_ocr";
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export type ImageOcrCommandRunner = (
  command: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

export async function parseImage(input: {
  content: string;
  title?: string | null;
  mimeType?: string | null;
  runner?: ImageOcrCommandRunner;
}): Promise<ParsedArtifact> {
  const originalLength = input.content.length;
  const warnings: string[] = [];
  const imageBytes = readBase64Image(input.content);

  if (imageBytes.length === 0) {
    warnings.push("image_empty_payload");
    return emptyResult(originalLength, warnings);
  }

  if (imageBytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`Image payload exceeds ${MAX_IMAGE_BYTES} bytes.`);
  }

  const runner = input.runner ?? defaultCommandRunner;
  const directory = await mkdtemp(join(tmpdir(), "sivraj-image-ocr-"));

  try {
    const imagePath = join(directory, `source${readImageExtension(input.title, input.mimeType)}`);
    await writeFile(imagePath, imageBytes);

    const result = await runner("tesseract", [imagePath, "stdout", "-l", "eng", "--psm", "6"]);
    const content = normalizeOcrText(result.stdout);

    if (!content) {
      warnings.push("image_empty_after_parse");
    }

    return {
      content,
      parser: {
        name: IMAGE_PARSER_NAME,
        originalLength,
        parsedLength: content.length,
        warnings,
      },
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function readBase64Image(content: string): Buffer {
  const trimmed = content.trim();
  const base64 = trimmed.startsWith("data:")
    ? (trimmed.split(",", 2)[1] ?? "")
    : trimmed;

  if (!base64) {
    return Buffer.alloc(0);
  }

  return Buffer.from(base64, "base64");
}

function readImageExtension(title: string | null | undefined, mimeType: string | null | undefined): string {
  const titleExtension = title ? extname(title).toLowerCase() : "";

  if ([".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff"].includes(titleExtension)) {
    return titleExtension;
  }

  if (mimeType === "image/jpeg") {
    return ".jpg";
  }

  if (mimeType === "image/webp") {
    return ".webp";
  }

  if (mimeType === "image/tiff") {
    return ".tiff";
  }

  return ".png";
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

function emptyResult(originalLength: number, warnings: string[]): ParsedArtifact {
  return {
    content: "",
    parser: {
      name: IMAGE_PARSER_NAME,
      originalLength,
      parsedLength: 0,
      warnings,
    },
  };
}
