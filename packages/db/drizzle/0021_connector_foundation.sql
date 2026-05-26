CREATE TYPE "public"."connector_provider" AS ENUM(
  'github',
  'notion',
  'microsoft_onedrive',
  'google_drive',
  'slack',
  'email',
  'calendar',
  'browser_history',
  'chatgpt',
  'codex',
  'claude',
  'other'
);

CREATE TYPE "public"."connector_account_status" AS ENUM(
  'connected',
  'paused',
  'needs_reauth',
  'error',
  'disconnected'
);

CREATE TYPE "public"."connector_sync_run_status" AS ENUM(
  'queued',
  'processing',
  'completed',
  'failed',
  'cancelled'
);

CREATE TYPE "public"."connector_sync_mode" AS ENUM(
  'initial',
  'incremental',
  'manual'
);

CREATE TYPE "public"."connector_sync_item_action" AS ENUM(
  'added',
  'updated',
  'skipped',
  'failed'
);

CREATE TABLE "connector_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "twin_id" uuid NOT NULL,
  "provider" "connector_provider" NOT NULL,
  "status" "connector_account_status" DEFAULT 'connected' NOT NULL,
  "external_account_id" text,
  "display_name" text NOT NULL,
  "scopes" text[] DEFAULT '{}'::text[] NOT NULL,
  "sync_cadence" text DEFAULT 'manual' NOT NULL,
  "token_ref" text,
  "cursor" text,
  "last_sync_at" timestamp with time zone,
  "next_sync_at" timestamp with time zone,
  "error_code" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "connector_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "twin_id" uuid NOT NULL,
  "connector_account_id" uuid NOT NULL,
  "provider" "connector_provider" NOT NULL,
  "source_type" "source_type" NOT NULL,
  "external_source_id" text NOT NULL,
  "display_name" text NOT NULL,
  "uri" text,
  "status" "connector_account_status" DEFAULT 'connected' NOT NULL,
  "cursor" text,
  "last_sync_at" timestamp with time zone,
  "next_sync_at" timestamp with time zone,
  "error_code" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "connector_sync_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "twin_id" uuid NOT NULL,
  "connector_account_id" uuid NOT NULL,
  "connector_source_id" uuid,
  "provider" "connector_provider" NOT NULL,
  "mode" "connector_sync_mode" NOT NULL,
  "status" "connector_sync_run_status" NOT NULL,
  "cursor_before" text,
  "cursor_after" text,
  "added_count" integer DEFAULT 0 NOT NULL,
  "updated_count" integer DEFAULT 0 NOT NULL,
  "skipped_count" integer DEFAULT 0 NOT NULL,
  "failed_count" integer DEFAULT 0 NOT NULL,
  "error_code" text,
  "error_message" text,
  "metadata" jsonb,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "connector_sync_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "twin_id" uuid NOT NULL,
  "connector_sync_run_id" uuid NOT NULL,
  "connector_account_id" uuid NOT NULL,
  "connector_source_id" uuid,
  "source_artifact_id" uuid,
  "external_item_id" text NOT NULL,
  "action" "connector_sync_item_action" NOT NULL,
  "reason" text,
  "content_hash" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "connector_accounts"
  ADD CONSTRAINT "connector_accounts_twin_id_twins_id_fk"
  FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "connector_sources"
  ADD CONSTRAINT "connector_sources_twin_id_twins_id_fk"
  FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "connector_sources"
  ADD CONSTRAINT "connector_sources_connector_account_id_connector_accounts_id_fk"
  FOREIGN KEY ("connector_account_id") REFERENCES "public"."connector_accounts"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "connector_sync_runs"
  ADD CONSTRAINT "connector_sync_runs_twin_id_twins_id_fk"
  FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "connector_sync_runs"
  ADD CONSTRAINT "connector_sync_runs_connector_account_id_connector_accounts_id_fk"
  FOREIGN KEY ("connector_account_id") REFERENCES "public"."connector_accounts"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "connector_sync_runs"
  ADD CONSTRAINT "connector_sync_runs_connector_source_id_connector_sources_id_fk"
  FOREIGN KEY ("connector_source_id") REFERENCES "public"."connector_sources"("id")
  ON DELETE set null ON UPDATE no action;

ALTER TABLE "connector_sync_items"
  ADD CONSTRAINT "connector_sync_items_twin_id_twins_id_fk"
  FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "connector_sync_items"
  ADD CONSTRAINT "connector_sync_items_connector_sync_run_id_connector_sync_runs_id_fk"
  FOREIGN KEY ("connector_sync_run_id") REFERENCES "public"."connector_sync_runs"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "connector_sync_items"
  ADD CONSTRAINT "connector_sync_items_connector_account_id_connector_accounts_id_fk"
  FOREIGN KEY ("connector_account_id") REFERENCES "public"."connector_accounts"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "connector_sync_items"
  ADD CONSTRAINT "connector_sync_items_connector_source_id_connector_sources_id_fk"
  FOREIGN KEY ("connector_source_id") REFERENCES "public"."connector_sources"("id")
  ON DELETE set null ON UPDATE no action;

ALTER TABLE "connector_sync_items"
  ADD CONSTRAINT "connector_sync_items_source_artifact_id_source_artifacts_id_fk"
  FOREIGN KEY ("source_artifact_id") REFERENCES "public"."source_artifacts"("id")
  ON DELETE set null ON UPDATE no action;

ALTER TABLE "source_artifacts" ADD COLUMN "connector_account_id" uuid;
ALTER TABLE "source_artifacts" ADD COLUMN "connector_source_id" uuid;
ALTER TABLE "source_artifacts" ADD COLUMN "connector_sync_run_id" uuid;

ALTER TABLE "source_artifacts"
  ADD CONSTRAINT "source_artifacts_connector_account_id_connector_accounts_id_fk"
  FOREIGN KEY ("connector_account_id") REFERENCES "public"."connector_accounts"("id")
  ON DELETE set null ON UPDATE no action;

ALTER TABLE "source_artifacts"
  ADD CONSTRAINT "source_artifacts_connector_source_id_connector_sources_id_fk"
  FOREIGN KEY ("connector_source_id") REFERENCES "public"."connector_sources"("id")
  ON DELETE set null ON UPDATE no action;

ALTER TABLE "source_artifacts"
  ADD CONSTRAINT "source_artifacts_connector_sync_run_id_connector_sync_runs_id_fk"
  FOREIGN KEY ("connector_sync_run_id") REFERENCES "public"."connector_sync_runs"("id")
  ON DELETE set null ON UPDATE no action;

CREATE INDEX "connector_accounts_twin_id_idx" ON "connector_accounts" USING btree ("twin_id");
CREATE INDEX "connector_accounts_provider_idx" ON "connector_accounts" USING btree ("provider");
CREATE INDEX "connector_accounts_status_idx" ON "connector_accounts" USING btree ("status");
CREATE UNIQUE INDEX "connector_accounts_twin_provider_external_idx" ON "connector_accounts" USING btree ("twin_id", "provider", "external_account_id");

CREATE INDEX "connector_sources_twin_id_idx" ON "connector_sources" USING btree ("twin_id");
CREATE INDEX "connector_sources_account_id_idx" ON "connector_sources" USING btree ("connector_account_id");
CREATE INDEX "connector_sources_provider_idx" ON "connector_sources" USING btree ("provider");
CREATE INDEX "connector_sources_status_idx" ON "connector_sources" USING btree ("status");
CREATE UNIQUE INDEX "connector_sources_account_external_idx" ON "connector_sources" USING btree ("connector_account_id", "external_source_id");

CREATE INDEX "connector_sync_runs_twin_id_idx" ON "connector_sync_runs" USING btree ("twin_id");
CREATE INDEX "connector_sync_runs_account_id_idx" ON "connector_sync_runs" USING btree ("connector_account_id");
CREATE INDEX "connector_sync_runs_source_id_idx" ON "connector_sync_runs" USING btree ("connector_source_id");
CREATE INDEX "connector_sync_runs_status_idx" ON "connector_sync_runs" USING btree ("status");
CREATE INDEX "connector_sync_runs_created_at_idx" ON "connector_sync_runs" USING btree ("created_at");

CREATE INDEX "connector_sync_items_twin_id_idx" ON "connector_sync_items" USING btree ("twin_id");
CREATE INDEX "connector_sync_items_run_id_idx" ON "connector_sync_items" USING btree ("connector_sync_run_id");
CREATE INDEX "connector_sync_items_account_id_idx" ON "connector_sync_items" USING btree ("connector_account_id");
CREATE INDEX "connector_sync_items_source_id_idx" ON "connector_sync_items" USING btree ("connector_source_id");
CREATE INDEX "connector_sync_items_artifact_id_idx" ON "connector_sync_items" USING btree ("source_artifact_id");
CREATE UNIQUE INDEX "connector_sync_items_run_external_idx" ON "connector_sync_items" USING btree ("connector_sync_run_id", "external_item_id");

CREATE INDEX "source_artifacts_connector_account_id_idx" ON "source_artifacts" USING btree ("connector_account_id");
CREATE INDEX "source_artifacts_connector_source_id_idx" ON "source_artifacts" USING btree ("connector_source_id");
CREATE INDEX "source_artifacts_connector_sync_run_id_idx" ON "source_artifacts" USING btree ("connector_sync_run_id");
