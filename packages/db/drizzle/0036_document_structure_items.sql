CREATE TABLE IF NOT EXISTS "document_structure_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "twin_id" uuid NOT NULL,
  "source_artifact_id" uuid NOT NULL,
  "memory_fragment_id" uuid NOT NULL,
  "item_type" text NOT NULL,
  "label" text NOT NULL,
  "normalized_label" text NOT NULL,
  "ordinal" integer,
  "page_start" integer,
  "page_end" integer,
  "char_start" integer,
  "char_end" integer,
  "confidence_score" double precision,
  "extraction_method" text NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "document_structure_items"
  ADD CONSTRAINT "document_structure_items_twin_id_twins_id_fk"
  FOREIGN KEY ("twin_id") REFERENCES "twins"("id") ON DELETE CASCADE;

ALTER TABLE "document_structure_items"
  ADD CONSTRAINT "document_structure_items_source_artifact_id_source_artifacts_id_fk"
  FOREIGN KEY ("source_artifact_id") REFERENCES "source_artifacts"("id") ON DELETE CASCADE;

ALTER TABLE "document_structure_items"
  ADD CONSTRAINT "document_structure_items_memory_fragment_id_memory_fragments_id_fk"
  FOREIGN KEY ("memory_fragment_id") REFERENCES "memory_fragments"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "document_structure_items_twin_id_idx"
  ON "document_structure_items" ("twin_id");

CREATE INDEX IF NOT EXISTS "document_structure_items_source_artifact_id_idx"
  ON "document_structure_items" ("source_artifact_id");

CREATE INDEX IF NOT EXISTS "document_structure_items_fragment_id_idx"
  ON "document_structure_items" ("memory_fragment_id");

CREATE INDEX IF NOT EXISTS "document_structure_items_type_idx"
  ON "document_structure_items" ("item_type");

CREATE INDEX IF NOT EXISTS "document_structure_items_page_range_idx"
  ON "document_structure_items" ("source_artifact_id", "page_start", "page_end");

CREATE UNIQUE INDEX IF NOT EXISTS "document_structure_items_artifact_type_label_idx"
  ON "document_structure_items" ("source_artifact_id", "item_type", "normalized_label", "page_start");
