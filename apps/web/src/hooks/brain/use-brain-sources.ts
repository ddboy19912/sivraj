import { useQuery } from "@tanstack/react-query";
import { getAuthedJson, isAuthError } from "@/lib/api";
import type { Session } from "@/lib/session";
import type {
  BrainArtifactContentResponse,
  BrainSourceKindFilter,
  BrainSourcesResponse,
} from "@/types/brain.types";

const BRAIN_SOURCES_LIMIT = 100;

export function useBrainSources(input: {
  session: Session;
  kind: BrainSourceKindFilter;
  onSessionRefreshed: (session: Session) => void;
}) {
  return useQuery({
    queryKey: ["brain-sources", input.session.twinId, input.kind],
    queryFn: () => fetchBrainSources(input),
    retry: (failureCount, error) => !isAuthError(error) && failureCount < 1,
    staleTime: 30_000,
  });
}

export function useBrainArtifactContent(input: {
  session: Session;
  artifactId: string | null;
  onSessionRefreshed: (session: Session) => void;
}) {
  return useQuery({
    queryKey: ["brain-artifact-content", input.session.twinId, input.artifactId],
    queryFn: () => fetchBrainArtifactContent({
      session: input.session,
      artifactId: input.artifactId!,
      onSessionRefreshed: input.onSessionRefreshed,
    }),
    enabled: Boolean(input.artifactId),
    retry: (failureCount, error) => !isAuthError(error) && failureCount < 1,
    staleTime: 60_000,
  });
}

function fetchBrainSources(input: {
  session: Session;
  kind: BrainSourceKindFilter;
  onSessionRefreshed: (session: Session) => void;
}) {
  const params = new URLSearchParams({
    kind: input.kind,
    limit: String(BRAIN_SOURCES_LIMIT),
  });

  return getAuthedJson<BrainSourcesResponse>(
    `/v1/twins/${input.session.twinId}/artifacts?${params.toString()}`,
    input.session,
    input.onSessionRefreshed,
  );
}

function fetchBrainArtifactContent(input: {
  session: Session;
  artifactId: string;
  onSessionRefreshed: (session: Session) => void;
}) {
  return getAuthedJson<BrainArtifactContentResponse>(
    `/v1/twins/${input.session.twinId}/artifacts/${input.artifactId}/content`,
    input.session,
    input.onSessionRefreshed,
  );
}
