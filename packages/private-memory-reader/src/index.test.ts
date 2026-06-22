import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createPrivateMemoryReader, type PrivateMemoryCiphertextCache } from "./index.js";

describe("private memory ciphertext cache", () => {
  it("populates ciphertext cache after Walrus reads", async () => {
    const encryptedBytes = new TextEncoder().encode("encrypted");
    const sha = sha256Hex(encryptedBytes);
    const cache = createMemoryCache();
    const walrusRead = vi.fn(async () => encryptedBytes);
    const reader = createPrivateMemoryReader({
      walrus: { read: walrusRead },
      seal: sealEcho(),
      ciphertextCache: cache,
      logger: silentLogger(),
    });

    await expect(reader.readPrivateMemory({
      rawStorageRef: "walrus://blob/blob-1",
      artifactId: "artifact-1",
      twinId: "twin-1",
      expectedCiphertextSha256: sha,
    })).resolves.toBe("encrypted");

    expect(walrusRead).toHaveBeenCalledTimes(1);
    expect(cache.putPrivateMemoryCiphertext).toHaveBeenCalledWith(
      expect.objectContaining({
        rawStorageRef: "walrus://blob/blob-1",
        ciphertextSha256: sha,
        provider: "walrus",
      }),
    );
  });

  it("uses cached ciphertext without reading Walrus", async () => {
    const encryptedBytes = new TextEncoder().encode("cached");
    const sha = sha256Hex(encryptedBytes);
    const cache = createMemoryCache({
      encryptedBytesBase64: Buffer.from(encryptedBytes).toString("base64"),
      rawStorageRef: "walrus://blob/blob-1",
      ciphertextSha256: sha,
      byteLength: encryptedBytes.length,
      cachedAt: new Date().toISOString(),
      provider: "walrus",
    });
    const walrusRead = vi.fn(async () => {
      throw new Error("walrus should not be called");
    });
    const reader = createPrivateMemoryReader({
      walrus: { read: walrusRead },
      seal: sealEcho(),
      ciphertextCache: cache,
      logger: silentLogger(),
    });

    await expect(reader.readPrivateMemory({
      rawStorageRef: "walrus://blob/blob-1",
      artifactId: "artifact-1",
      twinId: "twin-1",
      expectedCiphertextSha256: sha,
    })).resolves.toBe("cached");

    expect(walrusRead).not.toHaveBeenCalled();
  });

  it("rejects corrupted cache entries and falls back to Walrus", async () => {
    const encryptedBytes = new TextEncoder().encode("fresh");
    const sha = sha256Hex(encryptedBytes);
    const cache = createMemoryCache({
      encryptedBytesBase64: Buffer.from("bad").toString("base64"),
      rawStorageRef: "walrus://blob/blob-1",
      ciphertextSha256: sha,
      byteLength: 3,
      cachedAt: new Date().toISOString(),
      provider: "walrus",
    });
    const walrusRead = vi.fn(async () => encryptedBytes);
    const reader = createPrivateMemoryReader({
      walrus: { read: walrusRead },
      seal: sealEcho(),
      ciphertextCache: cache,
      logger: silentLogger(),
    });

    await expect(reader.readPrivateMemory({
      rawStorageRef: "walrus://blob/blob-1",
      artifactId: "artifact-1",
      twinId: "twin-1",
      expectedCiphertextSha256: sha,
    })).resolves.toBe("fresh");

    expect(walrusRead).toHaveBeenCalledTimes(1);
  });
});

function createMemoryCache(
  cachedEntry: Awaited<ReturnType<PrivateMemoryCiphertextCache["getPrivateMemoryCiphertext"]>> = null,
): PrivateMemoryCiphertextCache & {
  putPrivateMemoryCiphertext: ReturnType<typeof vi.fn>;
  getPrivateMemoryCiphertext: ReturnType<typeof vi.fn>;
} {
  return {
    getPrivateMemoryCiphertext: vi.fn(async () => cachedEntry),
    putPrivateMemoryCiphertext: vi.fn(async () => undefined),
  };
}

function sealEcho() {
  return {
    decrypt: vi.fn(async ({ encryptedBytes }: { encryptedBytes: Uint8Array }) => ({
      plaintext: encryptedBytes,
      packageId: "package",
      policyId: "policy",
      sealId: "seal",
    })),
  };
}

function silentLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  };
}

function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
