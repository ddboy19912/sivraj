import type { EnvSource } from "@sivraj/config";
import { readSuiGrpcNetwork } from "@sivraj/core";
import {
  assertSealPolicyConfig,
  createSealEncryptor,
  encryptAndStorePrivateSourceArtifact,
  parseSealKeyServers,
  storeEncryptedPrivateSourceArtifact,
  type SealEncryptor,
  type SealPolicyConfig,
} from "@sivraj/crypto-seal";
import {
  createWalrusStorage,
  type WalrusStorage,
} from "@sivraj/storage-walrus";
import { SuiGrpcClient } from "@mysten/sui/grpc";

import type {
  PrivateMemoryStorage,
  PrivateMemoryStorageOutput,
} from "../app.js";

const DEFAULT_WALRUS_EPOCHS = 5;

export function createPrivateMemoryStorage(
  env: EnvSource,
): PrivateMemoryStorage {
  let service: PrivateMemoryStorage | null = null;

  return {
    async storePrivateMemory(input) {
      service ??= createConfiguredPrivateMemoryStorage(env);
      return service.storePrivateMemory(input);
    },
    async storeEncryptedPrivateMemory(input) {
      service ??= createConfiguredPrivateMemoryStorage(env);
      return service.storeEncryptedPrivateMemory(input);
    },
  };
}

export function createPrivateMemoryStorageService(params: {
  seal: SealEncryptor;
  walrus: WalrusStorage;
}): PrivateMemoryStorage {
  return {
    async storePrivateMemory(input) {
      const stored = await encryptAndStorePrivateSourceArtifact({
        seal: params.seal,
        walrus: params.walrus,
        input: {
          twinId: input.twinId,
          sourceType: input.sourceType,
          title: input.title,
          content: input.content,
          metadata: input.metadata,
        },
      });

      return stored satisfies PrivateMemoryStorageOutput;
    },
    async storeEncryptedPrivateMemory(input) {
      const stored = await storeEncryptedPrivateSourceArtifact({
        walrus: params.walrus,
        twinId: input.twinId,
        sourceType: input.sourceType,
        encrypted: {
          encryptedBytes: input.encryptedBytes,
          ciphertextSha256: input.ciphertextSha256,
          packageId: input.seal.packageId,
          policyId: input.seal.policyId,
          threshold: input.seal.threshold,
          keyServerObjectIds: input.seal.keyServerObjectIds,
        },
      });

      return stored satisfies PrivateMemoryStorageOutput;
    },
  };
}

function createConfiguredPrivateMemoryStorage(
  env: EnvSource,
): PrivateMemoryStorage {
  const policy: SealPolicyConfig = {
    packageId: readRequired(env, "SEAL_PACKAGE_ID"),
    policyId: readRequired(env, "SEAL_POLICY_ID"),
    threshold: readInteger(env, "SEAL_THRESHOLD", 1),
    keyServers: parseSealKeyServers(readRequired(env, "SEAL_KEY_SERVERS")),
  };

  assertSealPolicyConfig(policy);

  const suiClient = new SuiGrpcClient({
    network: readSuiGrpcNetwork(env["SUI_NETWORK"]),
    baseUrl: readRequired(env, "SUI_RPC_URL"),
  });

  return createPrivateMemoryStorageService({
    seal: createSealEncryptor({
      suiClient,
      policy,
    }),
    walrus: createWalrusStorage({
      config: {
        network: readWalrusNetwork(env["WALRUS_NETWORK"]),
        rpcUrl: readRequired(env, "SUI_RPC_URL"),
        privateKey: readRequired(env, "SUI_PRIVATE_KEY"),
        epochs: readInteger(env, "WALRUS_EPOCHS", DEFAULT_WALRUS_EPOCHS),
        deletable: readBoolean(env, "WALRUS_DELETABLE", false),
        minWriteBalanceMist: readMaybe(env, "WALRUS_MIN_WRITE_BALANCE_MIST"),
        uploadRelayUrl: readMaybe(env, "WALRUS_UPLOAD_RELAY_URL"),
        uploadRelayTipMaxMist: readMaybeInteger(
          env,
          "WALRUS_UPLOAD_RELAY_TIP_MAX_MIST",
        ),
      },
    }),
  });
}

function readRequired(env: EnvSource, key: string): string {
  const value = env[key];

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function readInteger(env: EnvSource, key: string, fallback: number): number {
  const value = env[key];

  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer environment variable: ${key}`);
  }

  return parsed;
}

function readMaybe(env: EnvSource, key: string): string | undefined {
  const value = env[key];
  return value && value.length > 0 ? value : undefined;
}

function readMaybeInteger(env: EnvSource, key: string): number | undefined {
  const value = env[key];

  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer environment variable: ${key}`);
  }

  return parsed;
}

function readBoolean(env: EnvSource, key: string, fallback: boolean): boolean {
  const value = env[key];

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

function readWalrusNetwork(
  value: string | undefined,
): "mainnet" | "testnet" | "devnet" | "localnet" {
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
