import { useEffect, useRef } from "react";
import { createProviderConfigDialogHandlers } from "@/lib/chat/provider-config-dialog-handlers";
import { completeOpenRouterProviderDialogOAuth } from "@/lib/chat/provider-config-dialog-actions";
import { useProviderConfigState } from "@/hooks/chat/use-provider-config-state";
import { hasPendingOpenRouterOAuthCallback } from "@/lib/chat/provider-config-handlers";
import { toast } from "sonner";
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
  const hasPendingOAuthCallback = hasPendingOpenRouterOAuthCallback();
  const oauthCallbackStartedRef = useRef(false);
  const {
    setActiveProviderConfigId,
    setHasSavedApiKey,
    setIsBusy,
    setSavedConfigs,
    setStatus,
  } = state;

  useEffect(() => {
    if (!hasPendingOAuthCallback) {
      oauthCallbackStartedRef.current = false;
      return;
    }

    if (!input.open || !input.session || oauthCallbackStartedRef.current) {
      return;
    }

    oauthCallbackStartedRef.current = true;
    let cancelled = false;
    setIsBusy(true);
    setStatus(null);

    completeOpenRouterProviderDialogOAuth({
      session: input.session,
      onSessionRefreshed: input.onSessionRefreshed,
    })
      .then((response) => {
        if (cancelled || !response) {
          return;
        }

        const activeConfig = response.activeConfig ?? response.config;
        setSavedConfigs(response.configs ?? []);
        setActiveProviderConfigId(activeConfig?.id ?? null);
        setHasSavedApiKey(Boolean(activeConfig?.hasApiKey));
        input.onProviderChanged(response);
        toast.success("OpenRouter connected", {
          description: "OAuth credential saved.",
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Provider action failed.";
        toast.error("Provider action failed", { description: message });
      })
      .finally(() => {
        if (!cancelled) {
          setIsBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    hasPendingOAuthCallback,
    input.onProviderChanged,
    input.onSessionRefreshed,
    input.open,
    input.session,
    setActiveProviderConfigId,
    setHasSavedApiKey,
    setIsBusy,
    setSavedConfigs,
    setStatus,
  ]);

  return {
    ...state,
    ...handlers,
  };
}
