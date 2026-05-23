CREATE TYPE "public"."speaker_role" AS ENUM('self', 'other', 'system', 'unknown');
--> statement-breakpoint
CREATE TABLE "source_speaker_mappings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "twin_id" uuid NOT NULL,
  "source_artifact_id" uuid NOT NULL,
  "source_speaker" text NOT NULL,
  "source_speaker_id" text,
  "role" "speaker_role" NOT NULL,
  "mapped_name" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_speaker_mappings"
ADD CONSTRAINT "source_speaker_mappings_twin_id_twins_id_fk"
FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "source_speaker_mappings"
ADD CONSTRAINT "source_speaker_mappings_source_artifact_id_source_artifacts_id_fk"
FOREIGN KEY ("source_artifact_id") REFERENCES "public"."source_artifacts"("id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "source_speaker_mappings_twin_id_idx"
ON "source_speaker_mappings" USING btree ("twin_id");
--> statement-breakpoint
CREATE INDEX "source_speaker_mappings_source_artifact_id_idx"
ON "source_speaker_mappings" USING btree ("source_artifact_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "source_speaker_mappings_artifact_speaker_idx"
ON "source_speaker_mappings" USING btree ("source_artifact_id", "source_speaker");
