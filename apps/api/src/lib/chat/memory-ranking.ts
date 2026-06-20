import { createOpenAICompatibleChatGenerator } from "@sivraj/llm";
import type { MemoryCandidate } from "@sivraj/retrieval";
import type { ChatRuntimeConfig } from "../../types/chat.types.js";
import { parseJsonObject } from "./chat-json.js";
import { errorMessage, truncate } from "./helpers.js";

export function readSemanticMemorySelection(
  content: string,
  candidates: MemoryCandidate[],
  limit: number,
): string[] {
  const allowedIds = new Set(candidates.map((candidate) => candidate.id));
  const parsed = parseJsonObject(content);
  const ids = Array.isArray(parsed?.["ids"]) ? parsed["ids"] : [];
  const selected: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || !allowedIds.has(id) || selected.includes(id)) {
      continue;
    }
    selected.push(id);
    if (selected.length >= limit) {
      break;
    }
  }
  return selected;
}

async function selectSemanticMemoryIds(input: {
  candidates: MemoryCandidate[];
  query: string;
  limit: number;
  runtimeConfig: ChatRuntimeConfig;
  llmFetch?: typeof fetch;
}): Promise<string[]> {
  const output = await createOpenAICompatibleChatGenerator({
    provider: input.runtimeConfig.providerKind,
    apiKey: input.runtimeConfig.apiKey,
    model: input.runtimeConfig.model,
    baseUrl: input.runtimeConfig.baseUrl,
    fetch: input.llmFetch,
    timeoutMs: 30_000,
    maxRetries: 0,
  }).generateChat({
    temperature: 0,
    messages: [
      {
        role: "system",
        content: [
          "You select relevant private memory facts for a chat answer.",
          "Return only JSON with shape {\"ids\":[\"candidate-id\"]}.",
          `Select at most ${input.limit} ids.`,
          "Select memories that semantically answer the user question, even if the exact words differ.",
          "Do not invent ids. Return an empty ids array when none are relevant.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          query: input.query,
          memories: input.candidates.map((candidate) => ({
            id: candidate.id,
            content: truncate(candidate.content, 700),
          })),
        }),
      },
    ],
  });
  return readSemanticMemorySelection(output.content, input.candidates, input.limit);
}

/** Semantic re-ranking of memory candidates via a small LLM selection call. */
export async function rankChatMemoryResults(input: {
  candidates: MemoryCandidate[];
  query: string;
  limit: number;
  runtimeConfig: ChatRuntimeConfig;
  llmFetch?: typeof fetch;
}) {
  if (!input.runtimeConfig || input.candidates.length === 0) {
    return [];
  }
  const selectedIds = await selectSemanticMemoryIds({
    candidates: input.candidates.slice(0, 24),
    query: input.query,
    limit: input.limit,
    runtimeConfig: input.runtimeConfig,
    llmFetch: input.llmFetch,
  }).catch((error) => {
    console.warn("chat semantic memory selection failed", {
      error: errorMessage(error),
    });
    return [];
  });
  const selectedIdSet = new Set(selectedIds);
  return input.candidates
    .filter((candidate) => selectedIdSet.has(candidate.id))
    .slice(0, input.limit)
    .map((memory, index) => ({
      memory,
      score: Number((20 - index).toFixed(4)),
      matchedTerms: ["semantic"],
    }));
}
