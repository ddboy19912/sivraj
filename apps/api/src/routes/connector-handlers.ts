import {
  auditEvents,
  connectorAccounts,
  connectorSources,
  connectorSyncItems,
  connectorSyncRuns,
} from "@sivraj/db";
import { and, desc, eq } from "drizzle-orm";
import type { Context } from "hono";
import type { AppDependencies } from "../app.js";
import type { AuthEnv } from "../middleware/auth.js";
import type { AuthorizedTwin } from "../lib/http/route-auth.js";
import { optionalString, readRecord } from "../lib/http/route-helpers.js";
import { sanitizeSafeMetadata } from "../lib/safe-metadata.js";
import {
  CONNECTOR_PROVIDERS,
  CONNECTOR_SOURCE_TYPES,
  DEFAULT_CONNECTOR_SCOPES,
  connectorLabel,
  readAccountStatus,
  readProvider,
  readSourceInput,
  readStringList,
} from "../lib/connectors/helpers.js";

export function handleConnectorsAvailableGet(c: Context<AuthEnv>) {
  return c.json({
    connectors: CONNECTOR_PROVIDERS.map((provider) => ({
      provider,
      sourceType: CONNECTOR_SOURCE_TYPES[provider],
      defaultScopes: DEFAULT_CONNECTOR_SCOPES[provider],
      authModel: connectorAuthModel(provider),
    })),
  });
}

function connectorAuthModel(provider: (typeof CONNECTOR_PROVIDERS)[number]) {
  if (provider === "browser_history") {
    return "import";
  }

  if (provider === "telegram") {
    return "bot_link";
  }

  return "oauth_or_token";
}

export async function handleConnectorsListGet(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  twinId: string,
) {
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
}

export async function handleCreateConnectorAccount(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  { auth, twinId, body }: AuthorizedTwin & { body: Record<string, unknown> },
) {
  const provider = readProvider(body["provider"]);

  if (!provider) {
    return c.json({ error: "unsupported_connector_provider" }, 400);
  }

  const account = await insertConnectorAccount(db, {
    twinId,
    provider,
    body,
  });
  const source = await maybeInsertConnectorSource(db, {
    twinId,
    provider,
    accountId: account.id,
    body,
  });

  await db.insert(auditEvents).values({
    twinId,
    actorType: auth.type,
    actorId: auth.sub,
    eventType: "connector.account_connected",
    resourceType: "connector_account",
    resourceId: account.id,
    metadata: {
      provider,
      scopes: account.scopes,
      sourceId: source?.id ?? null,
      walletAddress: auth.walletAddress,
    },
  });

  return c.json({ account, source }, 201);
}

export async function handleConnectorSyncRunGet(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  twinId: string,
  syncRunId: string,
) {
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
    .where(and(
      eq(connectorSyncItems.connectorSyncRunId, syncRunId),
      eq(connectorSyncItems.twinId, twinId),
    ))
    .orderBy(desc(connectorSyncItems.createdAt))
    .limit(100);

  return c.json({ syncRun, items });
}

export async function handlePatchConnectorAccount(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  { auth, twinId, body }: AuthorizedTwin & { body: Record<string, unknown> },
  accountId: string,
) {
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
}

async function insertConnectorAccount(
  db: AppDependencies["db"],
  input: {
    twinId: string;
    provider: NonNullable<ReturnType<typeof readProvider>>;
    body: Record<string, unknown>;
  },
) {
  const displayName =
    optionalString(input.body["displayName"]) ?? connectorLabel(input.provider);
  const externalAccountId =
    optionalString(input.body["externalAccountId"]) ?? displayName;
  const scopes =
    readStringList(input.body["scopes"]) ?? DEFAULT_CONNECTOR_SCOPES[input.provider];
  const syncCadence = optionalString(input.body["syncCadence"]) ?? "manual";
  const metadata = sanitizeSafeMetadata(readRecord(input.body["metadata"]));

  const [account] = await db
    .insert(connectorAccounts)
    .values({
      twinId: input.twinId,
      provider: input.provider,
      displayName,
      externalAccountId,
      scopes,
      syncCadence,
      metadata,
      status: "connected",
    })
    .returning();

  return account;
}

async function maybeInsertConnectorSource(
  db: AppDependencies["db"],
  input: {
    twinId: string;
    provider: NonNullable<ReturnType<typeof readProvider>>;
    accountId: string;
    body: Record<string, unknown>;
  },
) {
  const sourceInput = readSourceInput(input.body["source"], input.provider);

  if (!sourceInput) {
    return null;
  }

  const [source] = await db
    .insert(connectorSources)
    .values({
      twinId: input.twinId,
      connectorAccountId: input.accountId,
      provider: input.provider,
      sourceType: sourceInput.sourceType,
      externalSourceId: sourceInput.externalSourceId,
      displayName: sourceInput.displayName,
      uri: sourceInput.uri,
      metadata: sourceInput.metadata,
      status: "connected",
    })
    .returning();

  return source;
}
