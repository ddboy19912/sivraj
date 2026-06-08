import { useProviderConfigFields } from "@/hooks/chat/use-provider-config-fields";
import { useProviderConfigLoad } from "@/hooks/chat/use-provider-config-load";
import type { ProviderConfigResponse } from "@/lib/chat/chat-api";
import type { Session } from "@/lib/session";

export function useProviderConfigState({
  open,
  session,
  onSessionRefreshed,
  onProviderChanged,
}: {
  open: boolean;
  session: Session | null;
  onSessionRefreshed: (session: Session) => void;
  onProviderChanged: (response: ProviderConfigResponse | null) => void;
}) {
  const fields = useProviderConfigFields(session);

  useProviderConfigLoad({
    open,
    session,
    onSessionRefreshed,
    onProviderChanged,
    setStatus: fields.setStatus,
    setters: {
      setProviderKind: fields.setProviderKind,
      setDisplayName: fields.setDisplayName,
      setBaseUrl: fields.setBaseUrl,
      setModel: fields.setModel,
      setHasSavedApiKey: fields.setHasSavedApiKey,
      setApiKey: fields.setApiKey,
      setFallbackLabel: fields.setFallbackLabel,
    },
  });

  return fields;
}
