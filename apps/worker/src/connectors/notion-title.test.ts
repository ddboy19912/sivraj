import { describe, expect, it } from "vitest";
import { readNotionTitle } from "../connectors.js";

describe("readNotionTitle", () => {
  it("reads the first title property", () => {
    expect(readNotionTitle({
      properties: {
        Name: {
          type: "title",
          title: [{ plain_text: "Project Notes" }],
        },
      },
    } as never)).toBe("Project Notes");
    expect(readNotionTitle({ properties: {} } as never)).toBeNull();
  });
});
