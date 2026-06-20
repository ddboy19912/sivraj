import { useState } from "react";
import type { RuntimeCapabilityConfig, SafeProviderConfig } from "@/lib/chat/chat-api";
import type { Session } from "@/lib/session";

export function useProviderConfigFields(session: Session | null) {
  const [hasSavedApiKey, setHasSavedApiKey] = useState(false);
  const [savedConfigs, setSavedConfigs] = useState<SafeProviderConfig[]>([]);
  const [activeProviderConfigId, setActiveProviderConfigId] = useState<string | null>(null);
  const [fallbackLabel, setFallbackLabel] = useState<string | null>(null);
  const [runtimeDefaults, setRuntimeDefaults] = useState<Record<string, RuntimeCapabilityConfig> | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const canConnect = Boolean(session);

  return {
    canConnect,
    fallbackLabel,
    runtimeDefaults,
    hasSavedApiKey,
    activeProviderConfigId,
    isBusy,
    savedConfigs,
    setFallbackLabel,
    setRuntimeDefaults,
    setHasSavedApiKey,
    setActiveProviderConfigId,
    setIsBusy,
    setSavedConfigs,
    setStatus,
    status,
  };
}
