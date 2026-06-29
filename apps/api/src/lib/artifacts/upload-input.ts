import {
  DEFAULT_MANUAL_MEMORY_SENSITIVITY,
  ENCRYPTED_WALRUS_STORAGE_MODE,
} from "@sivraj/core";
import type { SupportedArtifactSourceType } from "../../app.js";
import { recordMetadata, sanitizeSafeMetadata } from "../safe-metadata.js";
import {
  optionalSha256,
  optionalString,
  readBodyEncryptedPayload,
  requiredString,
} from "../http/route-helpers.js";
import { detectAiChatProviderFromFilename, readAiChatProvider } from "./ai-chat-provider.js";

const SUPPORTED_SOURCE_TYPES = [
  "note", "browser_history", "markdown", "upload", "pdf", "ocr_pdf", "image",
  "voice_note", "voice_conversation", "onboarding_self_description", "docx",
  "csv", "email", "calendar", "chat_export", "slack_export", "whatsapp_export",
  "github", "telegram_message", "api", "other",
] as const;

export function readSupportedSourceType(
  value: unknown,
): SupportedArtifactSourceType | null {
  return SUPPORTED_SOURCE_TYPES.includes(value as SupportedArtifactSourceType)
    ? value as SupportedArtifactSourceType
    : null;
}

export function buildArtifactStorageMetadata(input: {
  safeUploadMetadata: Record<string, unknown>;
  aiChatImportMetadata: Record<string, unknown>;
  aiChatImportFingerprint: {
    version: number;
    conversationCount: number;
    messageCount: number;
  } | null;
  encryptedPayload: ReturnType<typeof readBodyEncryptedPayload>;
}) {
  return {
    ...input.safeUploadMetadata,
    ...input.aiChatImportMetadata,
    ...(input.aiChatImportFingerprint
      ? {
          aiChatImportFingerprintVersion: input.aiChatImportFingerprint.version,
          aiChatConversationCount: input.aiChatImportFingerprint.conversationCount,
          aiChatMessageCount: input.aiChatImportFingerprint.messageCount,
        }
      : {}),
    storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
    sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
    encryptedPayload: {
      kind: "source_artifact",
      version: 1,
      encryptionBoundary: input.encryptedPayload ? "client" : "api",
    },
  };
}

export function validateArtifactUploadFields(input: {
  sourceType: SupportedArtifactSourceType | null;
  rawSourceType: unknown;
  encryptedPayload: ReturnType<typeof readBodyEncryptedPayload>;
  content: string | null;
}) {
  if (!input.sourceType) {
    return {
      error: {
        status: 400 as const,
        body: { error: "unsupported_source_type", sourceType: input.rawSourceType },
      },
    };
  }

  if (input.encryptedPayload === "invalid") {
    return { error: { status: 400 as const, body: { error: "invalid_encrypted_payload" } } };
  }

  if (!input.content && !input.encryptedPayload) {
    return { error: { status: 400 as const, body: { error: "missing_content" } } };
  }

  return null;
}

export function readArtifactUploadFields(body: Record<string, unknown>) {
  const sourceType = readSupportedSourceType(body["sourceType"]);
  const title = optionalString(body["title"]);
  const content = requiredString(body["content"]);
  const contentSha256 = optionalSha256(body["contentSha256"] ?? body["contentHash"]);
  const encryptedPayload = readBodyEncryptedPayload(body);
  const privateMetadata = recordMetadata(body["metadata"]);
  const safeUploadMetadata = sanitizeSafeMetadata(privateMetadata);

  return {
    sourceType,
    title,
    content,
    contentSha256,
    encryptedPayload,
    privateMetadata,
    safeUploadMetadata,
  };
}

export function detectExplicitAiChatProvider(metadata: Record<string, unknown>) {
  return readAiChatProvider(
    metadata["aiChatProvider"] ??
      metadata["chatProvider"] ??
      metadata["provider"],
  );
}
