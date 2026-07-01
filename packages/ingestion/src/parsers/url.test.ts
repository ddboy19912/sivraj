import { describe, expect, it } from "vitest";
import { parseUrl, type UrlHostResolver, type UrlParserFetch } from "./url.js";

describe("parseUrl", () => {
  it("extracts readable text from HTML pages", async () => {
    const parsed = await parseUrl({
      content: "Read this https://example.com/pricing for launch positioning.",
      fetcher: htmlFetch("<html><head><title>Pricing Memo</title></head><body><h1>Pricing</h1><p>Use founder-friendly pricing.</p></body></html>"),
      hostResolver: publicHostResolver,
    });

    expect(parsed.content).toContain("Title: Pricing Memo");
    expect(parsed.content).toContain("URL: https://example.com/pricing");
    expect(parsed.content).toContain("Use founder-friendly pricing.");
    expect(parsed.parser).toMatchObject({
      name: "url",
      warnings: [],
    });
  });

  it("falls back to URL-only content when fetch fails", async () => {
    const parsed = await parseUrl({
      content: "https://example.com/unreachable customer discovery notes",
      fetcher: async () => {
        throw new Error("network down");
      },
      hostResolver: publicHostResolver,
    });

    expect(parsed.content).toContain("URL: https://example.com/unreachable");
    expect(parsed.content).toContain("customer discovery notes");
    expect(parsed.parser.warnings).toContain("url_fetch_failed");
  });

  it("rejects private or local URL targets before fetching", async () => {
    let called = false;
    const parsed = await parseUrl({
      content: "http://localhost:3000/secret",
      fetcher: (async () => {
        called = true;
        return new Response("nope");
      }) as UrlParserFetch,
      hostResolver: publicHostResolver,
    });

    expect(called).toBe(false);
    expect(parsed.content).toContain("URL: http://localhost:3000/secret");
    expect(parsed.parser.warnings).toContain("url_private_host_rejected");
  });

  it("does not confuse normal domains with private IPv6 prefixes", async () => {
    let called = false;
    const parsed = await parseUrl({
      content: "https://fda.gov/example",
      fetcher: (async () => {
        called = true;
        return new Response("public page", {
          headers: { "content-type": "text/plain" },
        });
      }) as UrlParserFetch,
      hostResolver: publicHostResolver,
    });

    expect(called).toBe(true);
    expect(parsed.content).toContain("public page");
    expect(parsed.parser.warnings).toEqual([]);
  });

  it("rejects non-HTTP URL text without fetching", async () => {
    let called = false;
    const parsed = await parseUrl({
      content: "Save ftp://example.com/private",
      fetcher: (async () => {
        called = true;
        return new Response("nope");
      }) as UrlParserFetch,
      hostResolver: publicHostResolver,
    });

    expect(called).toBe(false);
    expect(parsed.content).toContain("URL: ftp://example.com/private");
    expect(parsed.parser.warnings).toContain("url_non_http_protocol");
  });

  it("rejects public-looking hosts that resolve to private addresses", async () => {
    let called = false;
    const parsed = await parseUrl({
      content: "https://example.com/private",
      fetcher: (async () => {
        called = true;
        return new Response("nope");
      }) as UrlParserFetch,
      hostResolver: async () => [{ address: "10.0.0.4" }],
    });

    expect(called).toBe(false);
    expect(parsed.content).toContain("URL: https://example.com/private");
    expect(parsed.parser.warnings).toContain("url_private_host_rejected");
  });
});

function htmlFetch(html: string): UrlParserFetch {
  return (async () => new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  })) as UrlParserFetch;
}

const publicHostResolver: UrlHostResolver = async () => [{ address: "93.184.216.34" }];
