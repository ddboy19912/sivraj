CREATE TYPE "public"."memory_storage_status" AS ENUM (
  'pending_upload',
  'uploaded',
  'verifying',
  'verified_available',
  'expiring_soon',
  'renewing',
  'renewed',
  'read_failed',
  'expired',
  'repairing',
  'unavailable'
);
--> statement-breakpoint
ALTER TABLE "memory_fragments" ADD COLUMN "storage_status" "memory_storage_status" DEFAULT 'verified_available' NOT NULL;
--> statement-breakpoint
ALTER TABLE "memory_fragments" ADD COLUMN "storage_provider" text DEFAULT 'walrus' NOT NULL;
--> statement-breakpoint
ALTER TABLE "memory_fragments" ADD COLUMN "walrus_network" text;
--> statement-breakpoint
ALTER TABLE "memory_fragments" ADD COLUMN "walrus_blob_id" text;
--> statement-breakpoint
ALTER TABLE "memory_fragments" ADD COLUMN "walrus_blob_object_id" text;
--> statement-breakpoint
ALTER TABLE "memory_fragments" ADD COLUMN "walrus_start_epoch" integer;
--> statement-breakpoint
ALTER TABLE "memory_fragments" ADD COLUMN "walrus_end_epoch" integer;
--> statement-breakpoint
ALTER TABLE "memory_fragments" ADD COLUMN "storage_verified_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "memory_fragments" ADD COLUMN "storage_last_read_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "memory_fragments" ADD COLUMN "storage_last_read_error_code" text;
--> statement-breakpoint
ALTER TABLE "memory_fragments" ADD COLUMN "storage_last_read_error_message" text;
--> statement-breakpoint
ALTER TABLE "memory_fragments" ADD COLUMN "storage_renewal_due_epoch" integer;
--> statement-breakpoint
ALTER TABLE "memory_fragments" ADD COLUMN "storage_renewal_attempted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "memory_fragments" ADD COLUMN "storage_repair_attempted_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "memory_fragments_storage_status_idx" ON "memory_fragments" USING btree ("storage_status");
--> statement-breakpoint
CREATE INDEX "memory_fragments_storage_renewal_due_epoch_idx" ON "memory_fragments" USING btree ("storage_renewal_due_epoch");
