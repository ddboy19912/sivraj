import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const sourceTypeEnum = pgEnum("source_type", [
  "upload",
  "url",
  "note",
  "browser_history",
  "chat_export",
  "slack_export",
  "whatsapp_export",
  "pdf",
  "ocr_pdf",
  "image",
  "voice_note",
  "voice_conversation",
  "onboarding_self_description",
  "markdown",
  "docx",
  "csv",
  "email",
  "calendar",
  "github",
  "api",
  "other",
]);

export const ingestionStatusEnum = pgEnum("ingestion_status", [
  "pending",
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
]);

export const graphNodeTypeEnum = pgEnum("graph_node_type", [
  "person",
  "organization",
  "project",
  "concept",
  "event",
  "artifact",
  "goal",
  "decision",
  "topic",
  "other",
]);

export const insightTypeEnum = pgEnum("insight_type", [
  "hypothesis",
  "pattern",
  "risk",
  "opportunity",
  "recommendation",
  "summary",
  "question",
  "other",
]);

export const candidateMemoryTypeEnum = pgEnum("candidate_memory_type", [
  "fact",
  "preference",
  "goal",
  "decision",
  "commitment",
  "experience",
  "project_update",
  "relationship",
  "other",
]);

export const candidateMemoryStatusEnum = pgEnum("candidate_memory_status", [
  "candidate",
  "approved",
  "rejected",
  "superseded",
]);

export const speakerRoleEnum = pgEnum("speaker_role", [
  "self",
  "other",
  "system",
  "unknown",
]);

export const accessPolicySubjectTypeEnum = pgEnum("access_policy_subject_type", [
  "user",
  "client",
  "agent",
  "system",
  "group",
  "other",
]);

export const agentWritebackStatusEnum = pgEnum("agent_writeback_status", [
  "pending",
  "approved",
  "rejected",
  "expired",
  "superseded",
]);

export const feedbackTargetTypeEnum = pgEnum("feedback_target_type", [
  "candidate_memory",
  "graph_node",
  "pattern",
  "insight",
  "reflection",
  "source_artifact",
]);

export const feedbackTypeEnum = pgEnum("feedback_type", [
  "useful",
  "wrong",
  "not_me",
  "too_generic",
  "too_sensitive",
  "approved",
  "rejected",
  "edited_later",
]);

export const reflectionStatusEnum = pgEnum("reflection_status", [
  "queued",
  "processing",
  "completed",
  "failed",
  "skipped",
]);

export const connectorProviderEnum = pgEnum("connector_provider", [
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
]);

export const connectorAccountStatusEnum = pgEnum("connector_account_status", [
  "connected",
  "paused",
  "needs_reauth",
  "error",
  "disconnected",
]);

export const connectorSyncRunStatusEnum = pgEnum("connector_sync_run_status", [
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
]);

export const connectorSyncModeEnum = pgEnum("connector_sync_mode", [
  "initial",
  "incremental",
  "manual",
]);

export const connectorSyncItemActionEnum = pgEnum("connector_sync_item_action", [
  "added",
  "updated",
  "skipped",
  "failed",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const walletAccounts = pgTable(
  "wallet_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chain: text("chain").notNull().default("sui"),
    address: text("address").notNull(),
    isPrimary: boolean("is_primary").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("wallet_accounts_user_id_idx").on(t.userId),
    uniqueIndex("wallet_accounts_chain_address_idx").on(t.chain, t.address),
  ],
);

export const twins = pgTable(
  "twins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    summary: text("summary"),
    currentGoals: jsonb("current_goals").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("twins_user_id_idx").on(t.userId)],
);

export const twinIdentityProfiles = pgTable(
  "twin_identity_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    twinId: uuid("twin_id")
      .notNull()
      .references(() => twins.id, { onDelete: "cascade" }),
    displayName: text("display_name"),
    aliases: text("aliases")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    emails: text("emails")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    phones: text("phones")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    handles: jsonb("handles").$type<unknown>(),
    selfDescriptionArtifactId: uuid("self_description_artifact_id").references(
      () => sourceArtifacts.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("twin_identity_profiles_twin_id_idx").on(t.twinId),
  ],
);

export const refreshSessions = pgTable(
  "refresh_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    twinId: uuid("twin_id")
      .notNull()
      .references(() => twins.id, { onDelete: "cascade" }),
    walletAddress: text("wallet_address").notNull(),
    tokenHash: text("token_hash").notNull(),
    scopes: text("scopes")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("refresh_sessions_user_id_idx").on(t.userId),
    index("refresh_sessions_twin_id_idx").on(t.twinId),
    uniqueIndex("refresh_sessions_token_hash_idx").on(t.tokenHash),
  ],
);

export const apiClients = pgTable("api_clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  metadata: jsonb("metadata").$type<unknown>(),
  redirectUris: text("redirect_uris")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const permissionGrants = pgTable(
  "permission_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    twinId: uuid("twin_id")
      .notNull()
      .references(() => twins.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => apiClients.id, { onDelete: "cascade" }),
    scopes: text("scopes")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    memoryDomains: text("memory_domains")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("permission_grants_twin_id_idx").on(t.twinId),
    index("permission_grants_client_id_idx").on(t.clientId),
  ],
);

export const accessPolicies = pgTable(
  "access_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    twinId: uuid("twin_id")
      .notNull()
      .references(() => twins.id, { onDelete: "cascade" }),
    subjectType: accessPolicySubjectTypeEnum("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    scope: text("scope").notNull(),
    allowedNodeTypes: text("allowed_node_types")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    allowedSourceTypes: text("allowed_source_types")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    deniedTags: text("denied_tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("access_policies_twin_id_idx").on(t.twinId)],
);

export const sourceArtifacts = pgTable(
  "source_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    twinId: uuid("twin_id")
      .notNull()
      .references(() => twins.id, { onDelete: "cascade" }),
    sourceType: sourceTypeEnum("source_type").notNull(),
    uri: text("uri"),
    rawStorageRef: text("raw_storage_ref"),
    hash: text("hash"),
    connectorAccountId: uuid("connector_account_id").references(() => connectorAccounts.id, {
      onDelete: "set null",
    }),
    connectorSourceId: uuid("connector_source_id").references(() => connectorSources.id, {
      onDelete: "set null",
    }),
    connectorSyncRunId: uuid("connector_sync_run_id").references(() => connectorSyncRuns.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata").$type<unknown>(),
    ingestionStatus: ingestionStatusEnum("ingestion_status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("source_artifacts_twin_id_idx").on(t.twinId),
    index("source_artifacts_ingestion_status_idx").on(t.ingestionStatus),
    index("source_artifacts_connector_account_id_idx").on(t.connectorAccountId),
    index("source_artifacts_connector_source_id_idx").on(t.connectorSourceId),
    index("source_artifacts_connector_sync_run_id_idx").on(t.connectorSyncRunId),
  ],
);

export const connectorAccounts = pgTable(
  "connector_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    twinId: uuid("twin_id")
      .notNull()
      .references(() => twins.id, { onDelete: "cascade" }),
    provider: connectorProviderEnum("provider").notNull(),
    status: connectorAccountStatusEnum("status").notNull().default("connected"),
    externalAccountId: text("external_account_id"),
    displayName: text("display_name").notNull(),
    scopes: text("scopes")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    syncCadence: text("sync_cadence").notNull().default("manual"),
    tokenRef: text("token_ref"),
    cursor: text("cursor"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    nextSyncAt: timestamp("next_sync_at", { withTimezone: true }),
    errorCode: text("error_code"),
    metadata: jsonb("metadata").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("connector_accounts_twin_id_idx").on(t.twinId),
    index("connector_accounts_provider_idx").on(t.provider),
    index("connector_accounts_status_idx").on(t.status),
    uniqueIndex("connector_accounts_twin_provider_external_idx").on(
      t.twinId,
      t.provider,
      t.externalAccountId,
    ),
  ],
);

export const connectorSources = pgTable(
  "connector_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    twinId: uuid("twin_id")
      .notNull()
      .references(() => twins.id, { onDelete: "cascade" }),
    connectorAccountId: uuid("connector_account_id")
      .notNull()
      .references(() => connectorAccounts.id, { onDelete: "cascade" }),
    provider: connectorProviderEnum("provider").notNull(),
    sourceType: sourceTypeEnum("source_type").notNull(),
    externalSourceId: text("external_source_id").notNull(),
    displayName: text("display_name").notNull(),
    uri: text("uri"),
    status: connectorAccountStatusEnum("status").notNull().default("connected"),
    cursor: text("cursor"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    nextSyncAt: timestamp("next_sync_at", { withTimezone: true }),
    errorCode: text("error_code"),
    metadata: jsonb("metadata").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("connector_sources_twin_id_idx").on(t.twinId),
    index("connector_sources_account_id_idx").on(t.connectorAccountId),
    index("connector_sources_provider_idx").on(t.provider),
    index("connector_sources_status_idx").on(t.status),
    uniqueIndex("connector_sources_account_external_idx").on(
      t.connectorAccountId,
      t.externalSourceId,
    ),
  ],
);

export const connectorSyncRuns = pgTable(
  "connector_sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    twinId: uuid("twin_id")
      .notNull()
      .references(() => twins.id, { onDelete: "cascade" }),
    connectorAccountId: uuid("connector_account_id")
      .notNull()
      .references(() => connectorAccounts.id, { onDelete: "cascade" }),
    connectorSourceId: uuid("connector_source_id").references(() => connectorSources.id, {
      onDelete: "set null",
    }),
    provider: connectorProviderEnum("provider").notNull(),
    mode: connectorSyncModeEnum("mode").notNull(),
    status: connectorSyncRunStatusEnum("status").notNull(),
    cursorBefore: text("cursor_before"),
    cursorAfter: text("cursor_after"),
    addedCount: integer("added_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").$type<unknown>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("connector_sync_runs_twin_id_idx").on(t.twinId),
    index("connector_sync_runs_account_id_idx").on(t.connectorAccountId),
    index("connector_sync_runs_source_id_idx").on(t.connectorSourceId),
    index("connector_sync_runs_status_idx").on(t.status),
    index("connector_sync_runs_created_at_idx").on(t.createdAt),
  ],
);

export const connectorSyncItems = pgTable(
  "connector_sync_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    twinId: uuid("twin_id")
      .notNull()
      .references(() => twins.id, { onDelete: "cascade" }),
    connectorSyncRunId: uuid("connector_sync_run_id")
      .notNull()
      .references(() => connectorSyncRuns.id, { onDelete: "cascade" }),
    connectorAccountId: uuid("connector_account_id")
      .notNull()
      .references(() => connectorAccounts.id, { onDelete: "cascade" }),
    connectorSourceId: uuid("connector_source_id").references(() => connectorSources.id, {
      onDelete: "set null",
    }),
    sourceArtifactId: uuid("source_artifact_id").references(() => sourceArtifacts.id, {
      onDelete: "set null",
    }),
    externalItemId: text("external_item_id").notNull(),
    action: connectorSyncItemActionEnum("action").notNull(),
    reason: text("reason"),
    contentHash: text("content_hash"),
    metadata: jsonb("metadata").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("connector_sync_items_twin_id_idx").on(t.twinId),
    index("connector_sync_items_run_id_idx").on(t.connectorSyncRunId),
    index("connector_sync_items_account_id_idx").on(t.connectorAccountId),
    index("connector_sync_items_source_id_idx").on(t.connectorSourceId),
    index("connector_sync_items_artifact_id_idx").on(t.sourceArtifactId),
    uniqueIndex("connector_sync_items_run_external_idx").on(
      t.connectorSyncRunId,
      t.externalItemId,
    ),
  ],
);

export const memoryFragments = pgTable(
  "memory_fragments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    twinId: uuid("twin_id")
      .notNull()
      .references(() => twins.id, { onDelete: "cascade" }),
    sourceArtifactId: uuid("source_artifact_id")
      .notNull()
      .references(() => sourceArtifacts.id, { onDelete: "cascade" }),
    contentStorageRef: text("content_storage_ref"),
    contentSha256: text("content_sha256"),
    embeddingRef: text("embedding_ref"),
    metadata: jsonb("metadata").$type<unknown>(),
    importanceScore: doublePrecision("importance_score"),
    confidenceScore: doublePrecision("confidence_score"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("memory_fragments_twin_id_idx").on(t.twinId),
    uniqueIndex("memory_fragments_source_artifact_id_idx").on(t.sourceArtifactId),
    index("memory_fragments_occurred_at_idx").on(t.occurredAt),
  ],
);

export const sourceSpeakerMappings = pgTable(
  "source_speaker_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    twinId: uuid("twin_id")
      .notNull()
      .references(() => twins.id, { onDelete: "cascade" }),
    sourceArtifactId: uuid("source_artifact_id")
      .notNull()
      .references(() => sourceArtifacts.id, { onDelete: "cascade" }),
    sourceSpeaker: text("source_speaker").notNull(),
    sourceSpeakerId: text("source_speaker_id"),
    role: speakerRoleEnum("role").notNull(),
    mappedName: text("mapped_name"),
    metadata: jsonb("metadata").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("source_speaker_mappings_twin_id_idx").on(t.twinId),
    index("source_speaker_mappings_source_artifact_id_idx").on(t.sourceArtifactId),
    uniqueIndex("source_speaker_mappings_artifact_speaker_idx").on(
      t.sourceArtifactId,
      t.sourceSpeaker,
    ),
  ],
);

export const graphNodes = pgTable(
  "graph_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    twinId: uuid("twin_id")
      .notNull()
      .references(() => twins.id, { onDelete: "cascade" }),
    nodeType: graphNodeTypeEnum("node_type").notNull(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    description: text("description"),
    properties: jsonb("properties").$type<unknown>(),
    confidenceScore: doublePrecision("confidence_score"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("graph_nodes_twin_id_idx").on(t.twinId),
    index("graph_nodes_node_type_idx").on(t.nodeType),
    uniqueIndex("graph_nodes_twin_type_normalized_name_idx").on(
      t.twinId,
      t.nodeType,
      t.normalizedName,
    ),
  ],
);

export const graphEdges = pgTable(
  "graph_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    twinId: uuid("twin_id")
      .notNull()
      .references(() => twins.id, { onDelete: "cascade" }),
    fromNodeId: uuid("from_node_id")
      .notNull()
      .references(() => graphNodes.id, { onDelete: "cascade" }),
    toNodeId: uuid("to_node_id")
      .notNull()
      .references(() => graphNodes.id, { onDelete: "cascade" }),
    edgeType: text("edge_type").notNull(),
    description: text("description"),
    evidenceMemoryIds: uuid("evidence_memory_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    confidenceScore: doublePrecision("confidence_score"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("graph_edges_twin_id_idx").on(t.twinId),
    index("graph_edges_from_node_id_idx").on(t.fromNodeId),
    index("graph_edges_to_node_id_idx").on(t.toNodeId),
    index("graph_edges_edge_type_idx").on(t.edgeType),
  ],
);

export const insights = pgTable(
  "insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    twinId: uuid("twin_id")
      .notNull()
      .references(() => twins.id, { onDelete: "cascade" }),
    insightType: insightTypeEnum("insight_type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    evidenceMemoryIds: uuid("evidence_memory_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    relatedNodeIds: uuid("related_node_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    confidenceScore: doublePrecision("confidence_score"),
    userFeedback: text("user_feedback"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("insights_twin_id_idx").on(t.twinId),
    index("insights_insight_type_idx").on(t.insightType),
  ],
);

export const canonicalMemories = pgTable(
  "canonical_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    twinId: uuid("twin_id")
      .notNull()
      .references(() => twins.id, { onDelete: "cascade" }),
    memoryType: candidateMemoryTypeEnum("memory_type").notNull(),
    canonicalKey: text("canonical_key").notNull(),
    subject: text("subject"),
    status: candidateMemoryStatusEnum("status").notNull().default("candidate"),
    evidenceCount: doublePrecision("evidence_count").notNull().default(1),
    confidenceScore: doublePrecision("confidence_score"),
    metadata: jsonb("metadata").$type<unknown>(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("canonical_memories_twin_id_idx").on(t.twinId),
    index("canonical_memories_memory_type_idx").on(t.memoryType),
    uniqueIndex("canonical_memories_twin_key_idx").on(t.twinId, t.canonicalKey),
  ],
);

export const candidateMemories = pgTable(
  "candidate_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    twinId: uuid("twin_id")
      .notNull()
      .references(() => twins.id, { onDelete: "cascade" }),
    canonicalMemoryId: uuid("canonical_memory_id")
      .references(() => canonicalMemories.id, { onDelete: "set null" }),
    sourceArtifactId: uuid("source_artifact_id")
      .notNull()
      .references(() => sourceArtifacts.id, { onDelete: "cascade" }),
    memoryFragmentId: uuid("memory_fragment_id")
      .notNull()
      .references(() => memoryFragments.id, { onDelete: "cascade" }),
    memoryType: candidateMemoryTypeEnum("memory_type").notNull(),
    status: candidateMemoryStatusEnum("status").notNull().default("candidate"),
    statementStorageRef: text("statement_storage_ref").notNull(),
    statementSha256: text("statement_sha256").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    evidenceLength: doublePrecision("evidence_length"),
    confidenceScore: doublePrecision("confidence_score"),
    metadata: jsonb("metadata").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("candidate_memories_twin_id_idx").on(t.twinId),
    index("candidate_memories_canonical_memory_id_idx").on(t.canonicalMemoryId),
    index("candidate_memories_source_artifact_id_idx").on(t.sourceArtifactId),
    index("candidate_memories_memory_fragment_id_idx").on(t.memoryFragmentId),
    index("candidate_memories_status_idx").on(t.status),
    uniqueIndex("candidate_memories_fragment_type_evidence_idx").on(
      t.memoryFragmentId,
      t.memoryType,
      t.evidenceHash,
    ),
  ],
);

export const userFeedbackEvents = pgTable(
  "user_feedback_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    twinId: uuid("twin_id")
      .notNull()
      .references(() => twins.id, { onDelete: "cascade" }),
    targetType: feedbackTargetTypeEnum("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    feedbackType: feedbackTypeEnum("feedback_type").notNull(),
    actorType: text("actor_type").notNull().default("user"),
    actorId: text("actor_id").notNull(),
    metadata: jsonb("metadata").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("user_feedback_events_twin_id_idx").on(t.twinId),
    index("user_feedback_events_target_idx").on(t.targetType, t.targetId),
    index("user_feedback_events_feedback_type_idx").on(t.feedbackType),
    index("user_feedback_events_created_at_idx").on(t.createdAt),
  ],
);

export const reflectionRuns = pgTable(
  "reflection_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    twinId: uuid("twin_id")
      .notNull()
      .references(() => twins.id, { onDelete: "cascade" }),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    status: reflectionStatusEnum("status").notNull(),
    summaryStorageRef: text("summary_storage_ref"),
    summarySha256: text("summary_sha256"),
    metadata: jsonb("metadata").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("reflection_runs_twin_id_idx").on(t.twinId),
    index("reflection_runs_period_idx").on(t.periodStart, t.periodEnd),
    index("reflection_runs_status_idx").on(t.status),
  ],
);

export const contextPackets = pgTable(
  "context_packets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    twinId: uuid("twin_id")
      .notNull()
      .references(() => twins.id, { onDelete: "cascade" }),
    requesterId: uuid("requester_id").notNull(),
    query: text("query").notNull(),
    scope: text("scope").notNull(),
    memoryFragmentIds: uuid("memory_fragment_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    graphNodeIds: uuid("graph_node_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    summary: text("summary"),
    citations: jsonb("citations").$type<unknown>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("context_packets_twin_id_idx").on(t.twinId),
    index("context_packets_expires_at_idx").on(t.expiresAt),
  ],
);

export const agentWritebacks = pgTable(
  "agent_writebacks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    twinId: uuid("twin_id")
      .notNull()
      .references(() => twins.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => apiClients.id, { onDelete: "cascade" }),
    status: agentWritebackStatusEnum("status").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("agent_writebacks_twin_id_idx").on(t.twinId),
    index("agent_writebacks_client_id_idx").on(t.clientId),
  ],
);

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => apiClients.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    events: text("events")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    secretRef: text("secret_ref"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webhook_endpoints_client_id_idx").on(t.clientId)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    twinId: uuid("twin_id").references(() => twins.id, { onDelete: "set null" }),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    eventType: text("event_type").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    metadata: jsonb("metadata").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_events_twin_id_idx").on(t.twinId), index("audit_events_created_at_idx").on(t.createdAt)],
);
