import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_CONTEXT_READ_SCOPE,
  AGENT_PROJECT_PROFILE_READ_SCOPE,
  AGENT_SOURCE_READ_SCOPE,
  signSessionToken,
} from "@sivraj/auth";
import {
  candidateMemories,
  canonicalMemories,
  sourceArtifacts,
} from "@sivraj/db";
import type { AppDependencies } from "../app.js";
import { createAgentTokenRoutes } from "./agent-tokens.js";
import { createEngineeringRoutes } from "./engineering.js";
import { createMemoryRoutes } from "./memories.js";

describe("read-only agent context scopes", () => {
  beforeEach(() => {
    process.env["JWT_SECRET"] = "agent-context-scope-secret";
    process.env["TOKEN_ISSUER"] = "agent-context-scope-test";
  });

  it("allows engineering context but blocks memory search and writebacks", async () => {
    const token = await signSessionToken(
      {
        type: "agent",
        sub: "client-1",
        twinId: "twin-1",
        clientId: "client-1",
        scopes: [
          AGENT_CONTEXT_READ_SCOPE,
          AGENT_SOURCE_READ_SCOPE,
          AGENT_PROJECT_PROFILE_READ_SCOPE,
        ],
      },
      {
        jwtSecret: "agent-context-scope-secret",
        tokenIssuer: "agent-context-scope-test",
      },
    );
    const app = createAgentContextScopeTestApp(createReadOnlyAgentDb({
      canonicalRows: [createCanonicalEngineeringMemory()],
      sourceRows: [createAgentInstructionSource()],
    }));
    const authHeaders = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };

    const contextResponse = await app.request(
      "/v1/twins/twin-1/engineering/context?preset=codex",
      { headers: authHeaders },
    );
    const contextPayload = await contextResponse.json();

    expect(contextResponse.status).toBe(200);
    expect(contextPayload.policy).toMatchObject({
      rawArtifactsIncluded: false,
      decryptedMemoryIncluded: false,
      plaintextStatementsIncluded: false,
      derivedEngineeringContextIncluded: true,
    });
    expect(contextPayload.contextExport).toMatchObject({
      targetFile: "AGENTS.md",
      itemCount: 1,
    });
    expect(contextPayload.contextExport.content).toContain(
      "Use pnpm and focused package tests before handoff.",
    );
    expect(contextPayload.contextExport.content).not.toContain("Evidence:");
    expect(contextPayload.contextExport.content).not.toContain("Evidence Map");
    expect(contextPayload.contextExport.content).not.toContain("Sivraj quality");
    expect(contextPayload.profileSummary.inventory).toMatchObject({
      canonicalEngineeringMemoryCount: 1,
      agentInstructionSourceCount: 1,
      exportableItemCount: 1,
    });

    const searchResponse = await app.request("/v1/twins/twin-1/memories/search", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ query: "pnpm" }),
    });
    expect(searchResponse.status).toBe(403);
    await expect(searchResponse.json()).resolves.toMatchObject({
      error: "missing_scope",
    });

    const writebackResponse = await app.request("/v1/twins/twin-1/agents/writebacks", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ taskSummary: "Update docs" }),
    });
    expect(writebackResponse.status).toBe(403);
    await expect(writebackResponse.json()).resolves.toMatchObject({
      error: "missing_scope",
    });
  });

  it("does not infer engineering packet items from ordinary canonical text", async () => {
    const token = await signSessionToken(
      {
        type: "agent",
        sub: "client-1",
        twinId: "twin-1",
        clientId: "client-1",
        scopes: [
          AGENT_CONTEXT_READ_SCOPE,
          AGENT_SOURCE_READ_SCOPE,
          AGENT_PROJECT_PROFILE_READ_SCOPE,
        ],
      },
      {
        jwtSecret: "agent-context-scope-secret",
        tokenIssuer: "agent-context-scope-test",
      },
    );
    const app = createAgentContextScopeTestApp(createReadOnlyAgentDb({
      canonicalRows: [createPersonalMemoryThatMentionsCode()],
    }));

    const contextResponse = await app.request(
      "/v1/twins/twin-1/engineering/context?preset=codex",
      { headers: { authorization: `Bearer ${token}` } },
    );
    const contextPayload = await contextResponse.json();

    expect(contextResponse.status).toBe(200);
    expect(contextPayload.contextExport).toMatchObject({
      targetFile: "AGENTS.md",
      itemCount: 0,
    });
    expect(contextPayload.contextExport.content).not.toContain("TypeScript");
    expect(contextPayload.profileSummary.inventory).toMatchObject({
      canonicalEngineeringMemoryCount: 0,
      exportableItemCount: 0,
    });
  });

  it("exports candidate engineering memories from uploaded agent files by default", async () => {
    const token = await signSessionToken(
      {
        type: "agent",
        sub: "client-1",
        twinId: "twin-1",
        clientId: "client-1",
        scopes: [
          AGENT_CONTEXT_READ_SCOPE,
          AGENT_SOURCE_READ_SCOPE,
          AGENT_PROJECT_PROFILE_READ_SCOPE,
        ],
      },
      {
        jwtSecret: "agent-context-scope-secret",
        tokenIssuer: "agent-context-scope-test",
      },
    );
    const app = createAgentContextScopeTestApp(createReadOnlyAgentDb({
      candidateRows: [createAgentInstructionCandidateMemory()],
      sourceRows: [createAgentInstructionSource()],
    }));

    const contextResponse = await app.request(
      "/v1/twins/twin-1/engineering/context?preset=claude_code",
      { headers: { authorization: `Bearer ${token}` } },
    );
    const contextPayload = await contextResponse.json();

    expect(contextResponse.status).toBe(200);
    expect(contextPayload.contextExport).toMatchObject({
      targetFile: "CLAUDE.md",
      itemCount: 1,
    });
    expect(contextPayload.contextExport.content).toContain(
      "Follow uploaded agent instructions when working in this repo.",
    );
    expect(contextPayload.profileSummary.inventory).toMatchObject({
      candidateEngineeringMemoryCount: 1,
      agentInstructionSourceCount: 1,
      exportableItemCount: 1,
    });
  });
});

function createAgentContextScopeTestApp(db: AppDependencies["db"]) {
  const app = new Hono();
  const dependencies = {
    db,
    privateMemoryReader: undefined,
    memorySearchConfig: {
      shortlistLimit: 20,
      fallbackLimit: 20,
      decryptConcurrency: 1,
      decryptEvidenceLimit: 6,
    },
  } as AppDependencies;

  app.route("/v1/twins/:twinId/agents", createAgentTokenRoutes(dependencies));
  app.route("/v1/twins/:twinId/engineering", createEngineeringRoutes(dependencies));
  app.route("/v1/twins/:twinId/memories", createMemoryRoutes(dependencies));
  return app;
}

function createReadOnlyAgentDb(options: {
  candidateRows?: Array<typeof candidateMemories.$inferSelect>;
  canonicalRows?: Array<typeof canonicalMemories.$inferSelect>;
  sourceRows?: Array<typeof sourceArtifacts.$inferSelect>;
} = {}): AppDependencies["db"] {
  const readOnlyGrant = {
    id: "grant-1",
    scopes: [
      AGENT_CONTEXT_READ_SCOPE,
      AGENT_SOURCE_READ_SCOPE,
      AGENT_PROJECT_PROFILE_READ_SCOPE,
    ],
  };

  return {
    select: vi.fn((selection?: Record<string, unknown>) => {
      if (selection && "scopes" in selection) {
        return {
          from: () => ({
            where: () => ({
              limit: async () => [readOnlyGrant],
            }),
          }),
        };
      }

      return {
        from: (table: unknown) => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => rowsForTable(table, options),
            }),
          }),
        }),
      };
    }),
    insert: vi.fn(() => ({
      values: vi.fn(async () => undefined),
    })),
    update: vi.fn(),
    delete: vi.fn(),
  } as never;
}

function rowsForTable(
  table: unknown,
  options: {
    candidateRows?: Array<typeof candidateMemories.$inferSelect>;
    canonicalRows?: Array<typeof canonicalMemories.$inferSelect>;
    sourceRows?: Array<typeof sourceArtifacts.$inferSelect>;
  },
) {
  if (table === candidateMemories) {
    return options.candidateRows ?? [];
  }

  if (table === canonicalMemories) {
    return options.canonicalRows ?? [];
  }

  if (table === sourceArtifacts) {
    return options.sourceRows ?? [];
  }

  return [];
}

function createCanonicalEngineeringMemory(): typeof canonicalMemories.$inferSelect {
  return {
    id: "canonical-engineering-1",
    twinId: "twin-1",
    memoryType: "preference",
    canonicalKey: "engineering_memory:global_user:tool_preference:pnpm:abc123",
    subject: "pnpm",
    status: "approved",
    evidenceCount: 1,
    confidenceScore: 0.91,
    metadata: {
      engineering: true,
      engineeringMemoryType: "tool_preference",
      engineeringInstructionScope: "global_user",
      engineeringSubject: "pnpm",
      engineeringEvidenceHash: "evidence-canonical-1",
      engineeringEvidenceLength: 64,
      agentContextLine: "Use pnpm and focused package tests before handoff.",
      memoryMetadata: {
        engineering: true,
        engineeringMemoryType: "tool_preference",
        engineeringInstructionScope: "global_user",
      },
      currentTruth: {
        kind: "engineering_memory",
        status: "active",
        sourceArtifactId: "source-agent-1",
        memoryFragmentId: "fragment-agent-1",
        evidenceHash: "evidence-canonical-1",
        engineeringMemoryType: "tool_preference",
        engineeringInstructionScope: "global_user",
        subject: "pnpm",
        agentContextLine: "Use pnpm and focused package tests before handoff.",
      },
    },
    firstSeenAt: new Date("2026-01-01T00:00:00.000Z"),
    lastSeenAt: new Date("2026-01-01T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function createPersonalMemoryThatMentionsCode(): typeof canonicalMemories.$inferSelect {
  return {
    ...createCanonicalEngineeringMemory(),
    id: "canonical-personal-1",
    canonicalKey: "profile_slot:user:favorite_language",
    subject: "personal",
    metadata: {
      currentTruth: {
        kind: "note",
        status: "active",
        value: "The user likes reading TypeScript blog posts on weekends.",
        sourceArtifactId: "source-personal-1",
        memoryFragmentId: "fragment-personal-1",
        evidenceHash: "evidence-personal-1",
      },
    },
  };
}

function createAgentInstructionCandidateMemory(): typeof candidateMemories.$inferSelect {
  return {
    id: "candidate-agent-1",
    twinId: "twin-1",
    canonicalMemoryId: null,
    archiveId: null,
    sourceArtifactId: "source-agent-1",
    memoryFragmentId: "fragment-agent-1",
    memoryType: "preference",
    status: "candidate",
    statementStorageRef: "pending://source-agent-1/fragment-agent-1",
    statementSha256: "statement-sha",
    evidenceHash: "candidate-evidence-1",
    evidenceLength: 72,
    confidenceScore: 0.88,
    archiveStatus: "not_required",
    archiveErrorCode: null,
    archiveErrorMessage: null,
    archiveAttemptCount: 0,
    archiveLastAttemptedAt: null,
    archiveNextRetryAt: null,
    archiveCompletedAt: null,
    metadata: {
      engineering: true,
      engineeringMemoryType: "agent_instruction",
      engineeringInstructionScope: "agent_specific",
      subject: "Claude Code",
      agentContextLine: "Follow uploaded agent instructions when working in this repo.",
      engineeringMetadata: {
        sourceKind: "agent_instruction_file",
      },
    },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function createAgentInstructionSource(): typeof sourceArtifacts.$inferSelect {
  return {
    id: "source-agent-1",
    twinId: "twin-1",
    sourceType: "markdown",
    uri: null,
    rawStorageRef: "private/source-agent-1",
    hash: "hash-source-agent-1",
    connectorAccountId: null,
    connectorSourceId: null,
    connectorSyncRunId: null,
    metadata: {
      engineeringSourceKind: "agent_instruction_file",
      artifactPurpose: "agent_skill_source",
      targetInstructionFile: "AGENTS.md",
    },
    ingestionStatus: "completed",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}
