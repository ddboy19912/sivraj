import { createProviderConfigDialogHandlers } from "@/lib/chat/provider-config-dialog-handlers";
import { useProviderConfigState } from "@/hooks/chat/use-provider-config-state";
import type { ProviderConfigResponse } from "@/lib/chat/chat-api";
import type { Session } from "@/lib/session";

type UseProviderConfigDialogInput = {
  open: boolean;
  session: Session | null;
  onSessionRefreshed: (session: Session) => void;
  onProviderChanged: (response: ProviderConfigResponse | null) => void;
};

export function useProviderConfigDialog(input: UseProviderConfigDialogInput) {
  const state = useProviderConfigState(input);
  const handlers = createProviderConfigDialogHandlers({
    session: input.session,
    state,
    onSessionRefreshed: input.onSessionRefreshed,
    onProviderChanged: input.onProviderChanged,
  });

  return {
    ...state,
    ...handlers,
  };
}
