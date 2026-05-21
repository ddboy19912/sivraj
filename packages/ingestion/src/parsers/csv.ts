import { parse } from "csv-parse/sync";
import type { ParsedArtifact } from "../types.js";

const CSV_PARSER_NAME = "csv";

export function parseCsv(input: {
  content: string;
  title?: string | null;
}): ParsedArtifact {
  const originalLength = input.content.length;
  const warnings: string[] = [];
  let records: unknown[][];

  try {
    records = parse(input.content, {
      bom: true,
      relaxColumnCount: true,
      skipEmptyLines: true,
      trim: true,
    }) as unknown[][];
  } catch {
    warnings.push("csv_parse_recovered_with_plain_text");
    records = input.content
      .split(/\r?\n/)
      .map((line) => line.split(",").map((cell) => cell.trim()))
      .filter((row) => row.some((cell) => cell.length > 0));
  }

  const content = records
    .map((row) => row.map((cell) => String(cell ?? "").trim()).filter(Boolean).join(" | "))
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!content) {
    warnings.push("csv_empty_after_parse");
  }

  return {
    content,
    parser: {
      name: CSV_PARSER_NAME,
      originalLength,
      parsedLength: content.length,
      warnings,
    },
  };
}
