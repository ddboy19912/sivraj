import { candidateMemories, canonicalMemories } from "@sivraj/db";
import { and, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import type { AppDependencies } from "../../app.js";
import { recordMetadata } from "../safe-metadata.js";

type GraphContextNode = {
  id: string;
  nodeType: string;
  name: string;
  normalizedName?: string | null;
  properties: unknown;
};

type GraphContextEdge = {
  fromNodeId: string;
  toNodeId: string;
  evidenceMemoryIds?: string[] | null;
};

type CandidateMemoryRow = typeof candidateMemories.$inferSelect;
type CanonicalMemoryRow = typeof canonicalMemories.$inferSelect;

type NodeContextKeys = {
  candidateMemoryIds: string[];
  canonicalMemoryIds: string[];
  memoryFragmentIds: string[];
  sourceArtifactIds: string[];
};

export type GraphCanonicalMemoryContext = {
  id: string;
  candidateMemoryId: string | null;
  memoryType: string;
  subject: string | null;
  summary: string;
  canonicalKey: string;
  status: string;
  sourceType: string | null;
  sourceArtifactIds: string[];
  memoryFragmentIds: string[];
  evidenceCount: number;
  confidenceScore: number | null;
  createdAt: string;
  updatedAt: string;
};

type CandidateContextMatch = {
  candidate: CandidateMemoryRow | null;
  canonical: CanonicalMemoryRow;
  score: number;
};

const MAX_CONTEXTS_PER_NODE = 3;

export async function loadGraphCanonicalMemoryContexts(input: {
  db: AppDependencies["db"];
  twinId: string;
  nodes: GraphContextNode[];
  edges: GraphContextEdge[];
}): Promise<Map<string, GraphCanonicalMemoryContext[]>> {
  const contextKeys = collectGraphNodeContextKeys(input.nodes, input.edges);
  const aggregateKeys = aggregateContextKeys(contextKeys);
  const candidateRows = await loadCandidateRows({
    db: input.db,
    twinId: input.twinId,
    keys: aggregateKeys,
  });
  const candidateRowsById = new Map(candidateRows.map((row) => [row.id, row]));
  const canonicalIds = unique([
    ...aggregateKeys.canonicalMemoryIds,
    ...candidateRows
      .map((row) => row.canonicalMemoryId)
      .filter((id): id is string => Boolean(id)),
  ]);
  const canonicalRows = await loadCanonicalRows(input.db, input.twinId, canonicalIds);
  const canonicalRowsById = new Map(canonicalRows.map((row) => [row.id, row]));
  const contextsByNodeId = new Map<string, GraphCanonicalMemoryContext[]>();

  for (const node of input.nodes) {
    const keys = contextKeys.get(node.id) ?? emptyNodeContextKeys();
    const matches = collectNodeContextMatches({
      node,
      keys,
      candidateRows,
      candidateRowsById,
      canonicalRowsById,
    });

    if (matches.length > 0) {
      contextsByNodeId.set(
        node.id,
        [...matches]
          .sort(compareCandidateContextMatches)
          .slice(0, MAX_CONTEXTS_PER_NODE)
          .map(formatGraphCanonicalMemoryContext),
      );
    }
  }

  return contextsByNodeId;
}

export function collectGraphNodeContextKeys(
  nodes: GraphContextNode[],
  edges: GraphContextEdge[],
): Map<string, NodeContextKeys> {
  const keysByNodeId = new Map<string, NodeContextKeys>();

  for (const node of nodes) {
    const properties = recordMetadata(node.properties);
    const keys = ensureNodeContextKeys(keysByNodeId, node.id);
    addUnique(keys.candidateMemoryIds, readString(properties["candidateMemoryId"]));
    addUniqueList(keys.candidateMemoryIds, readStringArray(properties["candidateMemoryIds"]));
    addUnique(keys.canonicalMemoryIds, readString(properties["canonicalMemoryId"]));
    addUniqueList(keys.canonicalMemoryIds, readStringArray(properties["canonicalMemoryIds"]));
    addUnique(keys.memoryFragmentIds, readString(properties["memoryFragmentId"]));
    addUniqueList(keys.memoryFragmentIds, readStringArray(properties["memoryFragmentIds"]));
    addUnique(keys.sourceArtifactIds, readString(properties["sourceArtifactId"]));
    addUniqueList(keys.sourceArtifactIds, readStringArray(properties["sourceArtifactIds"]));
  }

  for (const edge of edges) {
    const evidenceIds = Array.isArray(edge.evidenceMemoryIds)
      ? edge.evidenceMemoryIds.filter((id) => typeof id === "string" && id.length > 0)
      : [];

    if (evidenceIds.length === 0) {
      continue;
    }

    addUniqueList(ensureNodeContextKeys(keysByNodeId, edge.fromNodeId).memoryFragmentIds, evidenceIds);
    addUniqueList(ensureNodeContextKeys(keysByNodeId, edge.toNodeId).memoryFragmentIds, evidenceIds);
  }

  return keysByNodeId;
}

export function scoreCandidateMemoryForGraphNode(input: {
  node: GraphContextNode;
  candidate: Pick<CandidateMemoryRow, "memoryType" | "metadata">;
  canonical: Pick<CanonicalMemoryRow, "canonicalKey" | "memoryType" | "metadata" | "subject">;
}): number {
  const nodeTerms = collectNodeTerms(input.node);
  const searchableMemoryText = normalizeSearchText([
    input.candidate.memoryType,
    input.canonical.memoryType,
    input.canonical.canonicalKey,
    input.canonical.subject,
    readCanonicalContextSummary(input.candidate.metadata, input.canonical.metadata, input.canonical.subject, input.canonical.memoryType),
    readString(recordMetadata(input.candidate.metadata)["subject"]),
    readString(recordMetadata(input.candidate.metadata)["engineeringSubject"]),
  ].filter(Boolean).join(" "));

  if (!searchableMemoryText || nodeTerms.length === 0) {
    return 0;
  }

  let score = 0;

  for (const term of nodeTerms) {
    if (term.length >= 4 && searchableMemoryText.includes(term)) {
      score += term.includes(" ") ? 6 : 3;
      continue;
    }

    const words = term.split(" ").filter((word) => word.length >= 4);
    const matches = words.filter((word) => searchableMemoryText.includes(word)).length;
    score += matches;
  }

  return score;
}

export function formatGraphCanonicalMemoryContext(
  match: Pick<CandidateContextMatch, "candidate" | "canonical">,
): GraphCanonicalMemoryContext {
  const canonicalMetadata = recordMetadata(match.canonical.metadata);
  const candidateMetadata = recordMetadata(match.candidate?.metadata);
  const sourceArtifactIds = unique([
    ...(match.candidate ? [match.candidate.sourceArtifactId] : []),
    ...readStringArray(canonicalMetadata["sourceArtifactIds"]),
  ]);
  const memoryFragmentIds = unique([
    ...(match.candidate ? [match.candidate.memoryFragmentId] : []),
    ...readStringArray(canonicalMetadata["memoryFragmentIds"]),
  ]);

  return {
    id: match.canonical.id,
    candidateMemoryId: match.candidate?.id ?? null,
    memoryType: match.canonical.memoryType,
    subject: match.canonical.subject,
    summary: readCanonicalContextSummary(
      candidateMetadata,
      canonicalMetadata,
      match.canonical.subject,
      match.canonical.memoryType,
    ),
    canonicalKey: match.canonical.canonicalKey,
    status: match.canonical.status,
    sourceType: readString(candidateMetadata["sourceType"]) ?? readString(canonicalMetadata["sourceType"]),
    sourceArtifactIds,
    memoryFragmentIds,
    evidenceCount: match.canonical.evidenceCount,
    confidenceScore: match.canonical.confidenceScore,
    createdAt: match.canonical.createdAt.toISOString(),
    updatedAt: match.canonical.updatedAt.toISOString(),
  };
}

function collectNodeContextMatches(input: {
  node: GraphContextNode;
  keys: NodeContextKeys;
  candidateRows: CandidateMemoryRow[];
  candidateRowsById: Map<string, CandidateMemoryRow>;
  canonicalRowsById: Map<string, CanonicalMemoryRow>;
}): CandidateContextMatch[] {
  const matchesByCanonicalId = new Map<string, CandidateContextMatch>();
  const directCandidateIds = new Set(input.keys.candidateMemoryIds);
  const directCanonicalIds = new Set(input.keys.canonicalMemoryIds);
  const sourceArtifactIds = new Set(input.keys.sourceArtifactIds);
  const memoryFragmentIds = new Set(input.keys.memoryFragmentIds);

  for (const canonicalId of directCanonicalIds) {
    const canonical = input.canonicalRowsById.get(canonicalId);
    if (canonical) {
      keepBestMatch(matchesByCanonicalId, {
        canonical,
        candidate: null,
        score: 90,
      });
    }
  }

  for (const candidateId of directCandidateIds) {
    const candidate = input.candidateRowsById.get(candidateId);
    const canonical = candidate?.canonicalMemoryId
      ? input.canonicalRowsById.get(candidate.canonicalMemoryId)
      : null;

    if (candidate && canonical) {
      keepBestMatch(matchesByCanonicalId, {
        candidate,
        canonical,
        score: 100,
      });
    }
  }

  for (const candidate of input.candidateRows) {
    const canonical = candidate.canonicalMemoryId
      ? input.canonicalRowsById.get(candidate.canonicalMemoryId)
      : null;

    if (!canonical) {
      continue;
    }

    const isDirectCanonical = directCanonicalIds.has(canonical.id);
    const isDirectCandidate = directCandidateIds.has(candidate.id);
    const sharesSource = sourceArtifactIds.has(candidate.sourceArtifactId);
    const sharesFragment = memoryFragmentIds.has(candidate.memoryFragmentId);

    if (!isDirectCandidate && !isDirectCanonical && !sharesSource && !sharesFragment) {
      continue;
    }

    const score = isDirectCandidate || isDirectCanonical
      ? 100
      : scoreCandidateMemoryForGraphNode({
          node: input.node,
          candidate,
          canonical,
        });

    if (shouldKeepCandidateMatch(input.node, score, sharesSource || sharesFragment)) {
      keepBestMatch(matchesByCanonicalId, { candidate, canonical, score });
    }
  }

  return Array.from(matchesByCanonicalId.values());
}

function shouldKeepCandidateMatch(
  node: GraphContextNode,
  score: number,
  sharesEvidenceSource: boolean,
) {
  if (score >= 2) {
    return true;
  }

  return sharesEvidenceSource && (node.nodeType === "artifact" || node.name.startsWith("source_artifact:"));
}

function keepBestMatch(
  matchesByCanonicalId: Map<string, CandidateContextMatch>,
  match: CandidateContextMatch,
) {
  const existing = matchesByCanonicalId.get(match.canonical.id);
  if (!existing || compareCandidateContextMatches(match, existing) < 0) {
    matchesByCanonicalId.set(match.canonical.id, match);
  }
}

function compareCandidateContextMatches(a: CandidateContextMatch, b: CandidateContextMatch) {
  if (a.score !== b.score) {
    return b.score - a.score;
  }

  return b.canonical.updatedAt.getTime() - a.canonical.updatedAt.getTime();
}

async function loadCandidateRows(input: {
  db: AppDependencies["db"];
  twinId: string;
  keys: NodeContextKeys;
}) {
  const relationFilters: SQL[] = [];

  if (input.keys.candidateMemoryIds.length > 0) {
    relationFilters.push(inArray(candidateMemories.id, input.keys.candidateMemoryIds));
  }

  if (input.keys.memoryFragmentIds.length > 0) {
    relationFilters.push(inArray(candidateMemories.memoryFragmentId, input.keys.memoryFragmentIds));
  }

  if (input.keys.sourceArtifactIds.length > 0) {
    relationFilters.push(inArray(candidateMemories.sourceArtifactId, input.keys.sourceArtifactIds));
  }

  if (relationFilters.length === 0) {
    return [];
  }

  const relationFilter = relationFilters.length === 1
    ? relationFilters[0]!
    : or(...relationFilters)!;

  return input.db
    .select()
    .from(candidateMemories)
    .where(and(
      eq(candidateMemories.twinId, input.twinId),
      relationFilter,
    ))
    .orderBy(desc(candidateMemories.updatedAt))
    .limit(2_000);
}

async function loadCanonicalRows(
  db: AppDependencies["db"],
  twinId: string,
  canonicalMemoryIds: string[],
) {
  if (canonicalMemoryIds.length === 0) {
    return [];
  }

  return db
    .select()
    .from(canonicalMemories)
    .where(and(
      eq(canonicalMemories.twinId, twinId),
      inArray(canonicalMemories.id, canonicalMemoryIds),
    ));
}

function readCanonicalContextSummary(
  candidateMetadata: unknown,
  canonicalMetadata: unknown,
  subject: string | null,
  memoryType: string,
) {
  const candidate = recordMetadata(candidateMetadata);
  const canonical = recordMetadata(canonicalMetadata);
  const currentTruth = recordMetadata(canonical["currentTruth"]);

  return readString(candidate["agentContextLine"])
    ?? readString(recordMetadata(candidate["engineeringMetadata"])["agentContextLine"])
    ?? readString(canonical["agentContextLine"])
    ?? readString(currentTruth["value"])
    ?? (subject
      ? `${formatMemoryType(memoryType)} memory about ${subject}.`
      : `${formatMemoryType(memoryType)} memory connected to this graph point.`);
}

function collectNodeTerms(node: GraphContextNode) {
  const properties = recordMetadata(node.properties);

  return unique([
    node.name,
    node.normalizedName ?? "",
    readString(properties["subject"]),
    readString(properties["normalizedSubject"]),
  ])
    .flatMap((term) => splitTechnicalGraphName(term))
    .map(normalizeSearchText)
    .filter((term) => term.length >= 3);
}

function splitTechnicalGraphName(value: string) {
  if (value.includes(":")) {
    return value.split(":").filter(Boolean);
  }

  return [value];
}

function aggregateContextKeys(contextKeys: Map<string, NodeContextKeys>): NodeContextKeys {
  const aggregate = emptyNodeContextKeys();

  for (const keys of contextKeys.values()) {
    addUniqueList(aggregate.candidateMemoryIds, keys.candidateMemoryIds);
    addUniqueList(aggregate.canonicalMemoryIds, keys.canonicalMemoryIds);
    addUniqueList(aggregate.memoryFragmentIds, keys.memoryFragmentIds);
    addUniqueList(aggregate.sourceArtifactIds, keys.sourceArtifactIds);
  }

  return aggregate;
}

function ensureNodeContextKeys(
  keysByNodeId: Map<string, NodeContextKeys>,
  nodeId: string,
) {
  const existing = keysByNodeId.get(nodeId);
  if (existing) {
    return existing;
  }

  const created = emptyNodeContextKeys();
  keysByNodeId.set(nodeId, created);
  return created;
}

function emptyNodeContextKeys(): NodeContextKeys {
  return {
    candidateMemoryIds: [],
    canonicalMemoryIds: [],
    memoryFragmentIds: [],
    sourceArtifactIds: [],
  };
}

function addUnique(values: string[], value: string | null) {
  if (value && !values.includes(value)) {
    values.push(value);
  }
}

function addUniqueList(values: string[], incoming: string[]) {
  for (const value of incoming) {
    addUnique(values, value);
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => (
    typeof value === "string" && value.trim().length > 0
  ))));
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[_-]+/gu, " ")
    .replace(/[^a-z0-9\s]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function formatMemoryType(value: string) {
  const label = value.replace(/[_-]+/gu, " ").replace(/\s+/gu, " ").trim();
  return label.slice(0, 1).toUpperCase() + label.slice(1);
}
