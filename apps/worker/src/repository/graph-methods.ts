import { and, eq } from "drizzle-orm";
import { graphEdges, graphNodes, type Db } from "@sivraj/db";
import type { ArtifactRepository } from "../types/ingestion.types.js";
import { maxNullableNumber } from "./canonical-memory.js";
import { mergeGraphNodeProperties, normalizeGraphNodeName } from "./graph-helpers.js";

type UpsertGraphNodeInput = Parameters<ArtifactRepository["upsertGraphNode"]>[0];

async function upsertGraphNode(
  db: Db,
  input: UpsertGraphNodeInput,
) {
  const normalizedName = input.normalizedName ?? normalizeGraphNodeName(input.name);
  const [existing] = await db
    .select({
      id: graphNodes.id,
      name: graphNodes.name,
      description: graphNodes.description,
      properties: graphNodes.properties,
      confidenceScore: graphNodes.confidenceScore,
    })
    .from(graphNodes)
    .where(
      and(
        eq(graphNodes.twinId, input.twinId),
        eq(graphNodes.nodeType, input.nodeType),
        eq(graphNodes.normalizedName, normalizedName),
      ),
    )
    .limit(1);

  if (existing) {
    return updateExistingGraphNode(db, existing, input);
  }

  return insertGraphNode(db, input, normalizedName);
}

async function upsertGraphEdge(
  db: Db,
  input: {
    twinId: string;
    fromNodeId: string;
    toNodeId: string;
    edgeType: string;
    description?: string | null;
    evidenceMemoryIds: string[];
    confidenceScore: number;
  },
) {
  const [existing] = await db
    .select({
      id: graphEdges.id,
      evidenceMemoryIds: graphEdges.evidenceMemoryIds,
    })
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.twinId, input.twinId),
        eq(graphEdges.fromNodeId, input.fromNodeId),
        eq(graphEdges.toNodeId, input.toNodeId),
        eq(graphEdges.edgeType, input.edgeType),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(graphEdges)
      .set({
        evidenceMemoryIds: Array.from(new Set([
          ...existing.evidenceMemoryIds,
          ...input.evidenceMemoryIds,
        ])),
        confidenceScore: input.confidenceScore,
        updatedAt: new Date(),
      })
      .where(eq(graphEdges.id, existing.id));

    return { id: existing.id };
  }

  return insertGraphEdge(db, input);
}

export function createGraphMethods(db: Db) {
  return {
    upsertGraphNode: (input: Parameters<typeof upsertGraphNode>[1]) => upsertGraphNode(db, input),
    upsertGraphEdge: (input: Parameters<typeof upsertGraphEdge>[1]) => upsertGraphEdge(db, input),
  };
}

async function updateExistingGraphNode(
  db: Db,
  existing: {
    id: string;
    description: string | null;
    properties: unknown;
    confidenceScore: number | null;
  },
  input: {
    description?: string | null;
    properties: Record<string, unknown>;
    confidenceScore: number;
  },
) {
  const mergedProperties = mergeGraphNodeProperties(existing.properties, input.properties);
  const confidenceScore = maxNullableNumber(existing.confidenceScore, input.confidenceScore);
  const description = mergeGraphNodeDescription(existing.description, input.description);

  await db
    .update(graphNodes)
    .set({
      description,
      properties: mergedProperties,
      confidenceScore,
      updatedAt: new Date(),
    })
    .where(eq(graphNodes.id, existing.id));

  return existing;
}

function mergeGraphNodeDescription(
  existing: string | null,
  incoming: string | null | undefined,
) {
  const existingDescription = existing?.trim();
  if (existingDescription) {
    return existing;
  }

  const incomingDescription = incoming?.trim();
  return incomingDescription ? incomingDescription : existing;
}

async function insertGraphNode(
  db: Db,
  input: UpsertGraphNodeInput,
  normalizedName: string,
) {
  const [node] = await db
    .insert(graphNodes)
    .values({
      twinId: input.twinId,
      nodeType: input.nodeType,
      name: input.name,
      normalizedName,
      description: input.description ?? null,
      properties: mergeGraphNodeProperties(null, input.properties),
      confidenceScore: input.confidenceScore,
    })
    .returning({ id: graphNodes.id });

  if (!node) {
    throw new Error("Failed to create graph node");
  }

  return node;
}

async function insertGraphEdge(
  db: Db,
  input: {
    twinId: string;
    fromNodeId: string;
    toNodeId: string;
    edgeType: string;
    description?: string | null;
    evidenceMemoryIds: string[];
    confidenceScore: number;
  },
) {
  const [edge] = await db
    .insert(graphEdges)
    .values({
      twinId: input.twinId,
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      edgeType: input.edgeType,
      description: input.description ?? null,
      evidenceMemoryIds: input.evidenceMemoryIds,
      confidenceScore: input.confidenceScore,
    })
    .returning({ id: graphEdges.id });

  if (!edge) {
    throw new Error("Failed to create graph edge");
  }

  return edge;
}
