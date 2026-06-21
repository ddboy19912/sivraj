import type { MemoryCandidate } from "@sivraj/retrieval";
import { retrieveRelevantMemories } from "@sivraj/retrieval";

/**
 * Shared turn-domain types for chat orchestration.
 *
 * {@link ConversationContextResolution} is the planner output that drives retrieval,
 * memory intake, fast-path replies, and prompt assembly for each turn.
 */

export type TokenSavingsEstimate = {
  method: "source_vs_memory_estimate";
  estimatedTokensSaved: number;
  sourceTokensRepresented: number;
  memoryContextTokens: number;
  memoryCount: number;
  compressionRatio: number | null;
};

export type MemoryTokenAccounting = {
  sourceTokensRepresented: number;
  memoryContextTokens: number;
};

export type DocumentSourceCandidate = MemoryCandidate & {
  memoryFragmentId: string;
  sourceType: string;
};

export type DocumentContext = {
  results: ReturnType<typeof retrieveRelevantMemories>;
  retrievalPlan: DocumentRetrievalPlan;
  inspectionSources: DocumentInspectionSource[];
  passages: Array<{
    id: string;
    memoryFragmentId: string;
    sourceArtifactId: string;
    sourceType: string;
    chunkIndex: number;
    pageStart: number | null;
    pageEnd: number | null;
    content: string;
    score: number;
    matchedTerms: string[];
  }>;
};

export type MemoryRequestScope = "all" | "profile" | "preferences" | "engineering";

export type MemoryRequest =
  | { kind: "none" }
  | {
      kind: "specific_fact";
      query: string;
      scope: MemoryRequestScope;
      searchTerms: string[];
    }
  | {
      kind: "inventory";
      scope: MemoryRequestScope;
      excludeAlreadyMentioned: boolean;
    }
  | {
      kind: "followup";
      relation: "other" | "same_topic" | "clarify";
      query: string;
      scope: MemoryRequestScope;
      excludeAlreadyMentioned: boolean;
      searchTerms: string[];
    };

/** Planner output for a single chat turn — controls retrieval, intake, and response path. */
export type ConversationContextResolution = {
  source: "llm" | "fallback";
  standaloneQuery: string;
  intent: "document_qa" | "memory_qa" | "conversation_reference" | "general_chat" | "ambiguous";
  turnKind: "question" | "statement" | "command" | "mixed";
  answerTarget: "general" | "memory" | "document" | "conversation" | "none";
  memoryWrite: "skip" | "extract" | "force_note";
  retrieval: "none" | "hot_memory" | "document" | "conversation_context";
  confidence: number;
  referencedMessageIds: string[];
  memoryRequest: MemoryRequest;
  reason?: string;
};

export type ChatRetrievalTarget = "memory" | "document";

export type ChatRetrievalDegradationReason =
  | "timeout"
  | "read_failed"
  | "storage_unavailable"
  | "planner_unavailable"
  | "unknown";

export type ChatRetrievalStatus = {
  state: "not_requested" | "retrieved" | "empty" | "degraded";
  target: ChatRetrievalTarget | null;
  reason: ChatRetrievalDegradationReason | null;
  message: string | null;
};

export type TurnPlanningMemoryHint = {
  id: string;
  label: string;
  kind: string;
  slot: string;
  qualifier: string | null;
  value: string;
  sourceMessagePreview: string | null;
  updatedAt: string;
};

export type DocumentInspectionSource = {
  sourceArtifactId: string;
  sourceType: string;
  title: string | null;
  fileName: string | null;
  pageCount: number | null;
  charCount: number;
  includedFullText: boolean;
  scope: "metadata" | "page_range" | "llm_query_report";
  pageStart: number | null;
  pageEnd: number | null;
  content: string;
};

export type DocumentRetrievalPlan = {
  source: "llm" | "fallback" | "skipped";
  mode: "document_qa" | "memory_qa" | "general_chat" | "ambiguous";
  inspectionMode: "metadata" | "semantic_passages" | "page_range" | "exact_search" | "global_scan";
  task: "answer" | "summarize" | "extract" | "count" | "compare";
  target: DocumentNavigationTarget;
  artifactIds: string[];
  targetPages: number[];
  exactQuery?: string | null;
  matchMode?: "whole_word" | "phrase" | "substring" | null;
  confidence: number;
  needsClarification: boolean;
  reason?: string;
};

export type DocumentInventoryItem = {
  artifactId: string;
  sourceType: string;
  createdAt: string;
  isThreadFocus: boolean;
  title: string | null;
  fileName: string | null;
  pageCount: number | null;
  chunkCount: number;
  subjects: string[];
  structure: DocumentStructureSummary;
};

export type DocumentStructureSummary = {
  itemCount: number;
  chapterCount: number;
  headingCount: number;
  sectionCount: number;
  items: Array<{
    itemType: string;
    label: string;
    ordinal: number | null;
    pageStart: number | null;
    pageEnd: number | null;
  }>;
};

export type DocumentNavigationTarget =
  | { kind: "none" }
  | { kind: "pages"; pages: number[] }
  | { kind: "page_range"; pageStart: number; pageEnd: number }
  | { kind: "fraction"; start: number; end: number }
  | { kind: "relative_position"; position: "beginning" | "middle" | "end"; windowFraction: number }
  | { kind: "whole_document" };

export type DocumentNavigationPageScope = {
  mode: "none" | "page_inspection" | "query_scan";
  pagesByArtifactId: Map<string, number[]>;
  reason: string;
};

export type ChatTurnTimings = Record<string, number>;

export type GeneratedChatTitle =
  | {
      status: "generated";
      title: string;
      generatedAt: string;
      providerKind: string;
      model: string;
    }
  | {
      status: "failed";
      errorMessage: string;
    };

export type SivrajVoiceReplyKind = "missing_memory" | "private_ack";

export type CoreCommsContext = {
  assistantName: string | null;
  displayName: string | null;
  aliases: string[];
  emails: string[];
  phones: string[];
  handles: Record<string, unknown> | null;
};

export type CurrentTruthContext = {
  kind: string;
  slot: string;
  qualifier: string | null;
  value: string;
  valueType: string;
  mutable: boolean;
  sourceArtifactId: string | null;
  sourceMessagePreview: string | null;
  engineeringMemoryType?: string | null;
  engineeringInstructionScope?: string | null;
  engineeringSubject?: string | null;
  agentContextLine?: string | null;
  codeReference?: string | null;
};

export type DocumentQueryScanResult = {
  sourceArtifactId: string;
  sourceType: string;
  title: string | null;
  fileName: string | null;
  pageCount: number | null;
  pageStart: number | null;
  pageEnd: number | null;
  charCount: number;
  includedFullText: boolean;
  content: string;
};
