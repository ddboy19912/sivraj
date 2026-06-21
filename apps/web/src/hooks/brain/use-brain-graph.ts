import { useQuery } from "@tanstack/react-query";
import { getAuthedJson, isAuthError } from "@/lib/api";
import { resolveBrainViewState } from "@/lib/brain/graph";
import type { Session } from "@/lib/session";
import type { BrainGraphResponse } from "@/types/brain.types";

const BRAIN_GRAPH_LIMIT = 160;

type UseBrainGraphInput = {
  session: Session;
  onSessionRefreshed: (session: Session) => void;
};

export function useBrainGraph({
  session,
  onSessionRefreshed,
}: UseBrainGraphInput) {
  const {
    data,
    error,
    isFetching,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["brain-graph", session.twinId],
    queryFn: () => fetchBrainGraph(session, onSessionRefreshed),
    retry: (failureCount, error) => !isAuthError(error) && failureCount < 1,
    staleTime: 30_000,
  });

  return {
    data,
    error,
    isFetching,
    isLoading,
    refetch,
    viewState: resolveBrainViewState({
      graph: data ?? null,
      isLoading: isLoading || isFetching,
      error,
    }),
  };
}

function fetchBrainGraph(
  session: Session,
  onSessionRefreshed: (session: Session) => void,
) {
  const path = `/v1/twins/${session.twinId}/graph?limit=${BRAIN_GRAPH_LIMIT}`;
  return getAuthedJson<BrainGraphResponse>(path, session, onSessionRefreshed);
}
