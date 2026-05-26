import { TextEncoder } from "node:util";
import {
  assertSealPolicyConfig,
  createSealEncryptor,
  parseSealKeyServers,
  type SealEncryptor,
  type SealPolicyConfig,
} from "@sivraj/crypto-seal";
import { createWalrusStorage, type WalrusStorage } from "@sivraj/storage-walrus";
import { SuiGrpcClient } from "@mysten/sui/grpc";

export type PrivateSourceStorageOutput = {
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

export type PrivateSourceStorage = {
  storePrivateSource(input: {
    twinId: string;
    sourceType: string;
    title: string | null;
    content: string;
    metadata: Record<string, unknown>;
  }): Promise<PrivateSourceStorageOutput>;
};

type PrivateSourceStorageConfig = {
  suiRpcUrl: string;
  suiPrivateKey: string;
  suiNetwork: "mainnet" | "testnet" | "devnet";
  walrusNetwork: "mainnet" | "testnet" | "devnet" | "localnet";
  walrusEpochs: number;
  walrusDeletable: boolean;
  walrusUploadRelayUrl?: string;
  walrusUploadRelayTipMaxMist?: number;
  sealPackageId: string;
  sealPolicyId: string;
  sealKeyServers: string;
  sealThreshold: number;
};

const textEncoder = new TextEncoder();
const PRIVATE_SOURCE_PAYLOAD_VERSION = 1;

export function createPrivateSourceStorage(params: {
  seal: SealEncryptor;
  walrus: WalrusStorage;
}): PrivateSourceStorage {
  return {
    async storePrivateSource(input) {
      const plaintextBytes = textEncoder.encode(
        JSON.stringify({
          kind: "source_artifact",
          version: PRIVATE_SOURCE_PAYLOAD_VERSION,
          title: input.title,
          content: input.content,
          metadata: input.metadata,
        }),
      );
      const encrypted = await params.seal.encrypt({
        data: plaintextBytes,
        aad: textEncoder.encode(
          JSON.stringify({
            twinId: input.twinId,
            sourceType: input.sourceType,
            kind: "source_artifact",
            version: PRIVATE_SOURCE_PAYLOAD_VERSION,
          }),
        ),
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
        encryptedBytesBase64: Buffer.from(encrypted.encryptedBytes).toString("base64"),
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
      };
    },
  };
}

export function createConfiguredPrivateSourceStorage(
  env: Record<string, string | undefined>,
): PrivateSourceStorage | undefined {
  const config = readPrivateSourceStorageConfig(env);

  if (!config) {
    return undefined;
  }

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

  return createPrivateSourceStorage({
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
  });
}

function readPrivateSourceStorageConfig(
  env: Record<string, string | undefined>,
): PrivateSourceStorageConfig | undefined {
  const required = [
    "SUI_RPC_URL",
    "SUI_PRIVATE_KEY",
    "SEAL_PACKAGE_ID",
    "SEAL_POLICY_ID",
    "SEAL_KEY_SERVERS",
  ];

  if (required.some((key) => !env[key])) {
    return undefined;
  }

  return {
    suiRpcUrl: env["SUI_RPC_URL"]!,
    suiPrivateKey: env["SUI_PRIVATE_KEY"]!,
    suiNetwork: readSuiNetwork(env["SUI_NETWORK"]),
    walrusNetwork: readWalrusNetwork(env["WALRUS_NETWORK"]),
    walrusEpochs: readInteger(env["WALRUS_EPOCHS"], 5),
    walrusDeletable: readBoolean(env["WALRUS_DELETABLE"], false),
    walrusUploadRelayUrl: readMaybe(env["WALRUS_UPLOAD_RELAY_URL"]),
    walrusUploadRelayTipMaxMist: readMaybeInteger(env["WALRUS_UPLOAD_RELAY_TIP_MAX_MIST"]),
    sealPackageId: env["SEAL_PACKAGE_ID"]!,
    sealPolicyId: env["SEAL_POLICY_ID"]!,
    sealKeyServers: env["SEAL_KEY_SERVERS"]!,
    sealThreshold: readInteger(env["SEAL_THRESHOLD"], 1),
  };
}

function readSuiNetwork(value: string | undefined): PrivateSourceStorageConfig["suiNetwork"] {
  return value === "mainnet" || value === "testnet" || value === "devnet"
    ? value
    : "testnet";
}

function readWalrusNetwork(value: string | undefined): PrivateSourceStorageConfig["walrusNetwork"] {
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
