CREATE TYPE "public"."candidate_memory_type" AS ENUM(
  'fact',
  'preference',
  'goal',
  'decision',
  'commitment',
  'experience',
  'project_update',
  'relationship',
  'other'
);

CREATE TYPE "public"."candidate_memory_status" AS ENUM(
  'candidate',
  'approved',
  'rejected',
  'superseded'
);

CREATE TABLE "candidate_memories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "twin_id" uuid NOT NULL,
  "source_artifact_id" uuid NOT NULL,
  "memory_fragment_id" uuid NOT NULL,
  "memory_type" "candidate_memory_type" NOT NULL,
  "status" "candidate_memory_status" DEFAULT 'candidate' NOT NULL,
  "statement_storage_ref" text NOT NULL,
  "statement_sha256" text NOT NULL,
  "evidence_hash" text NOT NULL,
  "evidence_length" double precision,
  "confidence_score" double precision,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "candidate_memories"
ADD CONSTRAINT "candidate_memories_twin_id_twins_id_fk"
FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id")
ON DELETE cascade ON UPDATE no action;

ALTER TABLE "candidate_memories"
ADD CONSTRAINT "candidate_memories_source_artifact_id_source_artifacts_id_fk"
FOREIGN KEY ("source_artifact_id") REFERENCES "public"."source_artifacts"("id")
ON DELETE cascade ON UPDATE no action;

ALTER TABLE "candidate_memories"
ADD CONSTRAINT "candidate_memories_memory_fragment_id_memory_fragments_id_fk"
FOREIGN KEY ("memory_fragment_id") REFERENCES "public"."memory_fragments"("id")
ON DELETE cascade ON UPDATE no action;

CREATE INDEX "candidate_memories_twin_id_idx"
ON "candidate_memories" USING btree ("twin_id");

CREATE INDEX "candidate_memories_source_artifact_id_idx"
ON "candidate_memories" USING btree ("source_artifact_id");

CREATE INDEX "candidate_memories_memory_fragment_id_idx"
ON "candidate_memories" USING btree ("memory_fragment_id");

CREATE INDEX "candidate_memories_status_idx"
ON "candidate_memories" USING btree ("status");

CREATE UNIQUE INDEX "candidate_memories_fragment_type_evidence_idx"
ON "candidate_memories" USING btree (
  "memory_fragment_id",
  "memory_type",
  "evidence_hash"
);
