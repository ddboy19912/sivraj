ALTER TABLE "graph_nodes" ADD COLUMN "normalized_name" text;

UPDATE "graph_nodes"
SET "normalized_name" = lower(regexp_replace(trim("name"), '\s+', ' ', 'g'))
WHERE "normalized_name" IS NULL;

WITH canonical_nodes AS (
  SELECT
    "id",
    first_value("id") OVER (
      PARTITION BY "twin_id", "node_type", "normalized_name"
      ORDER BY "updated_at" DESC, "created_at" ASC, "id" ASC
    ) AS "canonical_id"
  FROM "graph_nodes"
)
UPDATE "graph_edges"
SET "from_node_id" = canonical_nodes."canonical_id"
FROM canonical_nodes
WHERE "graph_edges"."from_node_id" = canonical_nodes."id"
  AND canonical_nodes."id" <> canonical_nodes."canonical_id";

WITH canonical_nodes AS (
  SELECT
    "id",
    first_value("id") OVER (
      PARTITION BY "twin_id", "node_type", "normalized_name"
      ORDER BY "updated_at" DESC, "created_at" ASC, "id" ASC
    ) AS "canonical_id"
  FROM "graph_nodes"
)
UPDATE "graph_edges"
SET "to_node_id" = canonical_nodes."canonical_id"
FROM canonical_nodes
WHERE "graph_edges"."to_node_id" = canonical_nodes."id"
  AND canonical_nodes."id" <> canonical_nodes."canonical_id";

WITH merged_edge_evidence AS (
  SELECT
    "graph_edges"."twin_id",
    "graph_edges"."from_node_id",
    "graph_edges"."to_node_id",
    "graph_edges"."edge_type",
    array_agg(DISTINCT evidence_id) FILTER (WHERE evidence_id IS NOT NULL) AS "evidence_memory_ids"
  FROM "graph_edges"
  LEFT JOIN LATERAL unnest("graph_edges"."evidence_memory_ids") AS evidence_id ON true
  GROUP BY
    "graph_edges"."twin_id",
    "graph_edges"."from_node_id",
    "graph_edges"."to_node_id",
    "graph_edges"."edge_type"
)
UPDATE "graph_edges"
SET "evidence_memory_ids" = COALESCE(
  merged_edge_evidence."evidence_memory_ids",
  '{}'::uuid[]
)
FROM merged_edge_evidence
WHERE "graph_edges"."twin_id" = merged_edge_evidence."twin_id"
  AND "graph_edges"."from_node_id" = merged_edge_evidence."from_node_id"
  AND "graph_edges"."to_node_id" = merged_edge_evidence."to_node_id"
  AND "graph_edges"."edge_type" = merged_edge_evidence."edge_type";

WITH duplicate_edges AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "twin_id", "from_node_id", "to_node_id", "edge_type"
      ORDER BY "updated_at" DESC, "created_at" ASC, "id" ASC
    ) AS "row_number"
  FROM "graph_edges"
)
DELETE FROM "graph_edges"
USING duplicate_edges
WHERE "graph_edges"."id" = duplicate_edges."id"
  AND duplicate_edges."row_number" > 1;

WITH duplicate_nodes AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "twin_id", "node_type", "normalized_name"
      ORDER BY "updated_at" DESC, "created_at" ASC, "id" ASC
    ) AS "row_number"
  FROM "graph_nodes"
)
DELETE FROM "graph_nodes"
USING duplicate_nodes
WHERE "graph_nodes"."id" = duplicate_nodes."id"
  AND duplicate_nodes."row_number" > 1;

ALTER TABLE "graph_nodes" ALTER COLUMN "normalized_name" SET NOT NULL;

CREATE UNIQUE INDEX "graph_nodes_twin_type_normalized_name_idx"
ON "graph_nodes" ("twin_id", "node_type", "normalized_name");
