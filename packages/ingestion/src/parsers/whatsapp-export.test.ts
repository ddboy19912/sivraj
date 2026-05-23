import { describe, expect, it } from "vitest";
import { parseWhatsAppExport } from "./whatsapp-export.js";

describe("parseWhatsAppExport", () => {
  it("extracts WhatsApp text export lines", () => {
    const parsed = parseWhatsAppExport({
      content: [
        "01/04/2024, 10:00 - Tunde: Lead with compliance.",
        "01/04/2024, 10:02 - Ada: Trust reduces procurement friction.",
      ].join("\n"),
    });

    expect(parsed.content).toBe(
      [
        "[01/04/2024 10:00] Tunde: Lead with compliance.",
        "[01/04/2024 10:02] Ada: Trust reduces procurement friction.",
      ].join("\n"),
    );
    expect(parsed.parser.warnings).toEqual([]);
    expect(parsed.parser.speakers).toEqual(["Tunde", "Ada"]);
    expect(parsed.conversation?.messages).toEqual([
      {
        timestamp: "01/04/2024 10:00",
        speaker: "Tunde",
        text: "Lead with compliance.",
      },
      {
        timestamp: "01/04/2024 10:02",
        speaker: "Ada",
        text: "Trust reduces procurement friction.",
      },
    ]);
  });

  it("keeps multiline messages attached to the previous sender", () => {
    const parsed = parseWhatsAppExport({
      content: [
        "01/04/2024, 10:00 - Tunde: First line",
        "second line",
      ].join("\n"),
    });

    expect(parsed.content).toBe("[01/04/2024 10:00] Tunde: First line\nsecond line");
  });

  it("returns an empty parse result for empty WhatsApp exports", () => {
    const parsed = parseWhatsAppExport({ content: " \n " });

    expect(parsed.content).toBe("");
    expect(parsed.parser.warnings).toContain("whatsapp_export_empty_after_parse");
  });
});
