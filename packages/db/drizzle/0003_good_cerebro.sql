DROP INDEX "memory_fragments_source_artifact_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "memory_fragments_source_artifact_id_idx" ON "memory_fragments" USING btree ("source_artifact_id");