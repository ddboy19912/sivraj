import { describe, expect, it } from "vitest";
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
});
