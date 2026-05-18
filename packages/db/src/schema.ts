import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
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
  "chat_export",
  "pdf",
  "markdown",
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
    title: text("title"),
    uri: text("uri"),
    rawStorageRef: text("raw_storage_ref"),
    hash: text("hash"),
    metadata: jsonb("metadata").$type<unknown>(),
    ingestionStatus: ingestionStatusEnum("ingestion_status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("source_artifacts_twin_id_idx").on(t.twinId),
    index("source_artifacts_ingestion_status_idx").on(t.ingestionStatus),
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
    content: text("content").notNull(),
    summary: text("summary"),
    embeddingRef: text("embedding_ref"),
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

export const graphNodes = pgTable(
  "graph_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    twinId: uuid("twin_id")
      .notNull()
      .references(() => twins.id, { onDelete: "cascade" }),
    nodeType: graphNodeTypeEnum("node_type").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    properties: jsonb("properties").$type<unknown>(),
    confidenceScore: doublePrecision("confidence_score"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("graph_nodes_twin_id_idx").on(t.twinId),
    index("graph_nodes_node_type_idx").on(t.nodeType),
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
