import type { ConnectorSource } from "../types/connector.types.js";
import { readConnectorMetadataString } from "./metadata-reader.js";

export function readBrowserHistoryContent(
  source: ConnectorSource | null,
  accountMetadata: unknown,
): string | null {
  return readConnectorMetadataString(source?.metadata, "content") ??
    readConnectorMetadataString(source?.metadata, "csv") ??
    readConnectorMetadataString(accountMetadata, "content") ??
    readConnectorMetadataString(accountMetadata, "csv");
}
