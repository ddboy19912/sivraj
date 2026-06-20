CREATE TABLE IF NOT EXISTS "document_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "twin_id" uuid NOT NULL,
  "source_artifact_id" uuid NOT NULL,
  "memory_fragment_id" uuid NOT NULL,
  "chunk_index" integer NOT NULL,
  "content_storage_ref" text NOT NULL,
  "content_sha256" text NOT NULL,
  "token_count" integer NOT NULL,
  "char_start" integer NOT NULL,
  "char_end" integer NOT NULL,
  "storage_status" "memory_storage_status" DEFAULT 'verified_available' NOT NULL,
  "storage_provider" text DEFAULT 'walrus' NOT NULL,
  "walrus_network" text,
  "walrus_blob_id" text,
  "walrus_blob_object_id" text,
  "walrus_start_epoch" integer,
  "walrus_end_epoch" integer,
  "storage_verified_at" timestamp with time zone,
  "embedding_ref" text,
  "embedding" jsonb,
  "embedding_model" text,
  "embedding_provider" text,
  "embedding_generated_at" timestamp with time zone,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_twin_id_twins_id_fk" FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_source_artifact_id_source_artifacts_id_fk" FOREIGN KEY ("source_artifact_id") REFERENCES "public"."source_artifacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_memory_fragment_id_memory_fragments_id_fk" FOREIGN KEY ("memory_fragment_id") REFERENCES "public"."memory_fragments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_chunks_twin_id_idx" ON "document_chunks" USING btree ("twin_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_chunks_source_artifact_id_idx" ON "document_chunks" USING btree ("source_artifact_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_chunks_memory_fragment_id_idx" ON "document_chunks" USING btree ("memory_fragment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_chunks_storage_status_idx" ON "document_chunks" USING btree ("storage_status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_chunks_artifact_index_idx" ON "document_chunks" USING btree ("source_artifact_id","chunk_index");
