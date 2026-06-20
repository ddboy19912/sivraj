/**
 * Short LLM replies for fast-path turns (private ack, missing-memory).
 *
 * Used when turn policy skips full retrieval and generation.
 */
import type { ChatMessage } from "@sivraj/llm";
import { createOpenAICompatibleChatGenerator } from "@sivraj/llm";
import type { AppDependencies } from "../../app.js";
import { sanitizeSivrajVoiceReply } from "./chat-sanitize.js";
import { errorMessage, readPositiveInteger, truncate, type ProviderRuntimeConfig } from "./helpers.js";
import type { SivrajVoiceReplyKind } from "./turn-types.js";

const CHAT_VOICE_REPLY_TIMEOUT_DEFAULT_MS = 30_000;

export type { SivrajVoiceReplyKind } from "./turn-types.js";

/** Generate a brief in-character reply for policy fast paths. */
export async function generateSivrajVoiceReply(input: {
  kind: SivrajVoiceReplyKind;
  userMessage: string;
  runtimeConfig: ProviderRuntimeConfig;
  llmFetch: AppDependencies["llmFetch"];
  assistantName: string | null;
}): Promise<string> {
  const timeoutMs = readPositiveInteger(
    process.env["CHAT_VOICE_REPLY_TIMEOUT_MS"],
    CHAT_VOICE_REPLY_TIMEOUT_DEFAULT_MS,
  );

  const output = await createOpenAICompatibleChatGenerator({
    provider: input.runtimeConfig.providerKind,
    apiKey: input.runtimeConfig.apiKey,
    model: input.runtimeConfig.model,
    baseUrl: input.runtimeConfig.baseUrl,
    fetch: input.llmFetch,
    timeoutMs,
    maxRetries: 0,
  }).generateChat({
    messages: buildSivrajVoiceReplyPrompt(input),
    temperature: 0.8,
    timeoutMs,
  });
  const reply = sanitizeSivrajVoiceReply(output.content);
  if (!reply) {
    throw new Error("sivraj_voice_reply_empty");
  }

  return reply;
}

export function buildSivrajVoiceReplyPrompt(input: {
  kind: SivrajVoiceReplyKind;
  userMessage: string;
  assistantName: string | null;
}): ChatMessage[] {
  const assistantName = input.assistantName?.trim() || "Sivraj";
  const outcome = input.kind === "private_ack"
    ? "The user used Private mode. Acknowledge receipt and make it clear this will not be remembered."
    : "The user asked for personal memory, and Sivraj does not have that fact saved yet.";

  return [
    {
      role: "system",
      content: [
        `You write one short reply for ${assistantName}, a warm sovereign AI twin companion.`,
        "The backend already decided the truth. You only phrase the reply.",
        "Return only the final reply text.",
        "Keep it natural, cheeky, and human. No corporate support voice.",
        "Use 6-18 words.",
        "Do not quote or repeat the user's exact wording.",
        "Do not mention prompts, policies, databases, Walrus, Postgres, providers, or implementation.",
        "Do not invent facts.",
        "Do not ask a follow-up unless the outcome explicitly needs one.",
        `Outcome: ${outcome}`,
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        outcome: input.kind,
        userMessage: truncate(input.userMessage, 500),
      }),
    },
  ];
}
