import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import {
  createSealDecryptor,
  parseSealKeyServers,
  type SealDecryptor,
} from "@sivraj/crypto-seal";
import { createWalrusReader, type WalrusReader } from "@sivraj/storage-walrus";
import type { PrivateMemoryReader } from "./ingestion-processor.js";

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
  logger?: Pick<Console, "warn">;
}): PrivateMemoryReader {
  const decoder = new TextDecoder();
  const logger = params.logger ?? console;

  return {
    async readPrivateMemory(input) {
      const encryptedBytes = await retryPrivateMemoryStage({
        stage: "walrus_read",
        artifactId: input.artifactId,
        rawStorageRef: input.rawStorageRef,
        logger,
        operation: () =>
          params.walrus.read({
            rawStorageRef: input.rawStorageRef,
            expectedSha256: input.expectedCiphertextSha256,
          }),
      });
      const decrypted = await retryPrivateMemoryStage({
        stage: "seal_decrypt",
        artifactId: input.artifactId,
        rawStorageRef: input.rawStorageRef,
        logger,
        operation: () => params.seal.decrypt({ encryptedBytes }),
      });

      return decoder.decode(decrypted.plaintext);
    },
  };
}

async function retryPrivateMemoryStage<T>(params: {
  stage: "walrus_read" | "seal_decrypt";
  artifactId: string;
  rawStorageRef: string;
  operation: () => Promise<T>;
  logger: Pick<Console, "warn">;
}): Promise<T> {
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await params.operation();
    } catch (error) {
      lastError = error;

      params.logger.warn("private memory read stage failed", {
        stage: params.stage,
        artifactId: params.artifactId,
        rawStorageRef: params.rawStorageRef,
        attempt,
        maxAttempts,
        retryable: isRetryableError(error),
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: errorMessage(error),
      });

      if (attempt === maxAttempts || !isRetryableError(error)) {
        break;
      }

      await sleep(250 * 2 ** (attempt - 1));
    }
  }

  throw new Error(`${params.stage} failed: ${errorMessage(lastError)}`, {
    cause: lastError,
  });
}

function isRetryableError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();

  return [
    "fetch failed",
    "network",
    "timeout",
    "timed out",
    "econnreset",
    "econnrefused",
    "socket",
    "429",
    "500",
    "502",
    "503",
    "504",
  ].some((fragment) => message.includes(fragment));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown private memory read error";
}

export function createConfiguredPrivateMemoryReader(
  env: Record<string, string | undefined>,
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

function readSuiNetwork(
  value: string | undefined,
): PrivateMemoryReaderConfig["suiNetwork"] {
  if (
    value === "mainnet" ||
    value === "testnet" ||
    value === "devnet" ||
    value === "localnet"
  ) {
    return value;
  }

  return "testnet";
}

function readInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}
