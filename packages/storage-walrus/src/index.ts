import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { walrus } from "@mysten/walrus";
import { createHash } from "node:crypto";

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
  read(input: { rawStorageRef: string; expectedSha256?: string | null }): Promise<Uint8Array>;
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

type FetchLike = (input: string) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

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
  config: Pick<WalrusStorageConfig, "network" | "rpcUrl"> & {
    aggregatorUrl?: string;
  };
  client?: WalrusReadClientLike;
  fetch?: FetchLike;
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
  const aggregatorUrl = params.config.aggregatorUrl?.replace(/\/+$/, "");
  const fetchBlob = params.fetch ?? fetch;

  return {
    async read(input) {
      const blobId = parseWalrusBlobId(input.rawStorageRef);

      try {
        const bytes = await client.readBlob({ blobId });
        assertExpectedSha256(bytes, input.expectedSha256);
        return bytes;
      } catch (sdkError) {
        if (!aggregatorUrl || !isRetryableReadError(sdkError)) {
          throw sdkError;
        }

        try {
          const bytes = await readBlobFromAggregator({
            aggregatorUrl,
            blobId,
            fetchBlob,
          });
          assertExpectedSha256(bytes, input.expectedSha256);
          return bytes;
        } catch (aggregatorError) {
          throw new Error(
            `Walrus SDK read failed: ${errorMessage(sdkError)}; aggregator read failed: ${errorMessage(aggregatorError)}`,
            { cause: aggregatorError },
          );
        }
      }
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

async function readBlobFromAggregator(params: {
  aggregatorUrl: string;
  blobId: string;
  fetchBlob: FetchLike;
}): Promise<Uint8Array> {
  const response = await params.fetchBlob(
    `${params.aggregatorUrl}/v1/blobs/${encodeURIComponent(params.blobId)}`,
  );

  if (!response.ok) {
    throw new Error(`Walrus aggregator returned ${response.status} ${response.statusText}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

function assertExpectedSha256(bytes: Uint8Array, expectedSha256: string | null | undefined): void {
  if (!expectedSha256) {
    return;
  }

  const actualSha256 = sha256Hex(bytes);

  if (actualSha256 !== expectedSha256.toLowerCase()) {
    throw new Error("Walrus blob SHA-256 mismatch");
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isRetryableReadError(error: unknown): boolean {
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown Walrus read error";
}
