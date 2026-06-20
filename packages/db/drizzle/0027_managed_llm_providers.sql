ALTER TABLE "llm_provider_configs"
ADD COLUMN "is_active" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "llm_provider_configs"
SET "is_active" = true
WHERE "status" = 'connected';
--> statement-breakpoint
DROP INDEX IF EXISTS "llm_provider_configs_twin_id_idx";
--> statement-breakpoint
CREATE INDEX "llm_provider_configs_twin_id_idx"
ON "llm_provider_configs" USING btree ("twin_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "llm_provider_configs_active_twin_idx"
ON "llm_provider_configs" USING btree ("twin_id")
WHERE "is_active" = true;
