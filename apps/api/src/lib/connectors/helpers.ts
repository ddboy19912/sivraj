import type { SupportedArtifactSourceType } from "../../app.js";
import { sanitizeSafeMetadata } from "../safe-metadata.js";
import { optionalString, readRecord } from "../http/route-helpers.js";

export const CONNECTOR_PROVIDERS = [
  "github",
  "notion",
  "microsoft_onedrive",
  "google_drive",
  "slack",
  "email",
  "calendar",
  "browser_history",
  "chatgpt",
  "codex",
  "claude",
  "telegram",
  "other",
] as const;

export type ConnectorProvider = (typeof CONNECTOR_PROVIDERS)[number];
export type ConnectorMode = "initial" | "incremental" | "manual";

export const CONNECTOR_SOURCE_TYPES: Record<
  ConnectorProvider,
  SupportedArtifactSourceType
> = {
  github: "github",
  notion: "api",
  microsoft_onedrive: "api",
  google_drive: "api",
  slack: "slack_export",
  email: "email",
  calendar: "calendar",
  browser_history: "browser_history",
  chatgpt: "chat_export",
  codex: "chat_export",
  claude: "chat_export",
  telegram: "telegram_message",
  other: "api",
};

export const DEFAULT_CONNECTOR_SCOPES: Record<ConnectorProvider, string[]> = {
  github: ["github:repo:read"],
  notion: ["notion:workspace:read", "notion:page:read"],
  microsoft_onedrive: ["microsoft:files:read"],
  google_drive: ["google:drive:read"],
  slack: ["slack:channels:read", "slack:messages:read"],
  email: ["email:messages:read"],
  calendar: ["calendar:events:read"],
  browser_history: ["browser_history:read"],
  chatgpt: ["chatgpt:history:import"],
  codex: ["codex:history:import"],
  claude: ["claude:history:import"],
  telegram: ["telegram:messages:capture"],
  other: ["connector:read"],
};

export function readProvider(value: unknown): ConnectorProvider | null {
  return CONNECTOR_PROVIDERS.includes(value as ConnectorProvider)
    ? (value as ConnectorProvider)
    : null;
}

export function readSyncMode(value: unknown): ConnectorMode | null {
  return value === "initial" || value === "incremental" || value === "manual"
    ? value
    : null;
}

export function readAccountStatus(value: unknown) {
  return value === "connected" ||
    value === "paused" ||
    value === "needs_reauth" ||
    value === "error" ||
    value === "disconnected"
    ? value
    : null;
}

export function readSourceInput(value: unknown, provider: ConnectorProvider) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const externalSourceId = optionalString(record["externalSourceId"]);
  const displayName = optionalString(record["displayName"]) ?? externalSourceId;

  if (!externalSourceId || !displayName) {
    return null;
  }

  return {
    externalSourceId,
    displayName,
    sourceType: CONNECTOR_SOURCE_TYPES[provider],
    uri: optionalString(record["uri"]),
    metadata: sanitizeSafeMetadata(readRecord(record["metadata"])),
  };
}

export function readStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
}

export function recordValue(value: unknown, key: string): unknown {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

export function connectorLabel(provider: ConnectorProvider): string {
  return provider
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
