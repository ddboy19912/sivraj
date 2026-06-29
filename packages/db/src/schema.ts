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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  connectorSyncStateColumns,
  createdAtColumn,
  metadataColumn,
  nullableTwinIdColumn,
  optionalUuidRef,
  primaryId,
  rowTimestamps,
  textArrayColumn,
  twinIdColumn,
  tzTimestamp,
  uuidArrayColumn,
} from "./column-helpers.js";

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
  "telegram_message",
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

export const onboardingStatusEnum = pgEnum("onboarding_status", [
  "not_started",
  "in_progress",
  "completed",
]);

export const firstMeetIntroStatusEnum = pgEnum("first_meet_intro_status", [
  "not_started",
  "issued",
  "consumed",
]);

export const speakerRoleEnum = pgEnum("speaker_role", [
  "self",
  "other",
  "system",
  "unknown",
]);

export const accessPolicySubjectTypeEnum = pgEnum(
  "access_policy_subject_type",
  ["user", "client", "agent", "system", "group", "other"],
);

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

export const llmProviderKindEnum = pgEnum("llm_provider_kind", [
  "openai",
  "openrouter",
  "ollama",
  "custom_openai_compatible",
]);

export const llmProviderStatusEnum = pgEnum("llm_provider_status", [
  "connected",
  "disconnected",
  "error",
]);

export const chatMessageRoleEnum = pgEnum("chat_message_role", [
  "system",
  "user",
  "assistant",
]);

export const chatTurnStatusEnum = pgEnum("chat_turn_status", [
  "queued",
  "retrieving_context",
  "generating",
  "completed",
  "failed",
  "cancelled",
]);

export const chatMessageStatusEnum = pgEnum("chat_message_status", [
  "pending",
  "streaming",
  "completed",
  "failed",
  "cancelled",
]);

export const memoryStorageStatusEnum = pgEnum("memory_storage_status", [
  "pending_upload",
  "uploaded",
  "verifying",
  "verified_available",
  "expiring_soon",
  "renewing",
  "renewed",
  "read_failed",
  "expired",
  "repairing",
  "unavailable",
]);

export const candidateMemoryArchiveStatusEnum = pgEnum(
  "candidate_memory_archive_status",
  [
    "not_required",
    "pending",
    "queued",
    "archiving",
    "archived",
    "failed_retryable",
    "failed_blocked",
    "cancelled",
  ],
);

export const contextRuntimePacketKindEnum = pgEnum(
  "context_runtime_packet_kind",
  [
    "core_profile",
    "personal_hot_memory",
    "engineering_context",
    "document_inventory",
    "active_session",
    "surface_warmup",
  ],
);

export const contextRuntimePacketStatusEnum = pgEnum(
  "context_runtime_packet_status",
  ["ready", "stale", "refreshing", "failed"],
);

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
  "telegram",
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

export const connectorSyncItemActionEnum = pgEnum(
  "connector_sync_item_action",
  ["added", "updated", "skipped", "failed"],
);

export const telegramLinkTokenStatusEnum = pgEnum(
  "telegram_link_token_status",
  ["pending", "consumed", "expired", "revoked"],
);

export const telegramMessageIngestionStatusEnum = pgEnum(
  "telegram_message_ingestion_status",
  ["processing", "captured", "deferred", "failed"],
);

export const users = pgTable("users", {
  id: primaryId(),
  email: text("email").unique(),
  displayName: text("display_name"),
  onboardingStatus: onboardingStatusEnum("onboarding_status")
    .notNull()
    .default("not_started"),
  firstMeetIntroStatus: firstMeetIntroStatusEnum("first_meet_intro_status")
    .notNull()
    .default("not_started"),
  ...rowTimestamps(),
});

export const walletAccounts = pgTable(
  "wallet_accounts",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chain: text("chain").notNull().default("sui"),
    address: text("address").notNull(),
    isPrimary: boolean("is_primary").notNull().default(true),
    ...rowTimestamps(),
  },
  (t) => [
    index("wallet_accounts_user_id_idx").on(t.userId),
    uniqueIndex("wallet_accounts_chain_address_idx").on(t.chain, t.address),
  ],
);

export const twins = pgTable(
  "twins",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    summary: text("summary"),
    currentGoals: jsonb("current_goals").$type<unknown>(),
    ...rowTimestamps(),
  },
  (t) => [index("twins_user_id_idx").on(t.userId)],
);

export const twinIdentityProfiles = pgTable(
  "twin_identity_profiles",
  {
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    displayName: text("display_name"),
    aliases: textArrayColumn("aliases"),
    emails: textArrayColumn("emails"),
    phones: textArrayColumn("phones"),
    handles: jsonb("handles").$type<unknown>(),
    selfDescriptionArtifactId: optionalUuidRef(
      "self_description_artifact_id",
      () => sourceArtifacts,
    ),
    ...rowTimestamps(),
  },
  (t) => [uniqueIndex("twin_identity_profiles_twin_id_idx").on(t.twinId)],
);

export const twinVoiceProfiles = pgTable(
  "twin_voice_profiles",
  {
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    mode: text("mode").notNull().default("preset"),
    presetVoiceId: text("preset_voice_id").notNull().default("warm_operator"),
    provider: text("provider").notNull().default("chatterbox_turbo"),
    referenceArtifactId: optionalUuidRef(
      "reference_artifact_id",
      () => sourceArtifacts,
    ),
    consentAt: tzTimestamp("consent_at"),
    metadata: metadataColumn(),
    ...rowTimestamps(),
  },
  (t) => [uniqueIndex("twin_voice_profiles_twin_id_idx").on(t.twinId)],
);

export const twinVoiceSettings = pgTable(
  "twin_voice_settings",
  {
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    wakeEnabled: boolean("wake_enabled").notNull().default(false),
    wakePhrase: text("wake_phrase"),
    pushToTalkMode: text("push_to_talk_mode").notNull().default("toggle"),
    metadata: metadataColumn(),
    ...rowTimestamps(),
  },
  (t) => [uniqueIndex("twin_voice_settings_twin_id_idx").on(t.twinId)],
);

export const llmProviderConfigs = pgTable(
  "llm_provider_configs",
  {
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    providerKind: llmProviderKindEnum("provider_kind").notNull(),
    status: llmProviderStatusEnum("status").notNull().default("connected"),
    isActive: boolean("is_active").notNull().default(false),
    displayName: text("display_name").notNull(),
    baseUrl: text("base_url").notNull(),
    model: text("model").notNull(),
    apiKeyCiphertext: text("api_key_ciphertext"),
    apiKeyIv: text("api_key_iv"),
    apiKeyTag: text("api_key_tag"),
    apiKeySha256: text("api_key_sha256"),
    metadata: metadataColumn(),
    lastTestedAt: tzTimestamp("last_tested_at"),
    ...rowTimestamps(),
  },
  (t) => [
    index("llm_provider_configs_twin_id_idx").on(t.twinId),
    uniqueIndex("llm_provider_configs_active_twin_idx")
      .on(t.twinId)
      .where(sql`${t.isActive} = true`),
    index("llm_provider_configs_provider_kind_idx").on(t.providerKind),
    index("llm_provider_configs_status_idx").on(t.status),
  ],
);

export const refreshSessions = pgTable(
  "refresh_sessions",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    twinId: twinIdColumn(() => twins),
    walletAddress: text("wallet_address").notNull(),
    tokenHash: text("token_hash").notNull(),
    scopes: textArrayColumn("scopes"),
    expiresAt: tzTimestamp("expires_at").notNull(),
    revokedAt: tzTimestamp("revoked_at"),
    ...rowTimestamps(),
  },
  (t) => [
    index("refresh_sessions_user_id_idx").on(t.userId),
    index("refresh_sessions_twin_id_idx").on(t.twinId),
    uniqueIndex("refresh_sessions_token_hash_idx").on(t.tokenHash),
  ],
);

export const chatThreads = pgTable(
  "chat_threads",
  {
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    title: text("title").notNull().default("New chat"),
    llmProviderConfigId: optionalUuidRef(
      "llm_provider_config_id",
      () => llmProviderConfigs,
    ),
    metadata: metadataColumn(),
    ...rowTimestamps(),
  },
  (t) => [
    index("chat_threads_twin_id_idx").on(t.twinId),
    index("chat_threads_updated_at_idx").on(t.updatedAt),
    index("chat_threads_provider_config_id_idx").on(t.llmProviderConfigId),
  ],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    turnId: uuid("turn_id"),
    role: chatMessageRoleEnum("role").notNull(),
    status: chatMessageStatusEnum("status").notNull().default("completed"),
    content: text("content").notNull(),
    providerKind: llmProviderKindEnum("provider_kind"),
    model: text("model"),
    memoryFragmentIds: uuidArrayColumn("memory_fragment_ids"),
    citations: jsonb("citations").$type<unknown>(),
    usage: jsonb("usage").$type<unknown>(),
    metadata: metadataColumn(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("chat_messages_twin_id_idx").on(t.twinId),
    index("chat_messages_thread_id_idx").on(t.threadId),
    index("chat_messages_turn_id_idx").on(t.turnId),
    index("chat_messages_status_idx").on(t.status),
    index("chat_messages_created_at_idx").on(t.createdAt),
  ],
);

export const chatTurns = pgTable(
  "chat_turns",
  {
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    userMessageId: optionalUuidRef("user_message_id", () => chatMessages),
    assistantMessageId: optionalUuidRef(
      "assistant_message_id",
      () => chatMessages,
    ),
    status: chatTurnStatusEnum("status").notNull().default("queued"),
    providerKind: llmProviderKindEnum("provider_kind"),
    model: text("model"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: tzTimestamp("started_at"),
    completedAt: tzTimestamp("completed_at"),
    cancelledAt: tzTimestamp("cancelled_at"),
    metadata: metadataColumn(),
    ...rowTimestamps(),
  },
  (t) => [
    index("chat_turns_twin_id_idx").on(t.twinId),
    index("chat_turns_thread_id_idx").on(t.threadId),
    index("chat_turns_status_idx").on(t.status),
    index("chat_turns_created_at_idx").on(t.createdAt),
  ],
);

export const apiClients = pgTable("api_clients", {
  id: primaryId(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  metadata: metadataColumn(),
  redirectUris: textArrayColumn("redirect_uris"),
  ...rowTimestamps(),
});

export const permissionGrants = pgTable(
  "permission_grants",
  {
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    clientId: uuid("client_id")
      .notNull()
      .references(() => apiClients.id, { onDelete: "cascade" }),
    scopes: textArrayColumn("scopes"),
    memoryDomains: textArrayColumn("memory_domains"),
    expiresAt: tzTimestamp("expires_at"),
    revokedAt: tzTimestamp("revoked_at"),
    ...rowTimestamps(),
  },
  (t) => [
    index("permission_grants_twin_id_idx").on(t.twinId),
    index("permission_grants_client_id_idx").on(t.clientId),
  ],
);

export const accessPolicies = pgTable(
  "access_policies",
  {
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    subjectType: accessPolicySubjectTypeEnum("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    scope: text("scope").notNull(),
    allowedNodeTypes: textArrayColumn("allowed_node_types"),
    allowedSourceTypes: textArrayColumn("allowed_source_types"),
    deniedTags: textArrayColumn("denied_tags"),
    expiresAt: tzTimestamp("expires_at"),
    ...rowTimestamps(),
  },
  (t) => [index("access_policies_twin_id_idx").on(t.twinId)],
);

export const sourceArtifacts = pgTable(
  "source_artifacts",
  {
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    sourceType: sourceTypeEnum("source_type").notNull(),
    uri: text("uri"),
    rawStorageRef: text("raw_storage_ref"),
    hash: text("hash"),
    connectorAccountId: optionalUuidRef(
      "connector_account_id",
      () => connectorAccounts,
    ),
    connectorSourceId: optionalUuidRef(
      "connector_source_id",
      () => connectorSources,
    ),
    connectorSyncRunId: optionalUuidRef(
      "connector_sync_run_id",
      () => connectorSyncRuns,
    ),
    metadata: metadataColumn(),
    ingestionStatus: ingestionStatusEnum("ingestion_status").notNull(),
    ...rowTimestamps(),
  },
  (t) => [
    index("source_artifacts_twin_id_idx").on(t.twinId),
    index("source_artifacts_ingestion_status_idx").on(t.ingestionStatus),
    index("source_artifacts_connector_account_id_idx").on(t.connectorAccountId),
    index("source_artifacts_connector_source_id_idx").on(t.connectorSourceId),
    index("source_artifacts_connector_sync_run_id_idx").on(
      t.connectorSyncRunId,
    ),
  ],
);

export const connectorAccounts = pgTable(
  "connector_accounts",
  {
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    provider: connectorProviderEnum("provider").notNull(),
    status: connectorAccountStatusEnum("status").notNull().default("connected"),
    externalAccountId: text("external_account_id"),
    displayName: text("display_name").notNull(),
    scopes: textArrayColumn("scopes"),
    syncCadence: text("sync_cadence").notNull().default("manual"),
    tokenRef: text("token_ref"),
    ...connectorSyncStateColumns(),
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
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    connectorAccountId: uuid("connector_account_id")
      .notNull()
      .references(() => connectorAccounts.id, { onDelete: "cascade" }),
    provider: connectorProviderEnum("provider").notNull(),
    sourceType: sourceTypeEnum("source_type").notNull(),
    externalSourceId: text("external_source_id").notNull(),
    displayName: text("display_name").notNull(),
    uri: text("uri"),
    status: connectorAccountStatusEnum("status").notNull().default("connected"),
    ...connectorSyncStateColumns(),
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
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    connectorAccountId: uuid("connector_account_id")
      .notNull()
      .references(() => connectorAccounts.id, { onDelete: "cascade" }),
    connectorSourceId: optionalUuidRef(
      "connector_source_id",
      () => connectorSources,
    ),
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
    metadata: metadataColumn(),
    startedAt: tzTimestamp("started_at"),
    completedAt: tzTimestamp("completed_at"),
    ...rowTimestamps(),
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
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    connectorSyncRunId: uuid("connector_sync_run_id")
      .notNull()
      .references(() => connectorSyncRuns.id, { onDelete: "cascade" }),
    connectorAccountId: uuid("connector_account_id")
      .notNull()
      .references(() => connectorAccounts.id, { onDelete: "cascade" }),
    connectorSourceId: optionalUuidRef(
      "connector_source_id",
      () => connectorSources,
    ),
    sourceArtifactId: optionalUuidRef(
      "source_artifact_id",
      () => sourceArtifacts,
    ),
    externalItemId: text("external_item_id").notNull(),
    action: connectorSyncItemActionEnum("action").notNull(),
    reason: text("reason"),
    contentHash: text("content_hash"),
    metadata: metadataColumn(),
    createdAt: createdAtColumn(),
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

export const telegramLinkTokens = pgTable(
  "telegram_link_tokens",
  {
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    tokenHash: text("token_hash").notNull(),
    status: telegramLinkTokenStatusEnum("status").notNull().default("pending"),
    connectorAccountId: optionalUuidRef(
      "connector_account_id",
      () => connectorAccounts,
    ),
    telegramUserId: text("telegram_user_id"),
    chatId: text("chat_id"),
    expiresAt: tzTimestamp("expires_at").notNull(),
    consumedAt: tzTimestamp("consumed_at"),
    revokedAt: tzTimestamp("revoked_at"),
    metadata: metadataColumn(),
    ...rowTimestamps(),
  },
  (t) => [
    index("telegram_link_tokens_twin_id_idx").on(t.twinId),
    index("telegram_link_tokens_status_idx").on(t.status),
    index("telegram_link_tokens_expires_at_idx").on(t.expiresAt),
    uniqueIndex("telegram_link_tokens_token_hash_idx").on(t.tokenHash),
  ],
);

export const telegramIngestedMessages = pgTable(
  "telegram_ingested_messages",
  {
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    connectorAccountId: uuid("connector_account_id")
      .notNull()
      .references(() => connectorAccounts.id, { onDelete: "cascade" }),
    connectorSourceId: uuid("connector_source_id")
      .notNull()
      .references(() => connectorSources.id, { onDelete: "cascade" }),
    sourceArtifactId: optionalUuidRef(
      "source_artifact_id",
      () => sourceArtifacts,
    ),
    telegramUserId: text("telegram_user_id").notNull(),
    chatId: text("chat_id").notNull(),
    messageId: text("message_id").notNull(),
    updateId: text("update_id"),
    status: telegramMessageIngestionStatusEnum("status")
      .notNull()
      .default("processing"),
    contentHash: text("content_hash"),
    metadata: metadataColumn(),
    ...rowTimestamps(),
  },
  (t) => [
    index("telegram_ingested_messages_twin_id_idx").on(t.twinId),
    index("telegram_ingested_messages_account_id_idx").on(
      t.connectorAccountId,
    ),
    index("telegram_ingested_messages_source_id_idx").on(t.connectorSourceId),
    index("telegram_ingested_messages_artifact_id_idx").on(t.sourceArtifactId),
    index("telegram_ingested_messages_created_at_idx").on(t.createdAt),
    uniqueIndex("telegram_ingested_messages_account_chat_message_idx").on(
      t.connectorAccountId,
      t.chatId,
      t.messageId,
    ),
  ],
);

export const memoryFragments = pgTable(
  "memory_fragments",
  {
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    sourceArtifactId: uuid("source_artifact_id")
      .notNull()
      .references(() => sourceArtifacts.id, { onDelete: "cascade" }),
    contentStorageRef: text("content_storage_ref"),
    contentSha256: text("content_sha256"),
    storageStatus: memoryStorageStatusEnum("storage_status")
      .notNull()
      .default("verified_available"),
    storageProvider: text("storage_provider").notNull().default("walrus"),
    walrusNetwork: text("walrus_network"),
    walrusBlobId: text("walrus_blob_id"),
    walrusBlobObjectId: text("walrus_blob_object_id"),
    walrusStartEpoch: integer("walrus_start_epoch"),
    walrusEndEpoch: integer("walrus_end_epoch"),
    storageVerifiedAt: tzTimestamp("storage_verified_at"),
    storageLastReadAt: tzTimestamp("storage_last_read_at"),
    storageLastReadErrorCode: text("storage_last_read_error_code"),
    storageLastReadErrorMessage: text("storage_last_read_error_message"),
    storageRenewalDueEpoch: integer("storage_renewal_due_epoch"),
    storageRenewalAttemptedAt: tzTimestamp("storage_renewal_attempted_at"),
    storageRepairAttemptedAt: tzTimestamp("storage_repair_attempted_at"),
    embeddingRef: text("embedding_ref"),
    metadata: metadataColumn(),
    importanceScore: doublePrecision("importance_score"),
    confidenceScore: doublePrecision("confidence_score"),
    occurredAt: tzTimestamp("occurred_at"),
    ...rowTimestamps(),
  },
  (t) => [
    index("memory_fragments_twin_id_idx").on(t.twinId),
    uniqueIndex("memory_fragments_source_artifact_id_idx").on(
      t.sourceArtifactId,
    ),
    index("memory_fragments_occurred_at_idx").on(t.occurredAt),
    index("memory_fragments_storage_status_idx").on(t.storageStatus),
    index("memory_fragments_storage_renewal_due_epoch_idx").on(
      t.storageRenewalDueEpoch,
    ),
  ],
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    sourceArtifactId: uuid("source_artifact_id")
      .notNull()
      .references(() => sourceArtifacts.id, { onDelete: "cascade" }),
    memoryFragmentId: uuid("memory_fragment_id")
      .notNull()
      .references(() => memoryFragments.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    contentStorageRef: text("content_storage_ref").notNull(),
    contentSha256: text("content_sha256").notNull(),
    tokenCount: integer("token_count").notNull(),
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
    pageStart: integer("page_start"),
    pageEnd: integer("page_end"),
    storageStatus: memoryStorageStatusEnum("storage_status")
      .notNull()
      .default("verified_available"),
    storageProvider: text("storage_provider").notNull().default("walrus"),
    walrusNetwork: text("walrus_network"),
    walrusBlobId: text("walrus_blob_id"),
    walrusBlobObjectId: text("walrus_blob_object_id"),
    walrusStartEpoch: integer("walrus_start_epoch"),
    walrusEndEpoch: integer("walrus_end_epoch"),
    storageVerifiedAt: tzTimestamp("storage_verified_at"),
    embeddingRef: text("embedding_ref"),
    embedding: jsonb("embedding").$type<number[]>(),
    embeddingModel: text("embedding_model"),
    embeddingProvider: text("embedding_provider"),
    embeddingGeneratedAt: tzTimestamp("embedding_generated_at"),
    metadata: metadataColumn(),
    ...rowTimestamps(),
  },
  (t) => [
    index("document_chunks_twin_id_idx").on(t.twinId),
    index("document_chunks_source_artifact_id_idx").on(t.sourceArtifactId),
    index("document_chunks_memory_fragment_id_idx").on(t.memoryFragmentId),
    index("document_chunks_page_range_idx").on(
      t.sourceArtifactId,
      t.pageStart,
      t.pageEnd,
    ),
    index("document_chunks_storage_status_idx").on(t.storageStatus),
    uniqueIndex("document_chunks_artifact_index_idx").on(
      t.sourceArtifactId,
      t.chunkIndex,
    ),
  ],
);

export const documentPages = pgTable(
  "document_pages",
  {
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    sourceArtifactId: uuid("source_artifact_id")
      .notNull()
      .references(() => sourceArtifacts.id, { onDelete: "cascade" }),
    memoryFragmentId: uuid("memory_fragment_id")
      .notNull()
      .references(() => memoryFragments.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    contentStorageRef: text("content_storage_ref").notNull(),
    contentSha256: text("content_sha256").notNull(),
    tokenCount: integer("token_count").notNull(),
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
    storageStatus: memoryStorageStatusEnum("storage_status")
      .notNull()
      .default("verified_available"),
    storageProvider: text("storage_provider").notNull().default("walrus"),
    walrusNetwork: text("walrus_network"),
    walrusBlobId: text("walrus_blob_id"),
    walrusBlobObjectId: text("walrus_blob_object_id"),
    walrusStartEpoch: integer("walrus_start_epoch"),
    walrusEndEpoch: integer("walrus_end_epoch"),
    storageVerifiedAt: tzTimestamp("storage_verified_at"),
    metadata: metadataColumn(),
    ...rowTimestamps(),
  },
  (t) => [
    index("document_pages_twin_id_idx").on(t.twinId),
    index("document_pages_source_artifact_id_idx").on(t.sourceArtifactId),
    index("document_pages_memory_fragment_id_idx").on(t.memoryFragmentId),
    index("document_pages_storage_status_idx").on(t.storageStatus),
    uniqueIndex("document_pages_artifact_page_idx").on(
      t.sourceArtifactId,
      t.pageNumber,
    ),
  ],
);

export const documentStructureItems = pgTable(
  "document_structure_items",
  {
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    sourceArtifactId: uuid("source_artifact_id")
      .notNull()
      .references(() => sourceArtifacts.id, { onDelete: "cascade" }),
    memoryFragmentId: uuid("memory_fragment_id")
      .notNull()
      .references(() => memoryFragments.id, { onDelete: "cascade" }),
    itemType: text("item_type").notNull(),
    label: text("label").notNull(),
    normalizedLabel: text("normalized_label").notNull(),
    ordinal: integer("ordinal"),
    pageStart: integer("page_start"),
    pageEnd: integer("page_end"),
    charStart: integer("char_start"),
    charEnd: integer("char_end"),
    confidenceScore: doublePrecision("confidence_score"),
    extractionMethod: text("extraction_method").notNull(),
    metadata: metadataColumn(),
    ...rowTimestamps(),
  },
  (t) => [
    index("document_structure_items_twin_id_idx").on(t.twinId),
    index("document_structure_items_source_artifact_id_idx").on(t.sourceArtifactId),
    index("document_structure_items_fragment_id_idx").on(t.memoryFragmentId),
    index("document_structure_items_type_idx").on(t.itemType),
    index("document_structure_items_page_range_idx").on(
      t.sourceArtifactId,
      t.pageStart,
      t.pageEnd,
    ),
    uniqueIndex("document_structure_items_artifact_type_label_idx").on(
      t.sourceArtifactId,
      t.itemType,
      t.normalizedLabel,
      t.pageStart,
    ),
  ],
);

export const sourceSpeakerMappings = pgTable(
  "source_speaker_mappings",
  {
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    sourceArtifactId: uuid("source_artifact_id")
      .notNull()
      .references(() => sourceArtifacts.id, { onDelete: "cascade" }),
    sourceSpeaker: text("source_speaker").notNull(),
    sourceSpeakerId: text("source_speaker_id"),
    role: speakerRoleEnum("role").notNull(),
    mappedName: text("mapped_name"),
    metadata: metadataColumn(),
    ...rowTimestamps(),
  },
  (t) => [
    index("source_speaker_mappings_twin_id_idx").on(t.twinId),
    index("source_speaker_mappings_source_artifact_id_idx").on(
      t.sourceArtifactId,
    ),
    uniqueIndex("source_speaker_mappings_artifact_speaker_idx").on(
      t.sourceArtifactId,
      t.sourceSpeaker,
    ),
  ],
);

export const graphNodes = pgTable(
  "graph_nodes",
  {
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    nodeType: graphNodeTypeEnum("node_type").notNull(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    description: text("description"),
    properties: jsonb("properties").$type<unknown>(),
    confidenceScore: doublePrecision("confidence_score"),
    ...rowTimestamps(),
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
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    fromNodeId: uuid("from_node_id")
      .notNull()
      .references(() => graphNodes.id, { onDelete: "cascade" }),
    toNodeId: uuid("to_node_id")
      .notNull()
      .references(() => graphNodes.id, { onDelete: "cascade" }),
    edgeType: text("edge_type").notNull(),
    description: text("description"),
    evidenceMemoryIds: uuidArrayColumn("evidence_memory_ids"),
    confidenceScore: doublePrecision("confidence_score"),
    ...rowTimestamps(),
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
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    insightType: insightTypeEnum("insight_type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    evidenceMemoryIds: uuidArrayColumn("evidence_memory_ids"),
    relatedNodeIds: uuidArrayColumn("related_node_ids"),
    confidenceScore: doublePrecision("confidence_score"),
    userFeedback: text("user_feedback"),
    ...rowTimestamps(),
  },
  (t) => [
    index("insights_twin_id_idx").on(t.twinId),
    index("insights_insight_type_idx").on(t.insightType),
  ],
);

export const canonicalMemories = pgTable(
  "canonical_memories",
  {
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    memoryType: candidateMemoryTypeEnum("memory_type").notNull(),
    canonicalKey: text("canonical_key").notNull(),
    subject: text("subject"),
    status: candidateMemoryStatusEnum("status").notNull().default("candidate"),
    evidenceCount: doublePrecision("evidence_count").notNull().default(1),
    confidenceScore: doublePrecision("confidence_score"),
    metadata: metadataColumn(),
    firstSeenAt: tzTimestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: tzTimestamp("last_seen_at").notNull().defaultNow(),
    ...rowTimestamps(),
  },
  (t) => [
    index("canonical_memories_twin_id_idx").on(t.twinId),
    index("canonical_memories_memory_type_idx").on(t.memoryType),
    uniqueIndex("canonical_memories_twin_key_idx").on(t.twinId, t.canonicalKey),
  ],
);

export const candidateMemoryArchives = pgTable(
  "candidate_memory_archives",
  {
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    sourceArtifactId: uuid("source_artifact_id")
      .notNull()
      .references(() => sourceArtifacts.id, { onDelete: "cascade" }),
    memoryFragmentId: uuid("memory_fragment_id")
      .notNull()
      .references(() => memoryFragments.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    candidateMemoryIds: uuid("candidate_memory_ids").array().notNull(),
    encryptedBytesBase64: text("encrypted_bytes_base64").notNull(),
    contentSha256: text("content_sha256").notNull(),
    status: candidateMemoryArchiveStatusEnum("status")
      .notNull()
      .default("pending"),
    storageRef: text("storage_ref"),
    storageSha256: text("storage_sha256"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastAttemptedAt: tzTimestamp("last_attempted_at"),
    nextRetryAt: tzTimestamp("next_retry_at"),
    completedAt: tzTimestamp("completed_at"),
    jobId: text("job_id"),
    metadata: metadataColumn(),
    ...rowTimestamps(),
  },
  (t) => [
    index("candidate_memory_archives_twin_id_idx").on(t.twinId),
    index("candidate_memory_archives_status_retry_idx").on(
      t.status,
      t.nextRetryAt,
    ),
    index("candidate_memory_archives_artifact_idx").on(t.sourceArtifactId),
    uniqueIndex("candidate_memory_archives_batch_sha_idx").on(
      t.memoryFragmentId,
      t.contentSha256,
    ),
  ],
);

export const candidateMemories = pgTable(
  "candidate_memories",
  {
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    canonicalMemoryId: optionalUuidRef(
      "canonical_memory_id",
      () => canonicalMemories,
    ),
    archiveId: optionalUuidRef("archive_id", () => candidateMemoryArchives),
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
    archiveStatus: candidateMemoryArchiveStatusEnum("archive_status")
      .notNull()
      .default("not_required"),
    archiveErrorCode: text("archive_error_code"),
    archiveErrorMessage: text("archive_error_message"),
    archiveAttemptCount: integer("archive_attempt_count").notNull().default(0),
    archiveLastAttemptedAt: tzTimestamp("archive_last_attempted_at"),
    archiveNextRetryAt: tzTimestamp("archive_next_retry_at"),
    archiveCompletedAt: tzTimestamp("archive_completed_at"),
    metadata: metadataColumn(),
    ...rowTimestamps(),
  },
  (t) => [
    index("candidate_memories_twin_id_idx").on(t.twinId),
    index("candidate_memories_canonical_memory_id_idx").on(t.canonicalMemoryId),
    index("candidate_memories_archive_id_idx").on(t.archiveId),
    index("candidate_memories_source_artifact_id_idx").on(t.sourceArtifactId),
    index("candidate_memories_memory_fragment_id_idx").on(t.memoryFragmentId),
    index("candidate_memories_status_idx").on(t.status),
    index("candidate_memories_archive_status_idx").on(
      t.archiveStatus,
      t.archiveNextRetryAt,
    ),
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
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    targetType: feedbackTargetTypeEnum("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    feedbackType: feedbackTypeEnum("feedback_type").notNull(),
    actorType: text("actor_type").notNull().default("user"),
    actorId: text("actor_id").notNull(),
    metadata: metadataColumn(),
    createdAt: createdAtColumn(),
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
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    periodStart: tzTimestamp("period_start").notNull(),
    periodEnd: tzTimestamp("period_end").notNull(),
    status: reflectionStatusEnum("status").notNull(),
    summaryStorageRef: text("summary_storage_ref"),
    summarySha256: text("summary_sha256"),
    metadata: metadataColumn(),
    ...rowTimestamps(),
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
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    requesterId: uuid("requester_id").notNull(),
    query: text("query").notNull(),
    scope: text("scope").notNull(),
    memoryFragmentIds: uuidArrayColumn("memory_fragment_ids"),
    graphNodeIds: uuidArrayColumn("graph_node_ids"),
    summary: text("summary"),
    citations: jsonb("citations").$type<unknown>(),
    expiresAt: tzTimestamp("expires_at"),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("context_packets_twin_id_idx").on(t.twinId),
    index("context_packets_expires_at_idx").on(t.expiresAt),
  ],
);

export const contextRuntimePackets = pgTable(
  "context_runtime_packets",
  {
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    kind: contextRuntimePacketKindEnum("kind").notNull(),
    scopeKey: text("scope_key").notNull(),
    status: contextRuntimePacketStatusEnum("status").notNull().default("ready"),
    payload: jsonb("payload").$type<unknown>(),
    sourceRefs: jsonb("source_refs").$type<unknown>(),
    versionHash: text("version_hash").notNull(),
    generatedAt: tzTimestamp("generated_at").notNull().defaultNow(),
    staleAt: tzTimestamp("stale_at"),
    expiresAt: tzTimestamp("expires_at"),
    metadata: metadataColumn(),
    ...rowTimestamps(),
  },
  (t) => [
    index("context_runtime_packets_twin_id_idx").on(t.twinId),
    index("context_runtime_packets_kind_idx").on(t.kind),
    index("context_runtime_packets_status_idx").on(t.status),
    index("context_runtime_packets_expires_at_idx").on(t.expiresAt),
    uniqueIndex("context_runtime_packets_twin_kind_scope_idx").on(
      t.twinId,
      t.kind,
      t.scopeKey,
    ),
  ],
);

export const agentWritebacks = pgTable(
  "agent_writebacks",
  {
    id: primaryId(),
    twinId: twinIdColumn(() => twins),
    clientId: uuid("client_id")
      .notNull()
      .references(() => apiClients.id, { onDelete: "cascade" }),
    status: agentWritebackStatusEnum("status").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    approvedAt: tzTimestamp("approved_at"),
    rejectedAt: tzTimestamp("rejected_at"),
    ...rowTimestamps(),
  },
  (t) => [
    index("agent_writebacks_twin_id_idx").on(t.twinId),
    index("agent_writebacks_client_id_idx").on(t.clientId),
  ],
);

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: primaryId(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => apiClients.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    events: textArrayColumn("events"),
    secretRef: text("secret_ref"),
    enabled: boolean("enabled").notNull().default(true),
    ...rowTimestamps(),
  },
  (t) => [index("webhook_endpoints_client_id_idx").on(t.clientId)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: primaryId(),
    twinId: nullableTwinIdColumn(() => twins),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    eventType: text("event_type").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    metadata: metadataColumn(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("audit_events_twin_id_idx").on(t.twinId),
    index("audit_events_created_at_idx").on(t.createdAt),
  ],
);
