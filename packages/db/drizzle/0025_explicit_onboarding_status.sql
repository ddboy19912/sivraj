CREATE TYPE "public"."onboarding_status" AS ENUM('not_started', 'in_progress', 'completed');
--> statement-breakpoint
ALTER TABLE "users"
ADD COLUMN "onboarding_status" "onboarding_status" DEFAULT 'not_started' NOT NULL;
