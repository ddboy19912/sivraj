import { graphEdges, graphNodes, memoryFragments } from "@sivraj/db";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AppDependencies } from "../app.js";
import {
  artifactScopedGraphNodeName,
  collectArtifactScopedGraphIds,
} from "../lib/graph/scoped-loader.js";
import { recordMetadata, sanitizeSafeMetadata } from "../lib/safe-metadata.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { authorizeTwinRoute } from "../lib/http/route-auth.js";
import { readOptionalQueryUuid, readQueryLimit, selectOrderedGraphNodes } from "../lib/http/route-helpers.js";

const GRAPH_NODE_TYPES = [
  "person",
  "organization",
  "project",
  "concept",
  "event",
  "artifact",
  "goal",
  "decision",
  "topic",
  "other",
] as const;

type GraphNodeType = typeof GRAPH_NODE_TYPES[number];

export function createGraphRoutes({ db }: AppDependencies) {
  const routes = new Hono<AuthEnv>();

  routes.get("/", requireAuth, async (c) => {
    const routeAuth = authorizeTwinRoute(c, "memory:read");
    if (!routeAuth.ok) {
      return routeAuth.response;
    }
    const { twinId } = routeAuth.value;

    const nodeType = readNodeType(c.req.query("nodeType"));
    const artifactId = readOptionalQueryUuid(c.req.query("artifactId"));
    const limit = readQueryLimit(c.req.query("limit"), 100, 500);

    const graph = artifactId
      ? await loadArtifactScopedGraph({
          db,
          twinId,
          artifactId,
          nodeType,
          limit,
        })
      : await loadTwinGraph({
          db,
          twinId,
          nodeType,
          limit,
        });

    return c.json({
      policy: {
        rawArtifactsIncluded: false,
        scope: "memory:read",
      },
      nodes: graph.nodes.map(formatNode),
      edges: graph.edges.map(formatEdge),
    });
  });

  return routes;
}

async function loadTwinGraph(input: {
  db: AppDependencies["db"];
  twinId: string;
  nodeType: GraphNodeType | null;
  limit: number;
}) {
  const nodeRows = await selectOrderedGraphNodes({
    db: input.db,
    twinId: input.twinId,
    nodeType: input.nodeType,
    limit: input.limit,
  });

  const nodeIds = nodeRows.map((node) => node.id);
  const edgeRows = nodeIds.length === 0
    ? []
    : await input.db
      .select()
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.twinId, input.twinId),
          or(
            inArray(graphEdges.fromNodeId, nodeIds),
            inArray(graphEdges.toNodeId, nodeIds),
          ),
        ),
      )
      .orderBy(desc(graphEdges.updatedAt))
      .limit(input.limit);

  return {
    nodes: nodeRows,
    edges: edgeRows,
  };
}

async function loadArtifactScopedGraph(input: {
  db: AppDependencies["db"];
  twinId: string;
  artifactId: string;
  nodeType: GraphNodeType | null;
  limit: number;
}) {
  const memoryFragment = await findMemoryFragment(input.db, input.twinId, input.artifactId);

  const artifactNodes = await input.db
    .select({ id: graphNodes.id })
    .from(graphNodes)
    .where(
      and(
        eq(graphNodes.twinId, input.twinId),
        eq(graphNodes.normalizedName, artifactScopedGraphNodeName(input.artifactId)),
      ),
    );

  const propertyLinkedNodes = await input.db
    .select({ id: graphNodes.id })
    .from(graphNodes)
    .where(
      and(
        eq(graphNodes.twinId, input.twinId),
        or(
          sql`${graphNodes.properties}->>'sourceArtifactId' = ${input.artifactId}`,
          sql`${graphNodes.properties}->'sourceArtifactIds' ? ${input.artifactId}`,
        ),
      ),
    );

  const evidenceEdges = memoryFragment
    ? await input.db
      .select()
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.twinId, input.twinId),
          sql`${memoryFragment.id} = ANY(${graphEdges.evidenceMemoryIds})`,
        ),
      )
    : [];

  const artifactNodeIds = artifactNodes.map((node) => node.id);
  const connectedEdges = artifactNodeIds.length > 0
    ? await input.db
      .select()
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.twinId, input.twinId),
          or(
            inArray(graphEdges.fromNodeId, artifactNodeIds),
            inArray(graphEdges.toNodeId, artifactNodeIds),
          ),
        ),
      )
    : [];
  const { scopedNodeIds, scopedEdgeIds } = collectArtifactScopedGraphIds({
    artifactId: input.artifactId,
    artifactNodeIds,
    propertyLinkedNodeIds: propertyLinkedNodes.map((node) => node.id),
    evidenceEdges,
    connectedEdges,
  });

  const nodeIdArray = Array.from(scopedNodeIds);

  if (nodeIdArray.length === 0) {
    return {
      nodes: [],
      edges: [],
    };
  }

  const nodeRows = await selectOrderedGraphNodes({
    db: input.db,
    twinId: input.twinId,
    nodeType: input.nodeType,
    nodeIds: nodeIdArray,
    limit: input.limit,
  });

  const visibleNodeIds = nodeRows.map((node) => node.id);

  if (visibleNodeIds.length === 0) {
    return {
      nodes: [],
      edges: [],
    };
  }

  const edgeRows = await input.db
    .select()
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.twinId, input.twinId),
        or(
          inArray(graphEdges.fromNodeId, visibleNodeIds),
          inArray(graphEdges.toNodeId, visibleNodeIds),
        ),
        ...(scopedEdgeIds.size > 0 ? [inArray(graphEdges.id, Array.from(scopedEdgeIds))] : []),
      ),
    )
    .orderBy(desc(graphEdges.updatedAt))
    .limit(input.limit);

  return {
    nodes: nodeRows,
    edges: edgeRows,
  };
}

async function findMemoryFragment(
  db: AppDependencies["db"],
  twinId: string,
  sourceArtifactId: string,
) {
  const [fragment] = await db
    .select({ id: memoryFragments.id })
    .from(memoryFragments)
    .where(
      and(
        eq(memoryFragments.twinId, twinId),
        eq(memoryFragments.sourceArtifactId, sourceArtifactId),
      ),
    )
    .limit(1);

  return fragment ?? null;
}

function formatNode(node: typeof graphNodes.$inferSelect) {
  return {
    id: node.id,
    twinId: node.twinId,
    nodeType: node.nodeType,
    name: node.name,
    normalizedName: node.normalizedName,
    description: node.description,
    properties: sanitizeSafeMetadata(node.properties),
    confidenceScore: node.confidenceScore,
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
  };
}

function formatEdge(edge: typeof graphEdges.$inferSelect) {
  return {
    id: edge.id,
    twinId: edge.twinId,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
    edgeType: edge.edgeType,
    description: edge.description,
    evidenceMemoryIds: edge.evidenceMemoryIds,
    confidenceScore: edge.confidenceScore,
    createdAt: edge.createdAt.toISOString(),
    updatedAt: edge.updatedAt.toISOString(),
  };
}

function readNodeType(value: string | undefined): GraphNodeType | null {
  return value && GRAPH_NODE_TYPES.includes(value as GraphNodeType)
    ? value as GraphNodeType
    : null;
}

