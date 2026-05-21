import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertWalrusStorageConfig,
  createWalrusReader,
  createWalrusStorage,
  parseWalrusBlobId,
} from "./index";

describe("Walrus storage adapter", () => {
  it("stores encrypted bytes and returns a durable ref", async () => {
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
  });

  it("rejects missing config", () => {
    expect(() =>
      assertWalrusStorageConfig({
        network: "testnet",
        rpcUrl: "",
        privateKey: "",
        epochs: 0,
        deletable: false,
      }),
    ).toThrow("Missing required Sui RPC URL for Walrus storage");
  });

  it("reads encrypted bytes from a Walrus blob ref", async () => {
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
  });

  it("falls back to an aggregator when SDK reads fail", async () => {
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
  });

  it("rejects Walrus reads when bytes do not match the expected hash", async () => {
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
  });

  it("parses Walrus blob refs", () => {
    expect(parseWalrusBlobId("walrus://blob/blob-id")).toBe("blob-id");
    expect(() => parseWalrusBlobId("https://example.com/blob-id")).toThrow(
      "Invalid Walrus blob reference",
    );
  });
});

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
