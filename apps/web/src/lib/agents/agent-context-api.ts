import { getAuthedJson, postAuthedJson } from "@/lib/api";
import type { Session } from "@/lib/session";
import type {
  AgentClientRevokeResponse,
  AgentClientsResponse,
  AgentContextPreset,
  AgentContextResponse,
  AgentContextScope,
  AgentTokenResponse,
} from "@/types/agent-context.types";

type AuthedRequestInput = {
  session: Session;
  onSessionRefreshed: (session: Session) => void;
};

export function loadAgentContext(input: AuthedRequestInput & {
  preset: AgentContextPreset;
}) {
  const params = new URLSearchParams({ preset: input.preset });
  return getAuthedJson<AgentContextResponse>(
    `/v1/twins/${input.session.twinId}/engineering/context?${params.toString()}`,
    input.session,
    input.onSessionRefreshed,
  );
}

export function createAgentToken(input: AuthedRequestInput & {
  agentName: string;
  scopes: AgentContextScope[];
  expiresInMinutes: number;
}) {
  return postAuthedJson<AgentTokenResponse>(
    `/v1/twins/${input.session.twinId}/agents/tokens`,
    {
      agentName: input.agentName,
      scopes: input.scopes,
      expiresInMinutes: input.expiresInMinutes,
    },
    input.session,
    input.onSessionRefreshed,
  );
}

export function loadAgentClients(input: AuthedRequestInput) {
  return getAuthedJson<AgentClientsResponse>(
    `/v1/twins/${input.session.twinId}/agents/clients`,
    input.session,
    input.onSessionRefreshed,
  );
}

export function revokeAgentClient(input: AuthedRequestInput & {
  grantId: string;
}) {
  return postAuthedJson<AgentClientRevokeResponse>(
    `/v1/twins/${input.session.twinId}/agents/clients/${input.grantId}/revoke`,
    {},
    input.session,
    input.onSessionRefreshed,
  );
}
