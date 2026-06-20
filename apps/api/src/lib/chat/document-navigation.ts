/**
 * Document retrieval planning — parse LLM navigation plans and page scope.
 */
import { clampConfidence, parseJsonObject } from "./chat-json.js";
import { readPositiveInteger } from "./helpers.js";
import { optionalString, readRecord } from "../http/route-helpers.js";
import type {
  DocumentInventoryItem,
  DocumentNavigationPageScope,
  DocumentNavigationTarget,
  DocumentRetrievalPlan,
} from "./turn-types.js";
import { isUuid } from "./attachments.js";

export const CHAT_DOCUMENT_TARGET_PAGE_LIMIT_DEFAULT = 8;
export const CHAT_DOCUMENT_DIRECT_PAGE_LIMIT_DEFAULT = 16;

/** Parse the document navigator LLM output into a bounded retrieval plan. */
export function readDocumentRetrievalPlan(
  content: string,
  inventory: DocumentInventoryItem[],
): DocumentRetrievalPlan {
  const allowedIds = new Set(inventory.map((item) => item.artifactId));
  const parsed = parseJsonObject(content);
  const mode = readRetrievalMode(parsed?.["mode"]);
  const artifactIds = Array.isArray(parsed?.["artifactIds"])
    ? parsed["artifactIds"].filter(
        (id): id is string => typeof id === "string" && allowedIds.has(id),
      )
    : [];
  const targetPages = Array.isArray(parsed?.["targetPages"])
    ? parsed["targetPages"]
        .map(readPositivePageNumber)
        .filter((page): page is number => page !== null)
    : [];
  return {
    source: "llm",
    mode,
    inspectionMode: readInspectionMode(parsed?.["inspectionMode"], targetPages, mode),
    task: readDocumentNavigationTask(parsed?.["task"]),
    target: readDocumentNavigationTarget(parsed?.["target"], targetPages),
    artifactIds: Array.from(new Set(artifactIds)),
    targetPages: Array.from(new Set(targetPages)).slice(
      0,
      readPositiveInteger(
        process.env["CHAT_DOCUMENT_TARGET_PAGE_LIMIT"],
        CHAT_DOCUMENT_TARGET_PAGE_LIMIT_DEFAULT,
      ),
    ),
    exactQuery: optionalString(parsed?.["exactQuery"])?.slice(0, 240) ?? null,
    matchMode: readDocumentMatchMode(parsed?.["matchMode"]),
    confidence: clampConfidence(parsed?.["confidence"]),
    needsClarification: parsed?.["needsClarification"] === true,
    reason: optionalString(parsed?.["reason"])?.slice(0, 200),
  };
}

function readDocumentNavigationTask(
  value: unknown,
): DocumentRetrievalPlan["task"] {
  return value === "summarize"
    || value === "extract"
    || value === "count"
    || value === "compare"
    || value === "answer"
    ? value
    : "answer";
}

function readDocumentNavigationTarget(
  value: unknown,
  targetPages: number[],
): DocumentNavigationTarget {
  const record = readRecord(value);
  const kind = optionalString(record["kind"]);
  if (kind === "pages") {
    const pages = Array.isArray(record["pages"])
      ? record["pages"].map(readPositivePageNumber).filter((page): page is number => page !== null)
      : targetPages;
    return pages.length > 0
      ? { kind: "pages", pages: Array.from(new Set(pages)) }
      : { kind: "none" };
  }
  if (kind === "page_range") {
    const pageStart = readPositivePageNumber(record["pageStart"]);
    const pageEnd = readPositivePageNumber(record["pageEnd"]);
    if (pageStart && pageEnd) {
      return {
        kind: "page_range",
        pageStart: Math.min(pageStart, pageEnd),
        pageEnd: Math.max(pageStart, pageEnd),
      };
    }
  }
  if (kind === "fraction") {
    const start = readFraction(record["start"]);
    const end = readFraction(record["end"]);
    if (start !== null && end !== null && start !== end) {
      return {
        kind: "fraction",
        start: Math.min(start, end),
        end: Math.max(start, end),
      };
    }
  }
  if (kind === "relative_position") {
    const position = readRelativePosition(record["position"]);
    const windowFraction = readFraction(record["windowFraction"]) ?? 0.15;
    if (position) {
      return {
        kind: "relative_position",
        position,
        windowFraction: Math.min(Math.max(windowFraction, 0.03), 1),
      };
    }
  }
  if (kind === "whole_document") {
    return { kind: "whole_document" };
  }
  return targetPages.length > 0
    ? { kind: "pages", pages: Array.from(new Set(targetPages)) }
    : { kind: "none" };
}

function readFraction(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(number, 0), 1) : null;
}

function readRelativePosition(
  value: unknown,
): "beginning" | "middle" | "end" | null {
  return value === "beginning" || value === "middle" || value === "end" ? value : null;
}

function readInspectionMode(
  value: unknown,
  targetPages: number[],
  mode: DocumentRetrievalPlan["mode"],
): DocumentRetrievalPlan["inspectionMode"] {
  if (
    value === "metadata"
    || value === "semantic_passages"
    || value === "page_range"
    || value === "exact_search"
    || value === "global_scan"
  ) {
    return value;
  }
  if (targetPages.length > 0) {
    return "page_range";
  }
  return mode === "document_qa" ? "semantic_passages" : "semantic_passages";
}

function readDocumentMatchMode(value: unknown): DocumentRetrievalPlan["matchMode"] {
  return value === "whole_word" || value === "phrase" || value === "substring"
    ? value
    : null;
}

export function readPositivePageNumber(value: unknown): number | null {
  const page = typeof value === "number" ? value : Number(value);
  return Number.isInteger(page) && page > 0 ? page : null;
}

function readRetrievalMode(value: unknown): DocumentRetrievalPlan["mode"] {
  return value === "document_qa"
    || value === "memory_qa"
    || value === "general_chat"
    || value === "ambiguous"
    ? value
    : "ambiguous";
}

export function fallbackDocumentRetrievalPlan(
  inventory: DocumentInventoryItem[],
): DocumentRetrievalPlan {
  const focused = inventory.find((item) => item.isThreadFocus);
  const first = focused ?? inventory[0];
  return {
    source: "fallback",
    mode: first ? "document_qa" : "general_chat",
    inspectionMode: "semantic_passages",
    task: "answer",
    target: { kind: "none" },
    artifactIds: first ? [first.artifactId] : [],
    targetPages: [],
    exactQuery: null,
    matchMode: null,
    confidence: first ? 0.35 : 0,
    needsClarification: false,
    reason: first
      ? "planner_unavailable_using_focus_or_recent_document"
      : "no_documents_available",
  };
}

export function selectDocumentArtifactScope(input: {
  retrievalPlan: DocumentRetrievalPlan;
  inventory: DocumentInventoryItem[];
  focusedArtifactIds: string[];
}): string[] {
  const allowedIds = new Set(input.inventory.map((item) => item.artifactId));
  const plannedIds = input.retrievalPlan.artifactIds.filter((id) => allowedIds.has(id));
  if (plannedIds.length > 0) {
    return plannedIds;
  }
  const focusedIds = input.focusedArtifactIds.filter((id) => allowedIds.has(id));
  if (focusedIds.length > 0) {
    return focusedIds;
  }
  return input.inventory.slice(0, 1).map((item) => item.artifactId);
}

export function resolveDocumentNavigationPageScope(input: {
  retrievalPlan: DocumentRetrievalPlan;
  inventory: DocumentInventoryItem[];
  artifactIds: string[];
}): DocumentNavigationPageScope {
  const pagesByArtifactId = new Map<string, number[]>();
  const artifactIds = input.artifactIds.length > 0
    ? input.artifactIds
    : input.inventory.map((item) => item.artifactId);
  const directPageLimit = readPositiveInteger(
    process.env["CHAT_DOCUMENT_DIRECT_PAGE_LIMIT"],
    CHAT_DOCUMENT_DIRECT_PAGE_LIMIT_DEFAULT,
  );
  for (const artifactId of artifactIds) {
    const item = input.inventory.find((candidate) => candidate.artifactId === artifactId);
    const pages = resolveNavigationPagesForDocument(input.retrievalPlan, item?.pageCount ?? null);
    if (pages.length > 0) {
      pagesByArtifactId.set(artifactId, pages);
    }
  }
  if (pagesByArtifactId.size === 0) {
    return {
      mode: input.retrievalPlan.inspectionMode === "global_scan" ? "query_scan" : "none",
      pagesByArtifactId,
      reason: input.retrievalPlan.inspectionMode === "global_scan"
        ? "planner_requested_global_scan"
        : "no_navigation_target",
    };
  }
  const pageCount = Array.from(pagesByArtifactId.values())
    .reduce((total, pages) => total + pages.length, 0);
  const explicitSmallPageTarget = (
    input.retrievalPlan.target.kind === "pages"
    || input.retrievalPlan.inspectionMode === "page_range"
  ) && pageCount <= directPageLimit;
  return {
    mode: explicitSmallPageTarget ? "page_inspection" : "query_scan",
    pagesByArtifactId,
    reason: explicitSmallPageTarget ? "direct_page_target" : "bounded_navigation_scan",
  };
}

function resolveNavigationPagesForDocument(
  retrievalPlan: DocumentRetrievalPlan,
  pageCount: number | null,
): number[] {
  const directPages = retrievalPlan.targetPages.length > 0
    ? retrievalPlan.targetPages
    : retrievalPlan.target.kind === "pages"
      ? retrievalPlan.target.pages
      : [];
  if (directPages.length > 0) {
    return clampDocumentPages(directPages, pageCount);
  }
  if (retrievalPlan.target.kind === "page_range") {
    return rangeToPages(
      retrievalPlan.target.pageStart,
      retrievalPlan.target.pageEnd,
      pageCount,
    );
  }
  if (retrievalPlan.target.kind === "fraction" && pageCount) {
    return rangeToPages(
      Math.floor(pageCount * retrievalPlan.target.start) + 1,
      Math.ceil(pageCount * retrievalPlan.target.end),
      pageCount,
    );
  }
  if (retrievalPlan.target.kind === "relative_position" && pageCount) {
    const windowSize = Math.max(1, Math.ceil(pageCount * retrievalPlan.target.windowFraction));
    if (retrievalPlan.target.position === "beginning") {
      return rangeToPages(1, windowSize, pageCount);
    }
    if (retrievalPlan.target.position === "end") {
      return rangeToPages(pageCount - windowSize + 1, pageCount, pageCount);
    }
    const middle = Math.ceil(pageCount / 2);
    const halfWindow = Math.floor(windowSize / 2);
    return rangeToPages(middle - halfWindow, middle + halfWindow, pageCount);
  }
  if (retrievalPlan.target.kind === "whole_document" && pageCount) {
    return rangeToPages(1, pageCount, pageCount);
  }
  return [];
}

function clampDocumentPages(pages: number[], pageCount: number | null): number[] {
  return Array.from(new Set(
    pages
      .map(readPositivePageNumber)
      .filter((page): page is number => page !== null)
      .filter((page) => !pageCount || page <= pageCount),
  )).sort((a, b) => a - b);
}

function rangeToPages(
  pageStart: number,
  pageEnd: number,
  pageCount: number | null,
): number[] {
  const start = Math.max(1, Math.min(pageStart, pageEnd));
  const end = Math.max(
    start,
    pageCount
      ? Math.min(Math.max(pageStart, pageEnd), pageCount)
      : Math.max(pageStart, pageEnd),
  );
  const pages: number[] = [];
  for (let page = start; page <= end; page += 1) {
    pages.push(page);
  }
  return pages;
}

export function shouldInspectNormalizedDocument(input: {
  retrievalPlan: DocumentRetrievalPlan;
  hasPageTargets: boolean;
}): boolean {
  return input.retrievalPlan.inspectionMode !== "metadata" && (
    input.hasPageTargets
    || input.retrievalPlan.inspectionMode === "global_scan"
    || input.retrievalPlan.mode === "document_qa"
  );
}

export function readDocumentQueryScanResult(
  content: string,
  pageStart: number | null,
  pageEnd: number | null,
) {
  const parsed = parseJsonObject(content);
  const evidence = Array.isArray(parsed?.["evidence"])
    ? parsed["evidence"]
        .map(optionalString)
        .filter((value): value is string => Boolean(value))
        .slice(0, 8)
    : [];
  const partialAnswer = optionalString(parsed?.["partialAnswer"]);
  const confidence = clampConfidence(parsed?.["confidence"]);
  const relevant = parsed?.["relevant"] === true && (evidence.length > 0 || Boolean(partialAnswer));
  return {
    relevant,
    pageStart,
    pageEnd,
    evidence,
    partialAnswer,
    confidence,
  };
}

export function readDocumentFocusArtifactIds(metadata: unknown): string[] {
  const focus = readRecord(readRecord(metadata)["documentFocus"]);
  const sourceArtifactId = optionalString(focus["sourceArtifactId"]);
  const recentArtifactIds = Array.isArray(focus["recentSourceArtifactIds"])
    ? focus["recentSourceArtifactIds"].filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  return Array.from(new Set([
    ...(sourceArtifactId ? [sourceArtifactId] : []),
    ...recentArtifactIds,
  ])).filter(isUuid);
}
