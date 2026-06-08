import type { PrivateMemoryReader } from "@sivraj/private-memory-reader";
import type { QueuedArtifact } from "../types/ingestion.types.js";
import { errorMessage } from "./errors.js";
import { approximateBase64Bytes } from "./readers.js";
import { readCiphertextSha256 } from "./metadata-utils.js";

export function isRetryablePrivateMemoryReadError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();

  return [
    "fetch failed",
    "network",
    "timeout",
    "timed out",
    "econnreset",
    "econnrefused",
    "socket",
    "429",
    "500",
    "502",
    "503",
    "504",
    "walrus_read failed",
    "seal_decrypt failed",
  ].some((fragment) => message.includes(fragment));
}

export function readArtifactPrivateMemory(input: {
  privateMemoryReader: PrivateMemoryReader;
  artifact: QueuedArtifact;
  metadata: Record<string, unknown>;
  transientCiphertextBase64?: string;
  transientCiphertextSha256?: string;
}): Promise<string> {
  const expectedCiphertextSha256 = readCiphertextSha256(input.metadata);

  if (
    input.transientCiphertextBase64 &&
    input.privateMemoryReader.readPrivateMemoryFromEncryptedBytes
  ) {
    console.log("artifact transient ciphertext handoff used", {
      artifactId: input.artifact.id,
      sourceType: input.artifact.sourceType,
      ciphertextBytesApprox: approximateBase64Bytes(input.transientCiphertextBase64),
    });

    return input.privateMemoryReader.readPrivateMemoryFromEncryptedBytes({
      encryptedBytesBase64: input.transientCiphertextBase64,
      artifactId: input.artifact.id,
      twinId: input.artifact.twinId,
      expectedCiphertextSha256: input.transientCiphertextSha256 ?? expectedCiphertextSha256,
      source: "artifact_queue",
    });
  }

  return input.privateMemoryReader.readPrivateMemory({
    rawStorageRef: input.artifact.rawStorageRef!,
    artifactId: input.artifact.id,
    twinId: input.artifact.twinId,
    expectedCiphertextSha256,
  });
}
