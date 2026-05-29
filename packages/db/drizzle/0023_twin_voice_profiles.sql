CREATE TABLE "twin_voice_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "twin_id" uuid NOT NULL,
  "mode" text DEFAULT 'preset' NOT NULL,
  "preset_voice_id" text DEFAULT 'warm_operator' NOT NULL,
  "provider" text DEFAULT 'chatterbox_turbo' NOT NULL,
  "reference_artifact_id" uuid,
  "consent_at" timestamp with time zone,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "twin_voice_profiles"
ADD CONSTRAINT "twin_voice_profiles_twin_id_twins_id_fk"
FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "twin_voice_profiles"
ADD CONSTRAINT "twin_voice_profiles_reference_artifact_id_source_artifacts_id_fk"
FOREIGN KEY ("reference_artifact_id") REFERENCES "public"."source_artifacts"("id")
ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "twin_voice_profiles_twin_id_idx"
ON "twin_voice_profiles" USING btree ("twin_id");
