ALTER TABLE "memory_fragments" ADD COLUMN "content_storage_ref" text;
ALTER TABLE "memory_fragments" ADD COLUMN "content_sha256" text;
ALTER TABLE "memory_fragments" ADD COLUMN "metadata" jsonb;
