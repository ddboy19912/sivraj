import { TextEncoder } from "node:util";
import {
  assertSealPolicyConfig,
  createSealEncryptor,
  parseSealKeyServers,
  type SealEncryptor,
  type SealPolicyConfig,
} from "@sivraj/crypto-seal";
import type { EnvSource } from "@sivraj/config";
import {
  createWalrusStorage,
  type WalrusStorage,
} from "@sivraj/storage-walrus";
import { SuiGrpcClient } from "@mysten/sui/grpc";

import type {
  PrivateMemoryStorage,
  PrivateMemoryStorageOutput,
} from "../app.js";

const textEncoder = new TextEncoder();
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
  };
}

export function createPrivateMemoryStorageService(params: {
  seal: SealEncryptor;
  walrus: WalrusStorage;
}): PrivateMemoryStorage {
  return {
    async storePrivateMemory(input) {
      const plaintextBytes = textEncoder.encode(input.content);
      const aad = textEncoder.encode(
        JSON.stringify({
          twinId: input.twinId,
          sourceType: input.sourceType,
          title: input.title,
        }),
      );
      const encrypted = await params.seal.encrypt({
        data: plaintextBytes,
        aad,
      });
      const stored = await params.walrus.store({
        bytes: encrypted.encryptedBytes,
        attributes: {
          twinId: input.twinId,
          sourceType: input.sourceType,
          storageMode: "encrypted_walrus",
          sensitivity: "private",
          ciphertextSha256: encrypted.ciphertextSha256,
        },
      });

      return {
        rawStorageRef: stored.rawStorageRef,
        ciphertextSha256: encrypted.ciphertextSha256,
        seal: {
          packageId: encrypted.packageId,
          policyId: encrypted.policyId,
          threshold: encrypted.threshold,
          keyServerObjectIds: encrypted.keyServerObjectIds,
        },
        walrus: {
          blobId: stored.blobId,
          blobObjectId: stored.blobObjectId,
          startEpoch: stored.startEpoch,
          endEpoch: stored.endEpoch,
          size: stored.size,
        },
      } satisfies PrivateMemoryStorageOutput;
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
    network: readSuiNetwork(env["SUI_NETWORK"]),
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

function readSuiNetwork(
  value: string | undefined,
): "mainnet" | "testnet" | "devnet" {
  if (value === "mainnet" || value === "testnet" || value === "devnet") {
    return value;
  }

  return "testnet";
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
