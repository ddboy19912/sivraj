import {
  DEFAULT_MANUAL_MEMORY_SENSITIVITY,
  ENCRYPTED_WALRUS_STORAGE_MODE,
} from "@sivraj/core";
import { sanitizeConversationSpeaker } from "./chat-sanitize.js";
import type { CoreCommsContext } from "./turn-types.js";

export function buildChatTurnLearningEncryptedStorageMetadata() {
  return {
    storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
    sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
    encryptedPayload: {
      kind: "source_artifact",
      version: 1,
      encryptionBoundary: "api",
    },
  };
}

export function buildChatTurnLearningArtifactContent(input: {
  userMessage: string;
  assistantMessage: string;
  coreCommsContext: CoreCommsContext;
}) {
  const userSpeaker = sanitizeConversationSpeaker(
    input.coreCommsContext.displayName ?? "User",
  );

  return JSON.stringify({
    messages: [
      {
        role: userSpeaker,
        sourceSpeakerId: "user",
        content: input.userMessage,
        createdAt: new Date().toISOString(),
      },
      {
        role: "bot",
        name: sanitizeConversationSpeaker(input.coreCommsContext.assistantName ?? "Assistant"),
        sourceSpeakerId: "assistant",
        content: input.assistantMessage,
        createdAt: new Date().toISOString(),
      },
    ],
  });
}
