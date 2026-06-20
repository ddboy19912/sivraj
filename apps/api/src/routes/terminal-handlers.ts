import { auditEvents, connectorAccounts } from "@sivraj/db";
import { desc, eq } from "drizzle-orm";
import type { Context } from "hono";
import type { AuthClaims } from "@sivraj/auth";
import type { AppDependencies } from "../app.js";
import type { AuthEnv } from "../middleware/auth.js";
import { authorizeTwinScopedJsonBody } from "../lib/http/route-auth.js";
import { optionalString } from "../lib/http/route-helpers.js";
import { handleConnectorAccountSync } from "./connector-account-sync.js";
import {
  formatOnboardingResetLines,
  formatOnboardingStatusLines,
  loadTerminalOnboardingStatus,
  resetTerminalOnboarding,
} from "./terminal-onboarding.js";
import type {
  TerminalCommandId,
  TerminalCommandResponse,
} from "./terminal-types.js";

type ParsedTerminalCommand =
  | {
      commandId: "onboarding.status" | "connectors.list" | "audit.recent";
      limit?: number;
    }
  | {
      commandId: "onboarding.reset";
      dryRun: boolean;
      confirmed: boolean;
    }
  | {
      commandId: "connectors.sync";
      accountId: string;
    };

export async function handleTerminalCommandPost(
  c: Context<AuthEnv>,
  dependencies: AppDependencies,
) {
  const gate = await authorizeTwinScopedJsonBody(c, undefined);
  if (!gate.ok) {
    return gate.response;
  }

  const parsed = parseTerminalCommandBody(gate.value.body);
  if (!parsed.ok) {
    return c.json(failedResponse("audit.recent", parsed.error), 400);
  }

  await recordTerminalCommandAudit(dependencies.db, {
    auth: gate.value.auth,
    twinId: gate.value.twinId,
    commandId: parsed.command.commandId,
  });

  const response = await executeTerminalCommand(c, dependencies, {
    auth: gate.value.auth,
    twinId: gate.value.twinId,
    command: parsed.command,
  });

  return c.json(response, response.status === "success" ? 200 : 400);
}

export function parseTerminalCommandBody(
  body: Record<string, unknown>,
): { ok: true; command: ParsedTerminalCommand } | { ok: false; error: string } {
  const commandId = optionalString(body["commandId"]);
  const args = readStringArray(body["args"]);
  const flags = readRecord(body["flags"]);

  if (commandId === "onboarding.status") {
    return { ok: true, command: { commandId } };
  }

  if (commandId === "onboarding.reset") {
    return {
      ok: true,
      command: {
        commandId,
        dryRun: flags["confirm"] !== true,
        confirmed: flags["confirm"] === true,
      },
    };
  }

  if (commandId === "connectors.list") {
    return { ok: true, command: { commandId } };
  }

  if (commandId === "connectors.sync") {
    const accountId = args[0] ?? optionalString(body["accountId"]);

    if (!accountId) {
      return { ok: false, error: "connectors.sync requires an account id." };
    }

    return { ok: true, command: { commandId, accountId } };
  }

  if (commandId === "audit.recent") {
    return {
      ok: true,
      command: {
        commandId,
        limit: readLimit(args[0] ?? body["limit"], 10, 25),
      },
    };
  }

  return {
    ok: false,
    error: `Unsupported terminal command: ${commandId ?? "missing"}.`,
  };
}

async function executeTerminalCommand(
  c: Context<AuthEnv>,
  dependencies: AppDependencies,
  input: {
    auth: AuthClaims;
    twinId: string;
    command: ParsedTerminalCommand;
  },
): Promise<TerminalCommandResponse> {
  const command = input.command;

  switch (command.commandId) {
    case "onboarding.status": {
      const status = await loadTerminalOnboardingStatus(dependencies.db, {
        userId: input.auth.sub,
        twinId: input.twinId,
      });

      return {
        commandId: command.commandId,
        status: "success",
        lines: formatOnboardingStatusLines(status),
      };
    }

    case "onboarding.reset": {
      if (!command.confirmed) {
        const result = await resetTerminalOnboarding(dependencies.db, {
          auth: input.auth,
          twinId: input.twinId,
          dryRun: true,
        });

        if (!result.ok) {
          return failedResponse(command.commandId, result.error);
        }

        return {
          commandId: command.commandId,
          status: "success",
          lines: [
            ...formatOnboardingResetLines(result.summary),
            {
              kind: "warning",
              text: "Run onboarding reset --confirm to apply these changes.",
            },
          ],
        };
      }

      const result = await resetTerminalOnboarding(dependencies.db, {
        auth: input.auth,
        twinId: input.twinId,
        dryRun: false,
      });

      if (!result.ok) {
        return failedResponse(command.commandId, result.error);
      }

      return {
        commandId: command.commandId,
        status: "success",
        lines: formatOnboardingResetLines(result.summary),
        effects: ["clearSessionAndReload"],
      };
    }

    case "connectors.list":
      return listConnectors(dependencies.db, input.twinId);

    case "connectors.sync":
      return syncConnector(c, dependencies, {
        auth: input.auth,
        twinId: input.twinId,
        command,
      });

    case "audit.recent":
      return listRecentAuditEvents(
        dependencies.db,
        input.twinId,
        command.limit ?? 10,
      );
  }
}

async function listConnectors(
  db: AppDependencies["db"],
  twinId: string,
): Promise<TerminalCommandResponse> {
  const accounts = await db
    .select()
    .from(connectorAccounts)
    .where(eq(connectorAccounts.twinId, twinId))
    .orderBy(desc(connectorAccounts.createdAt));

  if (accounts.length === 0) {
    return {
      commandId: "connectors.list",
      status: "success",
      lines: [{ kind: "info", text: "No connector accounts found." }],
    };
  }

  return {
    commandId: "connectors.list",
    status: "success",
    lines: accounts.map((account) => ({
      kind: account.status === "connected" ? "success" : "warning",
      text: `${account.id}  ${account.provider}  ${account.status}  ${account.displayName}`,
    })),
  };
}

async function syncConnector(
  c: Context<AuthEnv>,
  dependencies: AppDependencies,
  input: {
    auth: AuthClaims;
    twinId: string;
    command: Extract<ParsedTerminalCommand, { commandId: "connectors.sync" }>;
  },
): Promise<TerminalCommandResponse> {
  const response = await handleConnectorAccountSync(c, {
    db: dependencies.db,
    connectorSyncQueue: dependencies.connectorSyncQueue,
    auth: input.auth,
    twinId: input.twinId,
    accountId: input.command.accountId,
    mode: "manual",
    connectorSourceId: null,
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    return failedResponse(
      "connectors.sync",
      readResponseError(body) ?? "Connector sync failed.",
    );
  }

  const syncRunId = readNestedString(body, "syncRun", "id");
  const jobId = readStringProperty(body, "jobId");
  const warning = readStringProperty(body, "warning");

  return {
    commandId: "connectors.sync",
    status: "success",
    lines: [
      {
        kind: "success",
        text: `Connector sync queued: ${syncRunId ?? "sync run created"}`,
      },
      ...(jobId ? [{ kind: "info" as const, text: `Job: ${jobId}` }] : []),
      ...(warning
        ? [{ kind: "warning" as const, text: `Warning: ${warning}` }]
        : []),
    ],
  };
}

async function listRecentAuditEvents(
  db: AppDependencies["db"],
  twinId: string,
  limit: number,
): Promise<TerminalCommandResponse> {
  const events = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.twinId, twinId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);

  if (events.length === 0) {
    return {
      commandId: "audit.recent",
      status: "success",
      lines: [{ kind: "info", text: "No audit events found." }],
    };
  }

  return {
    commandId: "audit.recent",
    status: "success",
    lines: events.map((event) => ({
      kind: "info",
      text: `${formatDate(event.createdAt)}  ${event.eventType}  ${event.resourceType}/${event.resourceId}`,
    })),
  };
}

function failedResponse(
  commandId: TerminalCommandId,
  message: string,
): TerminalCommandResponse {
  return {
    commandId,
    status: "failed",
    lines: [{ kind: "error", text: message }],
  };
}

async function recordTerminalCommandAudit(
  db: AppDependencies["db"],
  input: {
    auth: AuthClaims;
    twinId: string;
    commandId: TerminalCommandId;
  },
) {
  await db.insert(auditEvents).values({
    twinId: input.twinId,
    actorType: input.auth.type,
    actorId: input.auth.sub,
    eventType: "terminal.command.requested",
    resourceType: "terminal_command",
    resourceId: input.commandId,
    metadata: {
      commandId: input.commandId,
      walletAddress: input.auth.walletAddress,
    },
  });
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readLimit(value: unknown, fallback: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, max)
    : fallback;
}

function readResponseError(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const error = (value as { error?: unknown }).error;
  return typeof error === "string" ? error : null;
}

function readStringProperty(value: unknown, property: string): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const next = (value as Record<string, unknown>)[property];
  return typeof next === "string" && next.length > 0 ? next : null;
}

function readNestedString(
  value: unknown,
  firstKey: string,
  secondKey: string,
): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  return readStringProperty(
    (value as Record<string, unknown>)[firstKey],
    secondKey,
  );
}

function formatDate(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
