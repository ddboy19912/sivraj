import type { ProviderKind } from "@/lib/chat/chat-api";

export type ProviderPreset = {
  label: string;
  baseUrl: string;
  model: string;
  apiKeyRequired: boolean;
  detail: string;
};

export const PROVIDER_PRESETS: Record<ProviderKind, ProviderPreset> = {
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com",
    model: "gpt-4o-mini",
    apiKeyRequired: true,
    detail: "Hosted OpenAI models.",
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "meta-llama/llama-3.1-8b-instruct:free",
    apiKeyRequired: true,
    detail: "Open, free, and hosted model routing.",
  },
  ollama: {
    label: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.1",
    apiKeyRequired: false,
    detail: "Local open-source models.",
  },
  custom_openai_compatible: {
    label: "Custom",
    baseUrl: "https://api.example.com/v1",
    model: "custom-model",
    apiKeyRequired: false,
    detail: "Any OpenAI-compatible endpoint.",
  },
};

export function providerKeyHint(
  providerKind: ProviderKind,
  hasSavedApiKey: boolean,
  apiKey: string,
  apiKeyRequired: boolean,
) {
  if (providerKind === "ollama") {
    return "Leave blank for local Ollama.";
  }

  if (hasSavedApiKey && !apiKey) {
    return "Saved key will be reused.";
  }

  return apiKeyRequired
    ? "Required for this provider."
    : "Optional for compatible gateways.";
}
