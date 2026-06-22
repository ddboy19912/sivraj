CREATE TYPE "public"."context_runtime_packet_kind" AS ENUM(
  'core_profile',
  'personal_hot_memory',
  'engineering_context',
  'document_inventory',
  'active_session',
  'surface_warmup'
);

CREATE TYPE "public"."context_runtime_packet_status" AS ENUM(
  'ready',
  'stale',
  'refreshing',
  'failed'
);

CREATE TABLE "context_runtime_packets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "twin_id" uuid NOT NULL,
  "kind" "context_runtime_packet_kind" NOT NULL,
  "scope_key" text NOT NULL,
  "status" "context_runtime_packet_status" DEFAULT 'ready' NOT NULL,
  "payload" jsonb,
  "source_refs" jsonb,
  "version_hash" text NOT NULL,
  "generated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "stale_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "context_runtime_packets"
ADD CONSTRAINT "context_runtime_packets_twin_id_twins_id_fk"
FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id")
ON DELETE cascade ON UPDATE no action;

CREATE INDEX "context_runtime_packets_twin_id_idx"
ON "context_runtime_packets" USING btree ("twin_id");

CREATE INDEX "context_runtime_packets_kind_idx"
ON "context_runtime_packets" USING btree ("kind");

CREATE INDEX "context_runtime_packets_status_idx"
ON "context_runtime_packets" USING btree ("status");

CREATE INDEX "context_runtime_packets_expires_at_idx"
ON "context_runtime_packets" USING btree ("expires_at");

CREATE UNIQUE INDEX "context_runtime_packets_twin_kind_scope_idx"
ON "context_runtime_packets" USING btree ("twin_id","kind","scope_key");
