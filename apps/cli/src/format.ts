import type { JsonObject } from "./client.js";

export function readContextExportContent(response: JsonObject): string {
  const contextExport = readRecord(response["contextExport"]);
  const content = contextExport ? contextExport["content"] : null;

  if (typeof content === "string") {
    return content;
  }

  const fallback = response["contextMarkdown"];

  return typeof fallback === "string" ? fallback : JSON.stringify(response, null, 2);
}

export function formatContextSummary(response: JsonObject): string {
  const contextExport = readRecord(response["contextExport"]);
  const profileSummary = readRecord(response["profileSummary"]);
  const contextPacket = readRecord(response["contextPacket"]);
  const quality = readRecord(readRecord(contextPacket?.["quality"]) ?? profileSummary?.["quality"]);
  const lines = ["# Sivraj Context Export", ""];

  lines.push(`Preset: ${String(contextExport?.["preset"] ?? "unknown")}`);
  lines.push(`Target: ${String(contextExport?.["targetFile"] ?? "unknown")}`);
  lines.push(`Format: ${String(contextExport?.["format"] ?? "unknown")}`);
  lines.push(`Items: ${String(contextExport?.["itemCount"] ?? profileSummary?.["includedContextItems"] ?? "unknown")}`);
  lines.push(`Quality: ${String(quality?.["label"] ?? "unknown")}`);
  lines.push("");
  lines.push(readContextExportContent(response));

  return lines.join("\n").trimEnd();
}

export function formatWritebackResponse(response: JsonObject): string {
  return [
    "# Sivraj Agent Writeback",
    "",
    `Writeback: ${String(response["writebackId"] ?? "unknown")}`,
    `Status: ${String(response["status"] ?? "unknown")}`,
    `Storage: ${String(response["storageMode"] ?? "unknown")}`,
    `Warning: ${String(response["warning"] ?? "pending_review")}`,
  ].join("\n");
}

export function formatDemoResponse(input: {
  context: JsonObject;
  writeback?: JsonObject;
  mode?: "coding" | "research" | "strategy";
  question?: string;
}): string {
  const contextExport = readRecord(input.context["contextExport"]);
  const mode = input.mode ?? "coding";
  const lines = [
    `# Sivraj ${capitalize(mode)} Agent Demo`,
    "",
    "## Before Work",
    "",
    ...(input.question ? [`Question: ${input.question}`, ""] : []),
    `Preset: ${String(contextExport?.["preset"] ?? "unknown")}`,
    `Target: ${String(contextExport?.["targetFile"] ?? "unknown")}`,
    `Items: ${String(contextExport?.["itemCount"] ?? "unknown")}`,
    "",
    "Context preview:",
    "",
    preview(readContextExportContent(input.context), 1_500),
  ];

  if (input.writeback) {
    lines.push("");
    lines.push("## After Work");
    lines.push("");
    lines.push(formatWritebackResponse(input.writeback));
  } else {
    lines.push("");
    lines.push("## After Work");
    lines.push("");
    lines.push("Run `sivraj writeback --summary \"...\"` after the agent finishes to submit an encrypted pending-review session summary.");
  }

  return lines.join("\n").trimEnd();
}

export function formatEvalHarnessResponse(input: {
  task: string;
  context: JsonObject;
}): string {
  const contextPacket = readRecord(input.context["contextPacket"]);
  const quality = readRecord(contextPacket?.["quality"]);
  const metrics = readRecord(quality?.["metrics"]);
  const score = typeof quality?.["score"] === "number" ? quality.score : 0;
  const label = typeof quality?.["label"] === "string" ? quality.label : "unknown";
  const readyForAgent = Boolean(quality?.["readyForAgent"]);
  const totalItems = Number(metrics?.["totalItems"] ?? 0);
  const evidenceRefs = Number(metrics?.["evidenceRefs"] ?? 0);
  const issueCount = Number(metrics?.["issueCount"] ?? 0);
  const withContextScore = Math.round(score * 100);
  const baselineScore = 0;

  return [
    "# Sivraj Agent Eval Harness",
    "",
    `Task: ${input.task}`,
    "",
    "## Comparison",
    "",
    `Baseline without Sivraj context: ${baselineScore}/100`,
    `With Sivraj context: ${withContextScore}/100 (${label})`,
    `Ready for agent: ${readyForAgent ? "yes" : "no"}`,
    "",
    "## Evidence",
    "",
    `Context items: ${totalItems}`,
    `Evidence refs: ${evidenceRefs}`,
    `Context issues: ${issueCount}`,
    "",
    "Use this harness to compare agent runs: execute the same task once without this packet and once with the exported Sivraj context, then record the result through `sivraj writeback`.",
  ].join("\n");
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function preview(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength).trimEnd()}\n...` : value;
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
