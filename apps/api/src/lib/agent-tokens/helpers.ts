import {
  AGENT_SCOPES,
  loadAuthConfig,
  signSessionToken,
  type AgentScope,
} from "@sivraj/auth";
import { optionalString, readRecord } from "../http/route-helpers.js";

const DEFAULT_AGENT_TOKEN_TTL_MINUTES = 24 * 60;
const MAX_AGENT_TOKEN_TTL_MINUTES = 30 * 24 * 60;

export function readAgentScopes(value: unknown): AgentScope[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.filter(isAgentScope)));
}

function isAgentScope(value: unknown): value is AgentScope {
  return typeof value === "string" && (AGENT_SCOPES as readonly string[]).includes(value);
}

export function clampTtl(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_AGENT_TOKEN_TTL_MINUTES;
  }

  return Math.min(parsed, MAX_AGENT_TOKEN_TTL_MINUTES);
}

export function readUuid(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}

export function readWritebackStatus(value: unknown): "pending" | "approved" | "rejected" | "expired" | "superseded" | null {
  return value === "pending" ||
    value === "approved" ||
    value === "rejected" ||
    value === "expired" ||
    value === "superseded"
    ? value
    : null;
}

export function readLimit(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);

  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, 500)
    : 100;
}

export function readGrantStatus(revokedAt: Date | null, expiresAt: Date | null): "active" | "revoked" | "expired" {
  if (revokedAt) {
    return "revoked";
  }

  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    return "expired";
  }

  return "active";
}

export function sanitizeAgentClientMetadata(value: unknown): Record<string, unknown> {
  const metadata = readRecord(value);
  return {
    origin: optionalString(metadata["origin"]) ?? null,
    createdByType: optionalString(metadata["createdByType"]) ?? null,
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function readAuthConfig() {
  try {
    return loadAuthConfig(process.env);
  } catch {
    return null;
  }
}

async function signAgentSessionToken(input: {
  clientId: string;
  scopes: AgentScope[];
  twinId: string;
  expiresInMinutes: number;
}) {
  const authConfig = readAuthConfig();

  if (!authConfig) {
    return null;
  }

  const token = await signSessionToken(
    {
      sub: input.clientId,
      type: "agent",
      scopes: input.scopes,
      twinId: input.twinId,
      clientId: input.clientId,
    },
    authConfig,
    `${input.expiresInMinutes}m`,
  );

  return { token, authConfig };
}
