import { candidateMemories, graphEdges, graphNodes } from "@sivraj/db";
import type { MemorySearchConfig } from "@sivraj/config";
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { AppDependencies } from "../../app.js";
import { escapeLike } from "./helpers.js";

export async function loadShortlistedMemoryFragmentIds(input: {
  db: AppDependencies["db"];
  twinId: string;
  queryTerms: string[];
  config: MemorySearchConfig;
}): Promise<string[]> {
  const terms = input.queryTerms.slice(0, 8);

  if (terms.length === 0) {
    return [];
  }

  const memoryIds = new Set<string>();
  const graphIds = await loadGraphMatchedFragmentIds(input, terms);
  graphIds.forEach((id) => memoryIds.add(id));
  const candidateIds = await loadCandidateMatchedFragmentIds(input, terms);
  candidateIds.forEach((id) => memoryIds.add(id));

  return Array.from(memoryIds);
}

async function loadGraphMatchedFragmentIds(
  input: {
    db: AppDependencies["db"];
    twinId: string;
    config: MemorySearchConfig;
  },
  terms: string[],
) {
  const matchedNodes = await input.db
    .select({ id: graphNodes.id })
    .from(graphNodes)
    .where(
      and(
        eq(graphNodes.twinId, input.twinId),
        or(...terms.map((term) => graphNodeMatchesTerm(term))),
      ),
    )
    .limit(input.config.shortlistLimit);
  const matchedNodeIds = matchedNodes.map((node) => node.id);
  const memoryIds = new Set<string>();

  if (matchedNodeIds.length === 0) {
    return memoryIds;
  }

  const edges = await input.db
    .select({ evidenceMemoryIds: graphEdges.evidenceMemoryIds })
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.twinId, input.twinId),
        or(
          inArray(graphEdges.fromNodeId, matchedNodeIds),
          inArray(graphEdges.toNodeId, matchedNodeIds),
        ),
      ),
    )
    .limit(input.config.shortlistLimit * 4);

  for (const edge of edges) {
    for (const memoryId of edge.evidenceMemoryIds) {
      memoryIds.add(memoryId);
    }
  }

  return memoryIds;
}

async function loadCandidateMatchedFragmentIds(
  input: {
    db: AppDependencies["db"];
    twinId: string;
    config: MemorySearchConfig;
  },
  terms: string[],
) {
  const matchedCandidateMemories = await input.db
    .select({ memoryFragmentId: candidateMemories.memoryFragmentId })
    .from(candidateMemories)
    .where(
      and(
        eq(candidateMemories.twinId, input.twinId),
        ne(candidateMemories.status, "superseded"),
        or(...terms.map((term) => candidateMemoryMatchesTerm(term))),
      ),
    )
    .limit(input.config.shortlistLimit);

  return matchedCandidateMemories.map((candidate) => candidate.memoryFragmentId);
}

function graphNodeMatchesTerm(term: string) {
  const pattern = `%${escapeLike(term)}%`;

  return sql`lower(${graphNodes.name}) like ${pattern} escape '\\' or lower(${graphNodes.normalizedName}) like ${pattern} escape '\\'`;
}

function candidateMemoryMatchesTerm(term: string) {
  const pattern = `%${escapeLike(term)}%`;

  return sql`lower(coalesce(${candidateMemories.metadata}->>'subject', '')) like ${pattern} escape '\\'`;
}
