import { lookup } from "node:dns/promises";
import type { ParsedArtifact } from "../types.js";
import { normalizeWhitespaceText } from "./shared/text.js";

const URL_PARSER_NAME = "url";
const MAX_URL_RESPONSE_BYTES = 2 * 1024 * 1024;
const URL_FETCH_TIMEOUT_MS = 8_000;
const URL_MAX_REDIRECTS = 3;

export type UrlParserFetch = typeof fetch;
export type UrlHostResolver = (hostname: string) => Promise<readonly UrlResolvedAddress[]>;

type UrlResolvedAddress = {
  address: string;
};

export async function parseUrl(input: {
  content: string;
  title?: string | null;
  fetcher?: UrlParserFetch;
  hostResolver?: UrlHostResolver;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}): Promise<ParsedArtifact> {
  const originalLength = input.content.length;
  const warnings: string[] = [];
  const urls = extractUrls(input.content);
  const primaryUrl = urls[0] ?? null;

  if (!primaryUrl) {
    warnings.push("url_no_http_url_found");
    const content = normalizeWhitespaceText(input.content);
    return parsedUrlResult({ content, originalLength, warnings });
  }

  const hostResolver = input.hostResolver ?? defaultUrlHostResolver;
  const rejection = await readUrlFetchRejection(primaryUrl, hostResolver).catch(() => "url_dns_lookup_failed");
  if (rejection) {
    warnings.push(rejection);
    return parsedUrlResult({
      content: renderUrlFallbackContent(primaryUrl, input.content),
      originalLength,
      warnings,
    });
  }

  const fetcher = input.fetcher ?? fetch;
  const maxBytes = input.maxBytes ?? MAX_URL_RESPONSE_BYTES;
  const timeoutMs = input.timeoutMs ?? URL_FETCH_TIMEOUT_MS;
  const maxRedirects = input.maxRedirects ?? URL_MAX_REDIRECTS;
  const fetched = await fetchUrlText({
    fetcher,
    hostResolver,
    url: primaryUrl,
    timeoutMs,
    maxBytes,
    maxRedirects,
    warnings,
  });

  if (!fetched) {
    return parsedUrlResult({
      content: renderUrlFallbackContent(primaryUrl, input.content),
      originalLength,
      warnings,
    });
  }

  const rendered = renderFetchedUrlContent({
    url: fetched.url,
    title: fetched.title ?? input.title ?? null,
    text: fetched.text,
    originalContent: input.content,
  });

  return parsedUrlResult({
    content: rendered,
    originalLength,
    warnings,
  });
}

function parsedUrlResult(input: {
  content: string;
  originalLength: number;
  warnings: string[];
}): ParsedArtifact {
  const content = normalizeWhitespaceText(input.content);

  if (!content) {
    input.warnings.push("url_empty_after_parse");
  }

  return {
    content,
    parser: {
      name: URL_PARSER_NAME,
      originalLength: input.originalLength,
      parsedLength: content.length,
      warnings: input.warnings,
    },
  };
}

async function fetchUrlText(input: {
  fetcher: UrlParserFetch;
  hostResolver: UrlHostResolver;
  url: URL;
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  warnings: string[];
}): Promise<{ url: string; title: string | null; text: string } | null> {
  let currentUrl = input.url;

  for (let redirectCount = 0; redirectCount <= input.maxRedirects; redirectCount += 1) {
    const rejection = await readUrlFetchRejection(currentUrl, input.hostResolver).catch(() => "url_dns_lookup_failed");
    if (rejection) {
      input.warnings.push(rejection);
      return null;
    }

    const response = await fetchWithTimeout(input.fetcher, currentUrl, input.timeoutMs).catch((error: unknown) => {
      input.warnings.push(error instanceof Error && error.name === "AbortError"
        ? "url_fetch_timeout"
        : "url_fetch_failed");
      return null;
    });

    if (!response) {
      return null;
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      const nextUrl = location ? parseRedirectUrl(currentUrl, location) : null;

      if (!nextUrl) {
        input.warnings.push("url_redirect_missing_location");
        return null;
      }

      if (redirectCount === input.maxRedirects) {
        input.warnings.push("url_too_many_redirects");
        return null;
      }

      currentUrl = nextUrl;
      continue;
    }

    if (!response.ok) {
      input.warnings.push(`url_fetch_http_${response.status}`);
      return null;
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
    const isPlainText = contentType.startsWith("text/plain") || contentType.includes("text/markdown");

    if (!isHtml && !isPlainText) {
      input.warnings.push("url_unsupported_content_type");
      return null;
    }

    const body = await readResponseText(response, input.maxBytes).catch(() => {
      input.warnings.push("url_response_read_failed");
      return null;
    });

    if (!body) {
      return null;
    }

    if (body.truncated) {
      input.warnings.push("url_response_truncated");
    }

    const text = isHtml ? extractReadableHtmlText(body.text) : normalizeWhitespaceText(body.text);

    if (!text) {
      input.warnings.push("url_empty_after_fetch");
      return null;
    }

    return {
      url: currentUrl.toString(),
      title: isHtml ? extractHtmlTitle(body.text) : null,
      text,
    };
  }

  input.warnings.push("url_too_many_redirects");
  return null;
}

async function fetchWithTimeout(fetcher: UrlParserFetch, url: URL, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetcher(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "text/html,text/plain;q=0.9,*/*;q=0.1",
        "user-agent": "SivrajBot/1.0 (+https://sivraj.ai)",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponseText(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer).slice(0, maxBytes);
    return {
      text: new TextDecoder().decode(bytes),
      truncated: buffer.byteLength > maxBytes,
    };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let truncated = false;

  while (true) {
    const next = await reader.read();
    if (next.done) {
      break;
    }

    const chunk = next.value;
    const remainingBytes = maxBytes - totalBytes;

    if (remainingBytes <= 0) {
      truncated = true;
      break;
    }

    chunks.push(chunk.byteLength > remainingBytes ? chunk.slice(0, remainingBytes) : chunk);
    totalBytes += Math.min(chunk.byteLength, remainingBytes);

    if (chunk.byteLength > remainingBytes) {
      truncated = true;
      break;
    }
  }

  await reader.cancel().catch(() => undefined);

  return {
    text: new TextDecoder().decode(concatBytes(chunks, totalBytes)),
    truncated,
  };
}

function concatBytes(chunks: Uint8Array[], byteLength: number): Uint8Array {
  const combined = new Uint8Array(byteLength);
  let offset = 0;

  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return combined;
}

function renderFetchedUrlContent(input: {
  url: string;
  title: string | null;
  text: string;
  originalContent: string;
}): string {
  return [
    input.title ? `Title: ${input.title}` : null,
    `URL: ${input.url}`,
    "",
    input.text,
    "",
    normalizeWhitespaceText(input.originalContent),
  ].filter(Boolean).join("\n");
}

function renderUrlFallbackContent(url: URL, originalContent: string): string {
  return [
    `URL: ${url.toString()}`,
    "",
    normalizeWhitespaceText(originalContent),
  ].filter(Boolean).join("\n");
}

function extractReadableHtmlText(html: string): string {
  const withoutNoise = html
    .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/giu, " ")
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<\/(?:p|div|section|article|header|footer|main|li|h[1-6]|tr|br)>/giu, "\n")
    .replace(/<[^>]+>/gu, " ");

  return normalizeWhitespaceText(decodeHtmlEntities(withoutNoise));
}

function extractHtmlTitle(html: string): string | null {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(html)?.[1];
  const normalized = title ? normalizeWhitespaceText(decodeHtmlEntities(title)) : "";

  return normalized || null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, "\"")
    .replace(/&#39;/giu, "'")
    .replace(/&#(\d+);/gu, (_match, code: string) => {
      const value = Number.parseInt(code, 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : "";
    });
}

function extractUrls(content: string): URL[] {
  const matches = content.match(/[a-z][a-z0-9+.-]*:\/\/[^\s<>"')\]]+/giu) ?? [];

  return matches.flatMap((raw) => {
    const cleaned = raw.replace(/[),.;\]]+$/u, "");
    try {
      return [new URL(cleaned)];
    } catch {
      return [];
    }
  });
}

function parseRedirectUrl(base: URL, location: string): URL | null {
  try {
    return new URL(location, base);
  } catch {
    return null;
  }
}

async function defaultUrlHostResolver(hostname: string): Promise<readonly UrlResolvedAddress[]> {
  const resolved = await lookup(hostname, { all: true, verbatim: true });

  return resolved.map((entry) => ({ address: entry.address }));
}

async function readUrlFetchRejection(url: URL, hostResolver: UrlHostResolver): Promise<string | null> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "url_non_http_protocol";
  }

  if (url.username || url.password) {
    return "url_credentials_rejected";
  }

  const hostname = url.hostname.toLowerCase();

  if (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    return "url_private_host_rejected";
  }

  if (isPrivateIpLikeHost(hostname)) {
    return "url_private_host_rejected";
  }

  const resolvedAddresses = await hostResolver(hostname);
  if (resolvedAddresses.some((entry) => isPrivateIpLikeHost(entry.address.toLowerCase()))) {
    return "url_private_host_rejected";
  }

  return null;
}

function isPrivateIpLikeHost(hostname: string): boolean {
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(hostname);
  if (ipv4) {
    const parts = ipv4.slice(1).map((part) => Number.parseInt(part, 10));
    if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return false;
    }

    const [a, b, c] = parts;
    return a === 10 ||
      a === 0 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224;
  }

  if (!hostname.includes(":")) {
    return false;
  }

  const ipv6 = hostname.replace(/^\[/u, "").replace(/\]$/u, "");

  return ipv6 === "::1" ||
    ipv6 === "::" ||
    ipv6.startsWith("fc") ||
    ipv6.startsWith("fd") ||
    ipv6.startsWith("fe80:") ||
    ipv6.startsWith("::ffff:10.") ||
    ipv6.startsWith("::ffff:127.") ||
    ipv6.startsWith("::ffff:169.254.") ||
    ipv6.startsWith("::ffff:192.168.");
}
