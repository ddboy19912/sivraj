import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import type { ParsedArtifact } from "../types.js";
import {
  createEmptyParseResult,
  defaultOcrCommandRunner,
  normalizeOcrText,
  readBase64Payload,
  type OcrCommandRunner,
} from "./shared/ocr.js";

const IMAGE_PARSER_NAME = "image_ocr";
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export type ImageOcrCommandRunner = OcrCommandRunner;

export async function parseImage(input: {
  content: string;
  title?: string | null;
  mimeType?: string | null;
  runner?: ImageOcrCommandRunner;
}): Promise<ParsedArtifact> {
  const originalLength = input.content.length;
  const warnings: string[] = [];
  const imageBytes = readBase64Payload(input.content);

  if (imageBytes.length === 0) {
    warnings.push("image_empty_payload");
    return createEmptyParseResult(IMAGE_PARSER_NAME, originalLength, warnings);
  }

  if (imageBytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`Image payload exceeds ${MAX_IMAGE_BYTES} bytes.`);
  }

  const runner = input.runner ?? defaultOcrCommandRunner;
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
