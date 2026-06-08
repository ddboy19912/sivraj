import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAuthError } from "@/lib/api";
import { fetchTwinBootstrap } from "@/hooks/twin-bootstrap/twin-bootstrap-fetch";
import { useTwinBootstrapEffects } from "@/hooks/twin-bootstrap/use-twin-bootstrap-effects";
import type { Session } from "@/lib/session";
import type { TwinBootstrap } from "@/types/wallet.types";

type UseTwinBootstrapInput = {
  session: Session | null;
  hasMatchingWalletSession: boolean;
  setSession: (session: Session) => void;
  resetSession: () => void;
  setAuthError: (error: string | null) => void;
};

export function useTwinBootstrap({
  session,
  hasMatchingWalletSession,
  setSession,
  resetSession,
  setAuthError,
}: UseTwinBootstrapInput) {
  const queryClient = useQueryClient();
  const bootstrapQueryKey = [
    "twin-bootstrap",
    session?.twinId ?? null,
    session?.walletAddress ?? null,
  ] as const;

  const {
    data: bootstrapData,
    error: bootstrapError,
    isFetching,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: bootstrapQueryKey,
    enabled: Boolean(session && hasMatchingWalletSession),
    queryFn: () => fetchTwinBootstrap(session!, setSession),
    retry: (failureCount, error) => !isAuthError(error) && failureCount < 1,
    staleTime: 30_000,
  });

  useTwinBootstrapEffects({
    session,
    bootstrap: bootstrapData,
    bootstrapError,
    resetSession,
    setAuthError,
  });

  function updateBootstrap(updater: (current: TwinBootstrap) => TwinBootstrap) {
    queryClient.setQueryData<TwinBootstrap>(bootstrapQueryKey, (current) =>
      current ? updater(current) : current,
    );
  }

  return {
    bootstrap: bootstrapData ?? null,
    bootstrapError,
    isBootstrapLoading: isLoading || isFetching,
    refetchBootstrap: () => void refetch(),
    updateBootstrap,
  };
}
