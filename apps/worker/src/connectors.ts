import { createHash } from "node:crypto";
import {
  auditEvents,
  candidateMemories,
  connectorAccounts,
  connectorSources,
  connectorSyncItems,
  connectorSyncRuns,
  memoryFragments,
  sourceArtifacts,
  type Db,
} from "@sivraj/db";
import {
  importPublicGitHubRepository,
  parseGitHubRepoUrl,
  type GitHubImportResult,
} from "@sivraj/ingestion";
import type { ArtifactProcessingQueue, ConnectorSyncJobData } from "@sivraj/queue";
import { and, eq, inArray, isNull, lte, ne, or } from "drizzle-orm";
import type { PrivateSourceStorage } from "./private-source-storage.js";

const ENCRYPTED_WALRUS_STORAGE_MODE = "encrypted_walrus";
const DEFAULT_MANUAL_MEMORY_SENSITIVITY = "private";

type ConnectorAccount = typeof connectorAccounts.$inferSelect;
type ConnectorSource = typeof connectorSources.$inferSelect;
type ConnectorSyncRun = typeof connectorSyncRuns.$inferSelect;
type NotionPageResponse = {
  id?: string;
  url?: string;
  archived?: boolean;
  last_edited_time?: string;
  properties?: Record<string, unknown>;
};
type NotionBlock = {
  id?: string;
  type?: string;
  has_children?: boolean;
  [key: string]: unknown;
};
type NotionListResponse<T> = {
  results?: T[];
  has_more?: boolean;
  next_cursor?: string | null;
};
type NotionPageImportResult = {
  pageId: string;
  pageUrl: string | null;
  title: string;
  content: string;
  metadata: {
    importer: "notion_page";
    pageId: string;
    pageUrl: string | null;
    lastEditedTime: string | null;
    blockCount: number;
    truncated: boolean;
  };
};
type SlackConversationInfoResponse = {
  ok?: boolean;
  error?: string;
  channel?: {
    id?: string;
    name?: string;
    is_channel?: boolean;
    is_group?: boolean;
    is_im?: boolean;
    is_mpim?: boolean;
    is_private?: boolean;
    is_archived?: boolean;
    num_members?: number;
  };
};
type SlackHistoryResponse = {
  ok?: boolean;
  error?: string;
  messages?: SlackMessage[];
  has_more?: boolean;
  response_metadata?: {
    next_cursor?: string;
  };
};
type SlackMessage = {
  user?: string;
  username?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  type?: string;
  subtype?: string;
};
type SlackChannelImportResult = {
  channelId: string;
  channelName: string;
  content: string;
  metadata: {
    importer: "slack_channel";
    channelId: string;
    channelName: string;
    isPrivate: boolean | null;
    messageCount: number;
    oldest: string | null;
    latest: string | null;
    nextCursor: string | null;
  };
};
type GmailListResponse = {
  messages?: Array<{ id?: string; threadId?: string }>;
  nextPageToken?: string;
};
type GmailMessageResponse = {
  id?: string;
  threadId?: string;
  internalDate?: string;
  raw?: string;
};
type EmailImportResult = {
  messageId: string;
  threadId: string | null;
  title: string;
  content: string;
  metadata: {
    importer: "gmail_message";
    messageId: string;
    threadId: string | null;
    internalDate: string | null;
  };
};
type GoogleCalendarEventsResponse = {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
};
type GoogleCalendarEvent = {
  id?: string;
  status?: string;
  htmlLink?: string;
  summary?: string;
  description?: string;
  location?: string;
  updated?: string;
  created?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string; self?: boolean }>;
  hangoutLink?: string;
};
type CalendarImportResult = {
  calendarId: string;
  title: string;
  content: string;
  metadata: {
    importer: "google_calendar_events";
    calendarId: string;
    eventCount: number;
    timeMin: string;
    timeMax: string;
    latestUpdated: string | null;
  };
};
type GoogleDriveFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  webViewLink?: string;
};
type GoogleDriveListResponse = {
  files?: GoogleDriveFile[];
};
type MicrosoftDriveItem = {
  id?: string;
  name?: string;
  webUrl?: string;
  lastModifiedDateTime?: string;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
};
type MicrosoftDriveChildrenResponse = {
  value?: MicrosoftDriveItem[];
};
type DriveDocumentImportResult = {
  provider: "google_drive" | "microsoft_onedrive";
  sourceType: ConnectorArtifactSourceType;
  externalItemId: string;
  title: string;
  content: string;
  uri: string | null;
  metadata: {
    importer: "google_drive_file" | "microsoft_onedrive_item";
    fileId: string;
    fileName: string;
    mimeType: string | null;
    modifiedTime: string | null;
  };
};

type ConnectorArtifactSourceType =
  | "api"
  | "email"
  | "calendar"
  | "browser_history"
  | "docx"
  | "markdown"
  | "csv"
  | "upload";

export type ConnectorSyncAdapter = {
  provider: string;
  sync(input: ConnectorSyncAdapterInput): Promise<ConnectorSyncAdapterResult>;
};

export type ConnectorSyncAdapterInput = {
  db: Db;
  syncRun: ConnectorSyncRun;
  account: ConnectorAccount;
  source: ConnectorSource | null;
  privateSourceStorage: PrivateSourceStorage;
  artifactProcessingQueue: ArtifactProcessingQueue;
};

export type ConnectorSyncAdapterResult = {
  cursorAfter?: string | null;
  nextSyncAt?: Date | null;
  addedCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
};

export async function processConnectorSyncRun(input: {
  db: Db;
  data: ConnectorSyncJobData;
  privateSourceStorage?: PrivateSourceStorage;
  artifactProcessingQueue: ArtifactProcessingQueue;
  adapters?: ConnectorSyncAdapter[];
}) {
  const startedAt = new Date();
  const { db, data } = input;

  await db
    .update(connectorSyncRuns)
    .set({
      status: "processing",
      startedAt,
      updatedAt: startedAt,
    })
    .where(eq(connectorSyncRuns.id, data.syncRunId));

  await db.insert(auditEvents).values({
    twinId: data.twinId,
    actorType: "system",
    actorId: "sivraj-worker",
    eventType: "connector.sync_started",
    resourceType: "connector_sync_run",
    resourceId: data.syncRunId,
    metadata: connectorAuditMetadata(data),
  });

  try {
    const [syncRun] = await db
      .select()
      .from(connectorSyncRuns)
      .where(eq(connectorSyncRuns.id, data.syncRunId))
      .limit(1);
    const [account] = await db
      .select()
      .from(connectorAccounts)
      .where(eq(connectorAccounts.id, data.connectorAccountId))
      .limit(1);
    const [source] = data.connectorSourceId
      ? await db
          .select()
          .from(connectorSources)
          .where(eq(connectorSources.id, data.connectorSourceId))
          .limit(1)
      : [null];

    if (!syncRun || !account) {
      throw new Error("connector_sync_context_not_found");
    }

    if (!input.privateSourceStorage) {
      throw new Error("private_source_storage_not_configured");
    }

    const adapter = (input.adapters ?? defaultConnectorAdapters()).find(
      (candidate) => candidate.provider === data.provider,
    );

    if (!adapter) {
      return await completePlaceholderSync(db, data, {
        reason: "provider_sync_adapter_not_implemented",
      });
    }

    const result = await adapter.sync({
      db,
      syncRun,
      account,
      source,
      privateSourceStorage: input.privateSourceStorage,
      artifactProcessingQueue: input.artifactProcessingQueue,
    });
    const completedAt = new Date();
    const [updated] = await db
      .update(connectorSyncRuns)
      .set({
        status: "completed",
        cursorAfter: result.cursorAfter ?? source?.cursor ?? account.cursor,
        addedCount: result.addedCount,
        updatedCount: result.updatedCount,
        skippedCount: result.skippedCount,
        failedCount: result.failedCount,
        completedAt,
        updatedAt: completedAt,
      })
      .where(eq(connectorSyncRuns.id, data.syncRunId))
      .returning();

    await updateConnectorSyncTimestamps(db, {
      account,
      source,
      completedAt,
      cursorAfter: result.cursorAfter,
      nextSyncAt: result.nextSyncAt ?? nextSyncAt(account.syncCadence, completedAt),
    });

    await db.insert(auditEvents).values({
      twinId: data.twinId,
      actorType: "system",
      actorId: "sivraj-worker",
      eventType: "connector.sync_completed",
      resourceType: "connector_sync_run",
      resourceId: data.syncRunId,
      metadata: {
        ...connectorAuditMetadata(data),
        addedCount: result.addedCount,
        updatedCount: result.updatedCount,
        skippedCount: result.skippedCount,
        failedCount: result.failedCount,
      },
    });

    return updated ?? {
      status: "completed",
      ...result,
    };
  } catch (error) {
    const completedAt = new Date();
    const [failed] = await db
      .update(connectorSyncRuns)
      .set({
        status: "failed",
        failedCount: 1,
        errorCode: connectorErrorCode(error),
        errorMessage: errorMessage(error),
        completedAt,
        updatedAt: completedAt,
      })
      .where(eq(connectorSyncRuns.id, data.syncRunId))
      .returning();

    await db
      .update(connectorAccounts)
      .set({
        status: "error",
        errorCode: connectorErrorCode(error),
        updatedAt: completedAt,
      })
      .where(eq(connectorAccounts.id, data.connectorAccountId));

    await db.insert(auditEvents).values({
      twinId: data.twinId,
      actorType: "system",
      actorId: "sivraj-worker",
      eventType: "connector.sync_failed",
      resourceType: "connector_sync_run",
      resourceId: data.syncRunId,
      metadata: {
        ...connectorAuditMetadata(data),
        error: errorMessage(error),
      },
    });

    return failed ?? {
      status: "failed",
      addedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 1,
    };
  }
}

export async function enqueueDueConnectorSyncs(input: {
  db: Db;
  connectorSyncQueue: { enqueueConnectorSync(data: ConnectorSyncJobData): Promise<{ jobId: string }> };
  now?: Date;
  limit?: number;
}) {
  const now = input.now ?? new Date();
  const accounts = await input.db
    .select()
    .from(connectorAccounts)
    .where(
      and(
        eq(connectorAccounts.status, "connected"),
        ne(connectorAccounts.syncCadence, "manual"),
        or(isNull(connectorAccounts.nextSyncAt), lte(connectorAccounts.nextSyncAt, now)),
      ),
    )
    .limit(input.limit ?? 25);
  let queued = 0;

  for (const account of accounts) {
    const sources = await input.db
      .select()
      .from(connectorSources)
      .where(
        and(
          eq(connectorSources.connectorAccountId, account.id),
          eq(connectorSources.status, "connected"),
        ),
      );
    const syncTargets = sources.length > 0 ? sources : [null];

    for (const source of syncTargets) {
      const [activeRun] = await input.db
        .select({ id: connectorSyncRuns.id })
        .from(connectorSyncRuns)
        .where(
          and(
            eq(connectorSyncRuns.connectorAccountId, account.id),
            source
              ? eq(connectorSyncRuns.connectorSourceId, source.id)
              : isNull(connectorSyncRuns.connectorSourceId),
            inArray(connectorSyncRuns.status, ["queued", "processing"]),
          ),
        )
        .limit(1);

      if (activeRun) {
        continue;
      }

      const [syncRun] = await input.db
        .insert(connectorSyncRuns)
        .values({
          twinId: account.twinId,
          connectorAccountId: account.id,
          connectorSourceId: source?.id ?? null,
          provider: account.provider,
          mode: account.lastSyncAt ? "incremental" : "initial",
          status: "queued",
          cursorBefore: source?.cursor ?? account.cursor,
          metadata: {
            scheduler: "worker",
          },
        })
        .returning();

      await input.connectorSyncQueue.enqueueConnectorSync({
        syncRunId: syncRun.id,
        twinId: account.twinId,
        connectorAccountId: account.id,
        connectorSourceId: source?.id ?? null,
        provider: account.provider,
        mode: account.lastSyncAt ? "incremental" : "initial",
      });
      queued += 1;
    }
  }

  return { scanned: accounts.length, queued };
}

function defaultConnectorAdapters(): ConnectorSyncAdapter[] {
  return [
    createGitHubConnectorSyncAdapter(),
    createNotionConnectorSyncAdapter({
      token: process.env["NOTION_API_TOKEN"],
    }),
    createSlackConnectorSyncAdapter({
      token: process.env["SLACK_BOT_TOKEN"],
    }),
    createEmailConnectorSyncAdapter({
      token: process.env["GMAIL_ACCESS_TOKEN"],
    }),
    createCalendarConnectorSyncAdapter({
      token: process.env["GOOGLE_CALENDAR_ACCESS_TOKEN"],
    }),
    createGoogleDriveConnectorSyncAdapter({
      token: process.env["GOOGLE_DRIVE_ACCESS_TOKEN"],
    }),
    createMicrosoftOneDriveConnectorSyncAdapter({
      token: process.env["MICROSOFT_GRAPH_ACCESS_TOKEN"],
    }),
    createBrowserHistoryConnectorSyncAdapter(),
  ];
}

function createGitHubConnectorSyncAdapter(): ConnectorSyncAdapter {
  return {
    provider: "github",
    async sync(input) {
      if (!input.source) {
        throw new Error("github_connector_source_required");
      }

      const repoUrl = readGitHubRepoUrl(input.source);
      const imported = await importPublicGitHubRepository({ repoUrl });
      const result = await storeImportedConnectorArtifact(input, imported);

      return {
        cursorAfter: imported.metadata.defaultBranch,
        nextSyncAt: nextSyncAt(input.account.syncCadence),
        ...result,
      };
    },
  };
}

function createSlackConnectorSyncAdapter(input: {
  token: string | undefined;
  fetcher?: typeof fetch;
}): ConnectorSyncAdapter {
  return {
    provider: "slack",
    async sync(adapterInput) {
      if (!adapterInput.source) {
        throw new Error("slack_connector_source_required");
      }

      if (!input.token) {
        throw new Error("slack_bot_token_not_configured");
      }

      const channelId = readSlackChannelId(adapterInput.source);
      const imported = await importSlackChannel({
        channelId,
        token: input.token,
        oldest: adapterInput.source.cursor ?? adapterInput.account.cursor ?? undefined,
        fetcher: input.fetcher ?? fetch,
      });
      const result = await storeSlackConnectorArtifact(adapterInput, imported);

      return {
        cursorAfter: imported.metadata.latest ?? adapterInput.source.cursor ?? adapterInput.account.cursor,
        nextSyncAt: nextSyncAt(adapterInput.account.syncCadence),
        ...result,
      };
    },
  };
}

function createNotionConnectorSyncAdapter(input: {
  token: string | undefined;
  fetcher?: typeof fetch;
}): ConnectorSyncAdapter {
  return {
    provider: "notion",
    async sync(adapterInput) {
      if (!adapterInput.source) {
        throw new Error("notion_connector_source_required");
      }

      if (!input.token) {
        throw new Error("notion_api_token_not_configured");
      }

      const pageId = readNotionPageId(adapterInput.source);
      const imported = await importNotionPage({
        pageId,
        token: input.token,
        fetcher: input.fetcher ?? fetch,
      });
      const result = await storeTextConnectorArtifact(adapterInput, {
        provider: "notion",
        sourceType: "api",
        title: imported.title,
        content: imported.content,
        uri: imported.pageUrl ?? adapterInput.source.uri,
        externalItemId: imported.pageId,
        metadata: imported.metadata,
      });

      return {
        cursorAfter: imported.metadata.lastEditedTime,
        nextSyncAt: nextSyncAt(adapterInput.account.syncCadence),
        ...result,
      };
    },
  };
}

function createEmailConnectorSyncAdapter(input: {
  token: string | undefined;
  fetcher?: typeof fetch;
}): ConnectorSyncAdapter {
  return {
    provider: "email",
    async sync(adapterInput) {
      if (!input.token) {
        throw new Error("gmail_access_token_not_configured");
      }

      const imported = await importGmailMessages({
        token: input.token,
        cursor: adapterInput.source?.cursor ?? adapterInput.account.cursor ?? undefined,
        query: readConnectorMetadataString(adapterInput.source?.metadata, "query") ??
          readConnectorMetadataString(adapterInput.account.metadata, "query") ??
          "in:inbox",
        fetcher: input.fetcher ?? fetch,
      });

      if (imported.messages.length === 0) {
        await adapterInput.db.insert(connectorSyncItems).values({
          twinId: adapterInput.syncRun.twinId,
          connectorSyncRunId: adapterInput.syncRun.id,
          connectorAccountId: adapterInput.account.id,
          connectorSourceId: adapterInput.source?.id ?? null,
          externalItemId: "gmail:messages",
          action: "skipped",
          reason: "gmail_no_new_messages",
          metadata: {
            importer: "gmail_message",
            query: imported.query,
          },
        });

        return {
          cursorAfter: adapterInput.source?.cursor ?? adapterInput.account.cursor,
          nextSyncAt: nextSyncAt(adapterInput.account.syncCadence),
          addedCount: 0,
          updatedCount: 0,
          skippedCount: 1,
          failedCount: 0,
        };
      }

      let addedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;

      for (const message of imported.messages) {
        try {
          const result = await storeTextConnectorArtifact(adapterInput, {
            provider: "email",
            sourceType: "email",
            title: message.title,
            content: message.content,
            uri: `gmail://message/${message.messageId}`,
            externalItemId: message.messageId,
            metadata: message.metadata,
          });

          addedCount += result.addedCount;
          updatedCount += result.updatedCount;
          skippedCount += result.skippedCount;
          failedCount += result.failedCount;
        } catch (error) {
          failedCount += 1;
          await adapterInput.db.insert(connectorSyncItems).values({
            twinId: adapterInput.syncRun.twinId,
            connectorSyncRunId: adapterInput.syncRun.id,
            connectorAccountId: adapterInput.account.id,
            connectorSourceId: adapterInput.source?.id ?? null,
            externalItemId: message.messageId,
            action: "failed",
            reason: errorMessage(error),
            metadata: message.metadata,
          });
        }
      }

      return {
        cursorAfter: imported.cursorAfter ?? adapterInput.source?.cursor ?? adapterInput.account.cursor,
        nextSyncAt: nextSyncAt(adapterInput.account.syncCadence),
        addedCount,
        updatedCount,
        skippedCount,
        failedCount,
      };
    },
  };
}

function createCalendarConnectorSyncAdapter(input: {
  token: string | undefined;
  fetcher?: typeof fetch;
}): ConnectorSyncAdapter {
  return {
    provider: "calendar",
    async sync(adapterInput) {
      if (!input.token) {
        throw new Error("google_calendar_access_token_not_configured");
      }

      const calendarId = readCalendarId(adapterInput.source);
      const imported = await importGoogleCalendarEvents({
        token: input.token,
        calendarId,
        cursor: adapterInput.source?.cursor ?? adapterInput.account.cursor ?? undefined,
        fetcher: input.fetcher ?? fetch,
      });
      const result = await storeTextConnectorArtifact(adapterInput, {
        provider: "calendar",
        sourceType: "calendar",
        title: imported.title,
        content: imported.content,
        uri: `google-calendar://${calendarId}`,
        externalItemId: calendarId,
        metadata: imported.metadata,
      });

      return {
        cursorAfter: imported.metadata.latestUpdated ?? adapterInput.source?.cursor ?? adapterInput.account.cursor,
        nextSyncAt: nextSyncAt(adapterInput.account.syncCadence),
        ...result,
      };
    },
  };
}

function createGoogleDriveConnectorSyncAdapter(input: {
  token: string | undefined;
  fetcher?: typeof fetch;
}): ConnectorSyncAdapter {
  return {
    provider: "google_drive",
    async sync(adapterInput) {
      if (!adapterInput.source) {
        throw new Error("google_drive_connector_source_required");
      }

      if (!input.token) {
        throw new Error("google_drive_access_token_not_configured");
      }

      const imported = await importGoogleDriveSource({
        token: input.token,
        source: adapterInput.source,
        fetcher: input.fetcher ?? fetch,
      });

      return await storeDocumentImports(adapterInput, imported, "google_drive");
    },
  };
}

function createMicrosoftOneDriveConnectorSyncAdapter(input: {
  token: string | undefined;
  fetcher?: typeof fetch;
}): ConnectorSyncAdapter {
  return {
    provider: "microsoft_onedrive",
    async sync(adapterInput) {
      if (!adapterInput.source) {
        throw new Error("microsoft_onedrive_connector_source_required");
      }

      if (!input.token) {
        throw new Error("microsoft_graph_access_token_not_configured");
      }

      const imported = await importMicrosoftOneDriveSource({
        token: input.token,
        source: adapterInput.source,
        fetcher: input.fetcher ?? fetch,
      });

      return await storeDocumentImports(adapterInput, imported, "microsoft_onedrive");
    },
  };
}

function createBrowserHistoryConnectorSyncAdapter(): ConnectorSyncAdapter {
  return {
    provider: "browser_history",
    async sync(adapterInput) {
      const content = readConnectorMetadataString(adapterInput.source?.metadata, "content") ??
        readConnectorMetadataString(adapterInput.source?.metadata, "csv") ??
        readConnectorMetadataString(adapterInput.account.metadata, "content") ??
        readConnectorMetadataString(adapterInput.account.metadata, "csv");

      if (!content) {
        await adapterInput.db.insert(connectorSyncItems).values({
          twinId: adapterInput.syncRun.twinId,
          connectorSyncRunId: adapterInput.syncRun.id,
          connectorAccountId: adapterInput.account.id,
          connectorSourceId: adapterInput.source?.id ?? null,
          externalItemId: "browser_history_import",
          action: "skipped",
          reason: "browser_history_content_not_provided",
          metadata: { importer: "browser_history_connector_import" },
        });

        return {
          cursorAfter: adapterInput.source?.cursor ?? adapterInput.account.cursor,
          nextSyncAt: nextSyncAt(adapterInput.account.syncCadence),
          addedCount: 0,
          updatedCount: 0,
          skippedCount: 1,
          failedCount: 0,
        };
      }

      const result = await storeTextConnectorArtifact(adapterInput, {
        provider: "browser_history",
        sourceType: "browser_history",
        title: adapterInput.source?.displayName ?? "Browser history import",
        content,
        uri: adapterInput.source?.uri ?? null,
        externalItemId: adapterInput.source?.externalSourceId ?? "browser_history_import",
        metadata: {
          importer: "browser_history_connector_import",
          sourceName: adapterInput.source?.displayName ?? null,
        },
      });

      return {
        cursorAfter: sha256(content),
        nextSyncAt: nextSyncAt(adapterInput.account.syncCadence),
        ...result,
      };
    },
  };
}

async function storeImportedConnectorArtifact(
  input: ConnectorSyncAdapterInput,
  imported: GitHubImportResult,
): Promise<Omit<ConnectorSyncAdapterResult, "cursorAfter" | "nextSyncAt">> {
  const contentHash = sha256(imported.content);
  const [matchingArtifact] = await input.db
    .select({ id: sourceArtifacts.id })
    .from(sourceArtifacts)
    .where(
      and(
        eq(sourceArtifacts.connectorSourceId, input.source?.id ?? ""),
        eq(sourceArtifacts.hash, contentHash),
      ),
    )
    .limit(1);

  if (matchingArtifact) {
    await input.db.insert(connectorSyncItems).values({
      twinId: input.syncRun.twinId,
      connectorSyncRunId: input.syncRun.id,
      connectorAccountId: input.account.id,
      connectorSourceId: input.source?.id ?? null,
      sourceArtifactId: matchingArtifact.id,
      externalItemId: imported.repoUrl,
      action: "skipped",
      reason: "content_hash_unchanged",
      contentHash,
      metadata: {
        fileCount: imported.metadata.files.length,
      },
    });

    return { addedCount: 0, updatedCount: 0, skippedCount: 1, failedCount: 0 };
  }

  const [previousArtifact] = await input.db
    .select({ id: sourceArtifacts.id })
    .from(sourceArtifacts)
    .where(eq(sourceArtifacts.connectorSourceId, input.source?.id ?? ""))
    .limit(1);
  const action = previousArtifact ? "updated" : "added";
  const stored = await input.privateSourceStorage.storePrivateSource({
    twinId: input.syncRun.twinId,
    sourceType: "github",
    title: imported.title,
    content: imported.content,
    metadata: imported.metadata,
  });
  const [artifact] = await input.db
    .insert(sourceArtifacts)
    .values({
      twinId: input.syncRun.twinId,
      sourceType: "github",
      uri: imported.repoUrl,
      hash: contentHash,
      connectorAccountId: input.account.id,
      connectorSourceId: input.source?.id ?? null,
      connectorSyncRunId: input.syncRun.id,
      metadata: {
        storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
        sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
        encryptedPayload: {
          kind: "source_artifact",
          version: 1,
          connectorProvider: "github",
        },
        ciphertextSha256: stored.ciphertextSha256,
        seal: stored.seal,
        walrus: stored.walrus,
        connector: {
          accountId: input.account.id,
          sourceId: input.source?.id ?? null,
          syncRunId: input.syncRun.id,
          provider: "github",
          externalItemId: imported.repoUrl,
          contentHash,
        },
      },
      rawStorageRef: stored.rawStorageRef,
      ingestionStatus: "queued",
    })
    .returning();

  await input.db.insert(connectorSyncItems).values({
    twinId: input.syncRun.twinId,
    connectorSyncRunId: input.syncRun.id,
    connectorAccountId: input.account.id,
    connectorSourceId: input.source?.id ?? null,
    sourceArtifactId: artifact.id,
    externalItemId: imported.repoUrl,
    action,
    contentHash,
    metadata: {
      fileCount: imported.metadata.files.length,
      skippedFiles: imported.metadata.skipped.length,
      artifactId: artifact.id,
    },
  });

  await input.db.insert(auditEvents).values({
    twinId: input.syncRun.twinId,
    actorType: "system",
    actorId: "sivraj-worker",
    eventType: "connector.artifact_created",
    resourceType: "source_artifact",
    resourceId: artifact.id,
    metadata: {
      connectorAccountId: input.account.id,
      connectorSourceId: input.source?.id ?? null,
      connectorSyncRunId: input.syncRun.id,
      provider: "github",
      action,
      rawStorageRef: stored.rawStorageRef,
    },
  });

  if (action === "updated") {
    await supersedePreviousConnectorArtifacts(input, {
      provider: "github",
      newArtifactId: artifact.id,
      externalItemId: imported.repoUrl,
      contentHash,
    });
  }

  await input.artifactProcessingQueue.enqueueArtifactProcessing({
    artifactId: artifact.id,
    twinId: input.syncRun.twinId,
    sourceType: "github",
    ...(stored.encryptedBytesBase64
      ? {
          transientCiphertextBase64: stored.encryptedBytesBase64,
          transientCiphertextSha256: stored.ciphertextSha256,
        }
      : {}),
  });

  return {
    addedCount: action === "added" ? 1 : 0,
    updatedCount: action === "updated" ? 1 : 0,
    skippedCount: 0,
    failedCount: 0,
  };
}

async function storeTextConnectorArtifact(
  input: ConnectorSyncAdapterInput,
  imported: {
    provider: string;
    sourceType: ConnectorArtifactSourceType;
    title: string;
    content: string;
    uri: string | null;
    externalItemId: string;
    metadata: Record<string, unknown>;
  },
): Promise<Omit<ConnectorSyncAdapterResult, "cursorAfter" | "nextSyncAt">> {
  const contentHash = sha256(imported.content);
  const connectorSourceId = input.source?.id ?? "";
  const [matchingArtifact] = await input.db
    .select({ id: sourceArtifacts.id })
    .from(sourceArtifacts)
    .where(
      and(
        eq(sourceArtifacts.connectorSourceId, connectorSourceId),
        eq(sourceArtifacts.hash, contentHash),
      ),
    )
    .limit(1);

  if (matchingArtifact) {
    await input.db.insert(connectorSyncItems).values({
      twinId: input.syncRun.twinId,
      connectorSyncRunId: input.syncRun.id,
      connectorAccountId: input.account.id,
      connectorSourceId: input.source?.id ?? null,
      sourceArtifactId: matchingArtifact.id,
      externalItemId: imported.externalItemId,
      action: "skipped",
      reason: "content_hash_unchanged",
      contentHash,
      metadata: imported.metadata,
    });

    return { addedCount: 0, updatedCount: 0, skippedCount: 1, failedCount: 0 };
  }

  const [previousArtifact] = await input.db
    .select({ id: sourceArtifacts.id })
    .from(sourceArtifacts)
    .where(eq(sourceArtifacts.connectorSourceId, connectorSourceId))
    .limit(1);
  const action = previousArtifact ? "updated" : "added";
  const stored = await input.privateSourceStorage.storePrivateSource({
    twinId: input.syncRun.twinId,
    sourceType: imported.sourceType,
    title: imported.title,
    content: imported.content,
    metadata: imported.metadata,
  });
  const [artifact] = await input.db
    .insert(sourceArtifacts)
    .values({
      twinId: input.syncRun.twinId,
      sourceType: imported.sourceType,
      uri: imported.uri,
      hash: contentHash,
      connectorAccountId: input.account.id,
      connectorSourceId: input.source?.id ?? null,
      connectorSyncRunId: input.syncRun.id,
      metadata: {
        storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
        sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
        encryptedPayload: {
          kind: "source_artifact",
          version: 1,
          connectorProvider: imported.provider,
        },
        ciphertextSha256: stored.ciphertextSha256,
        seal: stored.seal,
        walrus: stored.walrus,
        connector: {
          accountId: input.account.id,
          sourceId: input.source?.id ?? null,
          syncRunId: input.syncRun.id,
          provider: imported.provider,
          externalItemId: imported.externalItemId,
          contentHash,
        },
      },
      rawStorageRef: stored.rawStorageRef,
      ingestionStatus: "queued",
    })
    .returning();

  await input.db.insert(connectorSyncItems).values({
    twinId: input.syncRun.twinId,
    connectorSyncRunId: input.syncRun.id,
    connectorAccountId: input.account.id,
    connectorSourceId: input.source?.id ?? null,
    sourceArtifactId: artifact.id,
    externalItemId: imported.externalItemId,
    action,
    contentHash,
    metadata: {
      ...imported.metadata,
      artifactId: artifact.id,
    },
  });

  await input.db.insert(auditEvents).values({
    twinId: input.syncRun.twinId,
    actorType: "system",
    actorId: "sivraj-worker",
    eventType: "connector.artifact_created",
    resourceType: "source_artifact",
    resourceId: artifact.id,
    metadata: {
      connectorAccountId: input.account.id,
      connectorSourceId: input.source?.id ?? null,
      connectorSyncRunId: input.syncRun.id,
      provider: imported.provider,
      action,
      rawStorageRef: stored.rawStorageRef,
    },
  });

  if (action === "updated") {
    await supersedePreviousConnectorArtifacts(input, {
      provider: imported.provider,
      newArtifactId: artifact.id,
      externalItemId: imported.externalItemId,
      contentHash,
    });
  }

  await input.artifactProcessingQueue.enqueueArtifactProcessing({
    artifactId: artifact.id,
    twinId: input.syncRun.twinId,
    sourceType: imported.sourceType,
    ...(stored.encryptedBytesBase64
      ? {
          transientCiphertextBase64: stored.encryptedBytesBase64,
          transientCiphertextSha256: stored.ciphertextSha256,
        }
      : {}),
  });

  return {
    addedCount: action === "added" ? 1 : 0,
    updatedCount: action === "updated" ? 1 : 0,
    skippedCount: 0,
    failedCount: 0,
  };
}

async function supersedePreviousConnectorArtifacts(
  input: ConnectorSyncAdapterInput,
  supersession: {
    provider: string;
    newArtifactId: string;
    externalItemId: string;
    contentHash: string;
  },
) {
  const connectorSourceId = input.source?.id;

  if (!connectorSourceId) {
    return;
  }

  const now = new Date();
  const previousArtifacts = await input.db
    .select({
      id: sourceArtifacts.id,
      metadata: sourceArtifacts.metadata,
    })
    .from(sourceArtifacts)
    .where(
      and(
        eq(sourceArtifacts.connectorSourceId, connectorSourceId),
        ne(sourceArtifacts.id, supersession.newArtifactId),
      ),
    );

  for (const previousArtifact of previousArtifacts) {
    await input.db
      .update(sourceArtifacts)
      .set({
        metadata: {
          ...asRecord(previousArtifact.metadata),
          supersededByArtifactId: supersession.newArtifactId,
          supersededAt: now.toISOString(),
          supersededReason: "connector_source_updated",
        },
        updatedAt: now,
      })
      .where(eq(sourceArtifacts.id, previousArtifact.id));

    await input.db
      .update(memoryFragments)
      .set({
        metadata: {
          supersededByArtifactId: supersession.newArtifactId,
          supersededAt: now.toISOString(),
          supersededReason: "connector_source_updated",
        },
        updatedAt: now,
      })
      .where(eq(memoryFragments.sourceArtifactId, previousArtifact.id));

    await input.db
      .update(candidateMemories)
      .set({
        status: "superseded",
        updatedAt: now,
      })
      .where(eq(candidateMemories.sourceArtifactId, previousArtifact.id));

    await input.db.insert(auditEvents).values({
      twinId: input.syncRun.twinId,
      actorType: "system",
      actorId: "sivraj-worker",
      eventType: "connector.artifact_superseded",
      resourceType: "source_artifact",
      resourceId: previousArtifact.id,
      metadata: {
        connectorAccountId: input.account.id,
        connectorSourceId,
        connectorSyncRunId: input.syncRun.id,
        provider: supersession.provider,
        externalItemId: supersession.externalItemId,
        newArtifactId: supersession.newArtifactId,
        contentHash: supersession.contentHash,
      },
    });
  }
}

async function storeSlackConnectorArtifact(
  input: ConnectorSyncAdapterInput,
  imported: SlackChannelImportResult,
): Promise<Omit<ConnectorSyncAdapterResult, "cursorAfter" | "nextSyncAt">> {
  const contentHash = sha256(imported.content);
  const connectorSourceId = input.source?.id ?? "";
  const [matchingArtifact] = await input.db
    .select({ id: sourceArtifacts.id })
    .from(sourceArtifacts)
    .where(
      and(
        eq(sourceArtifacts.connectorSourceId, connectorSourceId),
        eq(sourceArtifacts.hash, contentHash),
      ),
    )
    .limit(1);

  if (matchingArtifact) {
    await input.db.insert(connectorSyncItems).values({
      twinId: input.syncRun.twinId,
      connectorSyncRunId: input.syncRun.id,
      connectorAccountId: input.account.id,
      connectorSourceId: input.source?.id ?? null,
      sourceArtifactId: matchingArtifact.id,
      externalItemId: imported.channelId,
      action: "skipped",
      reason: "content_hash_unchanged",
      contentHash,
      metadata: imported.metadata,
    });

    return { addedCount: 0, updatedCount: 0, skippedCount: 1, failedCount: 0 };
  }

  if (!imported.metadata.messageCount) {
    await input.db.insert(connectorSyncItems).values({
      twinId: input.syncRun.twinId,
      connectorSyncRunId: input.syncRun.id,
      connectorAccountId: input.account.id,
      connectorSourceId: input.source?.id ?? null,
      externalItemId: imported.channelId,
      action: "skipped",
      reason: "slack_channel_no_new_messages",
      contentHash,
      metadata: imported.metadata,
    });

    return { addedCount: 0, updatedCount: 0, skippedCount: 1, failedCount: 0 };
  }

  const [previousArtifact] = await input.db
    .select({ id: sourceArtifacts.id })
    .from(sourceArtifacts)
    .where(eq(sourceArtifacts.connectorSourceId, connectorSourceId))
    .limit(1);
  const action = previousArtifact ? "updated" : "added";
  const stored = await input.privateSourceStorage.storePrivateSource({
    twinId: input.syncRun.twinId,
    sourceType: "slack_export",
    title: `Slack #${imported.channelName}`,
    content: imported.content,
    metadata: imported.metadata,
  });
  const [artifact] = await input.db
    .insert(sourceArtifacts)
    .values({
      twinId: input.syncRun.twinId,
      sourceType: "slack_export",
      uri: input.source?.uri ?? imported.channelId,
      hash: contentHash,
      connectorAccountId: input.account.id,
      connectorSourceId: input.source?.id ?? null,
      connectorSyncRunId: input.syncRun.id,
      metadata: {
        storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
        sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
        encryptedPayload: {
          kind: "source_artifact",
          version: 1,
          connectorProvider: "slack",
        },
        ciphertextSha256: stored.ciphertextSha256,
        seal: stored.seal,
        walrus: stored.walrus,
        connector: {
          accountId: input.account.id,
          sourceId: input.source?.id ?? null,
          syncRunId: input.syncRun.id,
          provider: "slack",
          externalItemId: imported.channelId,
          contentHash,
        },
      },
      rawStorageRef: stored.rawStorageRef,
      ingestionStatus: "queued",
    })
    .returning();

  await input.db.insert(connectorSyncItems).values({
    twinId: input.syncRun.twinId,
    connectorSyncRunId: input.syncRun.id,
    connectorAccountId: input.account.id,
    connectorSourceId: input.source?.id ?? null,
    sourceArtifactId: artifact.id,
    externalItemId: imported.channelId,
    action,
    contentHash,
    metadata: {
      ...imported.metadata,
      artifactId: artifact.id,
    },
  });

  await input.db.insert(auditEvents).values({
    twinId: input.syncRun.twinId,
    actorType: "system",
    actorId: "sivraj-worker",
    eventType: "connector.artifact_created",
    resourceType: "source_artifact",
    resourceId: artifact.id,
    metadata: {
      connectorAccountId: input.account.id,
      connectorSourceId: input.source?.id ?? null,
      connectorSyncRunId: input.syncRun.id,
      provider: "slack",
      action,
      rawStorageRef: stored.rawStorageRef,
    },
  });

  if (action === "updated") {
    await supersedePreviousConnectorArtifacts(input, {
      provider: "slack",
      newArtifactId: artifact.id,
      externalItemId: imported.channelId,
      contentHash,
    });
  }

  await input.artifactProcessingQueue.enqueueArtifactProcessing({
    artifactId: artifact.id,
    twinId: input.syncRun.twinId,
    sourceType: "slack_export",
    ...(stored.encryptedBytesBase64
      ? {
          transientCiphertextBase64: stored.encryptedBytesBase64,
          transientCiphertextSha256: stored.ciphertextSha256,
        }
      : {}),
  });

  return {
    addedCount: action === "added" ? 1 : 0,
    updatedCount: action === "updated" ? 1 : 0,
    skippedCount: 0,
    failedCount: 0,
  };
}

async function completePlaceholderSync(
  db: Db,
  data: ConnectorSyncJobData,
  input: { reason: string },
) {
  const completedAt = new Date();
  const skippedCount = 1;

  await db.insert(connectorSyncItems).values({
    twinId: data.twinId,
    connectorSyncRunId: data.syncRunId,
    connectorAccountId: data.connectorAccountId,
    connectorSourceId: data.connectorSourceId ?? null,
    externalItemId: `${data.provider}:provider-sync-adapter`,
    action: "skipped",
    reason: input.reason,
    metadata: {
      provider: data.provider,
      mode: data.mode,
      nextStep: "Add provider-specific fetch, diff, artifact creation, and cursor handling.",
    },
  });

  const [syncRun] = await db
    .update(connectorSyncRuns)
    .set({
      status: "completed",
      skippedCount,
      completedAt,
      updatedAt: completedAt,
      metadata: {
        provider: data.provider,
        mode: data.mode,
        implementationStatus: "connector_foundation_ready",
      },
    })
    .where(eq(connectorSyncRuns.id, data.syncRunId))
    .returning();

  await db.insert(auditEvents).values({
    twinId: data.twinId,
    actorType: "system",
    actorId: "sivraj-worker",
    eventType: "connector.sync_completed",
    resourceType: "connector_sync_run",
    resourceId: data.syncRunId,
    metadata: {
      ...connectorAuditMetadata(data),
      addedCount: 0,
      updatedCount: 0,
      skippedCount,
      failedCount: 0,
    },
  });

  return syncRun ?? {
    status: "completed",
    addedCount: 0,
    updatedCount: 0,
    skippedCount,
    failedCount: 0,
  };
}

function readGitHubRepoUrl(source: ConnectorSource): string {
  const repoUrl = source.uri ?? source.externalSourceId;

  if (!parseGitHubRepoUrl(repoUrl)) {
    throw new Error("invalid_github_repo_url");
  }

  return repoUrl;
}

async function importNotionPage(input: {
  pageId: string;
  token: string;
  fetcher: typeof fetch;
}): Promise<NotionPageImportResult> {
  const page = await fetchNotionJson<NotionPageResponse>(
    input.fetcher,
    input.token,
    `/pages/${input.pageId}`,
  );
  const title = readNotionTitle(page) ?? "Untitled Notion page";
  const blockLines: string[] = [];
  let blockCount = 0;
  let truncated = false;

  await readNotionBlocks({
    fetcher: input.fetcher,
    token: input.token,
    blockId: input.pageId,
    lines: blockLines,
    depth: 0,
    onBlock() {
      blockCount += 1;

      if (blockCount >= 500) {
        truncated = true;
        return false;
      }

      return true;
    },
  });

  return {
    pageId: page.id ?? input.pageId,
    pageUrl: typeof page.url === "string" ? page.url : null,
    title,
    content: [
      `Notion page: ${title}`,
      page.url ? `URL: ${page.url}` : null,
      page.last_edited_time ? `Last edited: ${page.last_edited_time}` : null,
      "",
      ...blockLines,
    ]
      .filter((line): line is string => line !== null)
      .join("\n")
      .trim(),
    metadata: {
      importer: "notion_page",
      pageId: page.id ?? input.pageId,
      pageUrl: typeof page.url === "string" ? page.url : null,
      lastEditedTime: typeof page.last_edited_time === "string" ? page.last_edited_time : null,
      blockCount,
      truncated,
    },
  };
}

async function importSlackChannel(input: {
  channelId: string;
  token: string;
  oldest?: string;
  fetcher: typeof fetch;
}): Promise<SlackChannelImportResult> {
  const info = await fetchSlackJson<SlackConversationInfoResponse>(
    input.fetcher,
    input.token,
    "conversations.info",
    { channel: input.channelId, include_num_members: "true" },
  );
  const channel = info.channel ?? {};
  const messages: SlackMessage[] = [];
  let cursor: string | undefined;
  let latest: string | null = null;
  let oldest: string | null = null;

  for (let page = 0; page < 2; page += 1) {
    const history = await fetchSlackJson<SlackHistoryResponse>(
      input.fetcher,
      input.token,
      "conversations.history",
      {
        channel: input.channelId,
        limit: "15",
        ...(input.oldest ? { oldest: input.oldest, inclusive: "false" } : {}),
        ...(cursor ? { cursor } : {}),
      },
    );
    const pageMessages = (history.messages ?? [])
      .filter((message) => message.type === "message" || !message.type)
      .filter((message) => typeof message.text === "string" && message.text.trim().length > 0);

    messages.push(...pageMessages);
    cursor = history.response_metadata?.next_cursor || undefined;

    if (!cursor) {
      break;
    }
  }

  const sortedMessages = [...messages].sort(
    (a: SlackMessage, b: SlackMessage) => Number.parseFloat(a.ts ?? "0") - Number.parseFloat(b.ts ?? "0"),
  );

  if (sortedMessages.length > 0) {
    oldest = sortedMessages[0]?.ts ?? null;
    latest = sortedMessages[sortedMessages.length - 1]?.ts ?? null;
  }

  return {
    channelId: channel.id ?? input.channelId,
    channelName: channel.name ?? input.channelId,
    content: JSON.stringify(sortedMessages),
    metadata: {
      importer: "slack_channel",
      channelId: channel.id ?? input.channelId,
      channelName: channel.name ?? input.channelId,
      isPrivate: typeof channel.is_private === "boolean" ? channel.is_private : null,
      messageCount: sortedMessages.length,
      oldest,
      latest,
      nextCursor: cursor ?? null,
    },
  };
}

async function importGmailMessages(input: {
  token: string;
  cursor?: string;
  query: string;
  fetcher: typeof fetch;
}): Promise<{ messages: EmailImportResult[]; cursorAfter: string | null; query: string }> {
  const afterSeconds = input.cursor ? Math.floor(Number.parseInt(input.cursor, 10) / 1000) : null;
  const query = [input.query, afterSeconds ? `after:${afterSeconds}` : null]
    .filter(Boolean)
    .join(" ");
  const list = await fetchGmailJson<GmailListResponse>(
    input.fetcher,
    input.token,
    `/users/me/messages?${new URLSearchParams({
      maxResults: "10",
      q: query,
    }).toString()}`,
  );
  const imported: EmailImportResult[] = [];
  let cursorAfter: string | null = input.cursor ?? null;

  for (const messageRef of list.messages ?? []) {
    if (!messageRef.id) {
      continue;
    }

    const message = await fetchGmailJson<GmailMessageResponse>(
      input.fetcher,
      input.token,
      `/users/me/messages/${encodeURIComponent(messageRef.id)}?${new URLSearchParams({
        format: "raw",
      }).toString()}`,
    );

    if (!message.id || !message.raw) {
      continue;
    }

    const rawEmail = decodeBase64Url(message.raw);
    imported.push({
      messageId: message.id,
      threadId: message.threadId ?? null,
      title: `Gmail message ${message.id}`,
      content: rawEmail,
      metadata: {
        importer: "gmail_message",
        messageId: message.id,
        threadId: message.threadId ?? null,
        internalDate: message.internalDate ?? null,
      },
    });

    if (message.internalDate && (!cursorAfter || Number.parseInt(message.internalDate, 10) > Number.parseInt(cursorAfter, 10))) {
      cursorAfter = message.internalDate;
    }
  }

  return {
    messages: imported,
    cursorAfter,
    query,
  };
}

async function importGoogleCalendarEvents(input: {
  token: string;
  calendarId: string;
  cursor?: string;
  fetcher: typeof fetch;
}): Promise<CalendarImportResult> {
  const now = Date.now();
  const timeMin = input.cursor
    ? new Date(input.cursor).toISOString()
    : new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(now + 60 * 24 * 60 * 60 * 1000).toISOString();
  const events = await fetchGoogleCalendarJson<GoogleCalendarEventsResponse>(
    input.fetcher,
    input.token,
    `/calendars/${encodeURIComponent(input.calendarId)}/events?${new URLSearchParams({
      maxResults: "50",
      orderBy: "startTime",
      singleEvents: "true",
      timeMin,
      timeMax,
    }).toString()}`,
  );
  const items = (events.items ?? []).filter((event) => event.status !== "cancelled");
  const latestUpdated = items.reduce<string | null>((latest, event) => {
    if (!event.updated) {
      return latest;
    }

    return !latest || event.updated > latest ? event.updated : latest;
  }, null);

  return {
    calendarId: input.calendarId,
    title: `Google Calendar ${input.calendarId}`,
    content: renderCalendarEvents(input.calendarId, items),
    metadata: {
      importer: "google_calendar_events",
      calendarId: input.calendarId,
      eventCount: items.length,
      timeMin,
      timeMax,
      latestUpdated,
    },
  };
}

async function importGoogleDriveSource(input: {
  token: string;
  source: ConnectorSource;
  fetcher: typeof fetch;
}): Promise<DriveDocumentImportResult[]> {
  const sourceId = input.source.externalSourceId || "root";
  const metadataKind = readConnectorMetadataString(input.source.metadata, "kind");
  const files = metadataKind === "file"
    ? [await fetchGoogleDriveJson<GoogleDriveFile>(
        input.fetcher,
        input.token,
        `/files/${encodeURIComponent(sourceId)}?${new URLSearchParams({
          fields: "id,name,mimeType,modifiedTime,webViewLink",
        }).toString()}`,
      )]
    : (await fetchGoogleDriveJson<GoogleDriveListResponse>(
        input.fetcher,
        input.token,
        `/files?${new URLSearchParams({
          pageSize: "10",
          q: `'${sourceId}' in parents and trashed=false`,
          fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
        }).toString()}`,
      )).files ?? [];
  const imported: DriveDocumentImportResult[] = [];

  for (const file of files) {
    if (!file.id || !file.name || file.mimeType === "application/vnd.google-apps.folder") {
      continue;
    }

    const exported = await downloadGoogleDriveFile({
      token: input.token,
      fetcher: input.fetcher,
      file,
    });

    if (!exported) {
      continue;
    }

    imported.push({
      provider: "google_drive",
      sourceType: exported.sourceType,
      externalItemId: file.id,
      title: file.name,
      content: exported.content,
      uri: file.webViewLink ?? null,
      metadata: {
        importer: "google_drive_file",
        fileId: file.id,
        fileName: file.name,
        mimeType: file.mimeType ?? null,
        modifiedTime: file.modifiedTime ?? null,
      },
    });
  }

  return imported;
}

async function downloadGoogleDriveFile(input: {
  token: string;
  fetcher: typeof fetch;
  file: GoogleDriveFile;
}): Promise<{ sourceType: ConnectorArtifactSourceType; content: string } | null> {
  if (!input.file.id || !input.file.mimeType) {
    return null;
  }

  if (input.file.mimeType === "application/vnd.google-apps.document") {
    return {
      sourceType: "api",
      content: await fetchGoogleDriveText(
        input.fetcher,
        input.token,
        `/files/${encodeURIComponent(input.file.id)}/export?${new URLSearchParams({
          mimeType: "text/plain",
        }).toString()}`,
      ),
    };
  }

  if (input.file.mimeType === "text/csv") {
    return {
      sourceType: "csv",
      content: await fetchGoogleDriveText(input.fetcher, input.token, `/files/${encodeURIComponent(input.file.id)}?alt=media`),
    };
  }

  if (input.file.mimeType.startsWith("text/")) {
    return {
      sourceType: input.file.mimeType === "text/markdown" ? "markdown" : "upload",
      content: await fetchGoogleDriveText(input.fetcher, input.token, `/files/${encodeURIComponent(input.file.id)}?alt=media`),
    };
  }

  return null;
}

async function importMicrosoftOneDriveSource(input: {
  token: string;
  source: ConnectorSource;
  fetcher: typeof fetch;
}): Promise<DriveDocumentImportResult[]> {
  const itemId = input.source.externalSourceId || "root";
  const item = await fetchMicrosoftGraphJson<MicrosoftDriveItem>(
    input.fetcher,
    input.token,
    microsoftDriveItemPath(itemId),
  );
  const items = item.folder
    ? (await fetchMicrosoftGraphJson<MicrosoftDriveChildrenResponse>(
        input.fetcher,
        input.token,
        `${microsoftDriveItemPath(itemId)}/children?$top=10`,
      )).value ?? []
    : [item];
  const imported: DriveDocumentImportResult[] = [];

  for (const child of items) {
    if (!child.id || child.folder) {
      continue;
    }

    const downloaded = await downloadMicrosoftDriveItem({
      token: input.token,
      fetcher: input.fetcher,
      item: child,
    });

    if (!downloaded) {
      continue;
    }

    imported.push({
      provider: "microsoft_onedrive",
      sourceType: downloaded.sourceType,
      externalItemId: child.id,
      title: child.name ?? child.id,
      content: downloaded.content,
      uri: child.webUrl ?? null,
      metadata: {
        importer: "microsoft_onedrive_item",
        fileId: child.id,
        fileName: child.name ?? child.id,
        mimeType: child.file?.mimeType ?? null,
        modifiedTime: child.lastModifiedDateTime ?? null,
      },
    });
  }

  return imported;
}

async function downloadMicrosoftDriveItem(input: {
  token: string;
  fetcher: typeof fetch;
  item: MicrosoftDriveItem;
}): Promise<{ sourceType: ConnectorArtifactSourceType; content: string } | null> {
  const mimeType = input.item.file?.mimeType ?? "";

  if (!input.item.id) {
    return null;
  }

  if (mimeType === "text/csv") {
    return {
      sourceType: "csv",
      content: await fetchMicrosoftGraphText(input.fetcher, input.token, `${microsoftDriveItemPath(input.item.id)}/content`),
    };
  }

  if (mimeType.startsWith("text/")) {
    return {
      sourceType: mimeType === "text/markdown" ? "markdown" : "upload",
      content: await fetchMicrosoftGraphText(input.fetcher, input.token, `${microsoftDriveItemPath(input.item.id)}/content`),
    };
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return {
      sourceType: "docx",
      content: await fetchMicrosoftGraphBase64(input.fetcher, input.token, `${microsoftDriveItemPath(input.item.id)}/content`),
    };
  }

  return null;
}

async function storeDocumentImports(
  input: ConnectorSyncAdapterInput,
  imports: DriveDocumentImportResult[],
  provider: "google_drive" | "microsoft_onedrive",
): Promise<ConnectorSyncAdapterResult> {
  if (imports.length === 0) {
    await input.db.insert(connectorSyncItems).values({
      twinId: input.syncRun.twinId,
      connectorSyncRunId: input.syncRun.id,
      connectorAccountId: input.account.id,
      connectorSourceId: input.source?.id ?? null,
      externalItemId: `${provider}:source`,
      action: "skipped",
      reason: "no_supported_documents_found",
      metadata: { provider },
    });

    return {
      cursorAfter: input.source?.cursor ?? input.account.cursor,
      nextSyncAt: nextSyncAt(input.account.syncCadence),
      addedCount: 0,
      updatedCount: 0,
      skippedCount: 1,
      failedCount: 0,
    };
  }

  let addedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let cursorAfter = input.source?.cursor ?? input.account.cursor ?? null;

  for (const item of imports) {
    try {
      const result = await storeTextConnectorArtifact(input, item);
      addedCount += result.addedCount;
      updatedCount += result.updatedCount;
      skippedCount += result.skippedCount;
      failedCount += result.failedCount;

      if (item.metadata.modifiedTime && (!cursorAfter || item.metadata.modifiedTime > cursorAfter)) {
        cursorAfter = item.metadata.modifiedTime;
      }
    } catch (error) {
      failedCount += 1;
      await input.db.insert(connectorSyncItems).values({
        twinId: input.syncRun.twinId,
        connectorSyncRunId: input.syncRun.id,
        connectorAccountId: input.account.id,
        connectorSourceId: input.source?.id ?? null,
        externalItemId: item.externalItemId,
        action: "failed",
        reason: errorMessage(error),
        metadata: item.metadata,
      });
    }
  }

  return {
    cursorAfter,
    nextSyncAt: nextSyncAt(input.account.syncCadence),
    addedCount,
    updatedCount,
    skippedCount,
    failedCount,
  };
}

async function fetchGoogleCalendarJson<T>(
  fetcher: typeof fetch,
  token: string,
  path: string,
): Promise<T> {
  const response = await fetcher(`https://www.googleapis.com/calendar/v3${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("google_calendar_unauthorized");
    }

    if (response.status === 404) {
      throw new Error("google_calendar_not_found");
    }

    if (response.status === 429) {
      throw new Error("google_calendar_rate_limited");
    }

    throw new Error(`google_calendar_fetch_failed_${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function fetchGoogleDriveJson<T>(
  fetcher: typeof fetch,
  token: string,
  path: string,
): Promise<T> {
  const response = await fetcher(`https://www.googleapis.com/drive/v3${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(readGoogleDriveError(response.status));
  }

  return response.json() as Promise<T>;
}

async function fetchGoogleDriveText(
  fetcher: typeof fetch,
  token: string,
  path: string,
): Promise<string> {
  const response = await fetcher(`https://www.googleapis.com/drive/v3${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(readGoogleDriveError(response.status));
  }

  return response.text();
}

async function fetchMicrosoftGraphJson<T>(
  fetcher: typeof fetch,
  token: string,
  path: string,
): Promise<T> {
  const response = await fetcher(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(readMicrosoftGraphError(response.status));
  }

  return response.json() as Promise<T>;
}

async function fetchMicrosoftGraphText(
  fetcher: typeof fetch,
  token: string,
  path: string,
): Promise<string> {
  const response = await fetcher(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(readMicrosoftGraphError(response.status));
  }

  return response.text();
}

async function fetchMicrosoftGraphBase64(
  fetcher: typeof fetch,
  token: string,
  path: string,
): Promise<string> {
  const response = await fetcher(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(readMicrosoftGraphError(response.status));
  }

  return Buffer.from(await response.arrayBuffer()).toString("base64");
}

function microsoftDriveItemPath(itemId: string): string {
  return itemId === "root" ? "/me/drive/root" : `/me/drive/items/${encodeURIComponent(itemId)}`;
}

function readGoogleDriveError(status: number): string {
  if (status === 401 || status === 403) {
    return "google_drive_unauthorized";
  }

  if (status === 404) {
    return "google_drive_source_not_found";
  }

  if (status === 429) {
    return "google_drive_rate_limited";
  }

  return `google_drive_fetch_failed_${status}`;
}

function readMicrosoftGraphError(status: number): string {
  if (status === 401 || status === 403) {
    return "microsoft_graph_unauthorized";
  }

  if (status === 404) {
    return "microsoft_drive_source_not_found";
  }

  if (status === 429) {
    return "microsoft_graph_rate_limited";
  }

  return `microsoft_graph_fetch_failed_${status}`;
}

function renderCalendarEvents(calendarId: string, events: GoogleCalendarEvent[]): string {
  const lines = [`Google Calendar: ${calendarId}`, ""];

  for (const event of events) {
    const title = event.summary?.trim() || "Untitled event";
    lines.push(`Event: ${title}`);
    lines.push(`ID: ${event.id ?? "unknown"}`);
    lines.push(`When: ${readCalendarDate(event.start)} - ${readCalendarDate(event.end)}`);

    if (event.location) {
      lines.push(`Location: ${event.location}`);
    }

    if (event.organizer?.email || event.organizer?.displayName) {
      lines.push(`Organizer: ${event.organizer.displayName ?? event.organizer.email} <${event.organizer.email ?? "unknown"}>`);
    }

    if (event.attendees?.length) {
      lines.push(`Attendees: ${event.attendees.map(renderCalendarAttendee).join(", ")}`);
    }

    if (event.hangoutLink) {
      lines.push(`Meeting link: ${event.hangoutLink}`);
    }

    if (event.description) {
      lines.push(`Description: ${event.description.replace(/\s+/g, " ").trim()}`);
    }

    lines.push("");
  }

  return lines.join("\n").trim();
}

function renderCalendarAttendee(attendee: NonNullable<GoogleCalendarEvent["attendees"]>[number]): string {
  const label = attendee.displayName ?? attendee.email ?? "unknown";
  return attendee.responseStatus ? `${label} (${attendee.responseStatus})` : label;
}

function readCalendarDate(value: GoogleCalendarEvent["start"]): string {
  return value?.dateTime ?? value?.date ?? "unknown";
}

async function fetchGmailJson<T>(
  fetcher: typeof fetch,
  token: string,
  path: string,
): Promise<T> {
  const response = await fetcher(`https://gmail.googleapis.com/gmail/v1${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("gmail_unauthorized");
    }

    if (response.status === 404) {
      throw new Error("gmail_message_not_found");
    }

    if (response.status === 429) {
      throw new Error("gmail_rate_limited");
    }

    throw new Error(`gmail_fetch_failed_${response.status}`);
  }

  return response.json() as Promise<T>;
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");

  return Buffer.from(padded, "base64").toString("utf8");
}

async function fetchSlackJson<T>(
  fetcher: typeof fetch,
  token: string,
  method: string,
  body: Record<string, string>,
): Promise<T> {
  const response = await fetcher(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });

  if (response.status === 429) {
    throw new Error("slack_rate_limited");
  }

  if (!response.ok) {
    throw new Error(`slack_fetch_failed_${response.status}`);
  }

  const payload = await response.json() as { ok?: boolean; error?: string };

  if (payload.ok === false) {
    throw new Error(`slack_${payload.error ?? "api_error"}`);
  }

  return payload as T;
}

async function readNotionBlocks(input: {
  fetcher: typeof fetch;
  token: string;
  blockId: string;
  lines: string[];
  depth: number;
  startCursor?: string;
  onBlock(): boolean;
}): Promise<void> {
  if (input.depth > 4) {
    return;
  }

  const params = new URLSearchParams({ page_size: "100" });

  if (input.startCursor) {
    params.set("start_cursor", input.startCursor);
  }

  const list = await fetchNotionJson<NotionListResponse<NotionBlock>>(
    input.fetcher,
    input.token,
    `/blocks/${input.blockId}/children?${params.toString()}`,
  );

  for (const block of list.results ?? []) {
    if (!input.onBlock()) {
      return;
    }

    const line = notionBlockToText(block, input.depth);

    if (line) {
      input.lines.push(line);
    }

    if (block.has_children && block.id) {
      await readNotionBlocks({
        fetcher: input.fetcher,
        token: input.token,
        blockId: block.id,
        lines: input.lines,
        depth: input.depth + 1,
        onBlock: input.onBlock,
      });
    }
  }

  if (list.has_more && list.next_cursor) {
    await readNotionBlocks({
      ...input,
      startCursor: list.next_cursor,
    });
  }
}

async function fetchNotionJson<T>(
  fetcher: typeof fetch,
  token: string,
  path: string,
): Promise<T> {
  const response = await fetcher(`https://api.notion.com/v1${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      "notion-version": "2026-03-11",
    },
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("notion_unauthorized");
    }

    if (response.status === 404) {
      throw new Error("notion_source_not_found");
    }

    if (response.status === 429) {
      throw new Error("notion_rate_limited");
    }

    throw new Error(`notion_fetch_failed_${response.status}`);
  }

  return response.json() as Promise<T>;
}

function notionBlockToText(block: NotionBlock, depth: number): string | null {
  const type = block.type;

  if (!type) {
    return null;
  }

  const payload = asRecord(block[type]);
  const richText = readRichText(payload["rich_text"]);
  const indent = "  ".repeat(depth);

  if (type === "heading_1" || type === "heading_2" || type === "heading_3") {
    return richText ? `${indent}${"#".repeat(Number(type.at(-1)))} ${richText}` : null;
  }

  if (type === "bulleted_list_item") {
    return richText ? `${indent}- ${richText}` : null;
  }

  if (type === "numbered_list_item") {
    return richText ? `${indent}1. ${richText}` : null;
  }

  if (type === "to_do") {
    const checked = payload["checked"] === true ? "x" : " ";
    return richText ? `${indent}- [${checked}] ${richText}` : null;
  }

  if (type === "quote") {
    return richText ? `${indent}> ${richText}` : null;
  }

  if (type === "code") {
    const language = typeof payload["language"] === "string" ? payload["language"] : "";
    return richText ? `${indent}\`\`\`${language}\n${richText}\n${indent}\`\`\`` : null;
  }

  if (type === "child_page") {
    const title = typeof payload["title"] === "string" ? payload["title"] : null;
    return title ? `${indent}Child page: ${title}` : null;
  }

  if (type === "bookmark" || type === "embed" || type === "link_preview") {
    const url = typeof payload["url"] === "string" ? payload["url"] : null;
    return [richText, url].filter(Boolean).join(" ");
  }

  return richText ? `${indent}${richText}` : null;
}

function readNotionPageId(source: ConnectorSource): string {
  const raw = source.uri ?? source.externalSourceId;
  const normalized = raw.replace(/-/g, "");
  const match = normalized.match(/[0-9a-fA-F]{32}/);

  if (!match) {
    throw new Error("invalid_notion_page_id");
  }

  return match[0]!;
}

function readSlackChannelId(source: ConnectorSource): string {
  const raw = source.externalSourceId || source.uri || "";
  const match = raw.match(/[CGD][A-Z0-9]{2,}/);

  if (!match) {
    throw new Error("invalid_slack_channel_id");
  }

  return match[0]!;
}

function readCalendarId(source: ConnectorSource | null): string {
  if (!source) {
    return "primary";
  }

  const value = source.externalSourceId || source.uri || "primary";

  if (value.startsWith("google-calendar://")) {
    return value.replace("google-calendar://", "");
  }

  return value;
}

function readConnectorMetadataString(metadata: unknown, key: string): string | null {
  const record = asRecord(metadata);
  const value = record[key];

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNotionTitle(page: NotionPageResponse): string | null {
  const properties = page.properties ?? {};

  for (const value of Object.values(properties)) {
    const property = asRecord(value);

    if (property["type"] !== "title") {
      continue;
    }

    const title = readRichText(property["title"]);

    if (title) {
      return title;
    }
  }

  return null;
}

function readRichText(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((item) => asRecord(item)["plain_text"])
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .join("");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function updateConnectorSyncTimestamps(
  db: Db,
  input: {
    account: ConnectorAccount;
    source: ConnectorSource | null;
    completedAt: Date;
    cursorAfter?: string | null;
    nextSyncAt?: Date | null;
  },
) {
  return Promise.all([
    db
      .update(connectorAccounts)
      .set({
        lastSyncAt: input.completedAt,
        nextSyncAt: input.nextSyncAt ?? null,
        cursor: input.cursorAfter ?? input.account.cursor,
        errorCode: null,
        updatedAt: input.completedAt,
      })
      .where(eq(connectorAccounts.id, input.account.id)),
    input.source
      ? db
          .update(connectorSources)
          .set({
            lastSyncAt: input.completedAt,
            nextSyncAt: input.nextSyncAt ?? null,
            cursor: input.cursorAfter ?? input.source.cursor,
            errorCode: null,
            updatedAt: input.completedAt,
          })
          .where(eq(connectorSources.id, input.source.id))
      : Promise.resolve(),
  ]);
}

function nextSyncAt(syncCadence: string, from: Date = new Date()): Date | null {
  const intervalMs = syncCadenceToMs(syncCadence);
  return intervalMs ? new Date(from.getTime() + intervalMs) : null;
}

function syncCadenceToMs(syncCadence: string): number | null {
  if (syncCadence === "hourly") {
    return 60 * 60 * 1000;
  }

  if (syncCadence === "daily") {
    return 24 * 60 * 60 * 1000;
  }

  if (syncCadence === "weekly") {
    return 7 * 24 * 60 * 60 * 1000;
  }

  const match = /^every_(\d+)_minutes$/.exec(syncCadence);

  if (!match) {
    return null;
  }

  return Number.parseInt(match[1]!, 10) * 60 * 1000;
}

function connectorAuditMetadata(data: ConnectorSyncJobData): Record<string, unknown> {
  return {
    connectorAccountId: data.connectorAccountId,
    connectorSourceId: data.connectorSourceId ?? null,
    provider: data.provider,
    mode: data.mode,
  };
}

function connectorErrorCode(error: unknown): string {
  const message = errorMessage(error);
  return message.length > 0 ? message.slice(0, 80) : "connector_sync_failed";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
