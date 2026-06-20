import { expect } from "vitest";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { createHash } from "node:crypto";
import {
  assertWalrusStorageConfig,
  createWalrusReader,
  createWalrusStorage,
  parseWalrusBlobId,
} from "./index";

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function run_stores_encrypted_bytes_and_returns_a_durable_ref() {
  const calls: unknown[] = [];
    const storage = createWalrusStorage({
      config: {
        network: "testnet",
        rpcUrl: "https://fullnode.testnet.sui.io:443",
        privateKey: Ed25519Keypair.generate().getSecretKey(),
        epochs: 3,
        deletable: false,
      },
      signer: Ed25519Keypair.generate(),
      client: {
        async writeBlob(input) {
          calls.push(input);
          return {
            blobId: "blob-id",
            blobObject: {
              id: "blob-object-id",
              size: "123",
              storage: {
                start_epoch: 1,
                end_epoch: 4,
              },
            },
          };
        },
      },
    });

    const result = await storage.store({
      bytes: new Uint8Array([1, 2, 3]),
      attributes: { twinId: "twin-id" },
    });

    expect(calls[0]).toMatchObject({
      blob: new Uint8Array([1, 2, 3]),
      deletable: false,
      epochs: 3,
      attributes: { twinId: "twin-id" },
    });
    expect(result).toEqual({
      rawStorageRef: "walrus://blob/blob-id",
      blobId: "blob-id",
      blobObjectId: "blob-object-id",
      startEpoch: 1,
      endEpoch: 4,
      size: "123",
    });
}

export async function run_rejects_missing_config() {
  expect(() =>
      assertWalrusStorageConfig({
        network: "testnet",
        rpcUrl: "",
        privateKey: "",
        epochs: 0,
        deletable: false,
      }),
    ).toThrow("Missing required Sui RPC URL for Walrus storage");
}

export async function run_reads_encrypted_bytes_from_a_walrus_blob_ref() {
  const calls: unknown[] = [];
    const reader = createWalrusReader({
      config: {
        network: "testnet",
        rpcUrl: "https://fullnode.testnet.sui.io:443",
      },
      client: {
        async readBlob(input) {
          calls.push(input);
          return new Uint8Array([4, 5, 6]);
        },
      },
    });

    await expect(reader.read({ rawStorageRef: "walrus://blob/blob-id" })).resolves.toEqual(
      new Uint8Array([4, 5, 6]),
    );
    expect(calls).toEqual([{ blobId: "blob-id" }]);
}

export async function run_falls_back_to_an_aggregator_when_sdk_reads_fail() {
  const sdkCalls: unknown[] = [];
    const fetchCalls: string[] = [];
    const expectedBytes = new Uint8Array([7, 8, 9]);
    const reader = createWalrusReader({
      config: {
        network: "testnet",
        rpcUrl: "https://fullnode.testnet.sui.io:443",
        aggregatorUrl: "https://aggregator.walrus-testnet.walrus.space/",
      },
      client: {
        async readBlob(input) {
          sdkCalls.push(input);
          throw new Error("fetch failed");
        },
      },
      fetch: async (input) => {
        fetchCalls.push(input);

        return {
          ok: true,
          status: 200,
          statusText: "OK",
          async arrayBuffer() {
            return expectedBytes.buffer.slice(
              expectedBytes.byteOffset,
              expectedBytes.byteOffset + expectedBytes.byteLength,
            );
          },
        };
      },
    });

    await expect(
      reader.read({
        rawStorageRef: "walrus://blob/blob-id",
        expectedSha256: sha256Hex(expectedBytes),
      }),
    ).resolves.toEqual(expectedBytes);
    expect(sdkCalls).toEqual([{ blobId: "blob-id" }]);
    expect(fetchCalls).toEqual(["https://aggregator.walrus-testnet.walrus.space/v1/blobs/blob-id"]);
}

export async function run_falls_back_to_an_aggregator_when_sdk_cannot_decode_slivers() {
  const fetchCalls: string[] = [];
  const expectedBytes = new Uint8Array([10, 11, 12]);
  const reader = createWalrusReader({
    config: {
      network: "testnet",
      rpcUrl: "https://fullnode.testnet.sui.io:443",
      aggregatorUrl: "https://aggregator.walrus-testnet.walrus.space/",
    },
    client: {
      async readBlob() {
        throw new Error("Unable to retrieve enough slivers to decode blob blob-id.");
      },
    },
    fetch: async (input) => {
      fetchCalls.push(input);

      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async arrayBuffer() {
          return expectedBytes.buffer.slice(
            expectedBytes.byteOffset,
            expectedBytes.byteOffset + expectedBytes.byteLength,
          );
        },
      };
    },
  });

  await expect(reader.read({ rawStorageRef: "walrus://blob/blob-id" })).resolves.toEqual(
    expectedBytes,
  );
  expect(fetchCalls).toEqual(["https://aggregator.walrus-testnet.walrus.space/v1/blobs/blob-id"]);
}

export async function run_classifies_sui_gas_selection_failures_as_insufficient_balance() {
  const signer = Ed25519Keypair.generate();
  const storage = createWalrusStorage({
    config: {
      network: "testnet",
      rpcUrl: "https://fullnode.testnet.sui.io:443",
      privateKey: Ed25519Keypair.generate().getSecretKey(),
      epochs: 3,
      deletable: false,
      minWriteBalanceMist: "10000000",
    },
    signer,
    balanceClient: {
      core: {
        async getBalance() {
          return {
            balance: {
              balance: "1000",
            },
          };
        },
      },
    },
    client: {
      async writeBlob() {
        throw new Error(
          `Unable to perform gas selection due to insufficient SUI balance (in address balance or coins) for account ${signer.getPublicKey().toSuiAddress()} to satisfy required budget 9892000.`,
        );
      },
    },
  });

  await expect(storage.store({ bytes: new Uint8Array([1]) })).rejects.toMatchObject({
    name: "WalrusStorageError",
    code: "walrus_insufficient_balance",
    message: "Walrus storage wallet has insufficient SUI for this write",
    storageWallet: {
      network: "testnet",
      address: signer.getPublicKey().toSuiAddress(),
      balanceMist: "1000",
      requiredMist: "10000000",
      shortfallMist: "9999000",
    },
  });
}

export async function run_classifies_insufficient_balance_when_balance_diagnostics_fail() {
  const signer = Ed25519Keypair.generate();
  const storage = createWalrusStorage({
    config: {
      network: "testnet",
      rpcUrl: "https://fullnode.testnet.sui.io:443",
      privateKey: Ed25519Keypair.generate().getSecretKey(),
      epochs: 3,
      deletable: false,
      minWriteBalanceMist: "10000000",
    },
    signer,
    balanceClient: {
      core: {
        async getBalance() {
          throw new Error("fetch failed");
        },
      },
    },
    client: {
      async writeBlob() {
        throw new Error(
          `Unable to perform gas selection due to insufficient SUI balance (in address balance or coins) for account ${signer.getPublicKey().toSuiAddress()} to satisfy required budget 9892000.`,
        );
      },
    },
  });

  await expect(storage.store({ bytes: new Uint8Array([1]) })).rejects.toMatchObject({
    name: "WalrusStorageError",
    code: "walrus_insufficient_balance",
    message: "Walrus storage wallet has insufficient SUI for this write",
  });
}

export async function run_classifies_wal_balance_failures_as_insufficient_balance() {
  const signer = Ed25519Keypair.generate();
  const walCoinType = "0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL";
  const storage = createWalrusStorage({
    config: {
      network: "testnet",
      rpcUrl: "https://fullnode.testnet.sui.io:443",
      privateKey: Ed25519Keypair.generate().getSecretKey(),
      epochs: 3,
      deletable: false,
    },
    signer,
    balanceClient: {
      core: {
        async getBalance(input) {
          expect(input).toMatchObject({
            owner: signer.getPublicKey().toSuiAddress(),
            coinType: walCoinType,
          });
          return {
            balance: {
              balance: "338973",
            },
          };
        },
      },
    },
    client: {
      async writeBlob() {
        throw new Error(
          `Insufficient balance of ${walCoinType} for owner ${signer.getPublicKey().toSuiAddress()}. Required: 1200339, Available: 338973`,
        );
      },
    },
  });

  await expect(storage.store({ bytes: new Uint8Array([1]) })).rejects.toMatchObject({
    name: "WalrusStorageError",
    code: "walrus_insufficient_balance",
    message: "Walrus storage wallet has insufficient WAL for this write",
    storageWallet: {
      network: "testnet",
      address: signer.getPublicKey().toSuiAddress(),
      coinType: walCoinType,
      coinSymbol: "WAL",
      balanceMist: "338973",
      requiredMist: "1200339",
      shortfallMist: "861366",
      requiredAmountSource: "sdk_error",
    },
  });
}

export async function run_rejects_walrus_reads_when_bytes_do_not_match_the_expected_ha() {
  const reader = createWalrusReader({
      config: {
        network: "testnet",
        rpcUrl: "https://fullnode.testnet.sui.io:443",
      },
      client: {
        async readBlob() {
          return new Uint8Array([4, 5, 6]);
        },
      },
    });

    await expect(
      reader.read({
        rawStorageRef: "walrus://blob/blob-id",
        expectedSha256: sha256Hex(new Uint8Array([1, 2, 3])),
      }),
    ).rejects.toThrow("Walrus blob SHA-256 mismatch");
}

export async function run_parses_walrus_blob_refs() {
  expect(parseWalrusBlobId("walrus://blob/blob-id")).toBe("blob-id");
    expect(() => parseWalrusBlobId("https://example.com/blob-id")).toThrow(
      "Invalid Walrus blob reference",
    );
}
