CREATE TYPE "public"."chat_message_role" AS ENUM('system', 'user', 'assistant');
--> statement-breakpoint
CREATE TYPE "public"."llm_provider_kind" AS ENUM('openai', 'openrouter', 'ollama', 'custom_openai_compatible');
--> statement-breakpoint
CREATE TYPE "public"."llm_provider_status" AS ENUM('connected', 'disconnected', 'error');
--> statement-breakpoint
CREATE TABLE "llm_provider_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "twin_id" uuid NOT NULL,
  "provider_kind" "llm_provider_kind" NOT NULL,
  "status" "llm_provider_status" DEFAULT 'connected' NOT NULL,
  "display_name" text NOT NULL,
  "base_url" text NOT NULL,
  "model" text NOT NULL,
  "api_key_ciphertext" text,
  "api_key_iv" text,
  "api_key_tag" text,
  "api_key_sha256" text,
  "metadata" jsonb,
  "last_tested_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_threads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "twin_id" uuid NOT NULL,
  "title" text DEFAULT 'New chat' NOT NULL,
  "llm_provider_config_id" uuid,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "twin_id" uuid NOT NULL,
  "thread_id" uuid NOT NULL,
  "role" "chat_message_role" NOT NULL,
  "content" text NOT NULL,
  "provider_kind" "llm_provider_kind",
  "model" text,
  "memory_fragment_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  "citations" jsonb,
  "usage" jsonb,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_provider_configs"
ADD CONSTRAINT "llm_provider_configs_twin_id_twins_id_fk"
FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_threads"
ADD CONSTRAINT "chat_threads_twin_id_twins_id_fk"
FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_threads"
ADD CONSTRAINT "chat_threads_llm_provider_config_id_llm_provider_configs_id_fk"
FOREIGN KEY ("llm_provider_config_id") REFERENCES "public"."llm_provider_configs"("id")
ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_messages"
ADD CONSTRAINT "chat_messages_twin_id_twins_id_fk"
FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_messages"
ADD CONSTRAINT "chat_messages_thread_id_chat_threads_id_fk"
FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "llm_provider_configs_twin_id_idx"
ON "llm_provider_configs" USING btree ("twin_id");
--> statement-breakpoint
CREATE INDEX "llm_provider_configs_provider_kind_idx"
ON "llm_provider_configs" USING btree ("provider_kind");
--> statement-breakpoint
CREATE INDEX "llm_provider_configs_status_idx"
ON "llm_provider_configs" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "chat_threads_twin_id_idx"
ON "chat_threads" USING btree ("twin_id");
--> statement-breakpoint
CREATE INDEX "chat_threads_updated_at_idx"
ON "chat_threads" USING btree ("updated_at");
--> statement-breakpoint
CREATE INDEX "chat_threads_provider_config_id_idx"
ON "chat_threads" USING btree ("llm_provider_config_id");
--> statement-breakpoint
CREATE INDEX "chat_messages_twin_id_idx"
ON "chat_messages" USING btree ("twin_id");
--> statement-breakpoint
CREATE INDEX "chat_messages_thread_id_idx"
ON "chat_messages" USING btree ("thread_id");
--> statement-breakpoint
CREATE INDEX "chat_messages_created_at_idx"
ON "chat_messages" USING btree ("created_at");
