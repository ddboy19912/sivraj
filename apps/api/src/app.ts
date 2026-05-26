import { Hono } from "hono";
import { cors } from "hono/cors";
import { loadMemorySearchConfig, type MemorySearchConfig } from "@sivraj/config";
import {
  createLazyArtifactProcessingQueue,
  createLazyArtifactStatusPublisher,
  createLazyArtifactStatusSubscriber,
  createLazyTransientCiphertextCache,
  createLazyWeeklyReflectionQueue,
  type ArtifactProcessingQueue,
  type ArtifactStatusPublisher,
  type ArtifactStatusSubscriber,
  type TransientCiphertextCache,
  type WeeklyReflectionQueue,
} from "@sivraj/queue";
import { db } from "./db.js";
import { createArtifactRoutes } from "./routes/artifacts.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createAgentTokenRoutes } from "./routes/agent-tokens.js";
import { createCandidateMemoryRoutes } from "./routes/candidate-memories.js";
import { createConversationRoutes } from "./routes/conversations.js";
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
import { createSpeakerMappingRoutes } from "./routes/speaker-mappings.js";
import {
  createConfiguredPrivateMemoryReader,
  type PrivateMemoryReader,
} from "./services/private-memory-reader.js";
import { createPrivateMemoryStorage } from "./services/private-memory-storage.js";

export type ApiDb = Pick<typeof db, "delete" | "insert" | "select" | "update">;

export type AppDependencies = {
  db: ApiDb;
  privateMemoryStorage?: PrivateMemoryStorage;
  artifactProcessingQueue?: ArtifactProcessingQueue;
  artifactStatusPublisher?: ArtifactStatusPublisher;
  artifactStatusSubscriber?: ArtifactStatusSubscriber;
  transientCiphertextCache?: TransientCiphertextCache;
  githubImporter?: GitHubImporter;
  privateMemoryReader?: PrivateMemoryReader;
  weeklyReflectionQueue?: WeeklyReflectionQueue;
  memorySearchConfig?: MemorySearchConfig;
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
  | "chat_export"
  | "slack_export"
  | "whatsapp_export"
  | "github";

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

export type PrivateMemoryStorageOutput = {
  rawStorageRef: string;
  ciphertextSha256: string;
  encryptedBytesBase64?: string;
  seal: {
    packageId: string;
    policyId: string;
    threshold: number;
    keyServerObjectIds: string[];
  };
  walrus: {
    blobId: string;
    blobObjectId: string;
    startEpoch: number;
    endEpoch: number;
    size: string;
  };
};

export type PrivateMemoryStorage = {
  storePrivateMemory(
    input: PrivateMemoryStorageInput,
  ): Promise<PrivateMemoryStorageOutput>;
  storeEncryptedPrivateMemory(
    input: EncryptedPrivateMemoryStorageInput,
  ): Promise<PrivateMemoryStorageOutput>;
};

export function createApp(
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
    privateMemoryReader: createConfiguredPrivateMemoryReader(process.env),
    weeklyReflectionQueue: createLazyWeeklyReflectionQueue(
      process.env["REDIS_URL"],
    ),
    memorySearchConfig: loadMemorySearchConfig(process.env),
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
    "/v1/twins/:twinId/engineering",
    createEngineeringRoutes(dependencies),
  );
  app.route("/v1/twins/:twinId/graph", createGraphRoutes(dependencies));
  app.route("/v1/twins/:twinId/memories", createMemoryRoutes(dependencies));
  app.route("/v1/twins/:twinId/feedback", createFeedbackRoutes(dependencies));
  app.route(
    "/v1/twins/:twinId/reflections",
    createReflectionRoutes(dependencies),
  );

  return app;
}

export const app = createApp();

function readCorsOrigins(value: string | undefined): string[] {
  return (value ?? "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
