import { TextEncoder } from "node:util";
import {
  assertSealPolicyConfig,
  createSealEncryptor,
  parseSealKeyServers,
  type SealEncryptor,
  type SealPolicyConfig,
} from "@sivraj/crypto-seal";
import { createWalrusStorage, type WalrusStorage } from "@sivraj/storage-walrus";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiGrpcClient } from "@mysten/sui/grpc";

export type PrivateFragmentStorageOutput = {
  contentStorageRef: string;
  contentSha256: string;
  encryptedBytesBase64?: string;
  metadata: Record<string, unknown>;
};

export type PrivateEncryptedFragmentOutput = {
  encryptedBytesBase64: string;
  contentSha256: string;
  metadata: Record<string, unknown>;
};

export type PrivateFragmentStorage = {
  storePrivateFragment(input: {
    twinId: string;
    sourceArtifactId: string;
    sourceType: string;
    content: string;
    contentKind?: "memory_fragment" | "candidate_memory" | "reflection";
  }): Promise<PrivateFragmentStorageOutput>;
  encryptPrivateFragment(input: {
    twinId: string;
    sourceArtifactId: string;
    sourceType: string;
    content: string;
    contentKind?: "memory_fragment" | "candidate_memory" | "reflection";
  }): Promise<PrivateEncryptedFragmentOutput>;
  storeEncryptedPrivateFragment(input: {
    twinId: string;
    sourceArtifactId: string;
    sourceType: string;
    encryptedBytesBase64: string;
    contentSha256: string;
    metadata: Record<string, unknown>;
    contentKind?: "memory_fragment" | "candidate_memory" | "reflection";
  }): Promise<PrivateFragmentStorageOutput>;
};

type PrivateFragmentStorageConfig = {
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

export function createPrivateFragmentStorage(params: {
  seal: SealEncryptor;
  walrus: WalrusStorage;
  logger?: Pick<Console, "info">;
}): PrivateFragmentStorage {
  const logger = params.logger ?? console;

  return {
    async storePrivateFragment(input) {
      const totalStartedAt = Date.now();
      const contentKind = input.contentKind ?? "memory_fragment";
      const encrypted = await this.encryptPrivateFragment(input);
      const stored = await this.storeEncryptedPrivateFragment({
        twinId: input.twinId,
        sourceArtifactId: input.sourceArtifactId,
        sourceType: input.sourceType,
        encryptedBytesBase64: encrypted.encryptedBytesBase64,
        contentSha256: encrypted.contentSha256,
        metadata: encrypted.metadata,
        contentKind,
      });

      logger.info("private fragment storage completed", {
        twinId: input.twinId,
        sourceArtifactId: input.sourceArtifactId,
        sourceType: input.sourceType,
        contentKind,
        plaintextChars: input.content.length,
        encryptedBytes: approximateBase64Bytes(encrypted.encryptedBytesBase64),
        sealEncryptMs: readNumber(encrypted.metadata["sealEncryptMs"]),
        walrusStoreMs: readNumber(stored.metadata["walrusStoreMs"]),
        totalMs: Date.now() - totalStartedAt,
        rawStorageRef: stored.contentStorageRef,
      });

      return stored;
    },
    async encryptPrivateFragment(input) {
      const contentKind = input.contentKind ?? "memory_fragment";
      const encryptStartedAt = Date.now();
      const encrypted = await params.seal.encrypt({
        data: textEncoder.encode(input.content),
        aad: textEncoder.encode(
          JSON.stringify({
            twinId: input.twinId,
            sourceArtifactId: input.sourceArtifactId,
            sourceType: input.sourceType,
            kind: contentKind,
          }),
        ),
      });
      const sealEncryptMs = Date.now() - encryptStartedAt;

      return {
        encryptedBytesBase64: Buffer.from(encrypted.encryptedBytes).toString("base64"),
        contentSha256: encrypted.ciphertextSha256,
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
          contentKind,
          sealEncryptMs,
          seal: {
            packageId: encrypted.packageId,
            policyId: encrypted.policyId,
            threshold: encrypted.threshold,
            keyServerObjectIds: encrypted.keyServerObjectIds,
          },
        },
      };
    },
    async storeEncryptedPrivateFragment(input) {
      const contentKind = input.contentKind ?? "memory_fragment";
      const encryptedBytes = Buffer.from(input.encryptedBytesBase64, "base64");
      const walrusStartedAt = Date.now();
      const stored = await params.walrus.store({
        bytes: encryptedBytes,
        attributes: {
          twinId: input.twinId,
          sourceArtifactId: input.sourceArtifactId,
          sourceType: input.sourceType,
          storageMode: "encrypted_walrus",
          sensitivity: "private",
          contentSha256: input.contentSha256,
          kind: contentKind,
        },
      });
      const walrusStoreMs = Date.now() - walrusStartedAt;

      logger.info("private encrypted fragment walrus storage completed", {
        twinId: input.twinId,
        sourceArtifactId: input.sourceArtifactId,
        sourceType: input.sourceType,
        contentKind,
        encryptedBytes: encryptedBytes.length,
        walrusStoreMs,
        rawStorageRef: stored.rawStorageRef,
      });

      return {
        contentStorageRef: stored.rawStorageRef,
        contentSha256: input.contentSha256,
        encryptedBytesBase64: input.encryptedBytesBase64,
        metadata: {
          ...input.metadata,
          walrusStoreMs,
          walrus: {
            blobId: stored.blobId,
            blobObjectId: stored.blobObjectId,
            startEpoch: stored.startEpoch,
            endEpoch: stored.endEpoch,
            size: stored.size,
          },
        },
      };
    },
  };
}

export function createConfiguredPrivateFragmentStorage(
  env: Record<string, string | undefined>,
): PrivateFragmentStorage | undefined {
  const config = readPrivateFragmentStorageConfig(env);

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

  return createPrivateFragmentStorage({
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

function approximateBase64Bytes(value: string): number {
  return Math.floor((value.length * 3) / 4);
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function readPrivateFragmentStorageConfig(
  env: Record<string, string | undefined>,
): PrivateFragmentStorageConfig | undefined {
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
    walrusNetwork: readWalrusNetwork(env["WALRUS_NETWORK"]),
    walrusEpochs: readInteger(env["WALRUS_EPOCHS"], 5),
    walrusDeletable: env["WALRUS_DELETABLE"] === "true",
    walrusUploadRelayUrl: readMaybe(env["WALRUS_UPLOAD_RELAY_URL"]),
    walrusUploadRelayTipMaxMist: readMaybeInteger(env["WALRUS_UPLOAD_RELAY_TIP_MAX_MIST"]),
    sealPackageId,
    sealPolicyId,
    sealKeyServers,
    sealThreshold: readInteger(env["SEAL_THRESHOLD"], 1),
  };
}

function readSuiNetwork(value: string | undefined): PrivateFragmentStorageConfig["suiNetwork"] {
  return value === "mainnet" || value === "devnet" ? value : "testnet";
}

function readWalrusNetwork(value: string | undefined): PrivateFragmentStorageConfig["walrusNetwork"] {
  if (value === "mainnet" || value === "devnet" || value === "localnet") {
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

function readMaybe(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

function readMaybeInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}
