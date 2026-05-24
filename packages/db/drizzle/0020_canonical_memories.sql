CREATE TABLE "canonical_memories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "twin_id" uuid NOT NULL,
  "memory_type" "candidate_memory_type" NOT NULL,
  "canonical_key" text NOT NULL,
  "subject" text,
  "status" "candidate_memory_status" DEFAULT 'candidate' NOT NULL,
  "evidence_count" double precision DEFAULT 1 NOT NULL,
  "confidence_score" double precision,
  "metadata" jsonb,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "canonical_memories"
ADD CONSTRAINT "canonical_memories_twin_id_twins_id_fk"
FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id")
ON DELETE cascade ON UPDATE no action;

CREATE INDEX "canonical_memories_twin_id_idx"
ON "canonical_memories" USING btree ("twin_id");

CREATE INDEX "canonical_memories_memory_type_idx"
ON "canonical_memories" USING btree ("memory_type");

CREATE UNIQUE INDEX "canonical_memories_twin_key_idx"
ON "canonical_memories" USING btree ("twin_id","canonical_key");

ALTER TABLE "candidate_memories"
ADD COLUMN "canonical_memory_id" uuid;

ALTER TABLE "candidate_memories"
ADD CONSTRAINT "candidate_memories_canonical_memory_id_canonical_memories_id_fk"
FOREIGN KEY ("canonical_memory_id") REFERENCES "public"."canonical_memories"("id")
ON DELETE set null ON UPDATE no action;

CREATE INDEX "candidate_memories_canonical_memory_id_idx"
ON "candidate_memories" USING btree ("canonical_memory_id");
