import { describe, expect, it } from "vitest";
import { resolveProviderPresentation } from "@/lib/chat/chat-formatters";

describe("resolveProviderPresentation", () => {
  it("formats routed model labels as model via provider", () => {
    expect(resolveProviderPresentation({
      config: {
        id: "provider-1",
        providerKind: "openrouter",
        status: "connected",
        isActive: true,
        authMethod: "openrouter_pkce",
        capability: "chat",
        displayName: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "google/gemini-2.5-flash-lite",
        hasApiKey: true,
        lastTestedAt: null,
        updatedAt: null,
      },
      activeConfig: null,
      configs: [],
      fallback: null,
    })).toMatchObject({
      label: "google/gemini-2.5-flash-lite via OpenRouter",
    });
  });

  it("formats fallback Gemini without a misleading provider suffix", () => {
    expect(resolveProviderPresentation({
      config: null,
      activeConfig: null,
      configs: [],
      fallback: {
        providerKind: "openrouter",
        displayName: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "google/gemini-2.5-flash-lite",
        source: "env",
      },
    })).toMatchObject({
      label: "google/gemini-2.5-flash-lite",
      mode: "OpenRouter default",
    });
  });
});
