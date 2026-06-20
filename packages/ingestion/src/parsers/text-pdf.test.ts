import { describe, expect, it } from "vitest";
import { type OcrCommandRunner, parseTextPdf } from "./text-pdf.js";

describe("parseTextPdf", () => {
  it("extracts searchable text from a base64 PDF with pdftotext", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner: OcrCommandRunner = async (command, args) => {
      calls.push({ command, args });
      if (command === "pdfinfo") {
        return { stdout: "Title: memory.pdf\nPages: 2\n", stderr: "" };
      }

      return { stdout: "  Memory systems\f\n\nToken savings  ", stderr: "" };
    };

    const base64Pdf = Buffer.from("%PDF-1.7").toString("base64");
    const parsed = await parseTextPdf({
      content: base64Pdf,
      title: "memory.pdf",
      runner,
    });

    expect(parsed.content).toBe("Memory systems\nToken savings");
    expect(parsed.parser).toMatchObject({
      name: "text_pdf",
      originalLength: base64Pdf.length,
      parsedLength: "Memory systems\nToken savings".length,
      warnings: [],
      document: {
        title: "memory.pdf",
        pageCount: 2,
        pages: [
          {
            pageNumber: 1,
            charStart: 0,
            charEnd: "Memory systems".length,
            textLength: "Memory systems".length,
          },
          {
            pageNumber: 2,
            charStart: "Memory systems".length + 1,
            charEnd: "Memory systems".length + 1 + "Token savings".length,
            textLength: "Token savings".length,
          },
        ],
      },
    });
    expect(calls.map((call) => call.command).sort()).toEqual([
      "pdfinfo",
      "pdftotext",
    ]);
  });

  it("accepts data URL PDF payloads", async () => {
    const parsed = await parseTextPdf({
      content: `data:application/pdf;base64,${Buffer.from("%PDF-1.7").toString("base64")}`,
      runner: async () => ({
        stdout: "Calibration code: ORCHID-LANTERN-742",
        stderr: "",
      }),
    });

    expect(parsed.content).toBe("Calibration code: ORCHID-LANTERN-742");
  });

  it("preserves extracted PDF page slots so page numbers do not drift", async () => {
    const parsed = await parseTextPdf({
      content: Buffer.from("%PDF-1.7").toString("base64"),
      runner: async (command) =>
        command === "pdfinfo"
          ? { stdout: "Pages: 4\n", stderr: "" }
          : { stdout: "Cover\f\n\n\fChapter one\fLast page\f", stderr: "" },
    });

    expect(parsed.content).toBe("Cover\n\nChapter one\nLast page");
    expect(parsed.parser.document?.pages).toEqual([
      { pageNumber: 1, charStart: 0, charEnd: 5, textLength: 5 },
      { pageNumber: 2, charStart: 6, charEnd: 6, textLength: 0 },
      { pageNumber: 3, charStart: 7, charEnd: 18, textLength: 11 },
      { pageNumber: 4, charStart: 19, charEnd: 28, textLength: 9 },
    ]);
  });

  it("returns an empty parse result for empty payloads", async () => {
    const parsed = await parseTextPdf({ content: "" });

    expect(parsed.content).toBe("");
    expect(parsed.parser.warnings).toContain("pdf_empty_payload");
  });
});
