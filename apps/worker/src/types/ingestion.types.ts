import type {
  EntityExtractionResult,
  EngineeringMemoryExtractionResult,
  ExtractedEntity,
  ExtractedMemory,
  MemoryExtractionResult,
  PatternSignal,
  SourceSpeakerMapping,
  TwinIdentityProfile,
} from "@sivraj/intelligence";
import type { ParsedConversationMessage, ParserMetadata } from "@sivraj/ingestion";
import type { SpeechToTextTranscriber } from "@sivraj/llm";
import type { StructuredGenerator } from "@sivraj/llm";
import type { TextEmbedder } from "@sivraj/llm";
import type { PrivateMemoryReader } from "@sivraj/private-memory-reader";

export type QueuedArtifact = {
  id: string;
  twinId: string;
  sourceType: string;
  rawStorageRef: string | null;
  metadata: unknown;
};

export type CanonicalMemoryMergeJudge = {
  judge(input: {
    candidate: {
      memoryType: ExtractedMemory["memoryType"];
      statement: string;
      normalizedStatement: string | null;
      subject: string | null;
      normalizedStatementHash: string;
      metadata: Record<string, unknown>;
    };
    existing: Array<{
      id: string;
      memoryType: ExtractedMemory["memoryType"];
      canonicalKey: string;
      subject: string | null;
      confidenceScore: number | null;
      metadata: Record<string, unknown>;
    }>;
  }): Promise<{
    decision: "same" | "related" | "conflicting" | "separate";
    canonicalMemoryId: string | null;
    confidence: number;
    reason: string;
  }>;
};

export type ArtifactRepository = {
  findArtifactById(id: string): Promise<QueuedArtifact | null>;
  findQueuedArtifacts(limit: number): Promise<QueuedArtifact[]>;
  claimArtifact(id: string): Promise<QueuedArtifact | null>;
  claimRecoverableArtifact(id: string): Promise<QueuedArtifact | null>;
  markArtifactProcessing(id: string, metadata: Record<string, unknown>): Promise<void>;
  markArtifactPending(id: string, metadata: Record<string, unknown>): Promise<void>;
  markArtifactCompleted(id: string, metadata: Record<string, unknown>): Promise<void>;
  markArtifactFailed(id: string, metadata: Record<string, unknown>): Promise<void>;
  findMemoryFragmentBySourceArtifactId(sourceArtifactId: string): Promise<{
    id: string;
    contentStorageRef: string | null;
    contentSha256: string | null;
    metadata?: unknown;
  } | null>;
  findMemoryFragmentById(id: string): Promise<{
    id: string;
    twinId: string;
    sourceArtifactId: string;
    contentStorageRef: string | null;
    contentSha256: string | null;
  } | null>;
  findTwinIdentityProfile(twinId: string): Promise<TwinIdentityProfile | null>;
  findSourceSpeakerMappings(twinId: string, sourceArtifactId: string): Promise<SourceSpeakerMapping[]>;
  findRecentPatternSignals(twinId: string, limit: number): Promise<PatternSignal[]>;
  createMemoryFragment(input: {
    twinId: string;
    sourceArtifactId: string;
    contentStorageRef: string;
    contentSha256?: string | null;
    metadata?: Record<string, unknown> | null;
    importanceScore: number;
    confidenceScore: number;
  }): Promise<{ id: string }>;
  replaceDocumentChunks(input: {
    twinId: string;
    sourceArtifactId: string;
    memoryFragmentId: string;
    chunks: Array<{
      chunkIndex: number;
      contentStorageRef: string;
      contentSha256: string;
      tokenCount: number;
      charStart: number;
      charEnd: number;
      pageStart?: number | null;
      pageEnd?: number | null;
      embedding?: number[] | null;
      embeddingModel?: string | null;
      embeddingProvider?: string | null;
      embeddingGeneratedAt?: Date | null;
      metadata?: Record<string, unknown> | null;
    }>;
  }): Promise<{ count: number }>;
  replaceDocumentPages(input: {
    twinId: string;
    sourceArtifactId: string;
    memoryFragmentId: string;
    pages: Array<{
      pageNumber: number;
      contentStorageRef: string;
      contentSha256: string;
      tokenCount: number;
      charStart: number;
      charEnd: number;
      metadata?: Record<string, unknown> | null;
    }>;
  }): Promise<{ count: number }>;
  replaceDocumentStructureItems(input: {
    twinId: string;
    sourceArtifactId: string;
    memoryFragmentId: string;
    items: Array<{
      itemType: string;
      label: string;
      normalizedLabel: string;
      ordinal?: number | null;
      pageStart?: number | null;
      pageEnd?: number | null;
      charStart?: number | null;
      charEnd?: number | null;
      confidenceScore?: number | null;
      extractionMethod: string;
      metadata?: Record<string, unknown> | null;
    }>;
  }): Promise<{ count: number }>;
  upsertGraphNode(input: {
    twinId: string;
    nodeType: ExtractedEntity["graphNodeType"];
    name: string;
    normalizedName?: string | null;
    description?: string | null;
    properties: Record<string, unknown>;
    confidenceScore: number;
  }): Promise<{ id: string }>;
  upsertGraphEdge(input: {
    twinId: string;
    fromNodeId: string;
    toNodeId: string;
    edgeType: string;
    description?: string | null;
    evidenceMemoryIds: string[];
    confidenceScore: number;
  }): Promise<{ id: string }>;
  createCandidateMemory(input: {
    twinId: string;
    sourceArtifactId: string;
    memoryFragmentId: string;
    archiveId?: string | null;
    memoryType: ExtractedMemory["memoryType"];
    status?: "candidate" | "approved" | "rejected" | "superseded";
    statement?: string;
    normalizedStatement?: string;
    statementStorageRef: string;
    statementSha256: string;
    evidenceHash: string;
    evidenceLength: number;
    confidenceScore: number;
    archiveStatus?: "not_required" | "pending" | "queued" | "archiving" | "archived" | "failed_retryable" | "failed_blocked" | "cancelled";
    metadata: Record<string, unknown>;
    mergeJudge?: CanonicalMemoryMergeJudge;
  }): Promise<{ id: string; canonicalMemoryId: string }>;
  createCandidateMemoryArchive(input: {
    twinId: string;
    sourceArtifactId: string;
    memoryFragmentId: string;
    sourceType: string;
    candidateMemoryIds: string[];
    encryptedBytesBase64: string;
    contentSha256: string;
    metadata: Record<string, unknown>;
  }): Promise<{ id: string }>;
  markCandidateMemoryArchiveQueued(input: {
    archiveId: string;
    candidateMemoryIds: string[];
    jobId: string;
  }): Promise<void>;
  markCandidateMemoryArchiveArchiving(input: {
    archiveId?: string | null;
    candidateMemoryIds: string[];
  }): Promise<void>;
  markCandidateMemoriesArchived(input: {
    archiveId?: string | null;
    candidateMemoryIds: string[];
    statementStorageRef: string;
    statementSha256: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  markCandidateMemoriesArchiveFailed(input: {
    archiveId?: string | null;
    candidateMemoryIds: string[];
    metadata: Record<string, unknown>;
  }): Promise<void>;
  findCandidateMemoryArchiveById(id: string): Promise<{
    id: string;
    twinId: string;
    sourceArtifactId: string;
    memoryFragmentId: string;
    sourceType: string;
    candidateMemoryIds: string[];
    encryptedBytesBase64: string;
    contentSha256: string;
    metadata: Record<string, unknown>;
  } | null>;
  findDueCandidateMemoryArchives(input: { limit: number; now?: Date }): Promise<Array<{
    id: string;
    twinId: string;
    sourceArtifactId: string;
    memoryFragmentId: string;
    sourceType: string;
    candidateMemoryIds: string[];
    encryptedBytesBase64: string;
    contentSha256: string;
    metadata: Record<string, unknown>;
  }>>;
  findWeeklyReflectionSignals(input: {
    twinId: string;
    periodStart: Date;
    periodEnd: Date;
  }): Promise<WeeklyReflectionSignals>;
  createReflectionRun(input: {
    twinId: string;
    periodStart: Date;
    periodEnd: Date;
    status: "completed" | "failed" | "skipped";
    summaryStorageRef?: string | null;
    summarySha256?: string | null;
    metadata: Record<string, unknown>;
  }): Promise<{ id: string }>;
  updateReflectionRun(input: {
    id: string;
    status: "processing" | "completed" | "failed" | "skipped";
    summaryStorageRef?: string | null;
    summarySha256?: string | null;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  createAuditEvent(input: {
    twinId: string;
    eventType: string;
    resourceId: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
};

export type EntityExtractor = {
  extract(input: {
    twinId: string;
    sourceArtifactId: string;
    memoryFragmentId: string;
    sourceType: string;
    content: string;
    title?: string | null;
  }): Promise<EntityExtractionResult>;
};

export type MemoryExtractor = {
  extract(input: {
    twinId: string;
    sourceArtifactId: string;
    memoryFragmentId: string;
    sourceType: string;
    content: string;
    title?: string | null;
  }): Promise<MemoryExtractionResult>;
};

export type EngineeringMemoryExtractor = {
  extract(input: {
    twinId: string;
    sourceArtifactId: string;
    memoryFragmentId: string;
    sourceType: string;
    content: string;
    title?: string | null;
    path?: string | null;
    fileName?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<EngineeringMemoryExtractionResult>;
};

export type WeeklyReflectionSignals = {
  sourceArtifactCount: number;
  memoryFragmentCount: number;
  candidateMemoryCount: number;
  approvedCandidateMemoryCount: number;
  rejectedCandidateMemoryCount: number;
  graphNodeCount: number;
  projectCount: number;
  goalCount: number;
  decisionCount: number;
  patternCount: number;
  feedbackCount: number;
  usefulFeedbackCount: number;
  negativeFeedbackCount: number;
  candidateSubjects: Array<{
    subject: string;
    memoryType: ExtractedMemory["memoryType"];
    count: number;
  }>;
  graphSubjects: Array<{
    name: string;
    nodeType: ExtractedEntity["graphNodeType"];
  }>;
  feedbackBreakdown: Record<string, number>;
  sourceArtifactIds: string[];
  memoryFragmentIds: string[];
  candidateMemoryIds: string[];
  graphNodeIds: string[];
};

export type PrivateFragmentStorage = {
  storePrivateFragment(input: {
    twinId: string;
    sourceArtifactId: string;
    sourceType: string;
    content: string;
    contentKind?: "memory_fragment" | "candidate_memory" | "document_chunk" | "reflection";
  }): Promise<{
    contentStorageRef: string;
    contentSha256: string;
    encryptedBytesBase64?: string;
    metadata: Record<string, unknown>;
  }>;
  encryptPrivateFragment?(input: {
    twinId: string;
    sourceArtifactId: string;
    sourceType: string;
    content: string;
    contentKind?: "memory_fragment" | "candidate_memory" | "document_chunk" | "reflection";
  }): Promise<{
    encryptedBytesBase64: string;
    contentSha256: string;
    metadata: Record<string, unknown>;
  }>;
  storeEncryptedPrivateFragment?(input: {
    twinId: string;
    sourceArtifactId: string;
    sourceType: string;
    encryptedBytesBase64: string;
    contentSha256: string;
    metadata: Record<string, unknown>;
    contentKind?: "memory_fragment" | "candidate_memory" | "document_chunk" | "reflection";
  }): Promise<{
    contentStorageRef: string;
    contentSha256: string;
    encryptedBytesBase64?: string;
    metadata: Record<string, unknown>;
  }>;
};

export type IntelligenceProcessingQueue = {
  enqueueIntelligenceProcessing(data: {
    artifactId: string;
    twinId: string;
    memoryFragmentId: string;
    sourceType: string;
    transientFragmentCiphertextBase64?: string;
    transientFragmentCiphertextSha256?: string;
  }): Promise<{ jobId: string }>;
};

export type ArtifactProcessingRuntimeOptions = {
  privateMemoryReader?: PrivateMemoryReader;
  privateFragmentStorage?: PrivateFragmentStorage;
  speechToTextTranscriber?: SpeechToTextTranscriber;
  textEmbedder?: TextEmbedder;
  structuredGenerator?: StructuredGenerator;
  intelligenceQueue?: IntelligenceProcessingQueue;
  transientCiphertextBase64?: string;
  transientCiphertextSha256?: string;
  publishArtifactStatus?: (event: {
    artifactId: string;
    twinId: string;
    sourceType: string;
    status: "pending" | "queued" | "processing" | "completed" | "failed" | "cancelled";
    reason?: string;
    processing?: Record<string, unknown>;
    occurredAt: string;
  }) => Promise<void>;
};

export type ArtifactProcessingRequestOptions = ArtifactProcessingRuntimeOptions & {
  now?: Date;
};

export type CandidateMemoryArchiveQueue = {
  enqueueCandidateMemoryArchive(data: {
    archiveId?: string;
    artifactId: string;
    twinId: string;
    memoryFragmentId: string;
    sourceType: string;
    candidateMemoryIds: string[];
    encryptedBytesBase64: string;
    contentSha256: string;
    metadata: Record<string, unknown>;
  }): Promise<{ jobId: string }>;
};

export type PrivateSourcePayload = {
  content: string;
  title: string | null;
  metadata: Record<string, unknown>;
};

export type MemoryFragmentProcessingRef = {
  id: string;
  contentStorageRef?: string | null;
  contentSha256?: string | null;
  metadata?: Record<string, unknown>;
  transientCiphertextBase64?: string;
  transientCiphertextSha256?: string;
};

export type ParsedProcessableContent = {
  content: string;
  parser?: ParserMetadata;
  conversation?: {
    messages: ParsedConversationMessage[];
  };
};

export type AttributionMetadata = {
  messageCount: number;
  speakers: string[];
  counts: Record<import("@sivraj/intelligence").SpeakerRole, number>;
  unknownSpeakers: string[];
  mappedSpeakers: number;
};

export type ProjectClusterCandidate = {
  name: string;
  normalizedName: string;
  confidence: number;
  signals: string[];
  source: "entity" | "candidate_memory";
};

export type DecisionGraphCandidate = {
  memory: ExtractedMemory;
  candidateMemoryId: string;
  statementIndex: number;
};

export type GoalGraphCandidate = {
  memory: ExtractedMemory;
  candidateMemoryId: string;
  statementIndex: number;
};

export type ProcessQueuedArtifactsResult = {
  scanned: number;
  completed: number;
  pending: number;
  failed: number;
};

export type ProcessArtifactResult = "completed" | "pending" | "failed" | "skipped";

export type AttributedProcessableContent = ParsedProcessableContent & {
  attribution?: AttributionMetadata;
};

export type IntelligenceChunk = {
  index: number;
  total: number;
  startOffset: number;
  endOffset: number;
  content: string;
};
