import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv.js";

describe("parseCsv", () => {
  it("turns csv rows into readable table text", () => {
    const parsed = parseCsv({
      content: "client,angle,result\nFintechCo,compliance-first,closed\nBankly,feature-led,lost",
    });

    expect(parsed.content).toBe(
      [
        "client | angle | result",
        "FintechCo | compliance-first | closed",
        "Bankly | feature-led | lost",
      ].join("\n"),
    );
    expect(parsed.parser).toMatchObject({
      name: "csv",
      parsedLength: parsed.content.length,
      warnings: [],
    });
  });

  it("handles quoted commas", () => {
    const parsed = parseCsv({
      content: 'client,note\nFintechCo,"lead with trust, not features"',
    });

    expect(parsed.content).toBe("client | note\nFintechCo | lead with trust, not features");
  });

  it("returns an empty parse result for empty csv", () => {
    const parsed = parseCsv({ content: "\n,\n" });

    expect(parsed.content).toBe("");
    expect(parsed.parser.warnings).toContain("csv_empty_after_parse");
  });
});
