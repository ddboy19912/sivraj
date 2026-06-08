export type SealKeyServerConfig = {
  objectId: string;
  weight: number;
  aggregatorUrl?: string;
  apiKeyName?: string;
  apiKey?: string;
};

export function parseSealKeyServers(value: string): SealKeyServerConfig[] {
  const trimmed = value.trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;

    if (!Array.isArray(parsed)) {
      throw new Error(
        "SEAL_KEY_SERVERS must be a JSON array or comma-separated object IDs",
      );
    }

    return parsed.map(parseKeyServerConfig);
  }

  return trimmed
    .split(",")
    .map((objectId) => ({
      objectId: objectId.trim(),
      weight: 1,
    }))
    .filter((server) => server.objectId.length > 0);
}

function parseKeyServerConfig(value: unknown): SealKeyServerConfig {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid Seal key server config");
  }

  const record = value as Record<string, unknown>;
  const objectId = stringField(record, "objectId");
  const weight = numberField(record, "weight", 1);
  const aggregatorUrl = optionalStringField(record, "aggregatorUrl");
  const apiKeyName = optionalStringField(record, "apiKeyName");
  const apiKey = optionalStringField(record, "apiKey");

  return {
    objectId,
    weight,
    ...(aggregatorUrl ? { aggregatorUrl } : {}),
    ...(apiKeyName ? { apiKeyName } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid Seal key server ${key}`);
  }

  return value;
}

function optionalStringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(
  record: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = record[key];

  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid Seal key server ${key}`);
  }

  return value;
}
