import {
  auditEvents,
  connectorAccounts,
  connectorSources,
  connectorSyncItems,
  connectorSyncRuns,
} from "@sivraj/db";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppDependencies, SupportedArtifactSourceType } from "../app.js";
import { requireAuth, requireScope, type AuthEnv } from "../middleware/auth.js";

const CONNECTOR_PROVIDERS = [
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
  "other",
] as const;

type ConnectorProvider = (typeof CONNECTOR_PROVIDERS)[number];
type ConnectorMode = "initial" | "incremental" | "manual";

const CONNECTOR_SOURCE_TYPES: Record<
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
  other: "api",
};

const DEFAULT_CONNECTOR_SCOPES: Record<ConnectorProvider, string[]> = {
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
  other: ["connector:read"],
};

export function createConnectorRoutes({
  db,
  connectorSyncQueue,
}: AppDependencies) {
  const routes = new Hono<AuthEnv>();

  routes.get("/available", requireAuth, async (c) => {
    const scopeError = requireScope(c, "artifact:read");

    if (scopeError) {
      return scopeError;
    }

    return c.json({
      connectors: CONNECTOR_PROVIDERS.map((provider) => ({
        provider,
        sourceType: CONNECTOR_SOURCE_TYPES[provider],
        defaultScopes: DEFAULT_CONNECTOR_SCOPES[provider],
        authModel: provider === "browser_history" ? "import" : "oauth_or_token",
      })),
    });
  });

  routes.get("/", requireAuth, async (c) => {
    const scopeError = requireScope(c, "artifact:read");

    if (scopeError) {
      return scopeError;
    }

    const authError = authorizeTwin(c);

    if (authError) {
      return authError;
    }

    const twinId = c.req.param("twinId") ?? "";
    const accounts = await db
      .select()
      .from(connectorAccounts)
      .where(eq(connectorAccounts.twinId, twinId))
      .orderBy(desc(connectorAccounts.createdAt));
    const sources = await db
      .select()
      .from(connectorSources)
      .where(eq(connectorSources.twinId, twinId))
      .orderBy(desc(connectorSources.createdAt));
    const runs = await db
      .select()
      .from(connectorSyncRuns)
      .where(eq(connectorSyncRuns.twinId, twinId))
      .orderBy(desc(connectorSyncRuns.createdAt))
      .limit(25);

    return c.json({
      accounts: accounts.map((account) => ({
        ...account,
        sources: sources
          .filter((source) => source.connectorAccountId === account.id)
          .map((source) => ({ ...source })),
        lastSyncRun:
          runs.find((run) => run.connectorAccountId === account.id) ?? null,
      })),
      recentSyncRuns: runs,
    });
  });

  routes.post("/accounts", requireAuth, async (c) => {
    const scopeError = requireScope(c, "artifact:upload");

    if (scopeError) {
      return scopeError;
    }

    const authError = authorizeTwin(c);

    if (authError) {
      return authError;
    }

    const auth = c.get("auth");
    const twinId = c.req.param("twinId") ?? "";
    const body = await c.req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return c.json({ error: "invalid_json_body" }, 400);
    }

    const provider = readProvider(body["provider"]);

    if (!provider) {
      return c.json({ error: "unsupported_connector_provider" }, 400);
    }

    const displayName =
      optionalString(body["displayName"]) ?? connectorLabel(provider);
    const externalAccountId =
      optionalString(body["externalAccountId"]) ?? displayName;
    const scopes =
      readStringList(body["scopes"]) ?? DEFAULT_CONNECTOR_SCOPES[provider];
    const syncCadence = optionalString(body["syncCadence"]) ?? "manual";
    const metadata = readRecord(body["metadata"]);

    const [account] = await db
      .insert(connectorAccounts)
      .values({
        twinId,
        provider,
        displayName,
        externalAccountId,
        scopes,
        syncCadence,
        metadata,
        status: "connected",
      })
      .returning();

    const sourceInput = readSourceInput(body["source"], provider);
    let source = null;

    if (sourceInput) {
      [source] = await db
        .insert(connectorSources)
        .values({
          twinId,
          connectorAccountId: account.id,
          provider,
          sourceType: sourceInput.sourceType,
          externalSourceId: sourceInput.externalSourceId,
          displayName: sourceInput.displayName,
          uri: sourceInput.uri,
          metadata: sourceInput.metadata,
          status: "connected",
        })
        .returning();
    }

    await db.insert(auditEvents).values({
      twinId,
      actorType: auth.type,
      actorId: auth.sub,
      eventType: "connector.account_connected",
      resourceType: "connector_account",
      resourceId: account.id,
      metadata: {
        provider,
        scopes,
        sourceId: source?.id ?? null,
        walletAddress: auth.walletAddress,
      },
    });

    return c.json({ account, source }, 201);
  });

  routes.post("/accounts/:accountId/sync", requireAuth, async (c) => {
    const scopeError = requireScope(c, "artifact:upload");

    if (scopeError) {
      return scopeError;
    }

    const authError = authorizeTwin(c);

    if (authError) {
      return authError;
    }

    const auth = c.get("auth");
    const twinId = c.req.param("twinId") ?? "";
    const accountId = c.req.param("accountId") ?? "";
    const body = await c.req.json().catch(() => ({}));
    const mode = readSyncMode(recordValue(body, "mode")) ?? "manual";
    const connectorSourceId = optionalString(
      recordValue(body, "connectorSourceId"),
    );
    const [account] = await db
      .select()
      .from(connectorAccounts)
      .where(
        and(
          eq(connectorAccounts.id, accountId),
          eq(connectorAccounts.twinId, twinId),
        ),
      )
      .limit(1);

    if (!account) {
      return c.json({ error: "connector_account_not_found" }, 404);
    }

    if (account.status !== "connected") {
      return c.json(
        { error: "connector_account_not_syncable", status: account.status },
        409,
      );
    }

    let source = null;

    if (connectorSourceId) {
      [source] = await db
        .select()
        .from(connectorSources)
        .where(
          and(
            eq(connectorSources.id, connectorSourceId),
            eq(connectorSources.twinId, twinId),
            eq(connectorSources.connectorAccountId, accountId),
          ),
        )
        .limit(1);

      if (!source) {
        return c.json({ error: "connector_source_not_found" }, 404);
      }
    }

    const [syncRun] = await db
      .insert(connectorSyncRuns)
      .values({
        twinId,
        connectorAccountId: account.id,
        connectorSourceId: source?.id ?? null,
        provider: account.provider,
        mode,
        status: "queued",
        cursorBefore: source?.cursor ?? account.cursor,
        metadata: {
          requestedBy: auth.sub,
          provider: account.provider,
        },
      })
      .returning();

    await db.insert(auditEvents).values({
      twinId,
      actorType: auth.type,
      actorId: auth.sub,
      eventType: "connector.sync_queued",
      resourceType: "connector_sync_run",
      resourceId: syncRun.id,
      metadata: {
        provider: account.provider,
        connectorAccountId: account.id,
        connectorSourceId: source?.id ?? null,
        mode,
      },
    });

    const queued = connectorSyncQueue
      ? await connectorSyncQueue
          .enqueueConnectorSync({
            syncRunId: syncRun.id,
            twinId,
            connectorAccountId: account.id,
            connectorSourceId: source?.id ?? null,
            provider: account.provider,
            mode,
          })
          .catch(async (error: unknown) => {
            await db.insert(auditEvents).values({
              twinId,
              actorType: "system",
              actorId: "sivraj-api",
              eventType: "connector.sync_queue_failed",
              resourceType: "connector_sync_run",
              resourceId: syncRun.id,
              metadata: { error: errorMessage(error) },
            });
            return null;
          })
      : null;

    return c.json(
      {
        syncRun,
        jobId: queued?.jobId ?? null,
        warning: connectorSyncQueue
          ? queued
            ? null
            : "connector_sync_queue_failed"
          : "connector_sync_queue_not_configured",
      },
      202,
    );
  });

  routes.get("/sync-runs/:syncRunId", requireAuth, async (c) => {
    const scopeError = requireScope(c, "artifact:read");

    if (scopeError) {
      return scopeError;
    }

    const authError = authorizeTwin(c);

    if (authError) {
      return authError;
    }

    const twinId = c.req.param("twinId") ?? "";
    const syncRunId = c.req.param("syncRunId") ?? "";
    const [syncRun] = await db
      .select()
      .from(connectorSyncRuns)
      .where(
        and(
          eq(connectorSyncRuns.id, syncRunId),
          eq(connectorSyncRuns.twinId, twinId),
        ),
      )
      .limit(1);

    if (!syncRun) {
      return c.json({ error: "connector_sync_run_not_found" }, 404);
    }

    const items = await db
      .select()
      .from(connectorSyncItems)
      .where(eq(connectorSyncItems.connectorSyncRunId, syncRunId))
      .orderBy(desc(connectorSyncItems.createdAt))
      .limit(100);

    return c.json({ syncRun, items });
  });

  routes.patch("/accounts/:accountId", requireAuth, async (c) => {
    const scopeError = requireScope(c, "artifact:upload");

    if (scopeError) {
      return scopeError;
    }

    const authError = authorizeTwin(c);

    if (authError) {
      return authError;
    }

    const auth = c.get("auth");
    const twinId = c.req.param("twinId") ?? "";
    const accountId = c.req.param("accountId") ?? "";
    const body = await c.req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return c.json({ error: "invalid_json_body" }, 400);
    }

    const status = readAccountStatus(body["status"]);

    if (!status) {
      return c.json({ error: "unsupported_connector_status" }, 400);
    }

    const [account] = await db
      .update(connectorAccounts)
      .set({
        status,
        updatedAt: new Date(),
        ...(status === "disconnected"
          ? { tokenRef: null, nextSyncAt: null }
          : {}),
      })
      .where(
        and(
          eq(connectorAccounts.id, accountId),
          eq(connectorAccounts.twinId, twinId),
        ),
      )
      .returning();

    if (!account) {
      return c.json({ error: "connector_account_not_found" }, 404);
    }

    await db.insert(auditEvents).values({
      twinId,
      actorType: auth.type,
      actorId: auth.sub,
      eventType: "connector.account_status_updated",
      resourceType: "connector_account",
      resourceId: account.id,
      metadata: {
        provider: account.provider,
        status,
      },
    });

    return c.json({ account });
  });

  return routes;
}

function authorizeTwin(c: Context<AuthEnv>) {
  const auth = c.get("auth");
  const twinId = c.req.param("twinId");

  if (!twinId) {
    return c.json({ error: "missing_twin_id" }, 400);
  }

  if (auth.type !== "service" && auth.twinId !== twinId) {
    return c.json({ error: "twin_scope_mismatch" }, 403);
  }

  return null;
}

function readProvider(value: unknown): ConnectorProvider | null {
  return CONNECTOR_PROVIDERS.includes(value as ConnectorProvider)
    ? (value as ConnectorProvider)
    : null;
}

function readSyncMode(value: unknown): ConnectorMode | null {
  return value === "initial" || value === "incremental" || value === "manual"
    ? value
    : null;
}

function readAccountStatus(value: unknown) {
  return value === "connected" ||
    value === "paused" ||
    value === "needs_reauth" ||
    value === "error" ||
    value === "disconnected"
    ? value
    : null;
}

function readSourceInput(value: unknown, provider: ConnectorProvider) {
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
    metadata: readRecord(record["metadata"]),
  };
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function recordValue(value: unknown, key: string): unknown {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function connectorLabel(provider: ConnectorProvider): string {
  return provider
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown queue error";
}
