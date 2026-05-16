import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { describe, expect, it } from "vitest";
import { assertWalrusStorageConfig, createWalrusStorage } from "./index";

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
});
