CREATE TYPE "public"."candidate_memory_archive_status" AS ENUM (
  'not_required',
  'pending',
  'queued',
  'archiving',
  'archived',
  'failed_retryable',
  'failed_blocked',
  'cancelled'
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "candidate_memory_archives" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "twin_id" uuid NOT NULL,
  "source_artifact_id" uuid NOT NULL,
  "memory_fragment_id" uuid NOT NULL,
  "source_type" text NOT NULL,
  "candidate_memory_ids" uuid[] NOT NULL,
  "encrypted_bytes_base64" text NOT NULL,
  "content_sha256" text NOT NULL,
  "status" "candidate_memory_archive_status" DEFAULT 'pending' NOT NULL,
  "storage_ref" text,
  "storage_sha256" text,
  "error_code" text,
  "error_message" text,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "last_attempted_at" timestamp with time zone,
  "next_retry_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "job_id" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "candidate_memory_archives" ADD CONSTRAINT "candidate_memory_archives_twin_id_twins_id_fk" FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "candidate_memory_archives" ADD CONSTRAINT "candidate_memory_archives_source_artifact_id_source_artifacts_id_fk" FOREIGN KEY ("source_artifact_id") REFERENCES "public"."source_artifacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "candidate_memory_archives" ADD CONSTRAINT "candidate_memory_archives_memory_fragment_id_memory_fragments_id_fk" FOREIGN KEY ("memory_fragment_id") REFERENCES "public"."memory_fragments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "candidate_memories" ADD COLUMN IF NOT EXISTS "archive_status" "candidate_memory_archive_status" DEFAULT 'not_required' NOT NULL;
--> statement-breakpoint
ALTER TABLE "candidate_memories" ADD COLUMN IF NOT EXISTS "archive_id" uuid;
--> statement-breakpoint
ALTER TABLE "candidate_memories" ADD COLUMN IF NOT EXISTS "archive_error_code" text;
--> statement-breakpoint
ALTER TABLE "candidate_memories" ADD COLUMN IF NOT EXISTS "archive_error_message" text;
--> statement-breakpoint
ALTER TABLE "candidate_memories" ADD COLUMN IF NOT EXISTS "archive_attempt_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "candidate_memories" ADD COLUMN IF NOT EXISTS "archive_last_attempted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "candidate_memories" ADD COLUMN IF NOT EXISTS "archive_next_retry_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "candidate_memories" ADD COLUMN IF NOT EXISTS "archive_completed_at" timestamp with time zone;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "candidate_memories" ADD CONSTRAINT "candidate_memories_archive_id_candidate_memory_archives_id_fk" FOREIGN KEY ("archive_id") REFERENCES "public"."candidate_memory_archives"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_memory_archives_twin_id_idx" ON "candidate_memory_archives" USING btree ("twin_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_memory_archives_status_retry_idx" ON "candidate_memory_archives" USING btree ("status","next_retry_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_memory_archives_artifact_idx" ON "candidate_memory_archives" USING btree ("source_artifact_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "candidate_memory_archives_batch_sha_idx" ON "candidate_memory_archives" USING btree ("memory_fragment_id","content_sha256");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_memories_archive_status_idx" ON "candidate_memories" USING btree ("archive_status","archive_next_retry_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_memories_archive_id_idx" ON "candidate_memories" USING btree ("archive_id");
