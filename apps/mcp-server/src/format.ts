import { formatWritebackApiResponseMarkdown } from "@sivraj/core";
import type { JsonObject } from "./sivraj-client.js";

export function formatSources(response: JsonObject): string {
  const sources = Array.isArray(response["sources"]) ? response["sources"] : [];
  const lines = ["# Sivraj Engineering Sources", ""];

  if (sources.length === 0) {
    lines.push("No engineering sources found.");
    return lines.join("\n");
  }

  for (const source of sources) {
    lines.push(formatSourceLine(source));
  }

  return lines.join("\n");
}

export function formatSearchResults(response: JsonObject): string {
  const query = typeof response["query"] === "string" ? response["query"] : "";
  const results = Array.isArray(response["results"]) ? response["results"] : [];
  const lines = [`# Sivraj Memory Search`, "", `Query: ${query}`, ""];

  if (results.length === 0) {
    lines.push("No matching memories found.");
    return lines.join("\n");
  }

  for (const result of results) {
    lines.push(...formatSearchResultLines(result));
  }

  return lines.join("\n");
}

export function formatWritebackResponse(response: JsonObject): string {
  return formatWritebackApiResponseMarkdown(response, {
    heading: "# Sivraj Agent Writeback Recorded",
    statusLabel: "Review",
  });
}

export function formatWritebackList(response: JsonObject): string {
  const writebacks = Array.isArray(response["writebacks"]) ? response["writebacks"] : [];
  const lines = ["# Sivraj Recent Agent Writebacks", ""];

  if (writebacks.length === 0) {
    lines.push("No agent writebacks found.");
    return lines.join("\n");
  }

  for (const writeback of writebacks) {
    lines.push(formatWritebackLine(writeback));
  }

  return lines.join("\n");
}

export function formatSourceLine(source: unknown): string {
  const record = readRecord(source);
  const name = String(record?.["displayName"] ?? record?.["artifactId"] ?? "Unknown source");
  const artifactId = String(record?.["artifactId"] ?? "unknown");
  const sourceType = String(record?.["sourceType"] ?? "unknown");
  const memoryCount = String(record?.["extractedEngineeringMemoryCount"] ?? 0);

  return [
    `- ${name}`,
    `  - artifact: ${artifactId}`,
    `  - type: ${sourceType}`,
    `  - memories: ${memoryCount}`,
  ].join("\n");
}

function formatSearchResultLines(result: unknown): string[] {
  const record = readRecord(result);

  if (!record) {
    return [];
  }

  return [
    `## ${String(record["id"] ?? "memory")}`,
    `Score: ${String(record["score"] ?? "unknown")}`,
    `Source artifact: ${String(record["sourceArtifactId"] ?? "unknown")}`,
    "",
    String(record["content"] ?? ""),
    "",
  ];
}

function formatWritebackLine(writeback: unknown): string {
  const record = readRecord(writeback);

  if (!record) {
    return "- Unknown writeback";
  }

  return [
    `- ${String(record["agentName"] ?? "coding-agent")} / ${String(record["status"] ?? "unknown")}`,
    `  - writeback: ${String(record["id"] ?? "unknown")}`,
    `  - repo: ${String(record["repo"] ?? "unknown")}`,
    `  - created: ${String(record["createdAt"] ?? "unknown")}`,
  ].join("\n");
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
