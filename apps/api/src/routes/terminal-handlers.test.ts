import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { signSessionToken } from "@sivraj/auth";
import type { AppDependencies } from "../app.js";
import { createTerminalRoutes } from "./terminal.js";
import { parseTerminalCommandBody } from "./terminal-handlers.js";
import {
  formatAccountWipeLines,
  wipeTerminalAccount,
} from "./terminal-account-wipe.js";
import {
  formatOnboardingResetLines,
  resetTerminalOnboarding,
} from "./terminal-onboarding.js";

describe("terminal command body parsing", () => {
  it("parses allowlisted commands and flags", () => {
    expect(
      parseTerminalCommandBody({
        commandId: "onboarding.reset",
        flags: { confirm: true },
      }),
    ).toMatchObject({
      ok: true,
      command: {
        commandId: "onboarding.reset",
        dryRun: false,
        confirmed: true,
      },
    });

    expect(
      parseTerminalCommandBody({
        commandId: "account.wipe",
        flags: { confirm: true },
      }),
    ).toMatchObject({
      ok: true,
      command: {
        commandId: "account.wipe",
        confirmed: true,
      },
    });

    expect(
      parseTerminalCommandBody({
        commandId: "connectors.sync",
        args: ["account-1"],
      }),
    ).toMatchObject({
      ok: true,
      command: { commandId: "connectors.sync", accountId: "account-1" },
    });
  });

  it("rejects unsupported commands", () => {
    expect(
      parseTerminalCommandBody({ commandId: "shell.exec" }),
    ).toMatchObject({
      ok: false,
      error: "Unsupported terminal command: shell.exec.",
    });
  });
});

describe("terminal route authorization", () => {
  it("rejects missing auth before executing a command", async () => {
    const app = createTerminalTestApp(createNoopDependencies());
    const response = await app.request("/v1/twins/twin-1/terminal/commands", {
      method: "POST",
      body: JSON.stringify({ commandId: "onboarding.status" }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(401);
  });

  it("rejects commands for another twin", async () => {
    withAuthEnv();
    const token = await signSessionToken(
      {
        type: "user",
        sub: "user-1",
        twinId: "twin-1",
        walletAddress: "0xabc",
        scopes: ["artifact:upload", "memory:read"],
      },
      { jwtSecret: "terminal-test-secret", tokenIssuer: "terminal-test" },
    );
    const app = createTerminalTestApp(createNoopDependencies());
    const response = await app.request("/v1/twins/twin-2/terminal/commands", {
      method: "POST",
      body: JSON.stringify({ commandId: "onboarding.status" }),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(403);
  });
});

describe("terminal account wipe", () => {
  it("reports dry-run counts without mutating the account", async () => {
    const mutations: string[] = [];
    const result = await wipeTerminalAccount(
      createAccountWipeDb({
        counts: [1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
        mutations,
      }),
      {
        auth: {
          type: "user",
          sub: "user-1",
          twinId: "twin-1",
          walletAddress: "0xabc",
          scopes: [],
        },
        twinId: "twin-1",
        dryRun: true,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      summary: {
        dryRun: true,
        deletedUsers: 1,
        deletedWalletAccounts: 1,
        deletedTwins: 1,
        deletedRefreshSessions: 2,
        deletedAuditEvents: 3,
        deletedChatThreads: 4,
        deletedChatMessages: 5,
        deletedSourceArtifacts: 6,
        deletedMemoryFragments: 7,
        deletedCanonicalMemories: 8,
        deletedCandidateMemories: 9,
        deletedConnectorAccounts: 10,
        deletedContextPackets: 11,
        deletedContextRuntimePackets: 12,
        deletedDocumentRows: 42,
        deletedGraphNodes: 16,
      },
    });
    expect(mutations).toEqual([]);
  });

  it("deletes audit events before deleting the user root on confirmed wipe", async () => {
    const mutations: string[] = [];
    const result = await wipeTerminalAccount(
      createAccountWipeDb({
        counts: Array.from({ length: 18 }, () => 1),
        mutations,
      }),
      {
        auth: {
          type: "user",
          sub: "user-1",
          twinId: "twin-1",
          walletAddress: "0xabc",
          scopes: [],
        },
        twinId: "twin-1",
        dryRun: false,
      },
    );

    expect(result).toMatchObject({ ok: true });
    expect(mutations).toEqual(["delete:audit_events", "delete:users"]);
  });

  it("requires a wallet-backed user session", async () => {
    const result = await wipeTerminalAccount(
      createAccountWipeDb({ counts: [], mutations: [] }),
      {
        auth: {
          type: "agent",
          sub: "agent-1",
          twinId: "twin-1",
          scopes: [],
        },
        twinId: "twin-1",
        dryRun: false,
      },
    );

    expect(result).toMatchObject({
      ok: false,
      status: 403,
      error: "user_wallet_required",
    });
  });

  it("formats wipe output lines", () => {
    expect(
      formatAccountWipeLines({
        dryRun: true,
        walletAddress: "0xabc",
        userId: "user-1",
        twinId: "twin-1",
        deletedUsers: 1,
        deletedWalletAccounts: 1,
        deletedTwins: 1,
        deletedRefreshSessions: 2,
        deletedAuditEvents: 3,
        deletedChatThreads: 4,
        deletedChatMessages: 5,
        deletedSourceArtifacts: 6,
        deletedMemoryFragments: 7,
        deletedCanonicalMemories: 8,
        deletedCandidateMemories: 9,
        deletedConnectorAccounts: 10,
        deletedContextPackets: 11,
        deletedContextRuntimePackets: 12,
        deletedDocumentRows: 13,
        deletedGraphNodes: 14,
        walrusNote: "Walrus note.",
      }),
    ).toContainEqual({ kind: "info", text: "Connector accounts removed: 10" });
  });
});

describe("terminal onboarding reset", () => {
  it("reports dry-run counts without mutating records", async () => {
    const mutations: string[] = [];
    const result = await resetTerminalOnboarding(createResetDb([2, 1, 1, 3], mutations), {
      auth: {
        type: "user",
        sub: "user-1",
        twinId: "twin-1",
        walletAddress: "0xabc",
        scopes: [],
      },
      twinId: "twin-1",
      dryRun: true,
    });

    expect(result).toMatchObject({
      ok: true,
      summary: {
        dryRun: true,
        deletedArtifacts: 2,
        deletedIdentityProfiles: 1,
        deletedVoiceProfiles: 1,
        revokedSessions: 3,
      },
    });
    expect(mutations).toEqual([]);
  });

  it("applies confirmed reset mutations and writes an audit event", async () => {
    const mutations: string[] = [];
    const result = await resetTerminalOnboarding(createResetDb([2, 1, 1, 3], mutations), {
      auth: {
        type: "user",
        sub: "user-1",
        twinId: "twin-1",
        walletAddress: "0xabc",
        scopes: [],
      },
      twinId: "twin-1",
      dryRun: false,
    });

    expect(result).toMatchObject({ ok: true });
    expect(mutations).toEqual([
      "delete",
      "delete",
      "delete",
      "update",
      "update",
      "update",
      "insert",
    ]);
  });

  it("formats reset output lines", () => {
    expect(
      formatOnboardingResetLines({
        dryRun: true,
        walletAddress: "0xabc",
        userId: "user-1",
        twinId: "twin-1",
        deletedArtifacts: 2,
        deletedIdentityProfiles: 1,
        deletedVoiceProfiles: 1,
        revokedSessions: 3,
      }),
    ).toContainEqual({ kind: "info", text: "Onboarding artifacts removed: 2" });
  });
});

function createTerminalTestApp(dependencies: AppDependencies) {
  const app = new Hono();
  app.route("/v1/twins/:twinId/terminal", createTerminalRoutes(dependencies));
  return app;
}

function createNoopDependencies(): AppDependencies {
  return {
    db: {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as never,
  };
}

function createResetDb(counts: number[], mutations: string[]): AppDependencies["db"] {
  let selectIndex = 0;
  const consumeCount = () => counts[selectIndex++] ?? 0;

  return {
    select: () => ({
      from: () => ({
        where: async () => [{ count: consumeCount() }],
      }),
    }),
    delete: () => ({
      where: async () => {
        mutations.push("delete");
      },
    }),
    update: () => ({
      set: () => ({
        where: async () => {
          mutations.push("update");
        },
      }),
    }),
    insert: () => ({
      values: async () => {
        mutations.push("insert");
      },
    }),
  } as never;
}

function createAccountWipeDb(input: {
  counts: number[];
  mutations: string[];
  hasTwin?: boolean;
  hasWallet?: boolean;
}): AppDependencies["db"] {
  let selectIndex = 0;
  let countIndex = 0;
  let deleteIndex = 0;
  const rowsForSelect = () => {
    if (selectIndex === 0) {
      selectIndex += 1;
      return input.hasTwin === false ? [] : [{ id: "twin-1" }];
    }
    if (selectIndex === 1) {
      selectIndex += 1;
      return input.hasWallet === false ? [] : [{ id: "wallet-1" }];
    }
    selectIndex += 1;
    return [{ count: input.counts[countIndex++] ?? 0 }];
  };

  return {
    select: () => ({
      from: () => ({
        where: () => queryRows(rowsForSelect()),
      }),
    }),
    delete: () => ({
      where: async () => {
        input.mutations.push(deleteIndex++ === 0 ? "delete:audit_events" : "delete:users");
      },
    }),
    insert: () => ({
      values: async () => undefined,
    }),
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
  } as never;
}

function queryRows(rows: unknown[]) {
  return {
    limit: async () => rows,
    then: (
      resolve: (value: unknown[]) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };
}

function withAuthEnv() {
  process.env["JWT_SECRET"] = "terminal-test-secret";
  process.env["TOKEN_ISSUER"] = "terminal-test";
}
