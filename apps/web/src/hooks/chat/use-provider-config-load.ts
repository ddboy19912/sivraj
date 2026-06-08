import { useEffect } from "react";
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
  const {
    setApiKey,
    setBaseUrl,
    setDisplayName,
    setFallbackLabel,
    setHasSavedApiKey,
    setModel,
    setProviderKind,
  } = setters;

  useEffect(() => {
    if (!open || !session) {
      return;
    }

    let cancelled = false;
    setStatus(null);
    loadProviderConfig(session, onSessionRefreshed)
      .then((response) => {
        if (cancelled) {
          return;
        }

        applyLoadedProviderConfig(response, {
          setProviderKind,
          setDisplayName,
          setBaseUrl,
          setModel,
          setHasSavedApiKey,
          setApiKey,
          setFallbackLabel,
        });
        onProviderChanged(response);
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus(
            error instanceof Error
              ? error.message
              : "Could not load provider config.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    onProviderChanged,
    onSessionRefreshed,
    open,
    session,
    setStatus,
    setApiKey,
    setBaseUrl,
    setDisplayName,
    setFallbackLabel,
    setHasSavedApiKey,
    setModel,
    setProviderKind,
  ]);
}
