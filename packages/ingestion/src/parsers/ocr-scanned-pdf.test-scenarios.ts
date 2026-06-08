import { expect, vi } from "vitest";

import { parseOcrScannedPdf, type OcrCommandRunner } from "./ocr-scanned-pdf.js";

async function writeFakePdfPageImage(args: string[]) {
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(args.at(-1) + "-1.png", "fake image"),
  );
}

function createPdftoppmRunner(ocrText: string): OcrCommandRunner {
  return async (command, args) => {
    if (command === "pdftoppm") {
      await writeFakePdfPageImage(args);
      return { stdout: "", stderr: "" };
    }

    return { stdout: ocrText, stderr: "" };
  };
}

export async function run_parseocrscannedpdf_renders_a_base64_pdf_and_ocrs_page_images_into_retrieva() {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runner: OcrCommandRunner = async (command, args) => {
    calls.push({ command, args });
    return createPdftoppmRunner("  Founder   positioning\n\nTrust angle  ")(command, args);
  };

  const parsed = await parseOcrScannedPdf({
    content: Buffer.from("%PDF-1.7").toString("base64"),
    title: "scan.pdf",
    runner,
  });

  expect(parsed.content).toBe("Founder positioning\nTrust angle");
  expect(parsed.parser).toEqual({
    name: "ocr_scanned_pdf",
    originalLength: Buffer.from("%PDF-1.7").toString("base64").length,
    parsedLength: "Founder positioning\nTrust angle".length,
    warnings: [],
  });
  expect(calls.map((call) => call.command)).toEqual(["pdftoppm", "tesseract"]);
}

export async function run_parseocrscannedpdf_accepts_a_data_url_pdf_payload() {
  const runner = vi.fn(createPdftoppmRunner("Scanned memo"));

  const parsed = await parseOcrScannedPdf({
    content: `data:application/pdf;base64,${Buffer.from("%PDF-1.7").toString("base64")}`,
    runner,
  });

  expect(parsed.content).toBe("Scanned memo");
}

export async function run_parseocrscannedpdf_returns_an_empty_parse_result_when_no_rendered_pages_ar() {
  const parsed = await parseOcrScannedPdf({
    content: Buffer.from("%PDF-1.7").toString("base64"),
    runner: async () => ({ stdout: "", stderr: "" }),
  });

  expect(parsed.content).toBe("");
  expect(parsed.parser.warnings).toContain("ocr_pdf_no_pages_rendered");
}
