import { strict as assert } from "node:assert";
import { test } from "vitest";
import { run } from "./index.js";

const env = {
  SIVRAJ_API_URL: "http://api.test",
  SIVRAJ_TWIN_ID: "twin-1",
  SIVRAJ_TOKEN: "token-1",
};

async function withMockFetch<T>(
  respond: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
  runTest: (calls: Array<{ url: string; init?: RequestInit }>) => Promise<T>,
): Promise<T> {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return respond(input, init);
  };

  try {
    return await runTest(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("context command prints preset export content", async () => {
  await withMockFetch(
    () => new Response(JSON.stringify({
      contextMarkdown: "# fallback",
      contextExport: {
        preset: "cursor",
        format: "mdc",
        targetFile: ".cursor/rules/sivraj.mdc",
        content: "---\nalwaysApply: true\n---\n# Sivraj Cursor Rules\n",
        itemCount: 1,
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
    async (calls) => {
      const output = await run(["context", "--preset", "cursor", "--repo-name", "sivraj"], env);
      assert.match(output, /Sivraj Cursor Rules/);
      assert.equal(calls.length, 1);
      assert.match(calls[0]?.url ?? "", /preset=cursor/);
      assert.match(calls[0]?.url ?? "", /repoName=sivraj/);
    },
  );
});

test("writeback command posts session summary", async () => {
  await withMockFetch(
    () => new Response(JSON.stringify({
      writebackId: "writeback-1",
      status: "pending",
      storageMode: "encrypted_walrus",
      warning: "agent_writeback_pending_review",
    }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }),
    async (calls) => {
      const output = await run([
        "writeback",
        "--agent-name",
        "Codex",
        "--summary",
        "Implemented CLI.",
        "--files-touched",
        "apps/cli/src/index.ts",
      ], env);
      assert.match(output, /writeback-1/);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.url, "http://api.test/v1/twins/twin-1/agents/writebacks");
      assert.equal(calls[0]?.init?.method, "POST");
      assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
        agentName: "Codex",
        taskSummary: "Implemented CLI.",
        filesTouched: ["apps/cli/src/index.ts"],
      });
    },
  );
});

test("writeback command requires summary", async () => {
  await assert.rejects(
    () => run(["writeback"], env),
    /Missing required writeback summary/,
  );
});

test("research and strategy demo clients fetch agent context", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify({
      contextExport: {
        preset: "codex",
        targetFile: "AGENTS.md",
        itemCount: 2,
        content: "# Research context\nUse source-backed Sivraj evidence.",
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const research = await run(["research-demo", "--question", "What market should I study?"], env);
    const strategy = await run(["strategy-demo", "--question", "What should I prioritize?"], env);

    assert.match(research, /Sivraj Research Agent Demo/);
    assert.match(research, /What market should I study/);
    assert.match(strategy, /Sivraj Strategy Agent Demo/);
    assert.match(strategy, /What should I prioritize/);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eval command compares baseline with Sivraj context quality", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    contextPacket: {
      quality: {
        score: 0.82,
        label: "good",
        readyForAgent: true,
        metrics: {
          totalItems: 8,
          evidenceRefs: 8,
          issueCount: 1,
        },
      },
    },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

  try {
    const output = await run(["eval", "--task", "Fix memory search"], env);

    assert.match(output, /Sivraj Agent Eval Harness/);
    assert.match(output, /Baseline without Sivraj context: 0\/100/);
    assert.match(output, /With Sivraj context: 82\/100 \(good\)/);
    assert.match(output, /Context items: 8/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
