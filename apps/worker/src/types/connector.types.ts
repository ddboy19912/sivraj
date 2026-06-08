import {
  connectorAccounts,
  connectorSources,
  connectorSyncRuns,
  type Db,
} from "@sivraj/db";
import type { ArtifactProcessingQueue } from "@sivraj/queue";
import type { PrivateSourceStorage } from "../private-source-storage.js";

export type ConnectorAccount = typeof connectorAccounts.$inferSelect;
export type ConnectorSource = typeof connectorSources.$inferSelect;
export type ConnectorSyncRun = typeof connectorSyncRuns.$inferSelect;

export type ConnectorArtifactSourceType =
  | "api"
  | "email"
  | "calendar"
  | "browser_history"
  | "docx"
  | "markdown"
  | "csv"
  | "upload";

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

export type ConnectorSyncAdapter = {
  provider: string;
  sync(input: ConnectorSyncAdapterInput): Promise<ConnectorSyncAdapterResult>;
};

export type ConnectorArtifactPayload = {
  provider: string;
  sourceType: ConnectorArtifactSourceType | "github" | "slack_export";
  title: string;
  content: string;
  uri: string | null;
  externalItemId: string;
  metadata: Record<string, unknown>;
};

export type StoreConnectorArtifactOptions = {
  skipWhen?: {
    reason: string;
    metadata?: Record<string, unknown>;
  };
  unchangedSkipMetadata?: Record<string, unknown>;
  buildSyncItemMetadata?: (artifactId: string) => Record<string, unknown>;
};
