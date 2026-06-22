import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppLayout } from "@/components/app/AppLayout";
import { createFlow } from "@/tests/fixtures/onboarding-fixtures";
import type { Session } from "@/lib/session";

const useSivrajAppStateMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/app/useSivrajAppState", () => ({
  useSivrajAppState: useSivrajAppStateMock,
}));

vi.mock("@/components/app/AppAmbientStage", () => ({
  AppAmbientStage: () => <div data-testid="ambient-stage" />,
}));

vi.mock("@/components/app/AppGlobalOverlay", () => ({
  AppGlobalOverlay: () => null,
}));

vi.mock("@/components/chat/ProviderConfigDialog", () => ({
  ProviderConfigDialog: () => null,
}));

vi.mock("@/components/common/AOSInit", () => ({
  AOSInit: () => null,
}));

vi.mock("@/components/navigation/Navbar", () => ({
  Navbar: () => null,
}));

vi.mock("@/components/navigation/NavigationTab", () => ({
  NavigationTab: () => null,
}));

vi.mock("@/components/settings/SettingsDrawer", () => ({
  SettingsDrawer: () => null,
}));

vi.mock("@/components/terminal/TerminalOverlay", () => ({
  TerminalOverlay: () => null,
}));

vi.mock("@/providers/agent-audio-provider", () => ({
  AgentAudioProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const session: Session = {
  token: "token",
  refreshToken: "refresh",
  expiresAt: "2099-01-01T00:00:00.000Z",
  twinId: "twin-test",
  walletAddress: "0x123",
};

describe("AppLayout", () => {
  beforeEach(() => {
    useSivrajAppStateMock.mockReset();
  });

  it("returns to Home when onboarding closes with an issued first-meet intro", async () => {
    let appOverlay: "onboarding" | null = "onboarding";
    useSivrajAppStateMock.mockImplementation(() => createAppState(appOverlay));

    const view = render(
      <MemoryRouter initialEntries={["/chat"]}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<LocationProbe />} />
            <Route path="/chat" element={<LocationProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("path")).toHaveTextContent("/chat");

    appOverlay = null;
    view.rerender(
      <MemoryRouter initialEntries={["/chat"]}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<LocationProbe />} />
            <Route path="/chat" element={<LocationProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("path")).toHaveTextContent("/");
    });
  });
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="path">{location.pathname}</div>;
}

function createAppState(appOverlay: "onboarding" | null) {
  return {
    appOverlay,
    homeAgentState: "idle",
    homeStatusHud: { label: "AGENT_STATUS", status: "IDLE", active: false },
    onboarding: createFlow({
      canUseProtectedApp: true,
      firstMeetIntroStatus: "issued",
      runtimeEvents: [{
        type: "first_meet_intro.requested",
        eventId: "twin-test:first-meet-intro",
        dedupeKey: "twin-test:first-meet-intro",
        text: "Hi Fortune, it's nice to meet you.",
        voiceStyle: "energetic",
      }],
      session,
    }),
    providerOpen: false,
    providerState: null,
    providerStatus: null,
    setProviderOpen: vi.fn(),
    setProviderState: vi.fn(),
    setSettingsOpen: vi.fn(),
    settingsOpen: false,
    twinRuntime: {
      consumeRuntimeEvent: vi.fn(),
      dispatchRuntimeEvent: vi.fn(),
      runtimeState: { status: "idle", processedEventIds: [] },
      speechPlaybackCommand: null,
    },
  };
}
