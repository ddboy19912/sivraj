import { asRecord } from "./metadata-utils.js";

export function isEncryptedPrivateArtifact(metadata: Record<string, unknown>): boolean {
  return metadata["storageMode"] === "encrypted_walrus" && metadata["sensitivity"] === "private";
}

export function readPlaintextProcessingInput(metadata: Record<string, unknown>): string | null {
  const processingInput = asRecord(metadata["processingInput"]);
  const content = processingInput["content"];

  return typeof content === "string" && content.trim().length > 0 ? content.trim() : null;
}

export function isSpeechToTextSource(sourceType: string): boolean {
  return sourceType === "voice_note" || sourceType === "voice_conversation";
}

export function pendingCandidateMemoryArchiveRef(artifactId: string, memoryFragmentId: string): string {
  return `pending://candidate-memory-archive/${artifactId}/${memoryFragmentId}`;
}
