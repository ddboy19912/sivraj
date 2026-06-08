import { TextEncoder } from "node:util";
import {
  buildPrivateSourceArtifactAad,
  buildPrivateSourceArtifactPayload,
} from "@sivraj/core";
import type { WalrusStorage, WalrusStoreOutput } from "@sivraj/storage-walrus";
import type { SealEncryptor, SealEncryptOutput } from "./seal-types.js";

const textEncoder = new TextEncoder();

export type PrivateSourceStorageOutput = {
  rawStorageRef: string;
  ciphertextSha256: string;
  encryptedBytesBase64?: string;
  seal: {
    packageId: string;
    policyId: string;
    threshold: number;
    keyServerObjectIds: string[];
  };
  walrus: {
    blobId: string;
    blobObjectId: string;
    startEpoch: number;
    endEpoch: number;
    size: string;
  };
};

export type PrivateSourceStorageInput = {
  twinId: string;
  sourceType: string;
  title: string | null;
  content: string;
  metadata: Record<string, unknown>;
};

export type PrivateSourceStorage = {
  storePrivateSource(input: PrivateSourceStorageInput): Promise<PrivateSourceStorageOutput>;
};

export async function encryptAndStorePrivateSourceArtifact(params: {
  seal: SealEncryptor;
  walrus: WalrusStorage;
  input: PrivateSourceStorageInput;
}): Promise<PrivateSourceStorageOutput> {
  const plaintextBytes = textEncoder.encode(
    JSON.stringify(
      buildPrivateSourceArtifactPayload({
        title: params.input.title,
        content: params.input.content,
        metadata: params.input.metadata,
      }),
    ),
  );
  const encrypted = await params.seal.encrypt({
    data: plaintextBytes,
    aad: textEncoder.encode(
      JSON.stringify(
        buildPrivateSourceArtifactAad({
          twinId: params.input.twinId,
          sourceType: params.input.sourceType,
        }),
      ),
    ),
  });

  return storeEncryptedPrivateSourceArtifact({
    walrus: params.walrus,
    twinId: params.input.twinId,
    sourceType: params.input.sourceType,
    encrypted,
  });
}

export async function storeEncryptedPrivateSourceArtifact(params: {
  walrus: WalrusStorage;
  twinId: string;
  sourceType: string;
  encrypted: SealEncryptOutput;
}): Promise<PrivateSourceStorageOutput> {
  const stored = await params.walrus.store({
    bytes: params.encrypted.encryptedBytes,
    attributes: {
      twinId: params.twinId,
      sourceType: params.sourceType,
      storageMode: "encrypted_walrus",
      sensitivity: "private",
      ciphertextSha256: params.encrypted.ciphertextSha256,
    },
  });

  return mapEncryptedPrivateSourceStorageResult({
    encrypted: params.encrypted,
    stored,
  });
}

export function mapEncryptedPrivateSourceStorageResult(input: {
  encrypted: SealEncryptOutput;
  stored: WalrusStoreOutput;
}): PrivateSourceStorageOutput {
  return {
    rawStorageRef: input.stored.rawStorageRef,
    ciphertextSha256: input.encrypted.ciphertextSha256,
    encryptedBytesBase64: Buffer.from(input.encrypted.encryptedBytes).toString("base64"),
    seal: {
      packageId: input.encrypted.packageId,
      policyId: input.encrypted.policyId,
      threshold: input.encrypted.threshold,
      keyServerObjectIds: input.encrypted.keyServerObjectIds,
    },
    walrus: {
      blobId: input.stored.blobId,
      blobObjectId: input.stored.blobObjectId,
      startEpoch: input.stored.startEpoch,
      endEpoch: input.stored.endEpoch,
      size: input.stored.size,
    },
  };
}

export function mapSealEncryptOutputMetadata(encrypted: SealEncryptOutput) {
  return {
    packageId: encrypted.packageId,
    policyId: encrypted.policyId,
    threshold: encrypted.threshold,
    keyServerObjectIds: encrypted.keyServerObjectIds,
  };
}

export function mapWalrusStoreOutputMetadata(stored: WalrusStoreOutput) {
  return {
    blobId: stored.blobId,
    blobObjectId: stored.blobObjectId,
    startEpoch: stored.startEpoch,
    endEpoch: stored.endEpoch,
    size: stored.size,
  };
}
