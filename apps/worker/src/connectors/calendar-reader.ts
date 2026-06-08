import type { ConnectorSource } from "../types/connector.types.js";

export function readCalendarId(source: ConnectorSource | null): string {
  if (!source) {
    return "primary";
  }

  const value = source.externalSourceId || source.uri || "primary";

  if (value.startsWith("google-calendar://")) {
    return value.replace("google-calendar://", "");
  }

  return value;
}
