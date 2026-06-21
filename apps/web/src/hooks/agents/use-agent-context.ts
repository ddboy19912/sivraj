import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAuthError } from "@/lib/api";
import {
  createAgentToken,
  loadAgentClients,
  loadAgentContext,
  revokeAgentClient,
} from "@/lib/agents/agent-context-api";
import type { Session } from "@/lib/session";
import type { AgentContextPreset, AgentContextScope } from "@/types/agent-context.types";

type AgentContextHookInput = {
  session: Session | null;
  preset: AgentContextPreset;
  onSessionRefreshed: (session: Session) => void;
};

type AgentClientsHookInput = {
  session: Session | null;
  onSessionRefreshed: (session: Session) => void;
};

export function useAgentContext({
  session,
  preset,
  onSessionRefreshed,
}: AgentContextHookInput) {
  return useQuery({
    queryKey: ["agent-context", session?.twinId ?? null, preset],
    queryFn: () => loadAgentContext({
      session: session!,
      preset,
      onSessionRefreshed,
    }),
    enabled: Boolean(session),
    retry: (failureCount, error) => !isAuthError(error) && failureCount < 1,
    staleTime: 30_000,
  });
}

export function useAgentClients({
  session,
  onSessionRefreshed,
}: AgentClientsHookInput) {
  return useQuery({
    queryKey: ["agent-clients", session?.twinId ?? null],
    queryFn: () => loadAgentClients({
      session: session!,
      onSessionRefreshed,
    }),
    enabled: Boolean(session),
    retry: (failureCount, error) => !isAuthError(error) && failureCount < 1,
    staleTime: 30_000,
  });
}

export function useCreateAgentToken({
  session,
  onSessionRefreshed,
}: AgentClientsHookInput) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      agentName: string;
      scopes: AgentContextScope[];
      expiresInMinutes: number;
    }) => createAgentToken({
      session: session!,
      onSessionRefreshed,
      ...input,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["agent-clients", session?.twinId ?? null],
      });
    },
  });
}

export function useRevokeAgentClient({
  session,
  onSessionRefreshed,
}: AgentClientsHookInput) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (grantId: string) => revokeAgentClient({
      session: session!,
      grantId,
      onSessionRefreshed,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["agent-clients", session?.twinId ?? null],
      });
    },
  });
}
