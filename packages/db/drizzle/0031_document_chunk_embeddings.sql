ALTER TABLE "document_chunks" ADD COLUMN IF NOT EXISTS "embedding" jsonb;
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN IF NOT EXISTS "embedding_model" text;
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN IF NOT EXISTS "embedding_provider" text;
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN IF NOT EXISTS "embedding_generated_at" timestamp with time zone;
