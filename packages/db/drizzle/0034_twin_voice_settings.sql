CREATE TABLE "twin_voice_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "twin_id" uuid NOT NULL,
  "wake_enabled" boolean DEFAULT false NOT NULL,
  "wake_phrase" text,
  "push_to_talk_mode" text DEFAULT 'hold' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "twin_voice_settings"
ADD CONSTRAINT "twin_voice_settings_twin_id_twins_id_fk"
FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id")
ON DELETE cascade
ON UPDATE no action;

CREATE UNIQUE INDEX "twin_voice_settings_twin_id_idx"
ON "twin_voice_settings" USING btree ("twin_id");
