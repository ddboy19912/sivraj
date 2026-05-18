import { describe, expect, it } from "vitest";
import {
  createPrivateMemoryStorage,
  createPrivateMemoryStorageService,
} from "./private-memory-storage";

describe("private memory storage service", () => {
  it("encrypts content before storing it on Walrus", async () => {
    const sealInputs: unknown[] = [];
    const walrusInputs: unknown[] = [];
    const service = createPrivateMemoryStorageService({
      seal: {
        async encrypt(input) {
          sealInputs.push(input);
          return {
            encryptedBytes: new Uint8Array([7, 8, 9]),
            ciphertextSha256: "ciphertext-hash",
            packageId: "0xpackage",
            policyId: "0xpolicy",
            threshold: 1,
            keyServerObjectIds: ["0xkeyserver"],
          };
        },
      },
      walrus: {
        async store(input) {
          walrusInputs.push(input);
          return {
            rawStorageRef: "walrus://blob/blob-id",
            blobId: "blob-id",
            blobObjectId: "blob-object-id",
            startEpoch: 1,
            endEpoch: 6,
            size: "123",
          };
        },
      },
    });

    const result = await service.storePrivateMemory({
      twinId: "twin-id",
      sourceType: "note",
      title: "Founder note",
      content: "Raw text memory",
      metadata: {},
    });

    expect(JSON.stringify(walrusInputs)).not.toContain("Raw text memory");
    expect(walrusInputs[0]).toMatchObject({
      bytes: new Uint8Array([7, 8, 9]),
      attributes: {
        twinId: "twin-id",
        sourceType: "note",
        storageMode: "encrypted_walrus",
        sensitivity: "private",
        ciphertextSha256: "ciphertext-hash",
      },
    });
    expect(sealInputs[0]).toMatchObject({
      data: new TextEncoder().encode("Raw text memory"),
    });
    expect(result.rawStorageRef).toBe("walrus://blob/blob-id");
  });

  it("does not require worker or LLM env to build storage config", async () => {
    const service = createPrivateMemoryStorage({
      SEAL_PACKAGE_ID: "0xpackage",
      SEAL_POLICY_ID: "0xpolicy",
      SEAL_KEY_SERVERS: "0xkeyserver",
      SUI_RPC_URL: "https://fullnode.testnet.sui.io:443",
      SUI_PRIVATE_KEY: "invalid-key",
    });

    await expect(
      service.storePrivateMemory({
        twinId: "twin-id",
        sourceType: "note",
        title: null,
        content: "Raw text memory",
        metadata: {},
      }),
    ).rejects.not.toThrow(/REDIS_URL|LLM_API_KEY/);
  });
});
