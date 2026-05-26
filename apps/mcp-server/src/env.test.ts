import { strict as assert } from "node:assert";
import { test } from "vitest";
import { loadMcpConfig } from "./env.js";

test("loads MCP config with explicit Sivraj values", () => {
  const config = loadMcpConfig({
    SIVRAJ_API_URL: "http://127.0.0.1:3000/",
    SIVRAJ_TWIN_ID: "twin-1",
    SIVRAJ_TOKEN: "token-1",
    SIVRAJ_PROJECT_NAME: "sivraj",
    SIVRAJ_PROJECT_ID: "project-1",
    SIVRAJ_INCLUDE_CANDIDATES: "false",
    SIVRAJ_MAX_ITEMS_PER_SECTION: "7",
  });

  assert.equal(config.apiUrl, "http://127.0.0.1:3000");
  assert.equal(config.twinId, "twin-1");
  assert.equal(config.token, "token-1");
  assert.equal(config.projectName, "sivraj");
  assert.equal(config.projectId, "project-1");
  assert.equal(config.includeCandidates, false);
  assert.equal(config.maxItemsPerSection, 7);
  assert.equal(config.writebackEncryption, "api");
});

test("falls back to API_URL and candidate review mode defaults", () => {
  const config = loadMcpConfig({
    API_URL: "http://localhost:4000",
    SIVRAJ_TWIN_ID: "twin-1",
    SIVRAJ_TOKEN: "token-1",
  });

  assert.equal(config.apiUrl, "http://localhost:4000");
  assert.equal(config.includeCandidates, true);
  assert.equal(config.maxItemsPerSection, 12);
});

test("loads client-side MCP writeback encryption config", () => {
  const config = loadMcpConfig({
    SIVRAJ_TWIN_ID: "twin-1",
    SIVRAJ_TOKEN: "token-1",
    SIVRAJ_WRITEBACK_ENCRYPTION: "client",
    SIVRAJ_SEAL_PACKAGE_ID: "0xpackage",
    SIVRAJ_SEAL_POLICY_ID: "0xpolicy",
    SIVRAJ_SEAL_KEY_SERVERS: "0xkeyserver",
    SIVRAJ_SEAL_THRESHOLD: "1",
    SIVRAJ_SUI_RPC_URL: "https://fullnode.testnet.sui.io:443",
  });

  assert.equal(config.writebackEncryption, "client");
  assert.equal(config.seal?.packageId, "0xpackage");
  assert.equal(config.seal?.policyId, "0xpolicy");
  assert.equal(config.seal?.threshold, 1);
  assert.equal(config.sui?.network, "testnet");
  assert.equal(config.sui?.rpcUrl, "https://fullnode.testnet.sui.io:443");
});

test("requires twin id and token", () => {
  assert.throws(() => loadMcpConfig({ SIVRAJ_TOKEN: "token-1" }), /SIVRAJ_TWIN_ID/);
  assert.throws(() => loadMcpConfig({ SIVRAJ_TWIN_ID: "twin-1" }), /SIVRAJ_TOKEN/);
});
