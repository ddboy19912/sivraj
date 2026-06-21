import userEvent from "@testing-library/user-event";
import { render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BrainPage } from "@/components/brain/BrainPage";
import { useBrainGraph } from "@/hooks/brain/use-brain-graph";
import {
  useBrainArtifactContent,
  useBrainSources,
} from "@/hooks/brain/use-brain-sources";
import type { BrainGraphResponse } from "@/types/brain.types";

vi.mock("@/hooks/brain/use-brain-graph", () => ({
  useBrainGraph: vi.fn(),
}));

vi.mock("@/hooks/brain/use-brain-sources", () => ({
  useBrainSources: vi.fn(),
  useBrainArtifactContent: vi.fn(),
}));

const useBrainGraphMock = vi.mocked(useBrainGraph);
const useBrainSourcesMock = vi.mocked(useBrainSources);
const useBrainArtifactContentMock = vi.mocked(useBrainArtifactContent);

beforeAll(() => {
  if (!("hasPointerCapture" in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
      configurable: true,
      value: () => false,
    });
  }
  if (!("scrollIntoView" in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: () => undefined,
    });
  }
});

describe("BrainPage", () => {
  beforeEach(() => {
    useBrainGraphMock.mockReset();
    useBrainSourcesMock.mockReturnValue({
      data: {
        policy: {
          rawArtifactsIncluded: false,
          exactContentEndpoint: true,
          scope: "memory:read",
        },
        kind: "agent_instructions",
        sources: [],
        summary: {
          sourceCount: 0,
          agentInstructionSourceCount: 0,
          exactContentAvailableCount: 0,
        },
      },
      error: null,
      isFetching: false,
      isLoading: false,
    } as never);
    useBrainArtifactContentMock.mockReturnValue({
      data: null,
      error: null,
      isFetching: false,
      isLoading: false,
    } as never);
  });

  it("opens a memory details modal when a node is clicked", async () => {
    const user = userEvent.setup();
    useBrainGraphMock.mockReturnValue({
      data: graph,
      error: null,
      isFetching: false,
      isLoading: false,
      refetch: vi.fn(),
      viewState: { status: "ready", graph },
    });

    render(
      <BrainPage
        session={{
          token: "token",
          refreshToken: "refresh",
          expiresAt: "2099-01-01T00:00:00.000Z",
          twinId: "twin-1",
          walletAddress: "0x1",
        }}
        twinName="Sivraj"
        onSessionRefreshed={vi.fn()}
      />,
    );

    const headerControls = screen.getByRole("group", { name: /Brain memory controls/u });
    expect(within(headerControls).getByRole("combobox", { name: /Filter brain memories by category/u }))
      .toBeInTheDocument();
    expect(within(headerControls).getByRole("searchbox", { name: /Search brain memories/u }))
      .toBeInTheDocument();

    const memoryNode = screen.getByRole("button", { name: /Decision: data privacy/u });
    await user.hover(memoryNode);
    const popover = screen.getByTestId("brain-node-popover");
    expect([popover.style.left, popover.style.right].some((value) => /%$/u.test(value)))
      .toBe(true);
    expect(popover.style.bottom).toBe("");

    await user.click(memoryNode);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Decision: data privacy")).toBeInTheDocument();
    expect(within(dialog).getByText("Description")).toBeInTheDocument();
    expect(within(dialog).getByText(
      "Encrypted decision memory about data privacy. The raw statement stays private while safe metadata keeps it connected.",
    )).toBeInTheDocument();
    expect(within(dialog).getByText("Category")).toBeInTheDocument();
    expect(within(dialog).getByText("Decision memory")).toBeInTheDocument();
    expect(within(dialog).getByText("Source")).toBeInTheDocument();
    expect(within(dialog).getByText("PDF")).toBeInTheDocument();
    expect(within(dialog).getByText("Artifact ID")).toBeInTheDocument();
    expect(within(dialog).getByText("artifact-1")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Copy artifact ID artifact-1/u }))
      .toBeInTheDocument();
    expect(within(dialog).queryByText("decision")).not.toBeInTheDocument();
  });

  it("surfaces canonical memory context for vague topic nodes", async () => {
    const user = userEvent.setup();
    const topicGraph: BrainGraphResponse = {
      policy: {
        rawArtifactsIncluded: false,
        canonicalMemoryContextIncluded: true,
        scope: "memory:read",
      },
      nodes: [
        {
          id: "topic-node",
          nodeType: "topic",
          name: "partial application",
          description: "topic detected from Chat Export memory and connected to related memory evidence.",
          properties: {
            entityType: "topic",
            sourceType: "chat_export",
          },
          canonicalMemories: [
            {
              id: "canonical-1",
              candidateMemoryId: "candidate-1",
              memoryType: "fact",
              subject: "closures in JavaScript",
              summary: "Closures in JavaScript can be used for currying and partial application.",
              canonicalKey: "subject:fact:closures_in_javascript:general",
              status: "candidate",
              sourceType: "chat_hot_memory_intake",
              sourceArtifactIds: ["artifact-1"],
              memoryFragmentIds: ["fragment-1"],
              evidenceCount: 14,
              confidenceScore: 0.9,
              createdAt: "2026-06-19T21:34:26.000Z",
              updatedAt: "2026-06-19T21:35:22.000Z",
            },
          ],
          confidenceScore: null,
          createdAt: "2026-06-19T21:34:26.000Z",
          updatedAt: null,
        },
      ],
      edges: [],
    };

    useBrainGraphMock.mockReturnValue({
      data: topicGraph,
      error: null,
      isFetching: false,
      isLoading: false,
      refetch: vi.fn(),
      viewState: { status: "ready", graph: topicGraph },
    });

    render(
      <BrainPage
        session={{
          token: "token",
          refreshToken: "refresh",
          expiresAt: "2099-01-01T00:00:00.000Z",
          twinId: "twin-1",
          walletAddress: "0x1",
        }}
        twinName="Sivraj"
        onSessionRefreshed={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /closures in JavaScript/u }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByText("closures in JavaScript").length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/Topic: partial application · Chat Memory · Stored/u))
      .toBeInTheDocument();
    expect(within(dialog).getByText("What Sivraj learned")).toBeInTheDocument();
    expect(within(dialog).getAllByText(
      "Closures in JavaScript can be used for currying and partial application.",
    ).length).toBeGreaterThan(0);
    expect(within(dialog).getByText("Description")).toBeInTheDocument();
    expect(within(dialog).getByText("Fact memory")).toBeInTheDocument();
    expect(within(dialog).getByText("From Chat Memory")).toBeInTheDocument();
    expect(within(dialog).getByText("14 evidence signals")).toBeInTheDocument();
  });

  it("dims other memory points while one node is active", async () => {
    const user = userEvent.setup();
    useBrainGraphMock.mockReturnValue({
      data: filterGraph,
      error: null,
      isFetching: false,
      isLoading: false,
      refetch: vi.fn(),
      viewState: { status: "ready", graph: filterGraph },
    });

    render(
      <BrainPage
        session={{
          token: "token",
          refreshToken: "refresh",
          expiresAt: "2099-01-01T00:00:00.000Z",
          twinId: "twin-1",
          walletAddress: "0x1",
        }}
        twinName="Sivraj"
        onSessionRefreshed={vi.fn()}
      />,
    );

    await user.hover(screen.getByRole("button", { name: /data privacy/u }));

    expect(screen.getByRole("button", { name: /Travel planning/u }))
      .toHaveClass("opacity-[0.18]");
  });

  it("updates the memory count when search and category filters are applied", async () => {
    const user = userEvent.setup();
    useBrainGraphMock.mockReturnValue({
      data: filterGraph,
      error: null,
      isFetching: false,
      isLoading: false,
      refetch: vi.fn(),
      viewState: { status: "ready", graph: filterGraph },
    });

    render(
      <BrainPage
        session={{
          token: "token",
          refreshToken: "refresh",
          expiresAt: "2099-01-01T00:00:00.000Z",
          twinId: "twin-1",
          walletAddress: "0x1",
        }}
        twinName="Sivraj"
        onSessionRefreshed={vi.fn()}
      />,
    );

    expect(screen.getByText("3 memories")).toBeInTheDocument();

    const search = screen.getByRole("searchbox", { name: /Search brain memories/u });
    await user.type(search, "privacy");
    expect(screen.getByText("1 memory")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "not stored");
    expect(screen.getByText("0 memories")).toBeInTheDocument();

    await user.clear(search);
    await user.click(screen.getByRole("combobox", { name: /Filter brain memories by category/u }));
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByText("1 memory")).toBeInTheDocument();
  });

  it("opens exact agent skill source content from the Brain source library", async () => {
    const user = userEvent.setup();
    const agentSkillContent = "# AGENTS.md\n\n- Keep exact content retrievable.";
    useBrainGraphMock.mockReturnValue({
      data: graph,
      error: null,
      isFetching: false,
      isLoading: false,
      refetch: vi.fn(),
      viewState: { status: "ready", graph },
    });
    useBrainSourcesMock.mockReturnValue({
      data: {
        policy: {
          rawArtifactsIncluded: false,
          exactContentEndpoint: true,
          scope: "memory:read",
        },
        kind: "agent_instructions",
        sources: [{
          artifactId: "artifact-agent-1",
          sourceType: "markdown",
          sourceKind: "agent_instruction_file",
          displayName: "AGENTS.md",
          targetInstructionFile: "AGENTS.md",
          agentInstructionFileName: "AGENTS.md",
          ingestionStatus: "completed",
          intelligenceStatus: "completed",
          processing: null,
          exactContentAvailable: true,
          candidateMemoryCount: 3,
          engineeringMemoryCount: 3,
          metadata: {
            engineeringSourceKind: "agent_instruction_file",
            targetInstructionFile: "AGENTS.md",
          },
          createdAt: "2026-06-21T10:00:00.000Z",
          updatedAt: "2026-06-21T10:00:00.000Z",
        }],
        summary: {
          sourceCount: 1,
          agentInstructionSourceCount: 1,
          exactContentAvailableCount: 1,
        },
      },
      error: null,
      isFetching: false,
      isLoading: false,
    } as never);
    useBrainArtifactContentMock.mockReturnValue({
      data: {
        policy: {
          rawArtifactsIncluded: true,
          decryptedSourceIncluded: true,
          scope: "memory:read",
        },
        artifact: {
          id: "artifact-agent-1",
          sourceType: "markdown",
          ingestionStatus: "completed",
          fileName: "AGENTS.md",
          title: "AGENTS.md",
          contentType: "text/markdown; charset=utf-8",
          encoding: "text",
          byteLength: agentSkillContent.length,
          metadata: {
            engineeringSourceKind: "agent_instruction_file",
            targetInstructionFile: "AGENTS.md",
          },
          createdAt: "2026-06-21T10:00:00.000Z",
          updatedAt: "2026-06-21T10:00:00.000Z",
        },
        content: agentSkillContent,
      },
      error: null,
      isFetching: false,
      isLoading: false,
    } as never);

    render(
      <BrainPage
        session={{
          token: "token",
          refreshToken: "refresh",
          expiresAt: "2099-01-01T00:00:00.000Z",
          twinId: "twin-1",
          walletAddress: "0x1",
        }}
        twinName="Sivraj"
        onSessionRefreshed={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open brain sources/u }));

    const dialog = screen.getByRole("dialog", { name: /Brain sources/u });
    expect(within(dialog).getAllByText("AGENTS.md").length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/Keep exact content retrievable/u)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Copy AGENTS.md/u })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Download AGENTS.md/u })).toBeInTheDocument();
  });
});

const graph: BrainGraphResponse = {
  policy: {
    rawArtifactsIncluded: false,
    scope: "memory:read",
  },
  nodes: [
    {
      id: "decision-node",
      nodeType: "decision",
      name: "decision:947f582900aa",
      description: null,
      properties: {
        subject: "data privacy",
        sourceType: "pdf",
        sourceArtifactId: "artifact-1",
      },
      confidenceScore: null,
      createdAt: "2026-06-10T12:00:00.000Z",
      updatedAt: null,
    },
  ],
  edges: [],
};

const filterGraph: BrainGraphResponse = {
  policy: {
    rawArtifactsIncluded: false,
    scope: "memory:read",
  },
  nodes: [
    {
      id: "decision-node",
      nodeType: "decision",
      name: "decision:privacy",
      description: null,
      properties: {
        subject: "data privacy",
        sourceType: "pdf",
        sourceArtifactId: "artifact-privacy",
      },
      confidenceScore: null,
      createdAt: "2026-06-10T12:00:00.000Z",
      updatedAt: null,
    },
    {
      id: "topic-node",
      nodeType: "concept",
      name: "Travel planning",
      description: "Likes compact Tokyo itineraries.",
      properties: {
        sourceType: "chat_export",
      },
      confidenceScore: null,
      createdAt: "2026-06-11T12:00:00.000Z",
      updatedAt: null,
    },
    {
      id: "goal-node",
      nodeType: "goal",
      name: "goal:demo",
      description: null,
      properties: {
        subject: "launch demo",
        sourceType: "chat",
      },
      confidenceScore: null,
      createdAt: "2026-06-12T12:00:00.000Z",
      updatedAt: null,
    },
  ],
  edges: [],
};
