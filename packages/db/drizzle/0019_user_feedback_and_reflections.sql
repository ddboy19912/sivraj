CREATE TYPE "public"."feedback_target_type" AS ENUM('candidate_memory', 'graph_node', 'pattern', 'insight', 'reflection', 'source_artifact');
CREATE TYPE "public"."feedback_type" AS ENUM('useful', 'wrong', 'not_me', 'too_generic', 'too_sensitive', 'approved', 'rejected', 'edited_later');
CREATE TYPE "public"."reflection_status" AS ENUM('queued', 'processing', 'completed', 'failed', 'skipped');

CREATE TABLE "user_feedback_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "twin_id" uuid NOT NULL,
  "target_type" "feedback_target_type" NOT NULL,
  "target_id" uuid NOT NULL,
  "feedback_type" "feedback_type" NOT NULL,
  "actor_type" text DEFAULT 'user' NOT NULL,
  "actor_id" text NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "reflection_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "twin_id" uuid NOT NULL,
  "period_start" timestamp with time zone NOT NULL,
  "period_end" timestamp with time zone NOT NULL,
  "status" "reflection_status" NOT NULL,
  "summary_storage_ref" text,
  "summary_sha256" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "user_feedback_events" ADD CONSTRAINT "user_feedback_events_twin_id_twins_id_fk" FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "reflection_runs" ADD CONSTRAINT "reflection_runs_twin_id_twins_id_fk" FOREIGN KEY ("twin_id") REFERENCES "public"."twins"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX "user_feedback_events_twin_id_idx" ON "user_feedback_events" USING btree ("twin_id");
CREATE INDEX "user_feedback_events_target_idx" ON "user_feedback_events" USING btree ("target_type","target_id");
CREATE INDEX "user_feedback_events_feedback_type_idx" ON "user_feedback_events" USING btree ("feedback_type");
CREATE INDEX "user_feedback_events_created_at_idx" ON "user_feedback_events" USING btree ("created_at");
CREATE INDEX "reflection_runs_twin_id_idx" ON "reflection_runs" USING btree ("twin_id");
CREATE INDEX "reflection_runs_period_idx" ON "reflection_runs" USING btree ("period_start","period_end");
CREATE INDEX "reflection_runs_status_idx" ON "reflection_runs" USING btree ("status");
