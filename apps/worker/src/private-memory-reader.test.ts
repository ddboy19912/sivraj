import { describe, expect, it, vi } from "vitest";
import { createPrivateMemoryReader } from "./private-memory-reader.js";

describe("private memory reader", () => {
  it("reads ciphertext from Walrus and decrypts with Seal", async () => {
    const walrusCalls: unknown[] = [];
    const sealCalls: unknown[] = [];
    const reader = createPrivateMemoryReader({
      walrus: {
        async read(input) {
          walrusCalls.push(input);
          return new Uint8Array([1, 2, 3]);
        },
      },
      seal: {
        async decrypt(input) {
          sealCalls.push(input);
          return {
            plaintext: new TextEncoder().encode("private memory"),
            packageId: "0xpackage",
            policyId: "0xpolicy",
            sealId: "0xseal",
          };
        },
      },
    });

    await expect(
      reader.readPrivateMemory({
        rawStorageRef: "walrus://blob/blob-id",
        artifactId: "artifact-id",
        twinId: "twin-id",
      }),
    ).resolves.toBe("private memory");
    expect(walrusCalls).toEqual([{ rawStorageRef: "walrus://blob/blob-id" }]);
    expect(sealCalls).toEqual([{ encryptedBytes: new Uint8Array([1, 2, 3]) }]);
  });

  it("retries transient Walrus read failures with stage-aware logs", async () => {
    const warn = vi.fn();
    let attempts = 0;
    const reader = createPrivateMemoryReader({
      logger: { warn },
      walrus: {
        async read() {
          attempts += 1;

          if (attempts === 1) {
            throw new Error("fetch failed");
          }

          return new Uint8Array([1, 2, 3]);
        },
      },
      seal: {
        async decrypt() {
          return {
            plaintext: new TextEncoder().encode("private memory"),
            packageId: "0xpackage",
            policyId: "0xpolicy",
            sealId: "0xseal",
          };
        },
      },
    });

    await expect(
      reader.readPrivateMemory({
        rawStorageRef: "walrus://blob/blob-id",
        artifactId: "artifact-id",
        twinId: "twin-id",
      }),
    ).resolves.toBe("private memory");
    expect(attempts).toBe(2);
    expect(warn).toHaveBeenCalledWith(
      "private memory read stage failed",
      expect.objectContaining({
        stage: "walrus_read",
        artifactId: "artifact-id",
        attempt: 1,
        retryable: true,
        errorMessage: "fetch failed",
      }),
    );
  });

  it("decrypts transient ciphertext without reading Walrus", async () => {
    const walrusCalls: unknown[] = [];
    const sealCalls: unknown[] = [];
    const encryptedBytes = new Uint8Array([4, 5, 6]);
    const reader = createPrivateMemoryReader({
      walrus: {
        async read(input) {
          walrusCalls.push(input);
          return new Uint8Array([1, 2, 3]);
        },
      },
      seal: {
        async decrypt(input) {
          sealCalls.push(input);
          return {
            plaintext: new TextEncoder().encode("transient memory"),
            packageId: "0xpackage",
            policyId: "0xpolicy",
            sealId: "0xseal",
          };
        },
      },
    });

    await expect(
      reader.readPrivateMemoryFromEncryptedBytes?.({
        encryptedBytesBase64: Buffer.from(encryptedBytes).toString("base64"),
        artifactId: "artifact-id",
        twinId: "twin-id",
        source: "artifact_queue",
      }),
    ).resolves.toBe("transient memory");
    expect(walrusCalls).toEqual([]);
    expect(sealCalls).toEqual([{ encryptedBytes: Buffer.from(encryptedBytes) }]);
  });
});
