import { isRetryableNetworkError, readSuiNetwork, sleep } from "@sivraj/core";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { createHash } from "node:crypto";
import {
  createSealDecryptor,
  parseSealKeyServers,
  type SealDecryptor,
} from "@sivraj/crypto-seal";
import { createWalrusReader, type WalrusReader } from "@sivraj/storage-walrus";

export type PrivateMemoryReader = {
  readPrivateMemory(input: {
    rawStorageRef: string;
    artifactId: string;
    twinId: string;
    expectedCiphertextSha256?: string | null;
  }): Promise<string>;
  readPrivateMemoryFromEncryptedBytes?(input: {
    encryptedBytesBase64: string;
    artifactId: string;
    twinId: string;
    expectedCiphertextSha256?: string | null;
    source: "artifact_queue" | "intelligence_queue";
  }): Promise<string>;
};

export type PrivateMemoryCiphertextCache = {
  getPrivateMemoryCiphertext(ciphertextSha256: string): Promise<{
    encryptedBytesBase64: string;
    rawStorageRef: string;
    ciphertextSha256: string;
    byteLength: number;
    cachedAt: string;
    provider: "walrus";
  } | null>;
  putPrivateMemoryCiphertext(input: {
    encryptedBytesBase64: string;
    rawStorageRef: string;
    ciphertextSha256: string;
    byteLength: number;
    cachedAt: string;
    provider: "walrus";
    ttlSeconds?: number;
  }): Promise<void>;
};

type PrivateMemoryReaderConfig = {
  suiRpcUrl: string;
  suiPrivateKey: string;
  suiNetwork: "mainnet" | "testnet" | "devnet" | "localnet";
  walrusAggregatorUrl?: string;
  sealPackageId: string;
  sealPolicyId: string;
  sealKeyServers: string;
  sealThreshold: number;
};

export function createPrivateMemoryReader(params: {
  walrus: WalrusReader;
  seal: SealDecryptor;
  ciphertextCache?: PrivateMemoryCiphertextCache;
  ciphertextCacheEnabled?: boolean;
  ciphertextCacheTtlMs?: number;
  ciphertextCacheMaxBytes?: number;
  logger?: Partial<Pick<Console, "info" | "warn">>;
}): PrivateMemoryReader {
  const decoder = new TextDecoder();
  const logger: Pick<Console, "info" | "warn"> = {
    info: params.logger?.info ?? console.info,
    warn: params.logger?.warn ?? console.warn,
  };

  return {
    async readPrivateMemory(input) {
      const totalStartedAt = Date.now();
      const encryptedBytes = await readEncryptedBytes({
        ...input,
        walrus: params.walrus,
        cache: params.ciphertextCache,
        cacheEnabled: params.ciphertextCacheEnabled ?? true,
        cacheTtlMs: params.ciphertextCacheTtlMs,
        cacheMaxBytes: params.ciphertextCacheMaxBytes,
        logger,
      });
      const decrypted = await retryPrivateMemoryStage({
        stage: "seal_decrypt",
        artifactId: input.artifactId,
        rawStorageRef: input.rawStorageRef,
        logger,
        operation: () => params.seal.decrypt({ encryptedBytes }),
      });
      logger.info("private memory read completed", {
        artifactId: input.artifactId,
        rawStorageRef: input.rawStorageRef,
        encryptedBytes: encryptedBytes.length,
        plaintextBytes: decrypted.plaintext.length,
        durationMs: Date.now() - totalStartedAt,
      });

      return decoder.decode(decrypted.plaintext);
    },
    async readPrivateMemoryFromEncryptedBytes(input) {
      const startedAt = Date.now();
      const encryptedBytes = Buffer.from(input.encryptedBytesBase64, "base64");
      const actualSha256 = createHash("sha256").update(encryptedBytes).digest("hex");

      if (
        input.expectedCiphertextSha256 &&
        actualSha256 !== input.expectedCiphertextSha256.toLowerCase()
      ) {
        throw new Error("transient_ciphertext_sha256_mismatch");
      }

      const decrypted = await retryPrivateMemoryStage({
        stage: "seal_decrypt",
        artifactId: input.artifactId,
        rawStorageRef: `transient://${input.source}`,
        logger,
        operation: () => params.seal.decrypt({ encryptedBytes }),
      });
      logger.info("private memory transient decrypt completed", {
        artifactId: input.artifactId,
        source: input.source,
        encryptedBytes: encryptedBytes.length,
        plaintextBytes: decrypted.plaintext.length,
        durationMs: Date.now() - startedAt,
      });

      return decoder.decode(decrypted.plaintext);
    },
  };
}

async function readEncryptedBytes(params: {
  rawStorageRef: string;
  artifactId: string;
  expectedCiphertextSha256?: string | null;
  walrus: WalrusReader;
  cache?: PrivateMemoryCiphertextCache;
  cacheEnabled: boolean;
  cacheTtlMs?: number;
  cacheMaxBytes?: number;
  logger: Pick<Console, "info" | "warn">;
}): Promise<Uint8Array> {
  const expectedSha = params.expectedCiphertextSha256?.toLowerCase() ?? null;
  const cached = expectedSha && params.cacheEnabled && params.cache
    ? await readCachedCiphertext({
        cache: params.cache,
        expectedSha,
        artifactId: params.artifactId,
        rawStorageRef: params.rawStorageRef,
        logger: params.logger,
      })
    : null;

  if (cached) {
    return cached;
  }

  const encryptedBytes = await retryPrivateMemoryStage({
    stage: "walrus_read",
    artifactId: params.artifactId,
    rawStorageRef: params.rawStorageRef,
    logger: params.logger,
    operation: () =>
      params.walrus.read({
        rawStorageRef: params.rawStorageRef,
        expectedSha256: params.expectedCiphertextSha256,
      }),
  });

  if (expectedSha && params.cacheEnabled && params.cache) {
    await cacheCiphertext({
      cache: params.cache,
      encryptedBytes,
      expectedSha,
      rawStorageRef: params.rawStorageRef,
      artifactId: params.artifactId,
      ttlMs: params.cacheTtlMs,
      maxBytes: params.cacheMaxBytes,
      logger: params.logger,
    });
  }

  return encryptedBytes;
}

async function readCachedCiphertext(params: {
  cache: PrivateMemoryCiphertextCache;
  expectedSha: string;
  artifactId: string;
  rawStorageRef: string;
  logger: Pick<Console, "info" | "warn">;
}): Promise<Uint8Array | null> {
  const cacheStartedAt = Date.now();
  try {
    const entry = await params.cache.getPrivateMemoryCiphertext(params.expectedSha);

    if (!entry) {
      return null;
    }

    const encryptedBytes = Buffer.from(entry.encryptedBytesBase64, "base64");
    const actualSha = sha256Hex(encryptedBytes);
    if (actualSha !== params.expectedSha || entry.ciphertextSha256.toLowerCase() !== params.expectedSha) {
      params.logger.warn("private memory ciphertext cache rejected", {
        artifactId: params.artifactId,
        rawStorageRef: params.rawStorageRef,
        expectedSha256: params.expectedSha,
        actualSha256: actualSha,
        cachedSha256: entry.ciphertextSha256,
      });
      return null;
    }

    params.logger.info("private memory ciphertext cache hit", {
      artifactId: params.artifactId,
      rawStorageRef: params.rawStorageRef,
      encryptedBytes: encryptedBytes.length,
      durationMs: Date.now() - cacheStartedAt,
    });
    return encryptedBytes;
  } catch (error) {
    params.logger.warn("private memory ciphertext cache read failed", {
      artifactId: params.artifactId,
      rawStorageRef: params.rawStorageRef,
      errorMessage: errorMessage(error),
    });
    return null;
  }
}

async function cacheCiphertext(params: {
  cache: PrivateMemoryCiphertextCache;
  encryptedBytes: Uint8Array;
  expectedSha: string;
  rawStorageRef: string;
  artifactId: string;
  ttlMs?: number;
  maxBytes?: number;
  logger: Pick<Console, "info" | "warn">;
}) {
  const maxBytes = params.maxBytes ?? 10 * 1024 * 1024;
  if (params.encryptedBytes.length > maxBytes) {
    return;
  }

  const actualSha = sha256Hex(params.encryptedBytes);
  if (actualSha !== params.expectedSha) {
    return;
  }

  try {
    await params.cache.putPrivateMemoryCiphertext({
      encryptedBytesBase64: Buffer.from(params.encryptedBytes).toString("base64"),
      rawStorageRef: params.rawStorageRef,
      ciphertextSha256: params.expectedSha,
      byteLength: params.encryptedBytes.length,
      cachedAt: new Date().toISOString(),
      provider: "walrus",
      ttlSeconds: Math.max(Math.floor((params.ttlMs ?? 24 * 60 * 60 * 1000) / 1000), 1),
    });
  } catch (error) {
    params.logger.warn("private memory ciphertext cache write failed", {
      artifactId: params.artifactId,
      rawStorageRef: params.rawStorageRef,
      errorMessage: errorMessage(error),
    });
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function retryPrivateMemoryStage<T>(params: {
  stage: "walrus_read" | "seal_decrypt";
  artifactId: string;
  rawStorageRef: string;
  operation: () => Promise<T>;
  logger: Pick<Console, "info" | "warn">;
}): Promise<T> {
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now();
    try {
      const result = await params.operation();

      params.logger.info("private memory read stage completed", {
        stage: params.stage,
        artifactId: params.artifactId,
        rawStorageRef: params.rawStorageRef,
        attempt,
        durationMs: Date.now() - startedAt,
      });

      return result;
    } catch (error) {
      lastError = error;

      params.logger.warn("private memory read stage failed", {
        stage: params.stage,
        artifactId: params.artifactId,
        rawStorageRef: params.rawStorageRef,
        attempt,
        maxAttempts,
        durationMs: Date.now() - startedAt,
        retryable: isRetryableNetworkError(error),
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: errorMessage(error),
      });

      if (attempt === maxAttempts || !isRetryableNetworkError(error)) {
        break;
      }

      await sleep(250 * 2 ** (attempt - 1));
    }
  }

  throw new Error(`${params.stage} failed: ${errorMessage(lastError)}`, {
    cause: lastError,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown private memory read error";
}

export function createConfiguredPrivateMemoryReader(
  env: Record<string, string | undefined>,
  options: {
    ciphertextCache?: PrivateMemoryCiphertextCache;
  } = {},
): PrivateMemoryReader | undefined {
  const config = readPrivateMemoryReaderConfig(env);

  if (!config) {
    return undefined;
  }

  const suiClient = new SuiGrpcClient({
    network: config.suiNetwork,
    baseUrl: config.suiRpcUrl,
  });
  const signer = Ed25519Keypair.fromSecretKey(config.suiPrivateKey);
  const keyServers = parseSealKeyServers(config.sealKeyServers);

  return createPrivateMemoryReader({
    walrus: createWalrusReader({
      config: {
        network: config.suiNetwork,
        rpcUrl: config.suiRpcUrl,
        aggregatorUrl: config.walrusAggregatorUrl,
      },
    }),
    ciphertextCache: options.ciphertextCache,
    ciphertextCacheEnabled: readBoolean(env["PRIVATE_MEMORY_CIPHERTEXT_CACHE_ENABLED"], true),
    ciphertextCacheTtlMs: readInteger(env["PRIVATE_MEMORY_CIPHERTEXT_CACHE_TTL_MS"], 24 * 60 * 60 * 1000),
    ciphertextCacheMaxBytes: readInteger(env["PRIVATE_MEMORY_CIPHERTEXT_CACHE_MAX_BYTES"], 10 * 1024 * 1024),
    seal: createSealDecryptor({
      suiClient,
      signer,
      policy: {
        packageId: config.sealPackageId,
        policyId: config.sealPolicyId,
        threshold: config.sealThreshold,
        keyServers,
      },
    }),
  });
}

function readPrivateMemoryReaderConfig(
  env: Record<string, string | undefined>,
): PrivateMemoryReaderConfig | undefined {
  const suiRpcUrl = env["SUI_RPC_URL"];
  const suiPrivateKey = env["SUI_PRIVATE_KEY"];
  const sealPackageId = env["SEAL_PACKAGE_ID"];
  const sealPolicyId = env["SEAL_POLICY_ID"];
  const sealKeyServers = env["SEAL_KEY_SERVERS"];

  if (
    !suiRpcUrl ||
    !suiPrivateKey ||
    !sealPackageId ||
    !sealPolicyId ||
    !sealKeyServers
  ) {
    return undefined;
  }

  return {
    suiRpcUrl,
    suiPrivateKey,
    suiNetwork: readSuiNetwork(env["SUI_NETWORK"]),
    walrusAggregatorUrl: readMaybe(env, "WALRUS_AGGREGATOR_URL"),
    sealPackageId,
    sealPolicyId,
    sealKeyServers,
    sealThreshold: readInteger(env["SEAL_THRESHOLD"], 1),
  };
}

function readMaybe(
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  const value = env[key]?.trim();

  return value ? value : undefined;
}

function readInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  return value === "true" ? true : value === "false" ? false : fallback;
}
