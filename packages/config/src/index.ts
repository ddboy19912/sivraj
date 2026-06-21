export { loadNearestEnv, type LoadNearestEnvOptions } from "./load-nearest-env.js";

export type NodeEnv = "development" | "test" | "production";
export type LogLevel = "debug" | "info" | "warn" | "error";

export type EnvSource = Record<string, string | undefined>;

export type AppConfig = {
  nodeEnv: NodeEnv;
  appUrl: string;
  apiUrl: string;
};

export type ApiConfig = {
  host: string;
  port: number;
  corsOrigins: string[];
  jwtSecret: string;
  tokenIssuer: string;
};

export type MemorySearchConfig = {
  shortlistLimit: number;
  fallbackLimit: number;
  decryptConcurrency: number;
  decryptEvidenceLimit: number;
};

export type DatabaseConfig = {
  url: string;
};

/** Matches root `.env.example` when `DATABASE_URL` is unset (local tooling only). */
export const DEFAULT_DATABASE_URL =
  "postgresql://sivraj:sivraj@localhost:5432/sivraj";

/**
 * Postgres URL for tooling (`drizzle-kit`, ad-hoc scripts) where a full `loadConfig` is undesirable.
 * Services should use `loadConfig(env).database` so `DATABASE_URL` remains required at runtime.
 */
export function resolveDatabaseUrl(env: EnvSource): string {
  const value = env["DATABASE_URL"];
  return value && value.length > 0 ? value : DEFAULT_DATABASE_URL;
}

export type QueueConfig = {
  redisUrl: string;
  workerConcurrency: number;
  artifactReconcileIntervalMs: number;
  artifactReconcileLimit: number;
};

export type LlmConfig = {
  provider: string;
  apiKey: string;
  model: string;
  embeddingModel: string;
};

export type WalrusConfig = {
  network: string;
  epochs: number;
  deletable: boolean;
  aggregatorUrl?: string;
};

export type AgentContextPreset = "codex" | "claude_code" | "cursor" | "generic_mcp";

export type SealConfig = {
  packageId: string;
  policyId: string;
  keyServers: string;
  threshold: number;
};

export type SuiConfig = {
  network: string;
  rpcUrl: string;
  privateKey: string;
};

export type ObservabilityConfig = {
  logLevel: LogLevel;
  otlpEndpoint?: string;
};

export type McpServerConfig = {
  apiUrl: string;
  twinId: string;
  token: string;
  projectName?: string;
  projectId?: string;
  agentPreset: AgentContextPreset;
  includeCandidates: boolean;
  maxItemsPerSection: number;
  writebackEncryption: "api" | "client";
  seal?: SealConfig;
  sui?: Pick<SuiConfig, "network" | "rpcUrl">;
};

export type SivrajConfig = {
  app: AppConfig;
  api: ApiConfig;
  memorySearch: MemorySearchConfig;
  database: DatabaseConfig;
  queue: QueueConfig;
  llm: LlmConfig;
  walrus: WalrusConfig;
  seal: SealConfig;
  sui: SuiConfig;
  observability: ObservabilityConfig;
};

export function loadConfig(env: EnvSource): SivrajConfig {
  return {
    app: {
      nodeEnv: readEnum(env, "NODE_ENV", ["development", "test", "production"], "development"),
      appUrl: readOptional(env, "APP_URL", "http://localhost:5173"),
      apiUrl: readOptional(env, "API_URL", "http://127.0.0.1:3000"),
    },
    api: {
      host: readOptional(env, "API_HOST", "0.0.0.0"),
      port: readInteger(env, "API_PORT", 3000),
      corsOrigins: readList(env, "CORS_ORIGINS", ["http://localhost:5173"]),
      jwtSecret: readRequired(env, "JWT_SECRET"),
      tokenIssuer: readOptional(env, "TOKEN_ISSUER", "sivraj"),
    },
    memorySearch: loadMemorySearchConfig(env),
    database: {
      url: readRequired(env, "DATABASE_URL"),
    },
    queue: {
      redisUrl: readRequired(env, "REDIS_URL"),
      workerConcurrency: readInteger(env, "WORKER_CONCURRENCY", 2),
      artifactReconcileIntervalMs: readPositiveInteger(env, "ARTIFACT_RECONCILE_INTERVAL_MS", 60_000),
      artifactReconcileLimit: readPositiveInteger(env, "ARTIFACT_RECONCILE_LIMIT", 25),
    },
    llm: {
      provider: readOptional(env, "LLM_PROVIDER", "openai"),
      apiKey: readRequired(env, "LLM_API_KEY"),
      model: readRequired(env, "LLM_MODEL"),
      embeddingModel: readRequired(env, "EMBEDDING_MODEL"),
    },
    walrus: {
      network: readOptional(env, "WALRUS_NETWORK", "testnet"),
      epochs: readInteger(env, "WALRUS_EPOCHS", 5),
      deletable: readBoolean(env, "WALRUS_DELETABLE", false),
      aggregatorUrl: readMaybe(env, "WALRUS_AGGREGATOR_URL"),
    },
    seal: {
      packageId: readRequired(env, "SEAL_PACKAGE_ID"),
      policyId: readRequired(env, "SEAL_POLICY_ID"),
      keyServers: readRequired(env, "SEAL_KEY_SERVERS"),
      threshold: readInteger(env, "SEAL_THRESHOLD", 1),
    },
    sui: {
      network: readOptional(env, "SUI_NETWORK", "testnet"),
      rpcUrl: readRequired(env, "SUI_RPC_URL"),
      privateKey: readRequired(env, "SUI_PRIVATE_KEY"),
    },
    observability: {
      logLevel: readEnum(env, "LOG_LEVEL", ["debug", "info", "warn", "error"], "info"),
      otlpEndpoint: readMaybe(env, "OTEL_EXPORTER_OTLP_ENDPOINT"),
    },
  };
}

export function loadMemorySearchConfig(env: EnvSource): MemorySearchConfig {
  return {
    shortlistLimit: readPositiveInteger(env, "MEMORY_SEARCH_SHORTLIST_LIMIT", 25),
    fallbackLimit: readPositiveInteger(env, "MEMORY_SEARCH_FALLBACK_LIMIT", 20),
    decryptConcurrency: readPositiveInteger(env, "MEMORY_SEARCH_DECRYPT_CONCURRENCY", 3),
    decryptEvidenceLimit: readPositiveInteger(env, "MEMORY_SEARCH_DECRYPT_EVIDENCE_LIMIT", 3),
  };
}

export function loadMcpServerConfig(env: EnvSource): McpServerConfig {
  const writebackEncryption = readEnum(env, "SIVRAJ_WRITEBACK_ENCRYPTION", ["api", "client"], "api");

  return {
    apiUrl: readOptional(env, "SIVRAJ_API_URL", readOptional(env, "API_URL", "http://127.0.0.1:3000")).replace(/\/+$/, ""),
    twinId: readRequired(env, "SIVRAJ_TWIN_ID"),
    token: readRequired(env, "SIVRAJ_TOKEN"),
    projectName: readMaybe(env, "SIVRAJ_PROJECT_NAME"),
    projectId: readMaybe(env, "SIVRAJ_PROJECT_ID"),
    agentPreset: readEnum(env, "SIVRAJ_AGENT_PRESET", ["codex", "claude_code", "cursor", "generic_mcp"], "codex"),
    includeCandidates: readBoolean(env, "SIVRAJ_INCLUDE_CANDIDATES", true),
    maxItemsPerSection: readPositiveInteger(env, "SIVRAJ_MAX_ITEMS_PER_SECTION", 12),
    writebackEncryption,
    ...(writebackEncryption === "client"
      ? {
          seal: {
            packageId: readRequired(env, "SIVRAJ_SEAL_PACKAGE_ID"),
            policyId: readRequired(env, "SIVRAJ_SEAL_POLICY_ID"),
            keyServers: readRequired(env, "SIVRAJ_SEAL_KEY_SERVERS"),
            threshold: readInteger(env, "SIVRAJ_SEAL_THRESHOLD", 1),
          },
          sui: {
            network: readOptional(env, "SIVRAJ_SUI_NETWORK", readOptional(env, "SUI_NETWORK", "testnet")),
            rpcUrl: readRequired(env, "SIVRAJ_SUI_RPC_URL"),
          },
        }
      : {}),
  };
}

function readRequired(env: EnvSource, key: string): string {
  const value = env[key];

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function readMaybe(env: EnvSource, key: string): string | undefined {
  const value = env[key];
  return value && value.length > 0 ? value : undefined;
}

function readOptional(env: EnvSource, key: string, fallback: string): string {
  return readMaybe(env, key) ?? fallback;
}

function readInteger(env: EnvSource, key: string, fallback: number): number {
  const value = readMaybe(env, key);

  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer environment variable: ${key}`);
  }

  return parsed;
}

function readPositiveInteger(env: EnvSource, key: string, fallback: number): number {
  const value = readInteger(env, key, fallback);

  if (value < 1) {
    throw new Error(`Invalid positive integer environment variable: ${key}`);
  }

  return value;
}

function readBoolean(env: EnvSource, key: string, fallback: boolean): boolean {
  const value = readMaybe(env, key);

  if (!value) {
    return fallback;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`Invalid boolean environment variable: ${key}`);
}

function readList(env: EnvSource, key: string, fallback: string[]): string[] {
  const value = readMaybe(env, key);

  if (!value) {
    return fallback;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readEnum<const TValue extends string>(
  env: EnvSource,
  key: string,
  values: readonly TValue[],
  fallback: TValue,
): TValue {
  const value = readMaybe(env, key);

  if (!value) {
    return fallback;
  }

  if (!values.includes(value as TValue)) {
    throw new Error(`Invalid environment variable: ${key}`);
  }

  return value as TValue;
}
