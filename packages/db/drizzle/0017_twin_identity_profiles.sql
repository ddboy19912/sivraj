ALTER TYPE "public"."source_type" ADD VALUE IF NOT EXISTS 'onboarding_self_description';
--> statement-breakpoint
CREATE TABLE "twin_identity_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "twin_id" uuid NOT NULL,
  "display_name" text,
  "aliases" text[] DEFAULT '{}'::text[] NOT NULL,
  "emails" text[] DEFAULT '{}'::text[] NOT NULL,
  "phones" text[] DEFAULT '{}'::text[] NOT NULL,
  "handles" jsonb,
  "self_description_artifact_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "twin_identity_profiles"
ADD CONSTRAINT "twin_identity_profiles_twin_id_twins_id_fk"
FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "twin_identity_profiles"
ADD CONSTRAINT "twin_identity_profiles_self_description_artifact_id_source_artifacts_id_fk"
FOREIGN KEY ("self_description_artifact_id") REFERENCES "public"."source_artifacts"("id")
ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "twin_identity_profiles_twin_id_idx"
ON "twin_identity_profiles" USING btree ("twin_id");
