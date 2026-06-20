import { readSuiGrpcNetwork } from "@sivraj/core";
import {
  assertSealPolicyConfig,
  createSealEncryptor,
  parseSealKeyServers,
  type SealEncryptor,
  type SealPolicyConfig,
} from "@sivraj/crypto-seal";
import {
  createWalrusReader,
  createWalrusStorage,
  type WalrusReader,
  type WalrusStorage,
} from "@sivraj/storage-walrus";
import { SuiGrpcClient } from "@mysten/sui/grpc";

export type PrivateEncryptedStorageConfig = {
  suiRpcUrl: string;
  suiPrivateKey: string;
  suiNetwork: "mainnet" | "testnet" | "devnet";
  walrusNetwork: "mainnet" | "testnet" | "devnet" | "localnet";
  walrusEpochs: number;
  walrusDeletable: boolean;
  walrusAggregatorUrl?: string;
  walrusUploadRelayUrl?: string;
  walrusUploadRelayTipMaxMist?: number;
  sealPackageId: string;
  sealPolicyId: string;
  sealKeyServers: string;
  sealThreshold: number;
};

const REQUIRED_PRIVATE_STORAGE_ENV_KEYS = [
  "SUI_RPC_URL",
  "SUI_PRIVATE_KEY",
  "SEAL_PACKAGE_ID",
  "SEAL_POLICY_ID",
  "SEAL_KEY_SERVERS",
] as const;

export function readPrivateEncryptedStorageConfig(
  env: Record<string, string | undefined>,
): PrivateEncryptedStorageConfig | undefined {
  if (REQUIRED_PRIVATE_STORAGE_ENV_KEYS.some((key) => !env[key])) {
    return undefined;
  }

  return {
    suiRpcUrl: env["SUI_RPC_URL"]!,
    suiPrivateKey: env["SUI_PRIVATE_KEY"]!,
    suiNetwork: readSuiGrpcNetwork(env["SUI_NETWORK"]),
    walrusNetwork: readWalrusNetwork(env["WALRUS_NETWORK"]),
    walrusEpochs: readInteger(env["WALRUS_EPOCHS"], 5),
    walrusDeletable: readBoolean(env["WALRUS_DELETABLE"], false),
    walrusAggregatorUrl: readMaybe(env["WALRUS_AGGREGATOR_URL"]),
    walrusUploadRelayUrl: readMaybe(env["WALRUS_UPLOAD_RELAY_URL"]),
    walrusUploadRelayTipMaxMist: readMaybeInteger(env["WALRUS_UPLOAD_RELAY_TIP_MAX_MIST"]),
    sealPackageId: env["SEAL_PACKAGE_ID"]!,
    sealPolicyId: env["SEAL_POLICY_ID"]!,
    sealKeyServers: env["SEAL_KEY_SERVERS"]!,
    sealThreshold: readInteger(env["SEAL_THRESHOLD"], 1),
  };
}

export function createPrivateEncryptedStorageRuntime(
  config: PrivateEncryptedStorageConfig,
): {
  seal: SealEncryptor;
  walrus: WalrusStorage;
  walrusReader: WalrusReader;
} {
  const policy: SealPolicyConfig = {
    packageId: config.sealPackageId,
    policyId: config.sealPolicyId,
    threshold: config.sealThreshold,
    keyServers: parseSealKeyServers(config.sealKeyServers),
  };

  assertSealPolicyConfig(policy);

  const suiClient = new SuiGrpcClient({
    network: config.suiNetwork,
    baseUrl: config.suiRpcUrl,
  });

  return {
    seal: createSealEncryptor({
      suiClient,
      policy,
    }),
    walrus: createWalrusStorage({
      config: {
        network: config.walrusNetwork,
        rpcUrl: config.suiRpcUrl,
        privateKey: config.suiPrivateKey,
        epochs: config.walrusEpochs,
        deletable: config.walrusDeletable,
        uploadRelayUrl: config.walrusUploadRelayUrl,
        uploadRelayTipMaxMist: config.walrusUploadRelayTipMaxMist,
      },
    }),
    walrusReader: createWalrusReader({
      config: {
        network: config.walrusNetwork,
        rpcUrl: config.suiRpcUrl,
        aggregatorUrl: config.walrusAggregatorUrl,
      },
    }),
  };
}

function readWalrusNetwork(
  value: string | undefined,
): PrivateEncryptedStorageConfig["walrusNetwork"] {
  return value === "mainnet" || value === "testnet" || value === "devnet" || value === "localnet"
    ? value
    : "testnet";
}

function readInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readMaybe(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

function readMaybeInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  return value === "true" || value === "1";
}
