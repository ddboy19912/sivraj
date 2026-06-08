import { describe, expect, it, vi } from "vitest";
import { readNotionBlocks, shouldStopNotionBlockTraversal } from "./notion-blocks.js";

describe("connector notion block helpers", () => {
  it("stops traversal at max depth", () => {
    expect(shouldStopNotionBlockTraversal(5)).toBe(true);
    expect(shouldStopNotionBlockTraversal(2)).toBe(false);
  });

  it("reads notion blocks into lines", async () => {
    const fetchNotionJson = vi.fn()
      .mockResolvedValueOnce({
        results: [{
          id: "block-1",
          type: "paragraph",
          paragraph: { rich_text: [{ plain_text: "Hello" }] },
          has_children: false,
        }],
        has_more: false,
      });

    const lines: string[] = [];
    await readNotionBlocks({
      fetcher: fetch,
      token: "token",
      blockId: "page-1",
      lines,
      depth: 0,
      onBlock: () => true,
      fetchNotionJson,
    });

    expect(lines).toEqual(["Hello"]);
  });
});
