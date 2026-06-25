import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatRoute from "@/pages/app/ChatRoute";
import BrainRoute from "@/pages/app/BrainRoute";
import AgentsRoute from "@/pages/app/AgentsRoute";
import HomeRoute from "@/pages/app/HomeRoute";
import type { AppRouteContextValue } from "@/providers/app-route-context";
import { AppRouteContextProvider } from "@/providers/app-route-provider";
import { createFlow } from "@/tests/fixtures/onboarding-fixtures";

const homepageMock = vi.hoisted(() => vi.fn());
const useHomepageVoiceChatMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/chat/ChatPage", () => ({
  ChatPage: () => <section aria-label="Chat page" />,
}));

vi.mock("@/components/brain/BrainPage", () => ({
  BrainPage: (props: { session: { twinId: string } }) => (
    <section aria-label="Brain page" data-twin-id={props.session.twinId} />
  ),
}));

vi.mock("@/components/settings/AgentsSettingsSection", () => ({
  AgentsSettingsSection: (props: { session: { twinId: string } }) => (
    <section aria-label="Agents page" data-twin-id={props.session.twinId} />
  ),
}));

vi.mock("@/pages/Homepage", () => ({
  Homepage: (props: { statusHud: unknown }) => {
    homepageMock(props);

    return (
      <section
        aria-label="Home page"
        data-status-hud={props.statusHud ? "visible" : "hidden"}
      />
    );
  },
}));

vi.mock("@/hooks/voice/use-homepage-voice-chat", () => ({
  useHomepageVoiceChat: useHomepageVoiceChatMock,
}));

describe("app route content", () => {
  beforeEach(() => {
    sessionStorage.clear();
    homepageMock.mockClear();
    useHomepageVoiceChatMock.mockReturnValue(createVoiceChat("idle"));
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it("renders home without verified protected access", () => {
    renderRoute(<HomeRoute />, createRouteContext({ canUseProtectedApp: false }));

    expect(screen.getByLabelText("Home page")).toBeInTheDocument();
    expect(screen.getByLabelText("Home page")).toHaveAttribute(
      "data-status-hud",
      "hidden",
    );
    expect(homepageMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ statusHud: null }),
    );
  });

  it("passes the home status HUD after verified protected access", () => {
    renderRoute(<HomeRoute />, createRouteContext({ canUseProtectedApp: true }));

    expect(screen.getByLabelText("Home page")).toHaveAttribute(
      "data-status-hud",
      "visible",
    );
  });

  it("requests a home session voice greeting for an eligible protected visit", async () => {
    const context = createRouteContext({
      canUseProtectedApp: true,
      displayName: "Fortune",
      firstMeetIntroStatus: "consumed",
      twinName: "Nova",
    });

    renderRoute(<HomeRoute />, context);

    await waitFor(() => {
      expect(context.twinRuntime.dispatchRuntimeEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "speech.requested",
          eventId: expect.stringMatching(/^home-session-greeting-twin-test-/u),
          dedupeKey: expect.stringMatching(/^home-session-greeting-twin-test-/u),
          failureMode: "quiet",
          text: expect.stringMatching(/Fortune/u),
          voiceStyle: "energetic",
        }),
      );
    });
  });

  it("does not request the home greeting again in the same browser session", async () => {
    const context = createRouteContext({
      canUseProtectedApp: true,
      displayName: "Fortune",
      firstMeetIntroStatus: "consumed",
    });
    const view = renderRoute(<HomeRoute />, context);

    await waitFor(() => {
      expect(context.twinRuntime.dispatchRuntimeEvent).toHaveBeenCalledTimes(1);
    });

    view.rerender(
      <AppRouteContextProvider value={context}>
        <HomeRoute />
      </AppRouteContextProvider>,
    );

    expect(context.twinRuntime.dispatchRuntimeEvent).toHaveBeenCalledTimes(1);
  });

  it("does not request the home greeting before the user display name is available", () => {
    const context = createRouteContext({
      canUseProtectedApp: true,
      displayName: "",
      firstMeetIntroStatus: "consumed",
    });

    renderRoute(<HomeRoute />, context);

    expect(context.twinRuntime.dispatchRuntimeEvent).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it("does not greet while the first-meet intro is pending", () => {
    const context = createRouteContext({
      canUseProtectedApp: true,
      firstMeetIntroStatus: "issued",
    });

    renderRoute(<HomeRoute />, context);

    expect(context.twinRuntime.dispatchRuntimeEvent).not.toHaveBeenCalled();
  });

  it("does not greet while the runtime is busy", () => {
    const context = createRouteContext({
      canUseProtectedApp: true,
      firstMeetIntroStatus: "consumed",
    });
    context.twinRuntime.runtimeState = {
      status: "preparing_speech",
      eventId: "existing",
      dedupeKey: "existing",
      text: "Already speaking soon.",
      voiceStyle: "energetic",
      processedEventIds: [],
    };

    renderRoute(<HomeRoute />, context);

    expect(context.twinRuntime.dispatchRuntimeEvent).not.toHaveBeenCalled();
  });

  it("does not greet while voice chat is active", () => {
    useHomepageVoiceChatMock.mockReturnValue(createVoiceChat("recording_push_to_talk"));
    const context = createRouteContext({
      canUseProtectedApp: true,
      firstMeetIntroStatus: "consumed",
    });

    renderRoute(<HomeRoute />, context);

    expect(context.twinRuntime.dispatchRuntimeEvent).not.toHaveBeenCalled();
  });

  it("does not mount protected chat before verified access", () => {
    renderRoute(<ChatRoute />, createRouteContext({ canUseProtectedApp: false }));

    expect(screen.queryByLabelText("Chat page")).not.toBeInTheDocument();
  });

  it("mounts protected tabs after verified access", () => {
    renderRoute(<ChatRoute />, createRouteContext({ canUseProtectedApp: true }));

    expect(screen.getByLabelText("Chat page")).toBeInTheDocument();
  });

  it("does not mount protected brain before verified access", () => {
    renderRoute(<BrainRoute />, createRouteContext({ canUseProtectedApp: false }));

    expect(screen.queryByLabelText("Brain page")).not.toBeInTheDocument();
  });

  it("mounts the brain with protected twin session context", () => {
    renderRoute(<BrainRoute />, createRouteContext({ canUseProtectedApp: true }));

    expect(screen.getByLabelText("Brain page")).toHaveAttribute(
      "data-twin-id",
      "twin-test",
    );
  });

  it("does not mount protected agents before verified access", () => {
    renderRoute(<AgentsRoute />, createRouteContext({ canUseProtectedApp: false }));

    expect(screen.queryByLabelText("Agents page")).not.toBeInTheDocument();
  });

  it("mounts the agents page with protected twin session context", () => {
    renderRoute(<AgentsRoute />, createRouteContext({ canUseProtectedApp: true }));

    expect(screen.getByLabelText("Agents page")).toHaveAttribute(
      "data-twin-id",
      "twin-test",
    );
  });
});

function renderRoute(page: React.ReactNode, context: AppRouteContextValue) {
  return render(
    <AppRouteContextProvider value={context}>{page}</AppRouteContextProvider>,
  );
}

function createRouteContext(
  flowOverrides: Parameters<typeof createFlow>[0],
): AppRouteContextValue {
  const session = flowOverrides.canUseProtectedApp
    ? {
      token: "token",
      refreshToken: "refresh",
      expiresAt: "2099-01-01T00:00:00.000Z",
      twinId: "twin-test",
      walletAddress: "0x123",
    }
    : null;

  return {
    homeAgentState: "initializing",
    homeStatusHud: { label: "AGENT_STATUS", status: "READY" },
    onboarding: createFlow({ session, ...flowOverrides }),
    providerState: null,
    setProviderOpen: vi.fn(),
    setProviderState: vi.fn(),
    twinRuntime: {
      runtimeState: { status: "idle", processedEventIds: [] },
      dispatchRuntimeEvent: vi.fn(),
    },
  };
}

function createVoiceChat(phase: string) {
  return {
    state: {
      phase,
      activeEventId: null,
      activeThreadId: null,
      settings: null,
      settingsStatus: "idle",
      profile: null,
      userTranscript: null,
      assistantTranscript: null,
      partialAssistantTranscript: "",
      error: null,
      wakeSupported: false,
    },
    beginPushToTalk: vi.fn(),
    cancelVoiceTurn: vi.fn(),
    endPushToTalk: vi.fn(),
    saveSettings: vi.fn(),
  };
}
