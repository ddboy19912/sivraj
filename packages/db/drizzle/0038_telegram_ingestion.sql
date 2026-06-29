ALTER TYPE "public"."source_type" ADD VALUE IF NOT EXISTS 'telegram_message' BEFORE 'github';--> statement-breakpoint

ALTER TYPE "public"."connector_provider" ADD VALUE IF NOT EXISTS 'telegram' BEFORE 'other';--> statement-breakpoint

CREATE TYPE "public"."telegram_link_token_status" AS ENUM(
  'pending',
  'consumed',
  'expired',
  'revoked'
);--> statement-breakpoint

CREATE TYPE "public"."telegram_message_ingestion_status" AS ENUM(
  'processing',
  'captured',
  'deferred',
  'failed'
);--> statement-breakpoint

CREATE TABLE "telegram_link_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "twin_id" uuid NOT NULL,
  "token_hash" text NOT NULL,
  "status" "telegram_link_token_status" DEFAULT 'pending' NOT NULL,
  "connector_account_id" uuid,
  "telegram_user_id" text,
  "chat_id" text,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "telegram_ingested_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "twin_id" uuid NOT NULL,
  "connector_account_id" uuid NOT NULL,
  "connector_source_id" uuid NOT NULL,
  "source_artifact_id" uuid,
  "telegram_user_id" text NOT NULL,
  "chat_id" text NOT NULL,
  "message_id" text NOT NULL,
  "update_id" text,
  "status" "telegram_message_ingestion_status" DEFAULT 'processing' NOT NULL,
  "content_hash" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "telegram_link_tokens"
ADD CONSTRAINT "telegram_link_tokens_twin_id_twins_id_fk"
FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id")
ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "telegram_link_tokens"
ADD CONSTRAINT "telegram_link_tokens_connector_account_id_connector_accounts_id_fk"
FOREIGN KEY ("connector_account_id") REFERENCES "public"."connector_accounts"("id")
ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "telegram_ingested_messages"
ADD CONSTRAINT "telegram_ingested_messages_twin_id_twins_id_fk"
FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id")
ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "telegram_ingested_messages"
ADD CONSTRAINT "telegram_ingested_messages_connector_account_id_connector_accounts_id_fk"
FOREIGN KEY ("connector_account_id") REFERENCES "public"."connector_accounts"("id")
ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "telegram_ingested_messages"
ADD CONSTRAINT "telegram_ingested_messages_connector_source_id_connector_sources_id_fk"
FOREIGN KEY ("connector_source_id") REFERENCES "public"."connector_sources"("id")
ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "telegram_ingested_messages"
ADD CONSTRAINT "telegram_ingested_messages_source_artifact_id_source_artifacts_id_fk"
FOREIGN KEY ("source_artifact_id") REFERENCES "public"."source_artifacts"("id")
ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "telegram_link_tokens_twin_id_idx"
ON "telegram_link_tokens" USING btree ("twin_id");--> statement-breakpoint

CREATE INDEX "telegram_link_tokens_status_idx"
ON "telegram_link_tokens" USING btree ("status");--> statement-breakpoint

CREATE INDEX "telegram_link_tokens_expires_at_idx"
ON "telegram_link_tokens" USING btree ("expires_at");--> statement-breakpoint

CREATE UNIQUE INDEX "telegram_link_tokens_token_hash_idx"
ON "telegram_link_tokens" USING btree ("token_hash");--> statement-breakpoint

CREATE INDEX "telegram_ingested_messages_twin_id_idx"
ON "telegram_ingested_messages" USING btree ("twin_id");--> statement-breakpoint

CREATE INDEX "telegram_ingested_messages_account_id_idx"
ON "telegram_ingested_messages" USING btree ("connector_account_id");--> statement-breakpoint

CREATE INDEX "telegram_ingested_messages_source_id_idx"
ON "telegram_ingested_messages" USING btree ("connector_source_id");--> statement-breakpoint

CREATE INDEX "telegram_ingested_messages_artifact_id_idx"
ON "telegram_ingested_messages" USING btree ("source_artifact_id");--> statement-breakpoint

CREATE INDEX "telegram_ingested_messages_created_at_idx"
ON "telegram_ingested_messages" USING btree ("created_at");--> statement-breakpoint

CREATE UNIQUE INDEX "telegram_ingested_messages_account_chat_message_idx"
ON "telegram_ingested_messages" USING btree (
  "connector_account_id",
  "chat_id",
  "message_id"
);
