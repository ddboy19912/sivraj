/**
 * Chat route and turn contracts shared between handlers and domain modules.
 *
 * Keeps HTTP-facing types (`ChatRouteDependencies`, turn seeds, SSE payloads)
 * separate from planner/retrieval types in `lib/chat/turn-types.ts`.
 */
import type { MemorySearchConfig } from "@sivraj/config";
import { chatMessages, chatThreads, chatTurns, sourceArtifacts } from "@sivraj/db";
import type { Context } from "hono";
import type { retrieveRelevantMemories } from "@sivraj/retrieval";
import type { AppDependencies, ApiDb } from "../app.js";
import type { AuthEnv } from "../middleware/auth.js";
import type { ProviderRuntimeConfig } from "../lib/chat/helpers.js";
import type { ChatMemoryIntent, MemoryIntakeResult } from "../lib/chat/memory-intake.js";
import type { ChatSurface } from "../lib/chat/chat-surface.js";
import type {
  ChatRetrievalStatus,
  ConversationContextResolution,
  CoreCommsContext,
  DocumentContext,
  GeneratedChatTitle,
  MemoryTokenAccounting,
  TokenSavingsEstimate,
} from "../lib/chat/turn-types.js";

export type {
  ChatRetrievalStatus,
  ConversationContextResolution,
  CoreCommsContext,
  DocumentContext,
  GeneratedChatTitle,
  MemoryTokenAccounting,
  TokenSavingsEstimate,
} from "../lib/chat/turn-types.js";
export type { ChatMemoryIntent, MemoryIntakeResult } from "../lib/chat/memory-intake.js";
export type { ChatSurface } from "../lib/chat/chat-surface.js";

export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type ChatThreadRow = typeof chatThreads.$inferSelect;
export type ChatTurnRow = typeof chatTurns.$inferSelect;
export type SourceArtifactRow = typeof sourceArtifacts.$inferSelect;

/** Resolved runtime LLM config for a chat turn. */
export type ChatRuntimeConfig = ProviderRuntimeConfig;

/** Injected services passed from route wiring into chat handlers. */
export type ChatRouteDependencies = {
  db: AppDependencies["db"];
  privateMemoryReader: AppDependencies["privateMemoryReader"];
  privateMemoryStorage: AppDependencies["privateMemoryStorage"];
  artifactProcessingQueue: AppDependencies["artifactProcessingQueue"];
  llmFetch: AppDependencies["llmFetch"];
  memorySearchConfig: MemorySearchConfig;
};

export type PostMessageInput = {
  content: string | null;
  memoryIntent: ChatMemoryIntent;
  surface: ChatSurface;
  retryAttempt: number;
};

export type PostAttachmentInput =
  | {
      artifactId: string;
      fileName: string;
      fileType: string | null;
      fileSize: number | null;
    }
  | {
      error: "missing_attachment_artifact" | "invalid_attachment_artifact";
      status: 400;
    };

export type ChatIntelligenceStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "skipped"
  | undefined;

export type ChatAttachmentMetadata = {
  artifactId: string;
  sourceType: string;
  fileName: string;
  fileType: string | null;
  fileSize: number | null;
  status: SourceArtifactRow["ingestionStatus"];
  intelligenceStatus: ChatIntelligenceStatus;
  processing: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

/** Attachment reference stored on a chat message metadata blob. */
export type ChatAttachmentRef = Record<string, unknown> & {
  artifactId: string;
};

export type ChatMemorySearchResult = ReturnType<typeof retrieveRelevantMemories>[number];

export type ChatMemoryContext = {
  results: ReturnType<typeof retrieveRelevantMemories>;
  tokenAccountingByMemoryId: Map<string, MemoryTokenAccounting>;
};

export type ChatCitation = {
  id: string;
  label: string;
  sourceArtifactId: string;
  score: number;
  matchedTerms: string[];
};

export type ChatGenerateOutput = {
  content: string;
  provider: string;
  model: string;
  metadata?: {
    usage?: Record<string, unknown>;
  };
};

export type ChatTurnSeed = {
  turn: ChatTurnRow;
  userMessage: ChatMessageRow;
  assistantMessage: ChatMessageRow;
};

export type ChatTurnResult = {
  output: ChatGenerateOutput;
  memoryContext: ChatMemoryContext;
  documentContext: DocumentContext;
  contextResolution: ConversationContextResolution;
  citations: ChatCitation[];
  usage: Record<string, unknown>;
  tokenSavings: TokenSavingsEstimate;
  retrievalStatus?: ChatRetrievalStatus;
  title: GeneratedChatTitle;
};

export type ChatTurnTimings = Record<string, number>;

export type ChatThreadGate = {
  twinId: string;
  thread: ChatThreadRow;
};

export type CreateQueuedTurnInput = {
  db: ApiDb;
  twinId: string;
  threadId: string;
  content: string;
  memoryIntent?: ChatMemoryIntent;
  surface?: ChatSurface;
};

export type ChatTurnAuditPayload = {
  output: ChatGenerateOutput;
  memoryContext: ChatMemoryContext;
  documentContext?: {
    passages?: Array<{ memoryFragmentId?: string; length?: number }>;
    retrievalPlan?: unknown;
  } | null;
  contextResolution: ConversationContextResolution | Record<string, unknown>;
  citations: ChatCitation[];
  usage: Record<string, unknown>;
  tokenSavings: TokenSavingsEstimate | Record<string, unknown>;
  title?: GeneratedChatTitle | Record<string, unknown>;
  timings?: ChatTurnTimings;
  retrievalStatus?: ChatRetrievalStatus;
};

export type ChatPersistTurnInput = {
  c: Context<AuthEnv>;
  db: ApiDb;
  gate: ChatThreadGate;
  content: string;
  surface?: ChatSurface;
  runtimeConfig: ChatRuntimeConfig;
  llmFetch?: typeof fetch;
  turn: ChatTurnAuditPayload;
};

export type MarkTurnGeneratingInput = {
  db: ApiDb;
  turnId: string;
  assistantMessageId: string;
  runtimeConfig: ChatRuntimeConfig;
};

export type CompleteStreamingTurnInput = {
  db: ApiDb;
  turnId: string;
  assistantMessageId: string;
  finalContent: string;
  runtimeConfig: ChatRuntimeConfig;
  model: string;
  memoryContext: ChatMemoryContext;
  documentContext: {
    passages: Array<{ memoryFragmentId?: string }>;
    retrievalPlan?: unknown;
  };
  contextResolution: ConversationContextResolution | Record<string, unknown>;
  citations: ChatCitation[];
  usage: Record<string, unknown>;
  tokenSavings: TokenSavingsEstimate | Record<string, unknown>;
  timings: ChatTurnTimings;
  retrievalStatus?: ChatRetrievalStatus;
  surface?: ChatSurface;
};

export type RecordCompletedStreamingTurnAuditInput = {
  c: Context<AuthEnv>;
  db: ApiDb;
  gate: ChatThreadGate;
  llmFetch?: typeof fetch;
  content: string;
  finalContent: string;
  runtimeConfig: ChatRuntimeConfig;
  model: string;
  memoryContext: ChatMemoryContext;
  documentContext: CompleteStreamingTurnInput["documentContext"];
  contextResolution: ConversationContextResolution | Record<string, unknown>;
  citations: ChatCitation[];
  usage: Record<string, unknown>;
  tokenSavings: TokenSavingsEstimate | Record<string, unknown>;
  timings: ChatTurnTimings;
  retrievalStatus?: ChatRetrievalStatus;
};

export type RecordChatMemoryIntakeOutcomeInput = {
  db: ApiDb;
  turnId?: string | null;
  userMessageId: string;
  memoryIntent: ChatMemoryIntent;
  memoryIntake: MemoryIntakeResult;
};

export type ChatTurnResponse = {
  id: string;
  threadId: string;
  userMessageId: string | null;
  assistantMessageId: string | null;
  status: ChatTurnRow["status"];
  providerKind: ChatTurnRow["providerKind"];
  model: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  metadata: ChatTurnRow["metadata"];
  createdAt: string;
  updatedAt: string;
};

export type ChatTurnEventStream = {
  writeSSE: (payload: { event: string; data: string }) => Promise<void>;
};

export const EMPTY_MEMORY_INTAKE_RESULT: MemoryIntakeResult = {
  source: "skipped",
  status: "skipped_question",
  facts: [],
  engineeringMemories: [],
  acknowledgement: null,
};

export function emptyMemoryIntakeForIntent(memoryIntent: ChatMemoryIntent): MemoryIntakeResult {
  return {
    ...EMPTY_MEMORY_INTAKE_RESULT,
    status: memoryIntent === "private" ? "no_facts" : "skipped_question",
  };
}
