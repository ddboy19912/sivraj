import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  createLazyArtifactProcessingQueue,
  type ArtifactProcessingQueue,
} from "@sivraj/queue";
import { db } from "./db.js";
import { createArtifactRoutes } from "./routes/artifacts.js";
import { createAuthRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { createMemoryRoutes } from "./routes/memories.js";
import { createPrivateMemoryStorage } from "./services/private-memory-storage.js";

export type ApiDb = Pick<typeof db, "insert" | "select" | "update">;

export type AppDependencies = {
  db: ApiDb;
  privateMemoryStorage?: PrivateMemoryStorage;
  artifactProcessingQueue?: ArtifactProcessingQueue;
};

export type SupportedArtifactSourceType = "note" | "markdown" | "upload" | "pdf";

export type PrivateMemoryStorageInput = {
  twinId: string;
  sourceType: SupportedArtifactSourceType;
  title: string | null;
  content: string;
  metadata: Record<string, unknown>;
};

export type PrivateMemoryStorageOutput = {
  rawStorageRef: string;
  ciphertextSha256: string;
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
  storePrivateMemory(input: PrivateMemoryStorageInput): Promise<PrivateMemoryStorageOutput>;
};

export function createApp(dependencies: AppDependencies = {
  db,
  privateMemoryStorage: createPrivateMemoryStorage(process.env),
  artifactProcessingQueue: createLazyArtifactProcessingQueue(process.env["REDIS_URL"]),
}) {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: readCorsOrigins(process.env["CORS_ORIGINS"]),
      allowHeaders: ["content-type", "authorization"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  app.route("/health", healthRoutes);
  app.route("/v1/auth", createAuthRoutes(dependencies));
  app.route("/v1/twins/:twinId/artifacts", createArtifactRoutes(dependencies));
  app.route("/v1/twins/:twinId/memories", createMemoryRoutes(dependencies));

  return app;
}

export const app = createApp();

function readCorsOrigins(value: string | undefined): string[] {
  return (value ?? "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
