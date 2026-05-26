import { strict as assert } from "node:assert";
import { test } from "vitest";
import { SivrajApiClient, type AgentWritebackArgs } from "./sivraj-client.js";
import type { AgentWritebackEncryptor } from "./writeback-encryption.js";

test("recordAgentWriteback sends client-encrypted payload when enabled", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  const encryptor: AgentWritebackEncryptor = {
    async encryptWriteback(args: AgentWritebackArgs) {
      assert.equal(args.taskSummary, "Implemented MCP encryption.");

      return {
        agentName: "Codex",
        repo: "sivraj",
        taskSummarySha256: "a".repeat(64),
        counts: {
          filesTouched: 1,
          commandsRun: 1,
          testsRun: 1,
          decisions: 1,
          bugsFound: 0,
          followUps: 0,
          userCorrections: 0,
        },
        encryptedPayload: {
          ciphertextBase64: Buffer.from("encrypted").toString("base64"),
          ciphertextSha256: "b".repeat(64),
          seal: {
            packageId: "0xpackage",
            policyId: "0xpolicy",
            threshold: 1,
            keyServerObjectIds: ["0xkeyserver"],
          },
        },
      };
    },
  };

  globalThis.fetch = (async (url, init) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });

    return new Response(JSON.stringify({ writebackId: "writeback-1" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const client = new SivrajApiClient({
      apiUrl: "http://api.test",
      twinId: "twin-1",
      token: "token-1",
      includeCandidates: false,
      maxItemsPerSection: 12,
      writebackEncryption: "client",
    }, encryptor);

    const response = await client.recordAgentWriteback({
      agentName: "Codex",
      repo: "sivraj",
      taskSummary: "Implemented MCP encryption.",
      filesTouched: ["apps/mcp-server/src/sivraj-client.ts"],
      commandsRun: ["pnpm --filter @sivraj/mcp-server test"],
      testsRun: ["pnpm --filter @sivraj/mcp-server test"],
      decisions: ["Encrypt writebacks before API submission."],
    });

    assert.equal(response["writebackId"], "writeback-1");
    assert.equal(calls[0]?.url, "http://api.test/v1/twins/twin-1/agents/writebacks");
    assert.equal(calls[0]?.body["taskSummary"], undefined);
    assert.equal(calls[0]?.body["taskSummarySha256"], "a".repeat(64));
    assert.deepEqual((calls[0]?.body["counts"] as Record<string, unknown>)["filesTouched"], 1);
    assert.ok(calls[0]?.body["encryptedPayload"]);
    assert.equal(JSON.stringify(calls[0]?.body).includes("Implemented MCP encryption."), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
