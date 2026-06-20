import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProviderConfigDialog } from "@/hooks/chat/use-provider-config-dialog";
import { completeOpenRouterProviderDialogOAuth } from "@/lib/chat/provider-config-dialog-actions";
import type { Session } from "@/lib/session";

vi.mock("@/lib/chat/provider-config-dialog-actions", () => ({
  completeOpenRouterProviderDialogOAuth: vi.fn(),
  createProviderDialogOpenRouterModel: vi.fn(),
  deleteProviderDialogConfig: vi.fn(),
  selectDefaultProviderDialogConfig: vi.fn(),
  selectProviderDialogConfig: vi.fn(),
  startOpenRouterProviderDialogOAuth: vi.fn(),
  updateProviderDialogModel: vi.fn(),
}));

vi.mock("@/lib/chat/chat-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat/chat-api")>();

  return {
    ...actual,
    loadProviderConfig: vi.fn().mockResolvedValue({
      config: null,
      activeConfig: null,
      configs: [],
      fallback: null,
    }),
  };
});

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const completeOpenRouterOAuthMock = vi.mocked(completeOpenRouterProviderDialogOAuth);

describe("useProviderConfigDialog", () => {
  afterEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("completes an OpenRouter OAuth callback once across state rerenders", async () => {
    completeOpenRouterOAuthMock.mockResolvedValue({
      config: null,
      activeConfig: {
        id: "provider-1",
        providerKind: "openrouter",
        displayName: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "google/gemini-2.5-flash-lite",
        status: "connected",
        isActive: true,
        authMethod: "openrouter_pkce",
        capability: "chat",
        hasApiKey: true,
        lastTestedAt: null,
        updatedAt: null,
      },
      configs: [],
      fallback: null,
    });
    window.sessionStorage.setItem(
      "sivraj.openrouter.oauth",
      JSON.stringify({ state: "oauth-state", codeVerifier: "verifier" }),
    );
    window.history.replaceState({}, "", "/chat?code=oauth-code&state=oauth-state");
    const onProviderChanged = vi.fn();

    const { rerender } = renderHook(
      (props: { open: boolean; session: Session | null }) =>
        useProviderConfigDialog({
          open: props.open,
          session: props.session,
          onSessionRefreshed: vi.fn(),
          onProviderChanged,
        }),
      {
        initialProps: {
          open: true,
          session: createSession(),
        },
      },
    );

    await waitFor(() => {
      expect(completeOpenRouterOAuthMock).toHaveBeenCalledTimes(1);
    });

    rerender({ open: true, session: createSession() });

    await waitFor(() => {
      expect(onProviderChanged).toHaveBeenCalledTimes(1);
    });
    expect(completeOpenRouterOAuthMock).toHaveBeenCalledTimes(1);
  });
});

function createSession(): Session {
  return {
    token: "token",
    refreshToken: "refresh",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    twinId: "twin-1",
    walletAddress: "0xabc",
  };
}
