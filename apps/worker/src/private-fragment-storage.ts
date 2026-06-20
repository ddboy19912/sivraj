import {
  encryptAndStorePrivateFragmentContent,
  encryptPrivateFragmentContent,
  storeEncryptedPrivateFragmentContent,
  type PrivateEncryptedFragmentOutput,
  type PrivateFragmentContentKind,
  type PrivateFragmentStorageOutput,
} from "@sivraj/crypto-seal";
import {
  createPrivateEncryptedStorageRuntime,
  readPrivateEncryptedStorageConfig,
} from "./private-storage-runtime.js";

export type {
  PrivateEncryptedFragmentOutput,
  PrivateFragmentStorageOutput,
};

export type PrivateFragmentStorage = {
  storePrivateFragment(input: {
    twinId: string;
    sourceArtifactId: string;
    sourceType: string;
    content: string;
    contentKind?: PrivateFragmentContentKind;
  }): Promise<PrivateFragmentStorageOutput>;
  encryptPrivateFragment(input: {
    twinId: string;
    sourceArtifactId: string;
    sourceType: string;
    content: string;
    contentKind?: PrivateFragmentContentKind;
  }): Promise<PrivateEncryptedFragmentOutput>;
  storeEncryptedPrivateFragment(input: {
    twinId: string;
    sourceArtifactId: string;
    sourceType: string;
    encryptedBytesBase64: string;
    contentSha256: string;
    metadata: Record<string, unknown>;
    contentKind?: PrivateFragmentContentKind;
  }): Promise<PrivateFragmentStorageOutput>;
};

function createPrivateFragmentStorage(params: {
  runtime: ReturnType<typeof createPrivateEncryptedStorageRuntime>;
  walrusNetwork?: string;
  logger?: Pick<Console, "info">;
}): PrivateFragmentStorage {
  const logger = params.logger ?? console;
  const { seal, walrus } = params.runtime;

  return {
    async storePrivateFragment(input) {
      const totalStartedAt = Date.now();
      const contentKind = input.contentKind ?? "memory_fragment";
      const stored = await encryptAndStorePrivateFragmentContent({
        seal,
        walrus,
        ...input,
        contentKind,
      });

      logger.info("private fragment storage completed", {
        twinId: input.twinId,
        sourceArtifactId: input.sourceArtifactId,
        sourceType: input.sourceType,
        contentKind,
        plaintextChars: input.content.length,
        encryptedBytes: approximateBase64Bytes(stored.encryptedBytesBase64 ?? ""),
        sealEncryptMs: readNumber(stored.metadata["sealEncryptMs"]),
        walrusStoreMs: readNumber(stored.metadata["walrusStoreMs"]),
        totalMs: Date.now() - totalStartedAt,
        rawStorageRef: stored.contentStorageRef,
      });

      await verifyStoredPrivateFragment({
        rawStorageRef: stored.contentStorageRef,
        expectedSha256: stored.contentSha256,
        runtime: params.runtime,
        logger,
        sourceArtifactId: input.sourceArtifactId,
        contentKind,
      });

      return withWalrusNetwork(stored, params.walrusNetwork);
    },
    async encryptPrivateFragment(input) {
      const encrypted = await encryptPrivateFragmentContent({
        seal,
        ...input,
      });

      return {
        encryptedBytesBase64: encrypted.encryptedBytesBase64,
        contentSha256: encrypted.contentSha256,
        metadata: encrypted.metadata,
      };
    },
    async storeEncryptedPrivateFragment(input) {
      const contentKind = input.contentKind ?? "memory_fragment";
      const stored = await storeEncryptedPrivateFragmentContent({
        walrus,
        ...input,
        contentKind,
      });

      logger.info("private encrypted fragment walrus storage completed", {
        twinId: input.twinId,
        sourceArtifactId: input.sourceArtifactId,
        sourceType: input.sourceType,
        contentKind,
        encryptedBytes: Buffer.from(input.encryptedBytesBase64, "base64").length,
        walrusStoreMs: readNumber(stored.metadata["walrusStoreMs"]),
        rawStorageRef: stored.contentStorageRef,
      });

      await verifyStoredPrivateFragment({
        rawStorageRef: stored.contentStorageRef,
        expectedSha256: stored.contentSha256,
        runtime: params.runtime,
        logger,
        sourceArtifactId: input.sourceArtifactId,
        contentKind,
      });

      return withWalrusNetwork(stored, params.walrusNetwork);
    },
  };
}

async function verifyStoredPrivateFragment(params: {
  rawStorageRef: string;
  expectedSha256: string;
  runtime: ReturnType<typeof createPrivateEncryptedStorageRuntime>;
  logger: Pick<Console, "info">;
  sourceArtifactId: string;
  contentKind: string;
}) {
  const startedAt = Date.now();
  const bytes = await params.runtime.walrusReader.read({
    rawStorageRef: params.rawStorageRef,
    expectedSha256: params.expectedSha256,
  });

  params.logger.info("private fragment walrus verification completed", {
    sourceArtifactId: params.sourceArtifactId,
    contentKind: params.contentKind,
    rawStorageRef: params.rawStorageRef,
    encryptedBytes: bytes.length,
    durationMs: Date.now() - startedAt,
  });
}

export function createConfiguredPrivateFragmentStorage(
  env: Record<string, string | undefined>,
): PrivateFragmentStorage | undefined {
  const config = readPrivateEncryptedStorageConfig(env);

  if (!config) {
    return undefined;
  }

  return createPrivateFragmentStorage({
    runtime: createPrivateEncryptedStorageRuntime(config),
    walrusNetwork: config.walrusNetwork,
  });
}

function withWalrusNetwork<T extends PrivateFragmentStorageOutput>(
  stored: T,
  walrusNetwork: string | undefined,
): T {
  if (!walrusNetwork) {
    return stored;
  }

  return {
    ...stored,
    metadata: {
      ...stored.metadata,
      walrusNetwork,
      walrus: {
        ...(typeof stored.metadata.walrus === "object" && stored.metadata.walrus
          ? stored.metadata.walrus
          : {}),
        network: walrusNetwork,
      },
    },
  };
}

function approximateBase64Bytes(value: string): number {
  return Math.floor((value.length * 3) / 4);
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
