import type { ChatMessage } from "@sivraj/llm";
import { createOpenAICompatibleChatGenerator } from "@sivraj/llm";
import { retrieveRelevantMemories } from "@sivraj/retrieval";
import type { AppDependencies } from "../../app.js";
import { readRecord } from "../http/route-helpers.js";
import {
  errorMessage,
  readPositiveInteger,
  truncate,
  type ProviderRuntimeConfig,
} from "./helpers.js";
import type { GeneratedChatTitle } from "./turn-types.js";

const CHAT_TITLE_MAX_LENGTH = 64;
const CHAT_TITLE_DEFAULT_TIMEOUT_MS = 30_000;

type ChatTitleMemoryContext = {
  results: ReturnType<typeof retrieveRelevantMemories>;
};

export async function generateSemanticChatTitle(input: {
  userMessage: string;
  assistantMessage: string;
  memoryContext: ChatTitleMemoryContext;
  runtimeConfig: ProviderRuntimeConfig;
  llmFetch: AppDependencies["llmFetch"];
}): Promise<GeneratedChatTitle> {
  try {
    const output = await createOpenAICompatibleChatGenerator({
      provider: input.runtimeConfig.providerKind,
      apiKey: input.runtimeConfig.apiKey,
      model: input.runtimeConfig.model,
      baseUrl: input.runtimeConfig.baseUrl,
      fetch: input.llmFetch,
      timeoutMs: readPositiveInteger(process.env["CHAT_TITLE_TIMEOUT_MS"], CHAT_TITLE_DEFAULT_TIMEOUT_MS),
      maxRetries: 0,
    }).generateChat({
      messages: buildTitlePromptMessages(input),
      temperature: 0,
      timeoutMs: readPositiveInteger(process.env["CHAT_TITLE_TIMEOUT_MS"], CHAT_TITLE_DEFAULT_TIMEOUT_MS),
    });
    const title = normalizeGeneratedChatTitle(output.content, {
      assistantMessage: input.assistantMessage,
    });

    if (!title) {
      return {
        status: "failed",
        errorMessage: "chat_title_invalid_output",
      };
    }

    return {
      status: "generated",
      title,
      generatedAt: new Date().toISOString(),
      providerKind: input.runtimeConfig.providerKind,
      model: output.model || input.runtimeConfig.model,
    };
  } catch (error) {
    console.warn("chat title generation failed", {
      providerKind: input.runtimeConfig.providerKind,
      model: input.runtimeConfig.model,
      error: errorMessage(error),
    });

    return {
      status: "failed",
      errorMessage: errorMessage(error),
    };
  }
}

function buildTitlePromptMessages(input: {
  userMessage: string;
  assistantMessage: string;
  memoryContext: ChatTitleMemoryContext;
}): ChatMessage[] {
  const memoryContext = input.memoryContext.results.length > 0
    ? input.memoryContext.results
        .slice(0, 3)
        .map((result, index: number) => `[MEM_${index + 1}] ${truncate(result.memory.content, 180)}`)
        .join("\n")
    : "No retrieved memory.";

  return [
    {
      role: "system",
      content: [
        "Generate a concise chat title.",
        "Return only the title text.",
        "Use 2-6 words and 64 characters or fewer.",
        "Do not use quotes, markdown, emoji, or a trailing period.",
        "Do not include exact secrets, codes, keys, tokens, or private identifiers from the conversation.",
        "If the answer contains a literal secret/code, summarize the user's task instead of naming the secret/code.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "First user message:",
        truncate(input.userMessage, 600),
        "",
        "Assistant response:",
        truncate(input.assistantMessage, 600),
        "",
        "Retrieved memory context:",
        memoryContext,
      ].join("\n"),
    },
  ];
}

export function normalizeGeneratedChatTitle(
  value: string,
  options: { assistantMessage?: string } = {},
): string | null {
  const stripped = value
    .trim()
    .replace(/^```(?:text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "")
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!stripped || stripped.length > CHAT_TITLE_MAX_LENGTH) {
    return null;
  }

  if (/[*#[\]{}<>]/u.test(stripped)) {
    return null;
  }

  const words = stripped.split(/\s+/u).filter(Boolean);
  if (words.length < 2 || words.length > 6) {
    return null;
  }

  if (isGenericChatTitle(stripped)) {
    return null;
  }

  if (containsSensitiveLiteral(stripped)) {
    return null;
  }

  const assistantLiteral = options.assistantMessage?.trim() ?? "";
  if (
    assistantLiteral &&
    isSensitiveLiteral(assistantLiteral) &&
    stripped.toLowerCase().includes(assistantLiteral.toLowerCase())
  ) {
    return null;
  }

  return stripped.slice(0, CHAT_TITLE_MAX_LENGTH);
}

export function resolveThreadTitleUpdate(input: {
  currentTitle: string;
  currentMetadata: unknown;
  generatedTitle: GeneratedChatTitle;
  runtimeConfig: ProviderRuntimeConfig;
  fallbackTitle: string;
}) {
  const currentMetadata = readRecord(input.currentMetadata) ?? {};
  const isAutoOwnedTitle = isAutoOwnedThreadTitle({
    currentTitle: input.currentTitle,
    fallbackTitle: input.fallbackTitle,
    metadata: currentMetadata,
  });

  if (!isAutoOwnedTitle) {
    return {
      title: input.currentTitle,
      metadata: currentMetadata,
      auditMetadata: {
        source: "skipped",
        reason: "title_not_auto_owned",
      },
    };
  }

  if (input.generatedTitle.status === "generated") {
    return {
      title: input.generatedTitle.title,
      metadata: {
        ...currentMetadata,
        titleSource: "generated",
        titleGeneratedAt: input.generatedTitle.generatedAt,
        titleModel: input.generatedTitle.model,
        titleProviderKind: input.generatedTitle.providerKind,
      },
      auditMetadata: {
        source: "generated",
        title: input.generatedTitle.title,
        model: input.generatedTitle.model,
        providerKind: input.generatedTitle.providerKind,
      },
    };
  }

  return {
    title: input.fallbackTitle,
    metadata: {
      ...currentMetadata,
      titleSource: "fallback",
      titleGeneratedAt: new Date().toISOString(),
      titleModel: input.runtimeConfig.model,
      titleProviderKind: input.runtimeConfig.providerKind,
      titleErrorMessage: input.generatedTitle.errorMessage.slice(0, 240),
    },
    auditMetadata: {
      source: "fallback",
      title: input.fallbackTitle,
      errorMessage: input.generatedTitle.errorMessage.slice(0, 240),
      model: input.runtimeConfig.model,
      providerKind: input.runtimeConfig.providerKind,
    },
  };
}

function isAutoOwnedThreadTitle(input: {
  currentTitle: string;
  fallbackTitle: string;
  metadata: Record<string, unknown>;
}) {
  return input.currentTitle === "New chat" ||
    input.currentTitle === input.fallbackTitle ||
    input.metadata["titleSource"] === "fallback";
}

function isGenericChatTitle(value: string) {
  const normalized = value.toLowerCase();
  return new Set([
    "new chat",
    "untitled chat",
    "chat title",
    "user question",
    "quick question",
    "general chat",
    "conversation summary",
  ]).has(normalized);
}

function isSensitiveLiteral(value: string) {
  const normalized = value.trim();
  return /^[A-Z0-9][A-Z0-9_-]{5,}$/u.test(normalized) ||
    /(?:api|secret|token|key|code)[_-]?[A-Z0-9_-]{8,}/iu.test(normalized);
}

function containsSensitiveLiteral(value: string) {
  return value
    .split(/\s+/u)
    .some((part) => isSensitiveLiteral(part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")));
}
