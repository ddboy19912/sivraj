CREATE TYPE "public"."access_policy_subject_type" AS ENUM('user', 'client', 'agent', 'system', 'group', 'other');--> statement-breakpoint
CREATE TYPE "public"."agent_writeback_status" AS ENUM('pending', 'approved', 'rejected', 'expired', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."graph_node_type" AS ENUM('person', 'organization', 'project', 'concept', 'event', 'artifact', 'goal', 'decision', 'topic', 'other');--> statement-breakpoint
CREATE TYPE "public"."ingestion_status" AS ENUM('pending', 'queued', 'processing', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."insight_type" AS ENUM('hypothesis', 'pattern', 'risk', 'opportunity', 'recommendation', 'summary', 'question', 'other');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('upload', 'url', 'note', 'chat_export', 'pdf', 'markdown', 'github', 'api', 'other');--> statement-breakpoint
CREATE TABLE "access_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"twin_id" uuid NOT NULL,
	"subject_type" "access_policy_subject_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"allowed_node_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"allowed_source_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"denied_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_writebacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"twin_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"status" "agent_writeback_status" NOT NULL,
	"payload" jsonb NOT NULL,
	"approved_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"metadata" jsonb,
	"redirect_uris" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"twin_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"event_type" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "context_packets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"twin_id" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"query" text NOT NULL,
	"scope" text NOT NULL,
	"memory_fragment_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"graph_node_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"summary" text,
	"citations" jsonb,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graph_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"twin_id" uuid NOT NULL,
	"from_node_id" uuid NOT NULL,
	"to_node_id" uuid NOT NULL,
	"edge_type" text NOT NULL,
	"description" text,
	"evidence_memory_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"confidence_score" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graph_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"twin_id" uuid NOT NULL,
	"node_type" "graph_node_type" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"properties" jsonb,
	"confidence_score" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"twin_id" uuid NOT NULL,
	"insight_type" "insight_type" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"evidence_memory_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"related_node_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"confidence_score" double precision,
	"user_feedback" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_fragments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"twin_id" uuid NOT NULL,
	"source_artifact_id" uuid NOT NULL,
	"content" text NOT NULL,
	"summary" text,
	"embedding_ref" text,
	"importance_score" double precision,
	"confidence_score" double precision,
	"occurred_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permission_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"twin_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"memory_domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"twin_id" uuid NOT NULL,
	"source_type" "source_type" NOT NULL,
	"title" text,
	"uri" text,
	"raw_storage_ref" text,
	"hash" text,
	"metadata" jsonb,
	"ingestion_status" "ingestion_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "twins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"summary" text,
	"current_goals" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"url" text NOT NULL,
	"events" text[] DEFAULT '{}'::text[] NOT NULL,
	"secret_ref" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_policies" ADD CONSTRAINT "access_policies_twin_id_twins_id_fk" FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_writebacks" ADD CONSTRAINT "agent_writebacks_twin_id_twins_id_fk" FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_writebacks" ADD CONSTRAINT "agent_writebacks_client_id_api_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."api_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_twin_id_twins_id_fk" FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_packets" ADD CONSTRAINT "context_packets_twin_id_twins_id_fk" FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_twin_id_twins_id_fk" FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_from_node_id_graph_nodes_id_fk" FOREIGN KEY ("from_node_id") REFERENCES "public"."graph_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_to_node_id_graph_nodes_id_fk" FOREIGN KEY ("to_node_id") REFERENCES "public"."graph_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_twin_id_twins_id_fk" FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_twin_id_twins_id_fk" FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_fragments" ADD CONSTRAINT "memory_fragments_twin_id_twins_id_fk" FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_fragments" ADD CONSTRAINT "memory_fragments_source_artifact_id_source_artifacts_id_fk" FOREIGN KEY ("source_artifact_id") REFERENCES "public"."source_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_grants" ADD CONSTRAINT "permission_grants_twin_id_twins_id_fk" FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_grants" ADD CONSTRAINT "permission_grants_client_id_api_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."api_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_artifacts" ADD CONSTRAINT "source_artifacts_twin_id_twins_id_fk" FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twins" ADD CONSTRAINT "twins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_client_id_api_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."api_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_policies_twin_id_idx" ON "access_policies" USING btree ("twin_id");--> statement-breakpoint
CREATE INDEX "agent_writebacks_twin_id_idx" ON "agent_writebacks" USING btree ("twin_id");--> statement-breakpoint
CREATE INDEX "agent_writebacks_client_id_idx" ON "agent_writebacks" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "audit_events_twin_id_idx" ON "audit_events" USING btree ("twin_id");--> statement-breakpoint
CREATE INDEX "audit_events_created_at_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "context_packets_twin_id_idx" ON "context_packets" USING btree ("twin_id");--> statement-breakpoint
CREATE INDEX "context_packets_expires_at_idx" ON "context_packets" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "graph_edges_twin_id_idx" ON "graph_edges" USING btree ("twin_id");--> statement-breakpoint
CREATE INDEX "graph_edges_from_node_id_idx" ON "graph_edges" USING btree ("from_node_id");--> statement-breakpoint
CREATE INDEX "graph_edges_to_node_id_idx" ON "graph_edges" USING btree ("to_node_id");--> statement-breakpoint
CREATE INDEX "graph_edges_edge_type_idx" ON "graph_edges" USING btree ("edge_type");--> statement-breakpoint
CREATE INDEX "graph_nodes_twin_id_idx" ON "graph_nodes" USING btree ("twin_id");--> statement-breakpoint
CREATE INDEX "graph_nodes_node_type_idx" ON "graph_nodes" USING btree ("node_type");--> statement-breakpoint
CREATE INDEX "insights_twin_id_idx" ON "insights" USING btree ("twin_id");--> statement-breakpoint
CREATE INDEX "insights_insight_type_idx" ON "insights" USING btree ("insight_type");--> statement-breakpoint
CREATE INDEX "memory_fragments_twin_id_idx" ON "memory_fragments" USING btree ("twin_id");--> statement-breakpoint
CREATE INDEX "memory_fragments_source_artifact_id_idx" ON "memory_fragments" USING btree ("source_artifact_id");--> statement-breakpoint
CREATE INDEX "memory_fragments_occurred_at_idx" ON "memory_fragments" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "permission_grants_twin_id_idx" ON "permission_grants" USING btree ("twin_id");--> statement-breakpoint
CREATE INDEX "permission_grants_client_id_idx" ON "permission_grants" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "source_artifacts_twin_id_idx" ON "source_artifacts" USING btree ("twin_id");--> statement-breakpoint
CREATE INDEX "source_artifacts_ingestion_status_idx" ON "source_artifacts" USING btree ("ingestion_status");--> statement-breakpoint
CREATE INDEX "twins_user_id_idx" ON "twins" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_client_id_idx" ON "webhook_endpoints" USING btree ("client_id");