import { describe, expect, it } from "vitest";
import { parseBrowserHistory } from "./browser-history.js";

describe("parseBrowserHistory", () => {
  it("parses JSON browser history exports", () => {
    const parsed = parseBrowserHistory({
      title: "history.json",
      content: JSON.stringify({
        history: [
          {
            title: "Sivraj",
            url: "https://sivraj.ai",
            lastVisitTime: "2026-05-20T10:00:00Z",
          },
        ],
      }),
    });

    expect(parsed.content).toContain("Browser history export: history.json");
    expect(parsed.content).toContain("2026-05-20");
    expect(parsed.content).toContain("- Sivraj");
    expect(parsed.content).toContain("URL: https://sivraj.ai");
    expect(parsed.content).toContain("Domain: sivraj.ai");
    expect(parsed.content).toContain("Visited: 2026-05-20T10:00:00.000Z");
    expect(parsed.parser.name).toBe("browser_history");
  });

  it("parses CSV browser history exports", () => {
    const parsed = parseBrowserHistory({
      title: "chrome-history-export.csv",
      content: "title,url,lastVisitTime\nSivraj,https://sivraj.ai,2026-05-20T10:00:00Z",
    });

    expect(parsed.content).toContain("Browser history export: chrome-history-export.csv");
    expect(parsed.content).toContain("URL: https://sivraj.ai");
    expect(parsed.content).toContain("Source row: 1");
  });

  it("extracts URLs from simple HTML or text exports", () => {
    const parsed = parseBrowserHistory({
      title: "history.html",
      content: '<a href="https://example.com/research">Research page</a>',
    });

    expect(parsed.content).toContain("URL: https://example.com/research");
    expect(parsed.content).toContain("Domain: example.com");
  });

  it("returns an empty parse result with warnings for unsupported exports", () => {
    const parsed = parseBrowserHistory({
      title: "empty.txt",
      content: "no visit data here",
    });

    expect(parsed.content).toBe("");
    expect(parsed.parser.warnings).toContain("browser_history_no_urls_found");
    expect(parsed.parser.warnings).toContain("browser_history_empty_after_parse");
  });
});
