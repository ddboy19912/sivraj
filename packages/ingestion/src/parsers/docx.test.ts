import { describe, expect, it } from "vitest";
import { parseDocx } from "./docx.js";

describe("parseDocx", () => {
  it("normalizes extracted docx text when binary upload is not available yet", async () => {
    const parsed = await parseDocx({
      content: "  Compliance   first.\n\n\nTrust before features.  ",
    });

    expect(parsed.content).toBe("Compliance first.\n\nTrust before features.");
    expect(parsed.parser).toMatchObject({
      name: "docx",
      warnings: ["docx_text_input_without_binary_parse"],
    });
  });

  it("fails cleanly for invalid base64 docx-like content", async () => {
    const parsed = await parseDocx({
      content: "UEsAAAA=",
    });

    expect(parsed.content).toBe("");
    expect(parsed.parser.warnings).toContain("docx_binary_parse_failed");
    expect(parsed.parser.warnings).toContain("docx_empty_after_parse");
  });
});
