import {
  auditEvents,
  connectorAccounts,
  connectorSources,
  connectorSyncItems,
  connectorSyncRuns,
  type Db,
} from "@sivraj/db";
import { importPublicGitHubRepository } from "@sivraj/ingestion";
import { renderCalendarEvents } from "./connectors/calendar-render.js";
import { storeDocumentImports } from "./connectors/document-imports.js";
import {
  importGoogleDriveSource,
  importMicrosoftOneDriveSource,
} from "./connectors/drive-import.js";
import { importGmailMessages } from "./connectors/gmail-import.js";
import { syncImportedGmailMessages } from "./connectors/gmail-sync.js";
import { syncBrowserHistoryConnector } from "./connectors/browser-history-sync.js";
import { readCalendarId } from "./connectors/calendar-reader.js";
import { readGitHubRepoUrl } from "./connectors/github-reader.js";
import { readConnectorMetadataString } from "./connectors/metadata-reader.js";
import { asRecord } from "./connectors/shared/record.js";
import { readNotionPageId } from "./connectors/notion-reader.js";
import { nextSyncAt, updateConnectorSyncTimestamps } from "./connectors/sync-timing.js";
import type { ArtifactProcessingQueue, ConnectorSyncJobData } from "@sivraj/queue";
import { and, eq, inArray, isNull, lte, ne, or } from "drizzle-orm";
import {
  fetchGoogleCalendarJson,
  fetchNotionJson,
  fetchSlackJson,
} from "./connectors/fetch.js";
import { readNotionBlocks } from "./connectors/notion-blocks.js";
import { runSlackConnectorSync } from "./connectors/slack-sync.js";
import { executeConnectorSyncRun as runConnectorSyncRun } from "./connectors/sync-run.js";
import { storeConnectorArtifact } from "./connectors/storage.js";
import type {
  ConnectorAccount,
  ConnectorArtifactSourceType,
  ConnectorSource,
  ConnectorSyncAdapter,
  ConnectorSyncAdapterInput,
  ConnectorSyncAdapterResult,
} from "./types/connector.types.js";
import { connectorAuditMetadata } from "./connectors/shared/audit.js";
import { connectorErrorCode } from "./connectors/shared/error-code.js";
import { errorMessage } from "./connectors/shared/error-message.js";
import type { PrivateSourceStorage } from "./private-source-storage.js";

export type { ConnectorSyncAdapter } from "./types/connector.types.js";
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
async function processConnectorSyncRun(input: {
  db: Db;
  data: ConnectorSyncJobData;
  privateSourceStorage?: PrivateSourceStorage;
  artifactProcessingQueue: ArtifactProcessingQueue;
  adapters?: ConnectorSyncAdapter[];
}) {
  return runConnectorSyncRun({
    ...input,
    resolveAdapters: () => defaultConnectorAdapters(),
    completePlaceholderSync,
  });
}

export { processConnectorSyncRun };

export { enqueueDueConnectorSyncs } from "./connectors/sync-scheduler.js";

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
      const result = await storeConnectorArtifact(input, {
        provider: "github",
        sourceType: "github",
        title: imported.title,
        content: imported.content,
        uri: imported.repoUrl,
        externalItemId: imported.repoUrl,
        metadata: imported.metadata,
      }, {
        unchangedSkipMetadata: {
          fileCount: imported.metadata.files.length,
        },
        buildSyncItemMetadata: (artifactId) => ({
          fileCount: imported.metadata.files.length,
          skippedFiles: imported.metadata.skipped.length,
          artifactId,
        }),
      });

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
      return runSlackConnectorSync({
        adapterInput,
        token: input.token ?? "",
        fetcher: input.fetcher,
      });
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
      const result = await storeConnectorArtifact(adapterInput, {
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

      return syncImportedGmailMessages(adapterInput, imported);
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
      const result = await storeConnectorArtifact(adapterInput, {
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
    sync: syncBrowserHistoryConnector,
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
    fetchNotionJson,
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

export function readNotionTitle(page: NotionPageResponse): string | null {
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

