import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentsSettingsSection } from "@/components/settings/AgentsSettingsSection";
import { createAppFetchMock } from "@/tests/fetch-mock";
import { jsonResponse } from "@/tests/helpers";
import type { Session } from "@/lib/session";
import type {
  AgentClientsResponse,
  AgentContextResponse,
  AgentContextScope,
  AgentEngineeringReviewQueueResponse,
} from "@/types/agent-context.types";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const session: Session = {
  token: "session-token",
  refreshToken: "refresh-token",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  twinId: "twin-id",
  walletAddress: "0xabc",
};

describe("AgentsSettingsSection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a compact skill download surface without packet clutter", async () => {
    globalThis.fetch = createAgentsFetchMock();

    renderAgentsSettings();

    expect(await screen.findAllByText("AGENTS.md")).toHaveLength(2);
    expect(screen.getByText("Agent skills")).toBeInTheDocument();
    expect(screen.getByText("MCP")).toBeInTheDocument();
    expect(screen.getByText("Access")).toBeInTheDocument();
    expect(screen.queryByText("3 items")).not.toBeInTheDocument();
    expect(screen.queryByText("4 memories")).not.toBeInTheDocument();
    expect(screen.queryByText("2 files")).not.toBeInTheDocument();
    expect(screen.queryByText("Quality")).not.toBeInTheDocument();
    expect(screen.queryByText("82% good")).not.toBeInTheDocument();
    expect(screen.queryByText("Engineering context only")).not.toBeInTheDocument();
    expect(screen.queryByText("Raw artifacts")).not.toBeInTheDocument();
    expect(screen.queryByText("Decrypted memory")).not.toBeInTheDocument();
    expect(screen.queryByText("Plaintext source statements")).not.toBeInTheDocument();
    expect(screen.queryByText("Excluded")).not.toBeInTheDocument();
  });

  it("creates read-only tokens by default and shows long token text", async () => {
    const createRequests: Array<{ scopes: AgentContextScope[] }> = [];
    const longToken = `agent-${"x".repeat(140)}`;
    globalThis.fetch = createAgentsFetchMock({
      onCreateToken: (body) => {
        createRequests.push({ scopes: body.scopes as AgentContextScope[] });
        return longToken;
      },
    });

    renderAgentsSettings();
    await screen.findAllByText("AGENTS.md");

    await userEvent.click(screen.getByRole("button", { name: "Create token" }));

    await waitFor(() => {
      expect(createRequests).toHaveLength(1);
    });
    expect(createRequests[0]?.scopes).toEqual([
      "agent:context:read",
      "agent:sources:read",
      "agent:project_profile:read",
    ]);
    expect(await screen.findByText(longToken)).toHaveClass("break-all");
  });

  it("adds optional scopes only after explicit toggles", async () => {
    const createRequests: Array<{ scopes: AgentContextScope[] }> = [];
    globalThis.fetch = createAgentsFetchMock({
      onCreateToken: (body) => {
        createRequests.push({ scopes: body.scopes as AgentContextScope[] });
        return "agent-token";
      },
    });

    renderAgentsSettings();
    await screen.findAllByText("AGENTS.md");

    await userEvent.click(screen.getByRole("checkbox", { name: /Memory search/u }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Writebacks/u }));
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));

    await waitFor(() => {
      expect(createRequests[0]?.scopes).toContain("agent:memory:search");
      expect(createRequests[0]?.scopes).toContain("agent:writeback:create");
    });
  });

  it("downloads packet content deliberately", async () => {
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    globalThis.fetch = createAgentsFetchMock();

    renderAgentsSettings();
    await screen.findAllByText("AGENTS.md");

    const click = vi.fn();
    const createElement = document.createElement.bind(document);
    URL.createObjectURL = vi.fn(() => "blob:packet");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "a") {
        return {
          click,
          rel: "",
          download: "",
          href: "",
        } as unknown as HTMLAnchorElement;
      }

      return createElement(tagName);
    });

    await userEvent.click(screen.getByRole("button", { name: "Download AGENTS.md" }));

    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();

    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
  });

  it("revokes active grants", async () => {
    const revokeRequests: string[] = [];
    globalThis.fetch = createAgentsFetchMock({
      onRevoke: (path) => revokeRequests.push(path),
    });

    renderAgentsSettings();
    await screen.findByText("Codex grant");

    await userEvent.click(screen.getByRole("button", { name: "Revoke Codex grant" }));

    await waitFor(() => {
      expect(revokeRequests).toEqual([
        "/v1/twins/twin-id/agents/clients/grant-1/revoke",
      ]);
    });
  });

  it("approves candidate engineering memories from the review modal", async () => {
    const reviewRequests: Array<{ path: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = createAgentsFetchMock({
      onReviewAction: (path, body) => reviewRequests.push({ path, body }),
    });

    renderAgentsSettings();
    await screen.findByText("1 candidate memory waiting");

    await userEvent.click(screen.getByRole("button", { name: "Review candidates" }));
    expect(await screen.findByRole("heading", { name: "Package manager" })).toBeInTheDocument();
    expect(await screen.findByText("Use pnpm for workspace commands.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(reviewRequests).toEqual([]);
    expect(await screen.findByRole("heading", { name: "Approve this memory?" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Approve memory" }));

    await waitFor(() => {
      expect(reviewRequests).toEqual([{
        path: "/v1/twins/twin-id/engineering/review-queue/candidate-1/action",
        body: { action: "keep_active" },
      }]);
    });
  });

  it("confirms before rejecting candidate engineering memories", async () => {
    const reviewRequests: Array<{ path: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = createAgentsFetchMock({
      onReviewAction: (path, body) => reviewRequests.push({ path, body }),
    });

    renderAgentsSettings();
    await screen.findByText("1 candidate memory waiting");

    await userEvent.click(screen.getByRole("button", { name: "Review candidates" }));
    await userEvent.click(await screen.findByRole("button", { name: "Reject" }));
    expect(reviewRequests).toEqual([]);
    expect(await screen.findByRole("heading", { name: "Reject this memory?" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Reject memory" }));

    await waitFor(() => {
      expect(reviewRequests).toEqual([{
        path: "/v1/twins/twin-id/engineering/review-queue/candidate-1/action",
        body: { action: "reject" },
      }]);
    });
  });

  it("renders loading and error states", async () => {
    globalThis.fetch = createAgentsFetchMock({ contextStatus: 500 });

    renderAgentsSettings();

    expect(screen.getByText("Loading packet")).toBeInTheDocument();
    expect(await screen.findByText(/Context unavailable/u, {}, {
      timeout: 3_000,
    })).toBeInTheDocument();
  });
});

function renderAgentsSettings() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AgentsSettingsSection session={session} onSessionRefreshed={vi.fn()} />
    </QueryClientProvider>,
  );
}

function createAgentsFetchMock(options: {
  contextStatus?: number;
  onCreateToken?: (body: Record<string, unknown>) => string;
  onReviewAction?: (path: string, body: Record<string, unknown>) => void;
  onRevoke?: (path: string) => void;
} = {}) {
  return createAppFetchMock({
    handler: (url, init) => {
      if (url.pathname === "/v1/twins/twin-id/engineering/context") {
        return jsonResponse(createContextResponse(), options.contextStatus ?? 200);
      }

      if (url.pathname === "/v1/twins/twin-id/engineering/review-queue") {
        return jsonResponse(createReviewQueueResponse());
      }

      if (url.pathname === "/v1/twins/twin-id/engineering/review-queue/candidate-1/action") {
        const body = readJsonBody(init);
        options.onReviewAction?.(url.pathname, body);
        return jsonResponse({
          candidateId: "candidate-1",
          action: body.action,
          status: "approved",
          feedbackId: "feedback-1",
        });
      }

      if (url.pathname === "/v1/twins/twin-id/agents/clients") {
        return jsonResponse(createClientsResponse());
      }

      if (url.pathname === "/v1/twins/twin-id/agents/tokens") {
        const body = readJsonBody(init);
        const token = options.onCreateToken?.(body) ?? "agent-token";
        return jsonResponse({
          token,
          tokenType: "Bearer",
          subjectType: "agent",
          clientId: "client-2",
          grantId: "grant-2",
          twinId: "twin-id",
          scopes: body.scopes,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }, 201);
      }

      if (url.pathname === "/v1/twins/twin-id/agents/clients/grant-1/revoke") {
        options.onRevoke?.(url.pathname);
        return jsonResponse({
          grantId: "grant-1",
          clientId: "client-1",
          revokedAt: new Date().toISOString(),
          status: "revoked",
        });
      }

      return null;
    },
  });
}

function readJsonBody(init: RequestInit | undefined) {
  return JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
}

function createContextResponse(): AgentContextResponse {
  return {
    policy: {
      rawArtifactsIncluded: false,
      decryptedMemoryIncluded: false,
      plaintextStatementsIncluded: false,
      derivedEngineeringContextIncluded: true,
      scope: "memory:read",
      agentScopesAccepted: [
        "agent:context:read",
        "agent:project_profile:read",
      ],
    },
    relationship: {
      sivraj: "Stores engineering context.",
      codingAgents: "Execute coding work.",
      handoff: "Use context export.",
    },
    contextPacket: {},
    contextMarkdown: "# Sivraj",
    contextExport: {
      preset: "codex",
      format: "markdown",
      targetFile: "AGENTS.md",
      content: "# Sovereign Context Packet",
      evidence: [],
      warnings: [],
      quality: createQuality(),
      includedCandidate: false,
      itemCount: 3,
    },
    profileSummary: {
      totalEngineeringMemories: 4,
      includedContextItems: 3,
      evidenceRefs: 2,
      warnings: [],
      issues: [],
      quality: createQuality(),
      repoFingerprint: {},
      inventory: {
        candidateEngineeringMemoryCount: 1,
        canonicalEngineeringMemoryCount: 3,
        engineeringMemoryCount: 4,
        engineeringSourceCount: 2,
        agentInstructionSourceCount: 2,
        sourceBackedEngineeringMemoryCount: 1,
        exportableItemCount: 3,
      },
    },
  };
}

function createReviewQueueResponse(): AgentEngineeringReviewQueueResponse {
  return {
    policy: {
      rawArtifactsIncluded: false,
      decryptedMemoryIncluded: false,
      plaintextStatementsIncluded: false,
      derivedEngineeringContextIncluded: true,
      scope: "memory:read",
      agentScopesAccepted: [
        "agent:context:read",
        "agent:project_profile:read",
      ],
    },
    summary: {
      totalEngineeringMemories: 1,
      pendingCandidateCount: 1,
      issueCount: 0,
      quality: createQuality(),
    },
    repoFingerprint: {},
    candidates: [{
      id: "candidate-1",
      memoryType: "fact",
      engineeringMemoryType: "tool_preference",
      scope: "project",
      status: "candidate",
      subject: "Package manager",
      agentContextLine: "Use pnpm for workspace commands.",
      confidenceScore: 0.92,
      evidenceHash: "hash",
      evidenceLength: 42,
      statementStorageRef: "storage://candidate-1",
      sourceArtifactId: "artifact-1",
      memoryFragmentId: "fragment-1",
      metadata: {},
    }],
    issues: [],
  };
}

function createQuality(): AgentContextResponse["contextExport"]["quality"] {
  return {
    score: 0.82,
    label: "good",
    readyForAgent: true,
    strengths: [],
    risks: [],
    recommendations: [],
    metrics: {
      totalItems: 3,
      approvedOrActiveItems: 3,
      candidateItems: 0,
      evidenceRefs: 2,
      issueCount: 0,
      highSeverityIssueCount: 0,
      repoMatchedItems: 2,
      weakUnknownSourceItems: 0,
      sectionCoverage: 0.7,
    },
  };
}

function createClientsResponse(): AgentClientsResponse {
  return {
    policy: {
      rawArtifactsIncluded: false,
      scope: "memory:read",
    },
    clients: [{
      clientId: "client-1",
      grantId: "grant-1",
      name: "Codex grant",
      type: "coding_agent",
      scopes: [
        "agent:context:read",
        "agent:sources:read",
        "agent:project_profile:read",
      ],
      memoryDomains: ["engineering"],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      revokedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "active",
      metadata: {},
    }],
  };
}
