import { useEffect, useEffectEvent } from "react";
import { loadProviderConfig, type ProviderConfigResponse } from "@/lib/chat/chat-api";
import {
  applyLoadedProviderConfig,
  type ProviderConfigSetters,
} from "@/lib/chat/provider-config-apply";
import type { Session } from "@/lib/session";

type ProviderConfigLoadInput = {
  open: boolean;
  session: Session | null;
  onSessionRefreshed: (session: Session) => void;
  onProviderChanged: (response: ProviderConfigResponse | null) => void;
  setStatus: (value: string | null) => void;
  setters: ProviderConfigSetters;
};

export function useProviderConfigLoad({
  open,
  session,
  onSessionRefreshed,
  onProviderChanged,
  setStatus,
  setters,
}: ProviderConfigLoadInput) {
  const handleSessionRefreshed = useEffectEvent((nextSession: Session) => {
    onSessionRefreshed(nextSession);
  });
  const handleLoadSuccess = useEffectEvent((response: ProviderConfigResponse) => {
    applyLoadedProviderConfig(response, setters);
    onProviderChanged(response);
  });
  const handleLoadError = useEffectEvent((error: unknown) => {
    setStatus(
      error instanceof Error
        ? error.message
        : "Could not load provider config.",
    );
  });

  useEffect(() => {
    if (!open || !session) {
      return;
    }

    let cancelled = false;
    setStatus(null);
    loadProviderConfig(session, handleSessionRefreshed)
      .then((response) => {
        if (cancelled) {
          return;
        }

        handleLoadSuccess(response);
      })
      .catch((error) => {
        if (!cancelled) {
          handleLoadError(error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    open,
    session,
    setStatus,
  ]);
}
