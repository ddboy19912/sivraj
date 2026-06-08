import {
  DEFAULT_MANUAL_MEMORY_SENSITIVITY,
  ENCRYPTED_WALRUS_STORAGE_MODE,
} from "@sivraj/core";
import { auditEvents, sourceArtifacts } from "@sivraj/db";
import { parseChatExport } from "@sivraj/ingestion";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import type { AppDependencies } from "../../app.js";
import type { AuthEnv } from "../../middleware/auth.js";
import { detectAiChatProviderFromFilename } from "./ai-chat-provider.js";
import { detectExplicitAiChatProvider } from "./upload-input.js";
import type { AuthorizedTwin } from "../http/route-auth.js";
import { optionalString } from "../http/route-helpers.js";

export function detectAiChatImportMetadata(input: {
  content: string;
  metadata: Record<string, unknown>;
  title?: string | null;
}): Record<string, unknown> {
  const explicitProvider = detectExplicitAiChatProvider(input.metadata);

  const provider = explicitProvider ??
    detectAiChatProviderFromFilename(input.title ?? optionalString(input.metadata["fileName"])) ??
    detectAiChatProviderFromContent(input.content);

  if (!provider) {
    return {};
  }

  return {
    aiChatProvider: provider,
    aiChatImportKind: "export",
  };
}

export function computeAiChatImportFingerprint(input: {
  content: string;
  metadata: Record<string, unknown>;
  provider?: string | null;
}): {
  hash: string;
  version: number;
  conversationCount: number;
  messageCount: number;
} | null {
  const explicitFingerprint = optionalString(input.metadata["aiChatImportFingerprint"]);

  if (explicitFingerprint) {
    return {
      hash: sha256Hex(`ai-chat-import:v1:explicit:${explicitFingerprint}`),
      version: 1,
      conversationCount: readNonNegativeInteger(input.metadata["aiChatConversationCount"]) ?? 0,
      messageCount: readNonNegativeInteger(input.metadata["aiChatMessageCount"]) ?? 0,
    };
  }

  if (!input.content) {
    return null;
  }

  const parsed = parseChatExport({ content: input.content });
  const chatExport = parsed.parser.chatExport;

  if (!chatExport || chatExport.conversations.length === 0) {
    return null;
  }

  const provider = input.provider ?? chatExport.provider;
  const conversations = chatExport.conversations.map((conversation) => ({
    id: conversation.sourceConversationId ?? null,
    title: conversation.title ?? null,
    messageCount: conversation.messageCount,
    firstMessageAt: conversation.firstMessageAt ?? null,
    lastMessageAt: conversation.lastMessageAt ?? null,
    sourceMessageIds: [...(conversation.sourceMessageIds ?? [])].sort(),
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const material = JSON.stringify({
    version: 1,
    provider,
    conversations,
  });

  return {
    hash: sha256Hex(`ai-chat-import:v1:${material}`),
    version: 1,
    conversationCount: conversations.length,
    messageCount: conversations.reduce((total, conversation) => total + conversation.messageCount, 0),
  };
}

export async function findDuplicateAiChatImport(
  c: Context<AuthEnv>,
  input: {
    db: AppDependencies["db"];
    auth: AuthorizedTwin["auth"];
    twinId: string;
    fingerprint: ReturnType<typeof computeAiChatImportFingerprint>;
    aiChatImportMetadata: Record<string, unknown>;
  },
) {
  if (!input.fingerprint) {
    return null;
  }

  const [duplicateArtifact] = await input.db
    .select({
      id: sourceArtifacts.id,
      ingestionStatus: sourceArtifacts.ingestionStatus,
    })
    .from(sourceArtifacts)
    .where(and(
      eq(sourceArtifacts.twinId, input.twinId),
      eq(sourceArtifacts.sourceType, "chat_export"),
      eq(sourceArtifacts.hash, input.fingerprint.hash),
    ))
    .limit(1);

  if (!duplicateArtifact) {
    return null;
  }

  await input.db.insert(auditEvents).values({
    twinId: input.twinId,
    actorType: input.auth.type,
    actorId: input.auth.sub,
    eventType: "artifact.skipped_duplicate",
    resourceType: "source_artifact",
    resourceId: duplicateArtifact.id,
    metadata: {
      reason: "duplicate_ai_chat_import",
      aiChatProvider: input.aiChatImportMetadata["aiChatProvider"] ?? "generic_chat",
      aiChatImportFingerprintVersion: input.fingerprint.version,
      aiChatConversationCount: input.fingerprint.conversationCount,
      aiChatMessageCount: input.fingerprint.messageCount,
    },
  });

  return c.json({
    artifactId: duplicateArtifact.id,
    memoryFragmentId: null,
    status: duplicateArtifact.ingestionStatus,
    storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
    sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
    skipped: true,
    reason: "duplicate_ai_chat_import",
  });
}

function detectAiChatProviderFromContent(content: string): "chatgpt" | "claude" | "generic_chat" | undefined {
  const parsedJson = parseJsonObject(content);

  if (!parsedJson) {
    return undefined;
  }

  const conversations = Array.isArray(parsedJson)
    ? parsedJson
    : isRecord(parsedJson)
      ? firstArrayValue(parsedJson, ["conversations", "chats", "items"])
      : undefined;

  if (!Array.isArray(conversations)) {
    return undefined;
  }

  if (conversations.some((conversation) => isRecord(conversation) && isRecord(conversation["mapping"]))) {
    return "chatgpt";
  }

  if (
    conversations.some((conversation) =>
      isRecord(conversation) &&
      (Array.isArray(conversation["chat_messages"]) ||
        typeof conversation["uuid"] === "string")
    )
  ) {
    return "claude";
  }

  return "generic_chat";
}

function parseJsonObject(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return null;
  }
}

function firstArrayValue(record: Record<string, unknown>, keys: string[]): unknown[] | undefined {
  for (const key of keys) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return undefined;
  }

  return value;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
