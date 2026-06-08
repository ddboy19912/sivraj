import { expect } from "vitest";

import {
  createPrivateMemoryStorage,
  createPrivateMemoryStorageService,
} from "./private-memory-storage";

export async function run_private_memory_stora_encrypts_content_before_storing_it_on_walrus() {
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
    const sealedPayload = JSON.parse(new TextDecoder().decode((sealInputs[0] as { data: Uint8Array }).data));
    expect(sealedPayload).toMatchObject({
      kind: "source_artifact",
      version: 1,
      title: "Founder note",
      content: "Raw text memory",
      metadata: {},
    });
    expect(result.rawStorageRef).toBe("walrus://blob/blob-id");
}

export async function run_private_memory_stora_stores_client_encrypted_ciphertext_without_re_encryptin() {
  const sealInputs: unknown[] = [];
    const walrusInputs: unknown[] = [];
    const service = createPrivateMemoryStorageService({
      seal: {
        async encrypt(input) {
          sealInputs.push(input);
          return {
            encryptedBytes: new Uint8Array([0]),
            ciphertextSha256: "unexpected",
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
            rawStorageRef: "walrus://blob/client-blob-id",
            blobId: "client-blob-id",
            blobObjectId: "client-blob-object-id",
            startEpoch: 1,
            endEpoch: 6,
            size: "456",
          };
        },
      },
    });

    const result = await service.storeEncryptedPrivateMemory({
      twinId: "twin-id",
      sourceType: "note",
      encryptedBytes: new Uint8Array([1, 2, 3]),
      ciphertextSha256: "client-ciphertext-hash",
      seal: {
        packageId: "0xclientpackage",
        policyId: "0xclientpolicy",
        threshold: 1,
        keyServerObjectIds: ["0xclientkeyserver"],
      },
    });

    expect(sealInputs).toHaveLength(0);
    expect(walrusInputs[0]).toMatchObject({
      bytes: new Uint8Array([1, 2, 3]),
      attributes: {
        twinId: "twin-id",
        sourceType: "note",
        storageMode: "encrypted_walrus",
        sensitivity: "private",
        ciphertextSha256: "client-ciphertext-hash",
      },
    });
    expect(result).toMatchObject({
      rawStorageRef: "walrus://blob/client-blob-id",
      ciphertextSha256: "client-ciphertext-hash",
      seal: {
        packageId: "0xclientpackage",
        policyId: "0xclientpolicy",
      },
    });
}

export async function run_private_memory_stora_does_not_require_worker_or_llm_env_to_build_storage_con() {
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
}
