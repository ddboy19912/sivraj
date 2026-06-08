import { createOpenAICompatibleChatGenerator, type ChatMessage } from "@sivraj/llm";
import { retrieveRelevantMemories, type MemoryCandidate } from "@sivraj/retrieval";
import {
  auditEvents,
  chatMessages,
  chatThreads,
  memoryFragments,
} from "@sivraj/db";
import { and, desc, eq } from "drizzle-orm";
import type { Context } from "hono";
import type { AppDependencies } from "../app.js";
import type { AuthEnv } from "../middleware/auth.js";
import { optionalString, readRecord } from "../lib/http/route-helpers.js";
import {
  authorizeThread,
  estimateSavedTokens,
  errorMessage,
  loadThreadMessages,
  readPositiveInteger,
  recordValue,
  titleFromMessage,
  toMessageResponse,
  toThreadResponse,
  truncate,
  type ProviderKind,
  type ProviderRuntimeConfig,
} from "../lib/chat/helpers.js";
import { loadProviderConfig, resolveRuntimeProviderConfig } from "./chat-provider-config.js";

export async function handleListThreads(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  twinId: string,
) {
  const rows = await db
    .select()
    .from(chatThreads)
    .where(eq(chatThreads.twinId, twinId))
    .orderBy(desc(chatThreads.updatedAt))
    .limit(50);

  return c.json({ threads: rows.map(toThreadResponse) });
}

export async function handleCreateThread(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  twinId: string,
) {
  const body = await c.req.json().catch(() => ({}));
  const title = optionalString(recordValue(body, "title")) ?? "New chat";
  const providerConfig = await loadProviderConfig(db, twinId);
  const [thread] = await db
    .insert(chatThreads)
    .values({
      twinId,
      title: title.slice(0, 120),
      llmProviderConfigId: providerConfig?.id ?? null,
      metadata: { surface: "web_chat" },
    })
    .returning();

  return c.json({ thread: toThreadResponse(thread) }, 201);
}

export async function handleGetThreadMessages(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
) {
  const gate = await authorizeThread(c, db);
  if ("response" in gate) {
    return gate.response;
  }

  const rows = await loadThreadMessages(db, gate.twinId, gate.thread.id, 200);
  return c.json({
    thread: toThreadResponse(gate.thread),
    messages: rows.map(toMessageResponse),
  });
}

export async function handlePostThreadMessage(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  privateMemoryReader: AppDependencies["privateMemoryReader"],
  llmFetch: AppDependencies["llmFetch"],
) {
  const gate = await authorizeThread(c, db);
  if ("response" in gate) {
    return gate.response;
  }

  const content = await readPostMessageContent(c);
  if (!content) {
    return c.json({ error: "missing_chat_message" }, 400);
  }

  const runtimeConfig = await resolveRuntimeProviderConfig(db, gate.twinId, process.env);
  if (!runtimeConfig) {
    return c.json({ error: "llm_provider_not_configured" }, 503);
  }

  const userMessage = await insertUserMessage(db, gate.twinId, gate.thread.id, content);
  const turn = await generateChatTurn({
    db,
    privateMemoryReader,
    llmFetch,
    twinId: gate.twinId,
    threadId: gate.thread.id,
    content,
    runtimeConfig,
  });
  const assistantMessage = await persistChatTurn({
    c,
    db,
    gate,
    content,
    runtimeConfig,
    turn,
  });

  return c.json(buildPostMessageResponse(userMessage, assistantMessage, turn), 201);
}

async function readPostMessageContent(c: Context<AuthEnv>): Promise<string | null> {
  const body = await c.req.json().catch(() => null);
  return body && typeof body === "object"
    ? optionalString((body as Record<string, unknown>)["content"])
    : null;
}

async function insertUserMessage(
  db: AppDependencies["db"],
  twinId: string,
  threadId: string,
  content: string,
) {
  const [userMessage] = await db
    .insert(chatMessages)
    .values({
      twinId,
      threadId,
      role: "user",
      content,
      metadata: { contextSaved: true, surface: "web_chat" },
    })
    .returning();

  return userMessage;
}

async function generateChatTurn(input: {
  db: AppDependencies["db"];
  privateMemoryReader: AppDependencies["privateMemoryReader"];
  llmFetch: AppDependencies["llmFetch"];
  twinId: string;
  threadId: string;
  content: string;
  runtimeConfig: ProviderRuntimeConfig;
}) {
  const memoryContext = await loadMemoryContext({
    db: input.db,
    privateMemoryReader: input.privateMemoryReader,
    twinId: input.twinId,
    query: input.content,
  });
  const recentMessages = await loadThreadMessages(input.db, input.twinId, input.threadId, 12);
  const promptMessages = buildPromptMessages({
    currentMessage: input.content,
    memoryContext,
    recentMessages,
    providerLabel: input.runtimeConfig.displayName,
  });
  const output = await createOpenAICompatibleChatGenerator({
    provider: input.runtimeConfig.providerKind,
    apiKey: input.runtimeConfig.apiKey,
    model: input.runtimeConfig.model,
    baseUrl: input.runtimeConfig.baseUrl,
    fetch: input.llmFetch,
    timeoutMs: readPositiveInteger(process.env["LLM_REQUEST_TIMEOUT_MS"], 45_000),
  }).generateChat({
    messages: promptMessages,
    temperature: 0.2,
  });
  const citations = memoryContext.results.map((result, index) => ({
    id: result.memory.id,
    label: `MEM_${index + 1}`,
    sourceArtifactId: result.memory.sourceArtifactId,
    score: result.score,
    matchedTerms: result.matchedTerms,
  }));
  const usage = readRecord(output.metadata?.usage);
  const estimatedSavedTokens = estimateSavedTokens(
    memoryContext.results.map((result) => result.memory.content),
  );

  return {
    output,
    memoryContext,
    citations,
    usage,
    estimatedSavedTokens,
  };
}

type ChatTurnInput = {
  c: Context<AuthEnv>;
  db: AppDependencies["db"];
  gate: { twinId: string; thread: typeof chatThreads.$inferSelect };
  content: string;
  runtimeConfig: ProviderRuntimeConfig;
  turn: Awaited<ReturnType<typeof generateChatTurn>>;
};

async function persistChatTurn(input: ChatTurnInput) {
  const assistantMessage = await insertAssistantMessage(input);
  await recordChatTurnAudit(input);
  return assistantMessage;
}

async function insertAssistantMessage(input: ChatTurnInput) {
  const { output, memoryContext, citations, usage, estimatedSavedTokens } = input.turn;
  const [assistantMessage] = await input.db
    .insert(chatMessages)
    .values({
      twinId: input.gate.twinId,
      threadId: input.gate.thread.id,
      role: "assistant",
      content: output.content,
      providerKind: input.runtimeConfig.providerKind as ProviderKind,
      model: output.model,
      memoryFragmentIds: memoryContext.results.map((result) => result.memory.id),
      citations,
      usage,
      metadata: {
        providerSource: input.runtimeConfig.source,
        tokenContextSaved: estimatedSavedTokens,
        retrievedMemoryCount: memoryContext.results.length,
        contextPacket: {
          policy: "bounded_retrieved_memory",
          rawArtifactsIncluded: false,
        },
      },
    })
    .returning();

  return assistantMessage;
}

async function recordChatTurnAudit(input: ChatTurnInput) {
  const auth = input.c.get("auth");
  const { output, memoryContext, estimatedSavedTokens } = input.turn;

  await input.db
    .update(chatThreads)
    .set({
      title: input.gate.thread.title === "New chat"
        ? titleFromMessage(input.content)
        : input.gate.thread.title,
      llmProviderConfigId: input.runtimeConfig.source === "user"
        ? input.runtimeConfig.id
        : input.gate.thread.llmProviderConfigId,
      updatedAt: new Date(),
    })
    .where(and(
      eq(chatThreads.id, input.gate.thread.id),
      eq(chatThreads.twinId, input.gate.twinId),
    ));

  await input.db.insert(auditEvents).values({
    twinId: input.gate.twinId,
    actorType: auth.type,
    actorId: auth.sub,
    eventType: "chat.assistant_response_created",
    resourceType: "chat_thread",
    resourceId: input.gate.thread.id,
    metadata: {
      providerKind: input.runtimeConfig.providerKind,
      providerSource: input.runtimeConfig.source,
      model: output.model,
      retrievedMemoryCount: memoryContext.results.length,
      memoryFragmentIds: memoryContext.results.map((result) => result.memory.id),
      tokenContextSaved: estimatedSavedTokens,
    },
  });
}

function buildPostMessageResponse(
  userMessage: typeof chatMessages.$inferSelect,
  assistantMessage: typeof chatMessages.$inferSelect,
  turn: Awaited<ReturnType<typeof generateChatTurn>>,
) {
  return {
    userMessage: toMessageResponse(userMessage),
    assistantMessage: toMessageResponse(assistantMessage),
    context: {
      citations: turn.citations,
      memoryCount: turn.memoryContext.results.length,
      tokenContextSaved: turn.estimatedSavedTokens,
      policy: {
        rawArtifactsIncluded: false,
        memory: "Sivraj retrieved durable memory instead of replaying full history.",
      },
    },
  };
}

async function loadMemoryContext(input: {
  db: AppDependencies["db"];
  privateMemoryReader: AppDependencies["privateMemoryReader"];
  twinId: string;
  query: string;
}) {
  if (!input.privateMemoryReader) {
    return { results: [] as ReturnType<typeof retrieveRelevantMemories> };
  }

  const rows = await input.db
    .select()
    .from(memoryFragments)
    .where(eq(memoryFragments.twinId, input.twinId))
    .orderBy(desc(memoryFragments.createdAt))
    .limit(50);
  const candidates: MemoryCandidate[] = [];

  for (const row of rows) {
    if (!row.contentStorageRef) {
      continue;
    }

    try {
      const content = await input.privateMemoryReader.readPrivateMemory({
        rawStorageRef: row.contentStorageRef,
        artifactId: row.sourceArtifactId,
        twinId: input.twinId,
        expectedCiphertextSha256: row.contentSha256,
      });

      candidates.push({
        id: row.id,
        twinId: row.twinId,
        sourceArtifactId: row.sourceArtifactId,
        content,
        importanceScore: row.importanceScore,
        confidenceScore: row.confidenceScore,
        occurredAt: row.occurredAt,
        createdAt: row.createdAt,
      });
    } catch (error) {
      console.warn("chat memory context fragment decrypt skipped", {
        memoryFragmentId: row.id,
        error: errorMessage(error),
      });
    }
  }

  return {
    results: retrieveRelevantMemories(candidates, { query: input.query, limit: 5 }),
  };
}

function buildPromptMessages(input: {
  currentMessage: string;
  memoryContext: { results: ReturnType<typeof retrieveRelevantMemories> };
  recentMessages: Array<typeof chatMessages.$inferSelect>;
  providerLabel: string;
}): ChatMessage[] {
  const memoryBlock = input.memoryContext.results.length > 0
    ? input.memoryContext.results
        .map((result, index) =>
          `[MEM_${index + 1}] ${truncate(result.memory.content, 900)}\nsourceArtifactId=${result.memory.sourceArtifactId}`,
        )
        .join("\n\n")
    : "No durable Sivraj memories were retrieved for this turn.";
  const recent = input.recentMessages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-10)
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
    }));

  return [
    {
      role: "system",
      content: [
        "You are the response model for Sivraj, a persistent user-owned memory layer.",
        "Sivraj is not the LLM. The LLM is replaceable; Sivraj supplies durable memory, citations, and compact context.",
        "Use the Sivraj memory context when relevant, cite memory labels like [MEM_1], and be clear when no relevant memory is available.",
        "Help the user feel the benefit: fewer repeated explanations, continuity across models, and no dependence on one model cutoff.",
        `Current model provider: ${input.providerLabel}.`,
        "",
        "Sivraj memory context:",
        memoryBlock,
      ].join("\n"),
    },
    ...recent,
    { role: "user", content: input.currentMessage },
  ];
}
