import { TextEncoder } from "node:util";
import type { WalrusStorage, WalrusStoreOutput } from "@sivraj/storage-walrus";
import type { SealEncryptor } from "./seal-types.js";
import {
  mapSealEncryptOutputMetadata,
  mapWalrusStoreOutputMetadata,
} from "./private-source-storage.js";

const textEncoder = new TextEncoder();

export type PrivateFragmentContentKind =
  | "memory_fragment"
  | "candidate_memory"
  | "reflection";

export type PrivateFragmentStorageOutput = {
  contentStorageRef: string;
  contentSha256: string;
  encryptedBytesBase64?: string;
  metadata: Record<string, unknown>;
};

export type PrivateEncryptedFragmentOutput = {
  encryptedBytesBase64: string;
  contentSha256: string;
  metadata: Record<string, unknown>;
};

export async function encryptPrivateFragmentContent(params: {
  seal: SealEncryptor;
  twinId: string;
  sourceArtifactId: string;
  sourceType: string;
  content: string;
  contentKind?: PrivateFragmentContentKind;
}): Promise<PrivateEncryptedFragmentOutput & { sealEncryptMs: number }> {
  const contentKind = params.contentKind ?? "memory_fragment";
  const encryptStartedAt = Date.now();
  const encrypted = await params.seal.encrypt({
    data: textEncoder.encode(params.content),
    aad: textEncoder.encode(
      JSON.stringify({
        twinId: params.twinId,
        sourceArtifactId: params.sourceArtifactId,
        sourceType: params.sourceType,
        kind: contentKind,
      }),
    ),
  });
  const sealEncryptMs = Date.now() - encryptStartedAt;

  return {
    encryptedBytesBase64: Buffer.from(encrypted.encryptedBytes).toString("base64"),
    contentSha256: encrypted.ciphertextSha256,
    metadata: {
      storageMode: "encrypted_walrus",
      sensitivity: "private",
      contentKind,
      sealEncryptMs,
      seal: mapSealEncryptOutputMetadata(encrypted),
    },
    sealEncryptMs,
  };
}

export async function storeEncryptedPrivateFragmentContent(params: {
  walrus: WalrusStorage;
  twinId: string;
  sourceArtifactId: string;
  sourceType: string;
  encryptedBytesBase64: string;
  contentSha256: string;
  metadata: Record<string, unknown>;
  contentKind?: PrivateFragmentContentKind;
}): Promise<PrivateFragmentStorageOutput> {
  const contentKind = params.contentKind ?? "memory_fragment";
  const encryptedBytes = Buffer.from(params.encryptedBytesBase64, "base64");
  const walrusStartedAt = Date.now();
  const stored = await params.walrus.store({
    bytes: encryptedBytes,
    attributes: {
      twinId: params.twinId,
      sourceArtifactId: params.sourceArtifactId,
      sourceType: params.sourceType,
      storageMode: "encrypted_walrus",
      sensitivity: "private",
      contentSha256: params.contentSha256,
      kind: contentKind,
    },
  });
  const walrusStoreMs = Date.now() - walrusStartedAt;

  return mapStoredPrivateFragmentContent({
    stored,
    contentSha256: params.contentSha256,
    encryptedBytesBase64: params.encryptedBytesBase64,
    metadata: params.metadata,
    walrusStoreMs,
  });
}

export function mapStoredPrivateFragmentContent(input: {
  stored: WalrusStoreOutput;
  contentSha256: string;
  encryptedBytesBase64: string;
  metadata: Record<string, unknown>;
  walrusStoreMs: number;
}): PrivateFragmentStorageOutput {
  return {
    contentStorageRef: input.stored.rawStorageRef,
    contentSha256: input.contentSha256,
    encryptedBytesBase64: input.encryptedBytesBase64,
    metadata: {
      ...input.metadata,
      walrusStoreMs: input.walrusStoreMs,
      walrus: mapWalrusStoreOutputMetadata(input.stored),
    },
  };
}

export async function encryptAndStorePrivateFragmentContent(params: {
  seal: SealEncryptor;
  walrus: WalrusStorage;
  twinId: string;
  sourceArtifactId: string;
  sourceType: string;
  content: string;
  contentKind?: PrivateFragmentContentKind;
}): Promise<PrivateFragmentStorageOutput & { sealEncryptMs: number }> {
  const encrypted = await encryptPrivateFragmentContent(params);

  const stored = await storeEncryptedPrivateFragmentContent({
    walrus: params.walrus,
    twinId: params.twinId,
    sourceArtifactId: params.sourceArtifactId,
    sourceType: params.sourceType,
    encryptedBytesBase64: encrypted.encryptedBytesBase64,
    contentSha256: encrypted.contentSha256,
    metadata: encrypted.metadata,
    contentKind: params.contentKind,
  });

  return {
    ...stored,
    sealEncryptMs: encrypted.sealEncryptMs,
  };
}
