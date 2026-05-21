import { describe, expect, it, vi } from "vitest";
import { parseOcrScannedPdf, type OcrCommandRunner } from "./ocr-scanned-pdf.js";

describe("parseOcrScannedPdf", () => {
  it("renders a base64 PDF and OCRs page images into retrievable text", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner: OcrCommandRunner = async (command, args) => {
      calls.push({ command, args });

      if (command === "pdftoppm") {
        await import("node:fs/promises").then(({ writeFile }) =>
          writeFile(args.at(-1) + "-1.png", "fake image"),
        );
        return { stdout: "", stderr: "" };
      }

      return { stdout: "  Founder   positioning\n\nTrust angle  ", stderr: "" };
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
  });

  it("accepts a data URL PDF payload", async () => {
    const runner = vi.fn(async (command: string, args: string[]) => {
      if (command === "pdftoppm") {
        await import("node:fs/promises").then(({ writeFile }) =>
          writeFile(args.at(-1) + "-1.png", "fake image"),
        );
        return { stdout: "", stderr: "" };
      }

      return { stdout: "Scanned memo", stderr: "" };
    });

    const parsed = await parseOcrScannedPdf({
      content: `data:application/pdf;base64,${Buffer.from("%PDF-1.7").toString("base64")}`,
      runner,
    });

    expect(parsed.content).toBe("Scanned memo");
  });

  it("returns an empty parse result when no rendered pages are produced", async () => {
    const parsed = await parseOcrScannedPdf({
      content: Buffer.from("%PDF-1.7").toString("base64"),
      runner: async () => ({ stdout: "", stderr: "" }),
    });

    expect(parsed.content).toBe("");
    expect(parsed.parser.warnings).toContain("ocr_pdf_no_pages_rendered");
  });
});
