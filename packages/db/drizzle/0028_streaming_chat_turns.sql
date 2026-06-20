CREATE TYPE "public"."chat_turn_status" AS ENUM(
  'queued',
  'retrieving_context',
  'generating',
  'completed',
  'failed',
  'cancelled'
);
--> statement-breakpoint
CREATE TYPE "public"."chat_message_status" AS ENUM(
  'pending',
  'streaming',
  'completed',
  'failed',
  'cancelled'
);
--> statement-breakpoint
ALTER TABLE "chat_messages"
ADD COLUMN "turn_id" uuid;
--> statement-breakpoint
ALTER TABLE "chat_messages"
ADD COLUMN "status" "chat_message_status" DEFAULT 'completed' NOT NULL;
--> statement-breakpoint
CREATE TABLE "chat_turns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "twin_id" uuid NOT NULL,
  "thread_id" uuid NOT NULL,
  "user_message_id" uuid,
  "assistant_message_id" uuid,
  "status" "chat_turn_status" DEFAULT 'queued' NOT NULL,
  "provider_kind" "llm_provider_kind",
  "model" text,
  "error_code" text,
  "error_message" text,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_turns"
ADD CONSTRAINT "chat_turns_twin_id_twins_id_fk"
FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_turns"
ADD CONSTRAINT "chat_turns_thread_id_chat_threads_id_fk"
FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_turns"
ADD CONSTRAINT "chat_turns_user_message_id_chat_messages_id_fk"
FOREIGN KEY ("user_message_id") REFERENCES "public"."chat_messages"("id")
ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_turns"
ADD CONSTRAINT "chat_turns_assistant_message_id_chat_messages_id_fk"
FOREIGN KEY ("assistant_message_id") REFERENCES "public"."chat_messages"("id")
ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "chat_turns_twin_id_idx"
ON "chat_turns" USING btree ("twin_id");
--> statement-breakpoint
CREATE INDEX "chat_turns_thread_id_idx"
ON "chat_turns" USING btree ("thread_id");
--> statement-breakpoint
CREATE INDEX "chat_turns_status_idx"
ON "chat_turns" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "chat_turns_created_at_idx"
ON "chat_turns" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "chat_messages_turn_id_idx"
ON "chat_messages" USING btree ("turn_id");
--> statement-breakpoint
CREATE INDEX "chat_messages_status_idx"
ON "chat_messages" USING btree ("status");
