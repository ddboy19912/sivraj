import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { walrus } from "@mysten/walrus";
import { createHash } from "node:crypto";
import { isRetryableNetworkError } from "@sivraj/core";
import { isSuiBalanceSplitAbort } from "./sui-balance-errors.js";

export type WalrusStorageConfig = {
  network: "mainnet" | "testnet" | "devnet" | "localnet";
  rpcUrl: string;
  privateKey: string;
  epochs: number;
  deletable: boolean;
  minWriteBalanceMist?: string;
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

export type WalrusStorageErrorCode =
  | "walrus_insufficient_balance"
  | "walrus_write_failed";

export type WalrusStorageWalletDiagnostics = {
  network: WalrusStorageConfig["network"];
  address: string;
  coinType: "0x2::sui::SUI";
  balanceMist: string;
  balanceSui: string;
  requiredMist: string;
  requiredSui: string;
  shortfallMist: string;
  shortfallSui: string;
  requiredAmountSource: "configured_minimum";
};

export class WalrusStorageError extends Error {
  readonly code: WalrusStorageErrorCode;
  readonly storageWallet?: WalrusStorageWalletDiagnostics;

  constructor(params: {
    code: WalrusStorageErrorCode;
    message: string;
    cause: unknown;
    storageWallet?: WalrusStorageWalletDiagnostics;
  }) {
    super(params.message, { cause: params.cause });
    this.name = "WalrusStorageError";
    this.code = params.code;
    this.storageWallet = params.storageWallet;
  }
}

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

type SuiBalanceClientLike = {
  core: {
    getBalance(input: {
      owner: string;
      coinType?: string;
    }): Promise<{
      balance: {
        balance?: string;
        coinBalance?: string;
        addressBalance?: string;
        coinType?: string;
      };
    }>;
  };
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
  balanceClient?: SuiBalanceClientLike;
  signer?: Ed25519Keypair;
}): WalrusStorage {
  assertWalrusStorageConfig(params.config);

  const signer = params.signer ?? Ed25519Keypair.fromSecretKey(params.config.privateKey);
  const balanceClient = params.balanceClient ?? createSuiClient(params.config);
  const client = params.client ?? createWalrusClient(params.config);

  return {
    async store(input) {
      let result: Awaited<ReturnType<WalrusWriteClientLike["writeBlob"]>>;

      try {
        result = await client.writeBlob({
          blob: input.bytes,
          deletable: params.config.deletable,
          epochs: params.config.epochs,
          signer,
          attributes: input.attributes,
        });
      } catch (error) {
        throw await toWalrusStorageError({
          error,
          config: params.config,
          signer,
          balanceClient,
        });
      }

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
        if (!aggregatorUrl || !isRetryableNetworkError(sdkError, "Unknown Walrus read error")) {
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

  parseMist(config.minWriteBalanceMist ?? DEFAULT_MIN_WRITE_BALANCE_MIST);
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

function createSuiClient(config: Pick<WalrusStorageConfig, "network" | "rpcUrl">): SuiBalanceClientLike {
  return new SuiGrpcClient({
    network: config.network,
    baseUrl: config.rpcUrl,
  });
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

const SUI_COIN_TYPE = "0x2::sui::SUI" as const;
const MIST_PER_SUI = 1_000_000_000n;
const DEFAULT_MIN_WRITE_BALANCE_MIST = "200000000";

async function toWalrusStorageError(params: {
  error: unknown;
  config: WalrusStorageConfig;
  signer: Ed25519Keypair;
  balanceClient: SuiBalanceClientLike;
}): Promise<WalrusStorageError> {
  if (!isSuiBalanceSplitAbort(params.error)) {
    return new WalrusStorageError({
      code: "walrus_write_failed",
      message: `Walrus write failed: ${errorMessage(params.error)}`,
      cause: params.error,
    });
  }

  const storageWallet = await readStorageWalletDiagnostics(params).catch(() => undefined);

  return new WalrusStorageError({
    code: "walrus_insufficient_balance",
    message: "Walrus storage wallet has insufficient SUI for this write",
    cause: params.error,
    storageWallet,
  });
}

async function readStorageWalletDiagnostics(params: {
  config: WalrusStorageConfig;
  signer: Ed25519Keypair;
  balanceClient: SuiBalanceClientLike;
}): Promise<WalrusStorageWalletDiagnostics> {
  const address = params.signer.getPublicKey().toSuiAddress();
  const balance = await params.balanceClient.core.getBalance({
    owner: address,
    coinType: SUI_COIN_TYPE,
  });
  const balanceMist = parseMist(
    balance.balance.balance ??
      balance.balance.coinBalance ??
      balance.balance.addressBalance ??
      "0",
  );
  const requiredMist = parseMist(params.config.minWriteBalanceMist ?? DEFAULT_MIN_WRITE_BALANCE_MIST);
  const shortfallMist = requiredMist > balanceMist ? requiredMist - balanceMist : 0n;

  return {
    network: params.config.network,
    address,
    coinType: SUI_COIN_TYPE,
    balanceMist: balanceMist.toString(),
    balanceSui: formatMistAsSui(balanceMist),
    requiredMist: requiredMist.toString(),
    requiredSui: formatMistAsSui(requiredMist),
    shortfallMist: shortfallMist.toString(),
    shortfallSui: formatMistAsSui(shortfallMist),
    requiredAmountSource: "configured_minimum",
  };
}

function parseMist(value: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new Error("Walrus minimum write balance must be a non-negative MIST integer");
  }

  return BigInt(value);
}

function formatMistAsSui(mist: bigint): string {
  const whole = mist / MIST_PER_SUI;
  const fractional = mist % MIST_PER_SUI;

  if (fractional === 0n) {
    return whole.toString();
  }

  return `${whole}.${fractional.toString().padStart(9, "0").replace(/0+$/, "")}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown Walrus read error";
}
