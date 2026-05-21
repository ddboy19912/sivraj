import { describe, expect, it } from "vitest";
import { parseImage, type ImageOcrCommandRunner } from "./image.js";

describe("parseImage", () => {
  it("OCRs a base64 image payload into retrievable text", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner: ImageOcrCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return { stdout: "  Launch   checklist\n\nShip demo  ", stderr: "" };
    };

    const content = Buffer.from("fake image bytes").toString("base64");
    const parsed = await parseImage({
      content,
      title: "screenshot.png",
      mimeType: "image/png",
      runner,
    });

    expect(parsed.content).toBe("Launch checklist\nShip demo");
    expect(parsed.parser).toEqual({
      name: "image_ocr",
      originalLength: content.length,
      parsedLength: "Launch checklist\nShip demo".length,
      warnings: [],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("tesseract");
    expect(calls[0]?.args[0]).toMatch(/source\.png$/);
  });

  it("accepts image data URLs", async () => {
    const parsed = await parseImage({
      content: `data:image/png;base64,${Buffer.from("fake image bytes").toString("base64")}`,
      runner: async () => ({ stdout: "Diagram text", stderr: "" }),
    });

    expect(parsed.content).toBe("Diagram text");
  });

  it("returns an empty parse result for empty payloads", async () => {
    const parsed = await parseImage({ content: "" });

    expect(parsed.content).toBe("");
    expect(parsed.parser.warnings).toContain("image_empty_payload");
  });
});
