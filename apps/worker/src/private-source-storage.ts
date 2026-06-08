import {
  encryptAndStorePrivateSourceArtifact,
  type PrivateSourceStorage,
  type PrivateSourceStorageOutput,
} from "@sivraj/crypto-seal";
import {
  createPrivateEncryptedStorageRuntime,
  readPrivateEncryptedStorageConfig,
} from "./private-storage-runtime.js";

export type { PrivateSourceStorage };

export function createConfiguredPrivateSourceStorage(
  env: Record<string, string | undefined>,
): PrivateSourceStorage | undefined {
  const config = readPrivateEncryptedStorageConfig(env);

  if (!config) {
    return undefined;
  }

  const runtime = createPrivateEncryptedStorageRuntime(config);

  return {
    async storePrivateSource(input) {
      return encryptAndStorePrivateSourceArtifact({
        seal: runtime.seal,
        walrus: runtime.walrus,
        input,
      });
    },
  };
}
