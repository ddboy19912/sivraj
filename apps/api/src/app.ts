import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  loadMemorySearchConfig,
  type MemorySearchConfig,
} from "@sivraj/config";
import type { PrivateSourceStorageOutput } from "@sivraj/crypto-seal";
import {
  createLazyArtifactProcessingQueue,
  createLazyArtifactStatusPublisher,
  createLazyArtifactStatusSubscriber,
  createLazyConnectorSyncQueue,
  createLazyTransientCiphertextCache,
  createLazyWeeklyReflectionQueue,
  type ArtifactProcessingQueue,
  type ArtifactStatusPublisher,
  type ArtifactStatusSubscriber,
  type ConnectorSyncQueue,
  type TransientCiphertextCache,
  type WeeklyReflectionQueue,
} from "@sivraj/queue";
import { db } from "./db.js";
import { createArtifactRoutes } from "./routes/artifacts.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createAgentTokenRoutes } from "./routes/agent-tokens.js";
import { createCandidateMemoryRoutes } from "./routes/candidate-memories.js";
import { createChatRoutes } from "./routes/chat.js";
import { createConversationRoutes } from "./routes/conversations.js";
import { createConnectorRoutes } from "./routes/connectors.js";
import { createEngineeringRoutes } from "./routes/engineering.js";
import { createFeedbackRoutes } from "./routes/feedback.js";
import { createGraphRoutes } from "./routes/graph.js";
import {
  createGitHubImportRoutes,
  type GitHubImporter,
} from "./routes/github-imports.js";
import { healthRoutes } from "./routes/health.js";
import { createIdentityProfileRoutes } from "./routes/identity-profile.js";
import { createMemoryRoutes } from "./routes/memories.js";
import { createReflectionRoutes } from "./routes/reflections.js";
import { createSecurityRoutes } from "./routes/security.js";
import { createTerminalRoutes } from "./routes/terminal.js";
import { createSpeakerMappingRoutes } from "./routes/speaker-mappings.js";
import { createTwinProfileRoutes } from "./routes/twin-profile.js";
import { createVoiceRoutes } from "./routes/voice.js";
import {
  createConfiguredPrivateMemoryReader,
  type PrivateMemoryReader,
} from "@sivraj/private-memory-reader";
import {
  createConfiguredSpeechToTextTranscriber,
  type SpeechToTextTranscriber,
} from "@sivraj/llm";
import { createPrivateMemoryStorage } from "./services/private-memory-storage.js";
import {
  createConfiguredRealtimeTextToSpeechTokenIssuer,
  createConfiguredRealtimeSpeechToTextTokenIssuer,
  createConfiguredVoiceSynthesizer,
  type RealtimeTextToSpeechTokenIssuer,
  type RealtimeSpeechToTextTokenIssuer,
  type VoiceSynthesizer,
} from "./services/voice-service-client.js";

export type ApiDb = Pick<typeof db, "delete" | "insert" | "select" | "update">;

export type AppDependencies = {
  db: ApiDb;
  privateMemoryStorage?: PrivateMemoryStorage;
  artifactProcessingQueue?: ArtifactProcessingQueue;
  artifactStatusPublisher?: ArtifactStatusPublisher;
  artifactStatusSubscriber?: ArtifactStatusSubscriber;
  transientCiphertextCache?: TransientCiphertextCache;
  connectorSyncQueue?: ConnectorSyncQueue;
  githubImporter?: GitHubImporter;
  privateMemoryReader?: PrivateMemoryReader;
  weeklyReflectionQueue?: WeeklyReflectionQueue;
  memorySearchConfig?: MemorySearchConfig;
  voiceSynthesizer?: VoiceSynthesizer;
  speechToTextTranscriber?: SpeechToTextTranscriber | null;
  realtimeSpeechToTextTokenIssuer?: RealtimeSpeechToTextTokenIssuer;
  realtimeTextToSpeechTokenIssuer?: RealtimeTextToSpeechTokenIssuer;
  voicePreviewAssetDir?: string;
  llmFetch?: typeof fetch;
};

export type SupportedArtifactSourceType =
  | "note"
  | "browser_history"
  | "markdown"
  | "upload"
  | "pdf"
  | "ocr_pdf"
  | "image"
  | "voice_note"
  | "voice_conversation"
  | "onboarding_self_description"
  | "docx"
  | "csv"
  | "email"
  | "calendar"
  | "chat_export"
  | "slack_export"
  | "whatsapp_export"
  | "github"
  | "api"
  | "other";

export type PrivateMemoryStorageInput = {
  twinId: string;
  sourceType: SupportedArtifactSourceType;
  title: string | null;
  content: string;
  metadata: Record<string, unknown>;
};

export type EncryptedPrivateMemoryStorageInput = {
  twinId: string;
  sourceType: SupportedArtifactSourceType;
  encryptedBytes: Uint8Array;
  ciphertextSha256: string;
  seal: PrivateMemoryStorageOutput["seal"];
};

export type PrivateMemoryStorageOutput = PrivateSourceStorageOutput;

export type PrivateMemoryStorage = {
  storePrivateMemory(
    input: PrivateMemoryStorageInput,
  ): Promise<PrivateMemoryStorageOutput>;
  storeEncryptedPrivateMemory(
    input: EncryptedPrivateMemoryStorageInput,
  ): Promise<PrivateMemoryStorageOutput>;
};

function createApp(
  dependencies: AppDependencies = {
    db,
    privateMemoryStorage: createPrivateMemoryStorage(process.env),
    artifactProcessingQueue: createLazyArtifactProcessingQueue(
      process.env["REDIS_URL"],
    ),
    artifactStatusPublisher: createLazyArtifactStatusPublisher(
      process.env["REDIS_URL"],
    ),
    artifactStatusSubscriber: createLazyArtifactStatusSubscriber(
      process.env["REDIS_URL"],
    ),
    transientCiphertextCache: createLazyTransientCiphertextCache(
      process.env["REDIS_URL"],
    ),
    connectorSyncQueue: createLazyConnectorSyncQueue(process.env["REDIS_URL"]),
    privateMemoryReader: createConfiguredPrivateMemoryReader(process.env),
    weeklyReflectionQueue: createLazyWeeklyReflectionQueue(
      process.env["REDIS_URL"],
    ),
    memorySearchConfig: loadMemorySearchConfig(process.env),
    voiceSynthesizer: createConfiguredVoiceSynthesizer(process.env),
    speechToTextTranscriber: createConfiguredSpeechToTextTranscriber(process.env),
    realtimeSpeechToTextTokenIssuer: createConfiguredRealtimeSpeechToTextTokenIssuer(process.env),
    realtimeTextToSpeechTokenIssuer: createConfiguredRealtimeTextToSpeechTokenIssuer(process.env),
    voicePreviewAssetDir: process.env["VOICE_PREVIEW_ASSET_DIR"],
  },
) {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: readCorsOrigins(process.env["CORS_ORIGINS"]),
      allowHeaders: ["content-type", "authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  app.route("/health", healthRoutes);
  app.route("/v1/auth", createAuthRoutes(dependencies));
  app.route("/v1/twins/:twinId/agents", createAgentTokenRoutes(dependencies));
  app.route("/v1/twins/:twinId", createTwinProfileRoutes(dependencies));
  app.route("/v1/twins/:twinId", createIdentityProfileRoutes(dependencies));
  app.route(
    "/v1/twins/:twinId/imports/github",
    createGitHubImportRoutes(dependencies),
  );
  app.route("/v1/twins/:twinId/artifacts", createArtifactRoutes(dependencies));
  app.route(
    "/v1/twins/:twinId/artifacts",
    createSpeakerMappingRoutes(dependencies),
  );
  app.route(
    "/v1/twins/:twinId/candidate-memories",
    createCandidateMemoryRoutes(dependencies),
  );
  app.route(
    "/v1/twins/:twinId/conversations",
    createConversationRoutes(dependencies),
  );
  app.route(
    "/v1/twins/:twinId/connectors",
    createConnectorRoutes(dependencies),
  );
  app.route(
    "/v1/twins/:twinId/engineering",
    createEngineeringRoutes(dependencies),
  );
  app.route("/v1/twins/:twinId/graph", createGraphRoutes(dependencies));
  app.route("/v1/twins/:twinId/memories", createMemoryRoutes(dependencies));
  app.route("/v1/twins/:twinId/feedback", createFeedbackRoutes(dependencies));
  app.route("/v1/twins/:twinId/chat", createChatRoutes(dependencies));
  app.route("/v1/twins/:twinId/voice", createVoiceRoutes(dependencies));
  app.route("/v1/twins/:twinId/terminal", createTerminalRoutes(dependencies));
  app.route(
    "/v1/twins/:twinId/reflections",
    createReflectionRoutes(dependencies),
  );
  app.route("/v1/twins/:twinId/security", createSecurityRoutes(dependencies));

  return app;
}

export const app = createApp();

function readCorsOrigins(value: string | undefined): string[] {
  return (value ?? "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
