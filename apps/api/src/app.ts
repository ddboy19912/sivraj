import { Hono } from "hono";
import { db } from "./db.js";
import { createArtifactRoutes } from "./routes/artifacts.js";
import { createAuthRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { createPrivateMemoryStorage } from "./services/private-memory-storage.js";

export type ApiDb = Pick<typeof db, "insert" | "select">;

export type AppDependencies = {
  db: ApiDb;
  privateMemoryStorage?: PrivateMemoryStorage;
};

export type PrivateMemoryStorageInput = {
  twinId: string;
  sourceType: "note";
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
}) {
  const app = new Hono();

  app.route("/health", healthRoutes);
  app.route("/v1/auth", createAuthRoutes(dependencies));
  app.route("/v1/twins/:twinId/artifacts", createArtifactRoutes(dependencies));

  return app;
}

export const app = createApp();
