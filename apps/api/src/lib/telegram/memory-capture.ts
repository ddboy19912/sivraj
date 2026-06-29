import type { AppDependencies } from "../../app.js";
import { loadCachedCoreCommsContext, loadCachedRuntimeProviderConfig } from "../chat/chat-cache.js";
import { resolveUserMemorySubject } from "../chat/current-truth.js";
import {
  runChatMemoryIntake,
  type ChatMemoryIntent,
  type MemoryIntakeResult,
} from "../chat/memory-intake.js";
import {
  buildMemoryIntakeAcknowledgement,
  storedMemoryCount,
} from "../chat/turn-policy.js";

type TelegramMemoryIntent = Exclude<ChatMemoryIntent, "private">;

export type TelegramHotMemoryCommitResult =
  | {
      status: "committed";
      reason: null;
      memoryIntake: MemoryIntakeResult;
      storedCount: number;
      replyText: string;
    }
  | {
      status: "captured_only";
      reason: "no_retrievable_memory";
      memoryIntake: MemoryIntakeResult;
      storedCount: 0;
      replyText: null;
    }
  | {
      status: "skipped";
      reason: "llm_provider_not_configured";
      memoryIntake: null;
      storedCount: 0;
      replyText: null;
    }
  | {
      status: "failed";
      reason: "memory_intake_failed";
      memoryIntake: MemoryIntakeResult | null;
      storedCount: number;
      errorMessage: string;
      replyText: null;
    };

export type TelegramTextCaptureDisposition =
  | { action: "capture" }
  | {
      action: "ignore";
      reason: "low_signal";
      replyText: string;
    };

export async function commitTelegramTextToHotMemory(input: {
  deps: AppDependencies;
  twinId: string;
  sourceArtifactId: string;
  text: string;
}): Promise<TelegramHotMemoryCommitResult> {
  const runtimeConfig = await loadCachedRuntimeProviderConfig(input.deps.db, input.twinId);

  if (!runtimeConfig) {
    return {
      status: "skipped",
      reason: "llm_provider_not_configured",
      memoryIntake: null,
      storedCount: 0,
      replyText: null,
    };
  }

  const intent = telegramTextMemoryIntent(input.text);

  try {
    const coreCommsContext = await loadCachedCoreCommsContext(input.deps.db, input.twinId);
    const memoryIntake = await runChatMemoryIntake({
      db: input.deps.db,
      twinId: input.twinId,
      userMessageId: input.sourceArtifactId,
      turnId: null,
      subject: resolveUserMemorySubject(coreCommsContext),
      message: input.text,
      intent,
      losslessFallback: intent === "remember",
      runtimeConfig,
      llmFetch: input.deps.llmFetch,
    });
    const count = storedMemoryCount(memoryIntake);

    if (count > 0) {
      return {
        status: "committed",
        reason: null,
        memoryIntake,
        storedCount: count,
        replyText: formatTelegramMemoryCommitReply(memoryIntake),
      };
    }

    if (memoryIntake.status === "failed") {
      return {
        status: "failed",
        reason: "memory_intake_failed",
        memoryIntake,
        storedCount: 0,
        errorMessage: memoryIntake.errorMessage ?? "memory intake failed",
        replyText: null,
      };
    }

    return {
      status: "captured_only",
      reason: "no_retrievable_memory",
      memoryIntake,
      storedCount: 0,
      replyText: null,
    };
  } catch (error: unknown) {
    return {
      status: "failed",
      reason: "memory_intake_failed",
      memoryIntake: null,
      storedCount: 0,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
      replyText: null,
    };
  }
}

export function telegramTextMemoryIntent(text: string): TelegramMemoryIntent {
  const normalized = text.toLowerCase();

  if (/\b(?:don't|dont|do not|never)\s+(?:remember|save|store|keep|note)\b/u.test(normalized)) {
    return "auto";
  }

  return /\b(?:remember|save|store|keep|note|make a note|don't forget|dont forget|do not forget)\b/u.test(normalized)
    ? "remember"
    : "auto";
}

export function resolveTelegramTextCaptureDisposition(text: string): TelegramTextCaptureDisposition {
  if (telegramTextMemoryIntent(text) === "remember") {
    return { action: "capture" };
  }

  if (isLowSignalTelegramText(text)) {
    return {
      action: "ignore",
      reason: "low_signal",
      replyText: "Hi. Send something you want me to remember, or ask me a question.",
    };
  }

  return { action: "capture" };
}

export function telegramHotMemoryCommitMetadata(result: TelegramHotMemoryCommitResult) {
  return {
    status: result.status,
    reason: result.reason,
    retrievable: result.status === "committed",
    storedCount: result.storedCount,
    factCount: result.memoryIntake?.facts.length ?? 0,
    engineeringMemoryCount: result.memoryIntake?.engineeringMemories.length ?? 0,
    intakeStatus: result.memoryIntake?.status ?? null,
    intakeSource: result.memoryIntake?.source ?? null,
    ...(result.status === "failed" ? { errorMessage: result.errorMessage } : {}),
  };
}

export function telegramTextCaptureReply(result: TelegramHotMemoryCommitResult): string {
  if (result.status === "committed" && result.replyText.trim()) {
    return result.replyText;
  }

  return "Captured. I'll process this into memory shortly.";
}

function formatTelegramMemoryCommitReply(memoryIntake: MemoryIntakeResult): string {
  const acknowledgement = buildMemoryIntakeAcknowledgement(memoryIntake).trim();
  const fallback = "Remembered in your Twin.";
  const reply = acknowledgement || fallback;

  return reply.length <= 512 ? reply : `${reply.slice(0, 509).trimEnd()}...`;
}

function isLowSignalTelegramText(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  if (!normalized) {
    return true;
  }

  if (normalized.length > 48) {
    return false;
  }

  return LOW_SIGNAL_TELEGRAM_TEXT.has(normalized) ||
    /^(?:hi|hello|hey|yo|sup|gm|gn|good morning|good afternoon|good evening)(?: sivraj| bot)?$/u.test(normalized) ||
    /^(?:ok|okay|k|cool|great|nice|thanks|thank you|ty|lol|haha|test|testing)$/u.test(normalized);
}

const LOW_SIGNAL_TELEGRAM_TEXT = new Set([
  "hi",
  "hello",
  "hey",
  "yo",
  "gm",
  "gn",
  "good morning",
  "good afternoon",
  "good evening",
  "thanks",
  "thank you",
  "ok",
  "okay",
  "cool",
  "great",
  "nice",
  "test",
  "testing",
]);
