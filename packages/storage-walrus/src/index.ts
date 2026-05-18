import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { walrus } from "@mysten/walrus";

export type WalrusStorageConfig = {
  network: "mainnet" | "testnet" | "devnet" | "localnet";
  rpcUrl: string;
  privateKey: string;
  epochs: number;
  deletable: boolean;
  uploadRelayUrl?: string;
  uploadRelayTipMaxMist?: number;
};

export type WalrusStoreInput = {
  bytes: Uint8Array;
  attributes?: Record<string, string>;
};

export type WalrusStoreOutput = {
  rawStorageRef: string;
  blobId: string;
  blobObjectId: string;
  startEpoch: number;
  endEpoch: number;
  size: string;
};

export type WalrusStorage = {
  store(input: WalrusStoreInput): Promise<WalrusStoreOutput>;
};

export type WalrusReader = {
  read(input: { rawStorageRef: string }): Promise<Uint8Array>;
};

type WalrusWriteClientLike = {
  writeBlob(input: {
    blob: Uint8Array;
    deletable: boolean;
    epochs: number;
    signer: Ed25519Keypair;
    attributes?: Record<string, string | null>;
  }): Promise<{
    blobId: string;
    blobObject: {
      id: string;
      size: string;
      storage: {
        start_epoch: number;
        end_epoch: number;
      };
    };
  }>;
};

type WalrusReadClientLike = {
  readBlob(input: { blobId: string }): Promise<Uint8Array>;
};

export function createWalrusStorage(params: {
  config: WalrusStorageConfig;
  client?: WalrusWriteClientLike;
  signer?: Ed25519Keypair;
}): WalrusStorage {
  assertWalrusStorageConfig(params.config);

  const signer = params.signer ?? Ed25519Keypair.fromSecretKey(params.config.privateKey);
  const client = params.client ?? createWalrusClient(params.config);

  return {
    async store(input) {
      const result = await client.writeBlob({
        blob: input.bytes,
        deletable: params.config.deletable,
        epochs: params.config.epochs,
        signer,
        attributes: input.attributes,
      });

      return {
        rawStorageRef: `walrus://blob/${result.blobId}`,
        blobId: result.blobId,
        blobObjectId: result.blobObject.id,
        startEpoch: result.blobObject.storage.start_epoch,
        endEpoch: result.blobObject.storage.end_epoch,
        size: result.blobObject.size,
      };
    },
  };
}

export function createWalrusReader(params: {
  config: Pick<WalrusStorageConfig, "network" | "rpcUrl">;
  client?: WalrusReadClientLike;
}): WalrusReader {
  if (!params.config.rpcUrl) {
    throw new Error("Missing required Sui RPC URL for Walrus reader");
  }

  const client = params.client ?? createWalrusClient({
    ...params.config,
    privateKey: "unused-for-read",
    epochs: 1,
    deletable: false,
  });

  return {
    async read(input) {
      return client.readBlob({ blobId: parseWalrusBlobId(input.rawStorageRef) });
    },
  };
}

export function assertWalrusStorageConfig(config: WalrusStorageConfig): void {
  if (!config.rpcUrl) {
    throw new Error("Missing required Sui RPC URL for Walrus storage");
  }

  if (!config.privateKey) {
    throw new Error("Missing required Sui private key for Walrus storage");
  }

  if (!Number.isInteger(config.epochs) || config.epochs < 1) {
    throw new Error("Walrus storage epochs must be a positive integer");
  }
}

function createWalrusClient(config: WalrusStorageConfig): WalrusWriteClientLike & WalrusReadClientLike {
  return new SuiGrpcClient({
    network: config.network,
    baseUrl: config.rpcUrl,
  }).$extend(
    walrus({
      ...(config.uploadRelayUrl
        ? {
            uploadRelay: {
              host: config.uploadRelayUrl,
              ...(config.uploadRelayTipMaxMist
                ? { sendTip: { max: config.uploadRelayTipMaxMist } }
                : {}),
            },
          }
        : {}),
    }),
  ).walrus;
}

export function parseWalrusBlobId(rawStorageRef: string): string {
  const prefix = "walrus://blob/";

  if (!rawStorageRef.startsWith(prefix)) {
    throw new Error("Invalid Walrus blob reference");
  }

  const blobId = rawStorageRef.slice(prefix.length);

  if (!blobId) {
    throw new Error("Missing Walrus blob ID");
  }

  return blobId;
}
