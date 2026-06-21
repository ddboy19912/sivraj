import { tokenize } from "@sivraj/retrieval";
import { optionalString, readRecord } from "../http/route-helpers.js";
import type {
  ConversationContextResolution,
  MemoryRequest,
  MemoryRequestScope,
} from "./turn-types.js";

const MEMORY_REQUEST_SCOPES = ["all", "profile", "preferences", "engineering"] as const;
const MEMORY_FOLLOWUP_RELATIONS = ["other", "same_topic", "clarify"] as const;

type MemoryPlanningContext = Pick<
  ConversationContextResolution,
  "answerTarget" | "intent" | "retrieval"
> | Record<string, unknown> | null | undefined;

export function readPlannedMemoryRequest(
  value: unknown,
  fallback: {
    query: string;
    contextResolution?: MemoryPlanningContext;
  },
): MemoryRequest {
  const record = readRecord(value);
  const kind = optionalString(record?.["kind"]);

  if (kind === "none") {
    return { kind: "none" };
  }

  if (kind === "inventory") {
    return {
      kind,
      scope: readMemoryRequestScope(record?.["scope"], fallback.query),
      excludeAlreadyMentioned: record?.["excludeAlreadyMentioned"] === true,
    };
  }

  if (kind === "followup") {
    return {
      kind,
      relation: readMemoryFollowupRelation(record?.["relation"]),
      query: optionalString(record?.["query"]) ?? fallback.query,
      scope: readMemoryRequestScope(record?.["scope"], fallback.query),
      excludeAlreadyMentioned: record?.["excludeAlreadyMentioned"] !== false,
      searchTerms: readSearchTerms(record?.["searchTerms"]),
    };
  }

  if (kind === "specific_fact") {
    return {
      kind,
      query: optionalString(record?.["query"]) ?? fallback.query,
      scope: readMemoryRequestScope(record?.["scope"], fallback.query),
      searchTerms: readSearchTerms(record?.["searchTerms"]),
    };
  }

  return deriveMemoryRequest(fallback.query, fallback.contextResolution);
}

export function readMemoryRequestFromContext(
  contextResolution: MemoryPlanningContext,
  query: string,
): MemoryRequest {
  const record = readRecord(contextResolution);
  return readPlannedMemoryRequest(record?.["memoryRequest"], {
    query,
    contextResolution,
  });
}

export function memorySearchTerms(input: {
  query: string;
  memoryRequest: MemoryRequest;
}): string[] {
  if (
    (input.memoryRequest.kind === "specific_fact" || input.memoryRequest.kind === "followup") &&
    input.memoryRequest.searchTerms.length > 0
  ) {
    return input.memoryRequest.searchTerms.slice(0, 8);
  }

  if (input.memoryRequest.kind === "inventory" || input.memoryRequest.kind === "followup") {
    return [];
  }

  return tokenize(input.query).slice(0, 8);
}

export function memoryMatchesScope(content: string, scope: MemoryRequestScope): boolean {
  if (scope === "all") {
    return true;
  }

  const category = classifyMemoryContent(content);

  if (scope === "engineering") {
    return category === "engineering";
  }

  if (scope === "preferences") {
    return category === "preference" || category === "engineering";
  }

  return category !== "engineering";
}

export function classifyMemoryContent(content: string): "profile" | "preference" | "engineering" | "other" {
  const normalized = content.toLowerCase();

  if (
    normalized.includes("engineering memory:") ||
    normalized.includes("kind: engineering_memory") ||
    normalized.includes("engineeringmemorytype") ||
    normalized.includes("tool_preference") ||
    normalized.includes("agent_instruction") ||
    normalized.includes("coding_preference") ||
    normalized.includes("repo_search")
  ) {
    return "engineering";
  }

  if (normalized.includes("preference memory") || normalized.includes("prefers")) {
    return "preference";
  }

  if (
    normalized.includes("current profile fact:") ||
    normalized.includes("profile_fact") ||
    normalized.includes("remembered note about")
  ) {
    return "profile";
  }

  return "other";
}

export function deriveMemoryRequest(
  query: string,
  contextResolution?: MemoryPlanningContext,
): MemoryRequest {
  const record = readRecord(contextResolution);
  const intent = optionalString(record?.["intent"]);
  const retrieval = optionalString(record?.["retrieval"]);
  const answerTarget = optionalString(record?.["answerTarget"]);

  if (intent !== "memory_qa" && retrieval !== "hot_memory" && answerTarget !== "memory") {
    return { kind: "none" };
  }

  const normalized = query.toLowerCase();
  const scope = readMemoryRequestScope(undefined, query);

  if (/\b(other|else|besides|another)\b/u.test(normalized)) {
    return {
      kind: "followup",
      relation: "other",
      query,
      scope,
      excludeAlreadyMentioned: true,
      searchTerms: [],
    };
  }

  if (/\b(memories|memory list|what.*remember|what.*saved|have saved)\b/u.test(normalized)) {
    return {
      kind: "inventory",
      scope,
      excludeAlreadyMentioned: false,
    };
  }

  return {
    kind: "specific_fact",
    query,
    scope,
    searchTerms: [],
  };
}

function readMemoryRequestScope(value: unknown, query: string): MemoryRequestScope {
  if (typeof value === "string" && MEMORY_REQUEST_SCOPES.includes(value as MemoryRequestScope)) {
    return value as MemoryRequestScope;
  }

  return inferMemoryScopeFromQuery(query);
}

function inferMemoryScopeFromQuery(query: string): MemoryRequestScope {
  const normalized = query.toLowerCase();

  if (/\b(coding|engineering|repo|repository|code|agent|tool|command|terminal|test|deploy)\b/u.test(normalized)) {
    return "engineering";
  }

  if (/\b(preference|prefer|like|dislike|style)\b/u.test(normalized)) {
    return "preferences";
  }

  return "profile";
}

function readMemoryFollowupRelation(value: unknown): "other" | "same_topic" | "clarify" {
  return typeof value === "string" && MEMORY_FOLLOWUP_RELATIONS.includes(value as "other" | "same_topic" | "clarify")
    ? value as "other" | "same_topic" | "clarify"
    : "same_topic";
}

function readSearchTerms(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const terms = value
    .map(optionalString)
    .filter((term): term is string => Boolean(term))
    .flatMap((term) => tokenize(term))
    .filter((term, index, values) => values.indexOf(term) === index);

  return terms.slice(0, 8);
}
