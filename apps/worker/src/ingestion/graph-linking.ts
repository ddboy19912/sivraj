import {
  detectPatterns,
  inferBehaviorPatternMetadata,
  type DetectedPattern,
  type ExtractedEntity,
  type ExtractedMemory,
  type PatternSignal,
} from "@sivraj/intelligence";
import type {
  ArtifactRepository,
  DecisionGraphCandidate,
  GoalGraphCandidate,
  ProjectClusterCandidate,
  QueuedArtifact,
} from "../types/ingestion.types.js";
import { sha256Text } from "./readers.js";

function normalizeProjectName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function readProjectCandidateFromEntity(entity: ExtractedEntity): ProjectClusterCandidate | null {
  if (entity.graphNodeType === "project") {
    return {
      name: entity.name,
      normalizedName: entity.normalizedName,
      confidence: Math.max(entity.confidence, 0.85),
      signals: ["project_entity"],
      source: "entity",
    };
  }

  if (entity.type === "product") {
    return {
      name: entity.name,
      normalizedName: normalizeProjectName(entity.name),
      confidence: Math.min(entity.confidence, 0.78),
      signals: ["product_entity"],
      source: "entity",
    };
  }

  return null;
}

export function readProjectCandidateFromMemory(memory: ExtractedMemory): ProjectClusterCandidate | null {
  const subject = typeof memory.subject === "string" ? memory.subject.trim() : "";

  if (!subject || subject.length < 2 || subject.length > 100) {
    return null;
  }

  if (memory.memoryType === "project_update") {
    return {
      name: subject,
      normalizedName: normalizeProjectName(subject),
      confidence: Math.max(memory.confidence, 0.78),
      signals: ["project_update_subject"],
      source: "candidate_memory",
    };
  }

  if (
    memory.memoryType === "decision"
    || memory.memoryType === "goal"
    || memory.memoryType === "commitment"
  ) {
    return {
      name: subject,
      normalizedName: normalizeProjectName(subject),
      confidence: Math.min(memory.confidence, 0.72),
      signals: [`${memory.memoryType}_subject`],
      source: "candidate_memory",
    };
  }

  return null;
}

function dedupeProjectCandidates(candidates: ProjectClusterCandidate[]): ProjectClusterCandidate[] {
  const seen = new Map<string, ProjectClusterCandidate>();

  for (const candidate of candidates) {
    const existing = seen.get(candidate.normalizedName);

    if (!existing || candidate.confidence > existing.confidence) {
      seen.set(candidate.normalizedName, candidate);
    }
  }

  return Array.from(seen.values());
}

async function upsertProjectClusterNode(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  candidate: ProjectClusterCandidate,
): Promise<{ id: string }> {
  return repository.upsertGraphNode({
    twinId: artifact.twinId,
    nodeType: "project",
    name: candidate.name,
    normalizedName: candidate.normalizedName,
    description: describeProjectCluster(candidate, artifact.sourceType),
    properties: {
      normalizedName: candidate.normalizedName,
      sourceType: artifact.sourceType,
      projectCluster: true,
      clusterMethod: "deterministic_project_clustering",
      clusterSignals: candidate.signals,
      clusterSources: [candidate.source],
    },
    confidenceScore: candidate.confidence,
  });
}

export async function upsertArtifactGraphNode(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  memoryFragmentId: string,
): Promise<{ id: string }> {
  return repository.upsertGraphNode({
    twinId: artifact.twinId,
    nodeType: "artifact",
    name: `source_artifact:${artifact.id}`,
    normalizedName: `source_artifact:${artifact.id}`,
    description: `Source artifact from ${formatGraphLabel(artifact.sourceType)} memory that contributed evidence to the knowledge graph.`,
    properties: {
      sourceArtifactId: artifact.id,
      memoryFragmentId,
      sourceType: artifact.sourceType,
    },
    confidenceScore: 1,
  });
}

export async function clusterProjectsFromEntities(
  repository: ArtifactRepository,
  input: {
    artifact: QueuedArtifact;
    memoryFragmentId: string;
    artifactNodeId: string;
    entityNodes: Array<{
      nodeId: string;
      entity: ExtractedEntity;
    }>;
  },
): Promise<Record<string, unknown>> {
  const candidates = input.entityNodes
    .map(({ entity }) => readProjectCandidateFromEntity(entity))
    .filter((candidate): candidate is ProjectClusterCandidate => Boolean(candidate));
  const deduped = dedupeProjectCandidates(candidates);
  let projectLinkCount = 0;

  for (const candidate of deduped) {
    const projectNode = await upsertProjectClusterNode(repository, input.artifact, candidate);

    await repository.upsertGraphEdge({
      twinId: input.artifact.twinId,
      fromNodeId: input.artifactNodeId,
      toNodeId: projectNode.id,
      edgeType: "belongs_to_project",
      description: "Source artifact is clustered into this project context.",
      evidenceMemoryIds: [input.memoryFragmentId],
      confidenceScore: candidate.confidence,
    });
    projectLinkCount += 1;

    for (const { nodeId, entity } of input.entityNodes) {
      if (entity.normalizedName === candidate.normalizedName && entity.graphNodeType === "project") {
        continue;
      }

      await repository.upsertGraphEdge({
        twinId: input.artifact.twinId,
        fromNodeId: projectNode.id,
        toNodeId: nodeId,
        edgeType: "project_context",
        description: "Entity appears in the same source context as this project cluster.",
        evidenceMemoryIds: [input.memoryFragmentId],
        confidenceScore: Math.min(candidate.confidence, entity.confidence),
      });
      projectLinkCount += 1;
    }
  }

  return {
    status: "completed",
    method: "deterministic_project_clustering",
    projectClusterCount: deduped.length,
    projectLinkCount,
    signals: Array.from(new Set(deduped.flatMap((candidate) => candidate.signals))),
  };
}

export async function clusterProjectsFromCandidates(
  repository: ArtifactRepository,
  input: {
    artifact: QueuedArtifact;
    memoryFragmentId: string;
    artifactNodeId: string;
    candidates: ProjectClusterCandidate[];
  },
): Promise<Record<string, unknown>> {
  const deduped = dedupeProjectCandidates(input.candidates);

  for (const candidate of deduped) {
    const projectNode = await upsertProjectClusterNode(repository, input.artifact, candidate);

    await repository.upsertGraphEdge({
      twinId: input.artifact.twinId,
      fromNodeId: input.artifactNodeId,
      toNodeId: projectNode.id,
      edgeType: "belongs_to_project",
      description: "Candidate memory subject is clustered into this project context.",
      evidenceMemoryIds: [input.memoryFragmentId],
      confidenceScore: candidate.confidence,
    });
  }

  return {
    status: "completed",
    method: "deterministic_project_clustering",
    projectClusterCount: deduped.length,
    projectLinkCount: deduped.length,
    signals: Array.from(new Set(deduped.flatMap((candidate) => candidate.signals))),
  };
}

export async function linkDecisionGraphNodes(
  repository: ArtifactRepository,
  input: {
    artifact: QueuedArtifact;
    memoryFragmentId: string;
    artifactNodeId: string;
    decisions: DecisionGraphCandidate[];
  },
): Promise<Record<string, unknown>> {
  let decisionLinkCount = 0;
  let projectDecisionLinkCount = 0;

  for (const decision of input.decisions) {
    const decisionHash = sha256Text(decision.memory.normalizedStatement);
    const decisionNode = await repository.upsertGraphNode({
      twinId: input.artifact.twinId,
      nodeType: "decision",
      name: `decision:${decisionHash.slice(0, 12)}`,
      normalizedName: `decision:${decisionHash}`,
      description: describePrivateMemoryGraphNode("decision", decision.memory.subject),
      properties: {
        decisionHash,
        sourceArtifactId: input.artifact.id,
        memoryFragmentId: input.memoryFragmentId,
        candidateMemoryId: decision.candidateMemoryId,
        sourceType: input.artifact.sourceType,
        subject: decision.memory.subject,
        evidenceHash: decision.memory.evidenceHash,
        evidenceLength: decision.memory.evidenceLength,
        statementIndex: decision.statementIndex,
        extractionMethod: decision.memory.metadata["engineering"] === true
          ? "llm_structured_engineering_memory_extractor"
          : "llm_structured_memory_extractor",
        privateStatementStoredEncrypted: true,
        metadata: decision.memory.metadata,
      },
      confidenceScore: decision.memory.confidence,
    });

    await repository.upsertGraphEdge({
      twinId: input.artifact.twinId,
      fromNodeId: input.artifactNodeId,
      toNodeId: decisionNode.id,
      edgeType: "records_decision",
      description: "Source artifact contains an encrypted candidate memory classified as a decision.",
      evidenceMemoryIds: [input.memoryFragmentId],
      confidenceScore: decision.memory.confidence,
    });
    decisionLinkCount += 1;

    const projectCandidate = readProjectCandidateFromMemory(decision.memory);

    if (projectCandidate) {
      const projectNode = await upsertProjectClusterNode(repository, input.artifact, projectCandidate);

      await repository.upsertGraphEdge({
        twinId: input.artifact.twinId,
        fromNodeId: projectNode.id,
        toNodeId: decisionNode.id,
        edgeType: "project_decision",
        description: "Decision candidate is associated with this project context.",
        evidenceMemoryIds: [input.memoryFragmentId],
        confidenceScore: Math.min(decision.memory.confidence, projectCandidate.confidence),
      });
      projectDecisionLinkCount += 1;
    }
  }

  return {
    status: "completed",
    method: "candidate_memory_decision_graph_linking",
    decisionCount: input.decisions.length,
    decisionLinkCount,
    projectDecisionLinkCount,
  };
}

export async function linkGoalGraphNodes(
  repository: ArtifactRepository,
  input: {
    artifact: QueuedArtifact;
    memoryFragmentId: string;
    artifactNodeId: string;
    goals: GoalGraphCandidate[];
  },
): Promise<Record<string, unknown>> {
  let goalLinkCount = 0;
  let projectGoalLinkCount = 0;

  for (const goal of input.goals) {
    const goalHash = sha256Text(goal.memory.normalizedStatement);
    const goalNode = await repository.upsertGraphNode({
      twinId: input.artifact.twinId,
      nodeType: "goal",
      name: `goal:${goalHash.slice(0, 12)}`,
      normalizedName: `goal:${goalHash}`,
      description: describePrivateMemoryGraphNode("goal", goal.memory.subject),
      properties: {
        goalHash,
        sourceArtifactId: input.artifact.id,
        memoryFragmentId: input.memoryFragmentId,
        candidateMemoryId: goal.candidateMemoryId,
        sourceType: input.artifact.sourceType,
        subject: goal.memory.subject,
        evidenceHash: goal.memory.evidenceHash,
        evidenceLength: goal.memory.evidenceLength,
        statementIndex: goal.statementIndex,
        extractionMethod: "llm_structured_memory_extractor",
        inferenceMethod: "candidate_memory_goal_graph_linking",
        privateStatementStoredEncrypted: true,
        metadata: goal.memory.metadata,
      },
      confidenceScore: goal.memory.confidence,
    });

    await repository.upsertGraphEdge({
      twinId: input.artifact.twinId,
      fromNodeId: input.artifactNodeId,
      toNodeId: goalNode.id,
      edgeType: "states_goal",
      description: "Source artifact contains an encrypted candidate memory classified as a goal.",
      evidenceMemoryIds: [input.memoryFragmentId],
      confidenceScore: goal.memory.confidence,
    });
    goalLinkCount += 1;

    const projectCandidate = readProjectCandidateFromMemory(goal.memory);

    if (projectCandidate) {
      const projectNode = await upsertProjectClusterNode(repository, input.artifact, projectCandidate);

      await repository.upsertGraphEdge({
        twinId: input.artifact.twinId,
        fromNodeId: projectNode.id,
        toNodeId: goalNode.id,
        edgeType: "project_goal",
        description: "Goal candidate is associated with this project context.",
        evidenceMemoryIds: [input.memoryFragmentId],
        confidenceScore: Math.min(goal.memory.confidence, projectCandidate.confidence),
      });
      projectGoalLinkCount += 1;
    }
  }

  return {
    status: "completed",
    method: "candidate_memory_goal_graph_linking",
    goalCount: input.goals.length,
    goalLinkCount,
    projectGoalLinkCount,
  };
}

async function upsertPatternGraphNode(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  pattern: DetectedPattern,
): Promise<{ id: string }> {
  return repository.upsertGraphNode({
    twinId: artifact.twinId,
    nodeType: "other",
    name: `pattern:${pattern.patternHash.slice(0, 12)}`,
    normalizedName: `pattern:${pattern.patternHash}`,
    description: describePatternGraphNode(pattern),
    properties: {
      kind: "pattern",
      patternType: pattern.patternType,
      patternHash: pattern.patternHash,
      subject: pattern.subject,
      normalizedSubject: pattern.normalizedSubject,
      evidenceCount: pattern.evidenceCount,
      sourceArtifactIds: pattern.sourceArtifactIds,
      memoryFragmentIds: pattern.memoryFragmentIds,
      candidateMemoryIds: pattern.candidateMemoryIds,
      canonicalMemoryIds: pattern.canonicalMemoryIds,
      memoryTypes: pattern.memoryTypes,
      sourceTypes: pattern.sourceTypes,
      detector: pattern.detector,
      privateStatementStoredEncrypted: true,
    },
    confidenceScore: pattern.confidence,
  });
}

export function patternMetadataForMemory(memory: ExtractedMemory): Record<string, unknown> {
  return inferBehaviorPatternMetadata({
    statement: memory.statement,
    normalizedStatement: memory.normalizedStatement,
    subject: memory.subject,
    metadata: memory.metadata,
  }) ?? {};
}

export function toPatternSignal(
  artifact: QueuedArtifact,
  memoryFragmentId: string,
  candidateMemory: { id: string; canonicalMemoryId?: string | null },
  memory: ExtractedMemory,
): PatternSignal | null {
  if (!memory.subject) {
    return null;
  }

  return {
    twinId: artifact.twinId,
    sourceArtifactId: artifact.id,
    memoryFragmentId,
    candidateMemoryId: candidateMemory.id,
    canonicalMemoryId: candidateMemory.canonicalMemoryId ?? null,
    memoryType: memory.memoryType,
    subject: memory.subject,
    confidence: memory.confidence,
    evidenceHash: memory.evidenceHash,
    evidenceLength: memory.evidenceLength,
    sourceType: artifact.sourceType,
    metadata: {
      ...memory.metadata,
      ...patternMetadataForMemory(memory),
    },
  };
}

function describeProjectCluster(
  candidate: ProjectClusterCandidate,
  sourceType: string,
) {
  const signals = candidate.signals.map(formatGraphLabel).join(", ");
  return `Subject cluster inferred from ${signals || "graph"} signals in ${formatGraphLabel(sourceType)} memory.`;
}

function describePrivateMemoryGraphNode(
  kind: "decision" | "goal",
  subject: string | null,
) {
  const about = subject ? ` about ${subject}` : "";
  return `Encrypted ${kind} memory${about}. The raw statement stays private while safe metadata keeps it connected.`;
}

function describePatternGraphNode(pattern: DetectedPattern) {
  return `Detected ${formatGraphLabel(pattern.patternType)} pattern about ${pattern.subject} across ${pattern.evidenceCount} evidence signals.`;
}

function formatGraphLabel(value: string) {
  return value.replace(/[_-]+/gu, " ").replace(/\s+/gu, " ").trim();
}

export async function detectAndLinkPatterns(
  repository: ArtifactRepository,
  input: {
    artifact: QueuedArtifact;
    memoryFragmentId: string;
    artifactNodeId: string;
    currentSignals: PatternSignal[];
  },
): Promise<Record<string, unknown>> {
  const historicalSignals = await repository.findRecentPatternSignals(input.artifact.twinId, 250);
  const result = detectPatterns({
    twinId: input.artifact.twinId,
    currentSignals: input.currentSignals,
    historicalSignals,
  });
  let patternLinkCount = 0;
  let projectPatternLinkCount = 0;

  for (const pattern of result.patterns) {
    const patternNode = await upsertPatternGraphNode(repository, input.artifact, pattern);

    await repository.upsertGraphEdge({
      twinId: input.artifact.twinId,
      fromNodeId: input.artifactNodeId,
      toNodeId: patternNode.id,
      edgeType: "supports_pattern",
      description: "Source artifact contributes private-safe evidence for this detected pattern.",
      evidenceMemoryIds: [input.memoryFragmentId],
      confidenceScore: pattern.confidence,
    });
    patternLinkCount += 1;

    const projectNode = await upsertProjectClusterNode(repository, input.artifact, {
      name: pattern.subject,
      normalizedName: pattern.normalizedSubject,
      confidence: pattern.confidence,
      signals: [pattern.patternType],
      source: "candidate_memory",
    });

    await repository.upsertGraphEdge({
      twinId: input.artifact.twinId,
      fromNodeId: projectNode.id,
      toNodeId: patternNode.id,
      edgeType: "project_pattern",
      description: "Detected pattern is associated with this project or subject context.",
      evidenceMemoryIds: [input.memoryFragmentId],
      confidenceScore: pattern.confidence,
    });
    projectPatternLinkCount += 1;
  }

  return {
    status: "completed",
    ...result.metadata,
    patternLinkCount,
    projectPatternLinkCount,
  };
}
