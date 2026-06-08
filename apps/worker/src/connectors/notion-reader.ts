import type { ConnectorSource } from "../types/connector.types.js";

export function readNotionPageId(source: ConnectorSource): string {
  const raw = source.uri || source.externalSourceId;
  const normalized = raw.replace(/-/g, "");
  const match = normalized.match(/[0-9a-fA-F]{32}/);

  if (!match) {
    throw new Error("invalid_notion_page_id");
  }

  return match[0]!;
}
