CREATE TYPE "public"."first_meet_intro_status" AS ENUM('not_started', 'issued', 'consumed');
--> statement-breakpoint
ALTER TABLE "users"
ADD COLUMN "first_meet_intro_status" "first_meet_intro_status" DEFAULT 'not_started' NOT NULL;
--> statement-breakpoint
UPDATE "users"
SET "first_meet_intro_status" = 'consumed'
WHERE "onboarding_status" = 'completed';
