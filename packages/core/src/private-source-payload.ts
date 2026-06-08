export const PRIVATE_SOURCE_ARTIFACT_PAYLOAD_VERSION = 1;

export type PrivateSourceArtifactPayload = {
  kind: "source_artifact";
  version: typeof PRIVATE_SOURCE_ARTIFACT_PAYLOAD_VERSION;
  title: string | null;
  content: string;
  metadata: Record<string, unknown>;
};

export function buildPrivateSourceArtifactPayload(input: {
  title: string | null;
  content: string;
  metadata: Record<string, unknown>;
}): PrivateSourceArtifactPayload {
  return {
    kind: "source_artifact",
    version: PRIVATE_SOURCE_ARTIFACT_PAYLOAD_VERSION,
    title: input.title,
    content: input.content,
    metadata: input.metadata,
  };
}

export function buildPrivateSourceArtifactAad(input: {
  twinId?: string;
  sourceType: string;
  encryptionBoundary?: "client";
}): Record<string, unknown> {
  return {
    ...(input.twinId ? { twinId: input.twinId } : {}),
    sourceType: input.sourceType,
    kind: "source_artifact",
    version: PRIVATE_SOURCE_ARTIFACT_PAYLOAD_VERSION,
    ...(input.encryptionBoundary ? { encryptionBoundary: input.encryptionBoundary } : {}),
  };
}
