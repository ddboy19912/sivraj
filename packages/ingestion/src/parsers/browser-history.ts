import { parse as parseCsv } from "csv-parse/sync";
import type { ParsedArtifact } from "../types.js";

type BrowserVisit = {
  title: string | null;
  url: string;
  domain: string;
  visitedAt: string | null;
  sourceRow: number;
};

const BROWSER_HISTORY_PARSER_NAME = "browser_history";
const MAX_VISITS = 500;

export function parseBrowserHistory(input: {
  content: string;
  title?: string | null;
}): ParsedArtifact {
  const originalLength = input.content.length;
  const warnings: string[] = [];
  const visits = readBrowserHistoryVisits(input.content, warnings).slice(0, MAX_VISITS);

  if (visits.length === MAX_VISITS) {
    warnings.push("browser_history_truncated");
  }

  const content = formatBrowserHistory(input.title, visits);

  if (!content) {
    warnings.push("browser_history_empty_after_parse");
  }

  return {
    content,
    parser: {
      name: BROWSER_HISTORY_PARSER_NAME,
      originalLength,
      parsedLength: content.length,
      warnings,
    },
  };
}

function readBrowserHistoryVisits(content: string, warnings: string[]): BrowserVisit[] {
  const trimmed = content.trim();

  if (!trimmed) {
    warnings.push("browser_history_empty_input");
    return [];
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const jsonVisits = readJsonVisits(trimmed, warnings);

    if (jsonVisits.length > 0) {
      return jsonVisits;
    }
  }

  const csvVisits = readCsvVisits(trimmed, warnings);

  if (csvVisits.length > 0) {
    return csvVisits;
  }

  return readTextVisits(trimmed, warnings);
}

function readJsonVisits(content: string, warnings: string[]): BrowserVisit[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    warnings.push("browser_history_invalid_json");
    return [];
  }

  const records = collectCandidateRecords(parsed);
  return records.flatMap((record, index) => visitFromRecord(record, index + 1) ?? []);
}

function collectCandidateRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectCandidateRecords);
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const direct = readUrl(record) ? [record] : [];
  const nestedKeys = ["history", "items", "visits", "browserHistory", "entries", "records"];
  const nested = nestedKeys.flatMap((key) => collectCandidateRecords(record[key]));

  return [...direct, ...nested];
}

function readCsvVisits(content: string, warnings: string[]): BrowserVisit[] {
  try {
    const rows = parseCsv(content, {
      bom: true,
      columns: true,
      relaxColumnCount: true,
      skipEmptyLines: true,
      trim: true,
    }) as Record<string, unknown>[];

    return rows.flatMap((row, index) => visitFromRecord(row, index + 1) ?? []);
  } catch {
    warnings.push("browser_history_invalid_csv");
    return [];
  }
}

function readTextVisits(content: string, warnings: string[]): BrowserVisit[] {
  const urlMatches = Array.from(content.matchAll(/https?:\/\/[^\s"'<>]+/gi));

  if (urlMatches.length === 0) {
    warnings.push("browser_history_no_urls_found");
  }

  return urlMatches.flatMap((match, index) => {
    const url = cleanUrl(match[0]);
    const parsedUrl = parseUrl(url);

    if (!parsedUrl) {
      return [];
    }

    return [{
      title: readNearbyTitle(content, match.index ?? 0),
      url,
      domain: parsedUrl.hostname,
      visitedAt: null,
      sourceRow: index + 1,
    }];
  });
}

function visitFromRecord(record: Record<string, unknown>, sourceRow: number): BrowserVisit | null {
  const url = readUrl(record);
  const parsedUrl = url ? parseUrl(url) : null;

  if (!url || !parsedUrl) {
    return null;
  }

  return {
    title: readFirstString(record, ["title", "name", "pageTitle", "page_title"]) ?? parsedUrl.hostname,
    url,
    domain: parsedUrl.hostname,
    visitedAt: readVisitTime(record),
    sourceRow,
  };
}

function readUrl(record: Record<string, unknown>): string | null {
  return readFirstString(record, ["url", "href", "link", "typedUrl", "typed_url"]);
}

function readVisitTime(record: Record<string, unknown>): string | null {
  const raw = readFirstValue(record, [
    "visitTime",
    "lastVisitTime",
    "timestamp",
    "time",
    "date",
    "visitedAt",
    "last_visit_time",
  ]);

  if (typeof raw === "string") {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.valueOf()) ? raw : parsed.toISOString();
  }

  if (typeof raw === "number") {
    const parsed = new Date(raw > 10_000_000_000 ? raw : raw * 1000);
    return Number.isNaN(parsed.valueOf()) ? String(raw) : parsed.toISOString();
  }

  return null;
}

function readFirstString(record: Record<string, unknown>, keys: string[]): string | null {
  const value = readFirstValue(record, keys);

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readFirstValue(record: Record<string, unknown>, keys: string[]): unknown {
  const normalizedEntries = Object.entries(record).map(([key, value]) => [key.toLowerCase(), value] as const);

  for (const key of keys) {
    const found = normalizedEntries.find(([candidate]) => candidate === key.toLowerCase());

    if (found) {
      return found[1];
    }
  }

  return null;
}

function formatBrowserHistory(title: string | null | undefined, visits: BrowserVisit[]): string {
  if (visits.length === 0) {
    return "";
  }

  const sections = [`Browser history export: ${title ?? "Untitled export"}`];
  const grouped = groupByDay(visits);

  for (const [day, dayVisits] of grouped) {
    sections.push(`\n${day}`);

    for (const visit of dayVisits) {
      sections.push([
        `- ${visit.title ?? visit.domain}`,
        `  URL: ${visit.url}`,
        `  Domain: ${visit.domain}`,
        ...(visit.visitedAt ? [`  Visited: ${visit.visitedAt}`] : []),
        `  Source row: ${visit.sourceRow}`,
      ].join("\n"));
    }
  }

  return sections.join("\n").trim();
}

function groupByDay(visits: BrowserVisit[]): Map<string, BrowserVisit[]> {
  const grouped = new Map<string, BrowserVisit[]>();

  for (const visit of visits) {
    const day = visit.visitedAt?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "Undated";
    grouped.set(day, [...(grouped.get(day) ?? []), visit]);
  }

  return grouped;
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function cleanUrl(url: string): string {
  return url.replace(/[),.;\]]+$/, "");
}

function readNearbyTitle(content: string, index: number): string | null {
  const start = Math.max(0, index - 120);
  const nearby = content.slice(start, index).split(/\n/).at(-1)?.trim();

  return nearby && nearby.length > 0 ? nearby.replace(/[-–—:|]+$/, "").trim() : null;
}
