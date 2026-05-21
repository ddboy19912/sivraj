import { describe, expect, it } from "vitest";
import { parseEmail } from "./email.js";

describe("parseEmail", () => {
  it("extracts readable fields and body from raw email", async () => {
    const parsed = await parseEmail({
      content: [
        "From: Ada <ada@example.com>",
        "To: Tunde <tunde@example.com>",
        "Subject: Compliance angle",
        "Date: Mon, 1 Apr 2024 10:00:00 +0000",
        "",
        "Lead with trust before features.",
      ].join("\r\n"),
    });

    expect(parsed.content).toContain("Subject: Compliance angle");
    expect(parsed.content).toContain("From:");
    expect(parsed.content).toContain("ada@example.com");
    expect(parsed.content).toContain("To:");
    expect(parsed.content).toContain("tunde@example.com");
    expect(parsed.content).toContain("Lead with trust before features.");
    expect(parsed.parser).toMatchObject({
      name: "email",
      warnings: [],
    });
  });

  it("returns an empty parse result for blank email content", async () => {
    const parsed = await parseEmail({ content: " \n " });

    expect(parsed.content).toBe("");
    expect(parsed.parser.warnings).toContain("email_empty_after_parse");
  });
});
