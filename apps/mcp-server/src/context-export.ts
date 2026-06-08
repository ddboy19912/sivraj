import type { JsonObject } from "./sivraj-client.js";

export function readContextExportMarkdown(response: JsonObject): string {
  const exportContent = readContextExportContent(response);

  if (exportContent) {
    return exportContent;
  }

  const fallback = response["contextMarkdown"];

  return typeof fallback === "string" ? fallback : JSON.stringify(response, null, 2);
}

function readContextExportRecord(response: JsonObject): Record<string, unknown> | null {
  const contextExport = response["contextExport"];

  return contextExport && typeof contextExport === "object" && !Array.isArray(contextExport)
    ? contextExport as Record<string, unknown>
    : null;
}

export function readContextExportContent(response: JsonObject): string | null {
  const content = readContextExportRecord(response)?.["content"];

  return typeof content === "string" ? content : null;
}
