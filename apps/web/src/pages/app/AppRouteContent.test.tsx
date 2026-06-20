import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ChatRoute from "@/pages/app/ChatRoute";
import HomeRoute from "@/pages/app/HomeRoute";
import type { AppRouteContextValue } from "@/providers/app-route-context";
import { AppRouteContextProvider } from "@/providers/app-route-provider";
import { createFlow } from "@/tests/fixtures/onboarding-fixtures";

const homepageMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/chat/ChatPage", () => ({
  ChatPage: () => <section aria-label="Chat page" />,
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

describe("app route content", () => {
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

  it("does not mount protected chat before verified access", () => {
    renderRoute(<ChatRoute />, createRouteContext({ canUseProtectedApp: false }));

    expect(screen.queryByLabelText("Chat page")).not.toBeInTheDocument();
  });

  it("mounts protected tabs after verified access", () => {
    renderRoute(<ChatRoute />, createRouteContext({ canUseProtectedApp: true }));

    expect(screen.getByLabelText("Chat page")).toBeInTheDocument();
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
  return {
    homeAgentState: "initializing",
    homeStatusHud: { label: "AGENT_STATUS", status: "READY" },
    onboarding: createFlow(flowOverrides),
    providerState: null,
    setProviderOpen: vi.fn(),
    setProviderState: vi.fn(),
    twinRuntime: {
      runtimeState: { status: "idle", processedEventIds: [] },
      dispatchRuntimeEvent: vi.fn(),
    },
  };
}
