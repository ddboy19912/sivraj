#!/usr/bin/env node
import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadMcpConfig } from "./env.js";
import { detectLocalRepoFingerprint, mergeRepoFingerprint } from "./repo-fingerprint.js";
import { SivrajApiClient, type JsonObject } from "./sivraj-client.js";
import { createMcpWritebackEncryptor } from "./writeback-encryption.js";

const config = loadMcpConfig();
const client = new SivrajApiClient(config, createMcpWritebackEncryptor(config));
const localRepoFingerprint = detectLocalRepoFingerprint();
const server = new McpServer({
  name: "sivraj-mcp-server",
  version: "0.0.0",
});

server.registerResource(
  "sivraj.currentEngineeringContext",
  "sivraj://engineering/context",
  {
    title: "Current Sivraj Engineering Context",
    description: "Private-safe, source-backed coding-agent context for the current repository.",
    mimeType: "text/markdown",
  },
  async (uri) => {
    const response = await client.getEngineeringContext({
      ...mergeRepoFingerprint(localRepoFingerprint, {}),
      preset: "generic_mcp",
    });
    const markdown = typeof response["contextMarkdown"] === "string"
      ? response["contextMarkdown"]
      : JSON.stringify(response, null, 2);

    return resourceText(uri.href, markdown);
  },
);

server.registerResource(
  "sivraj.engineeringSources",
  "sivraj://engineering/sources",
  {
    title: "Sivraj Engineering Instruction Sources",
    description: "Private-safe summaries of instruction files and artifacts that produced engineering memories.",
    mimeType: "text/markdown",
  },
  async (uri) => {
    const response = await client.listEngineeringSources(100);

    return resourceText(uri.href, formatSources(response));
  },
);

server.registerResource(
  "sivraj.recentAgentWritebacks",
  "sivraj://agents/writebacks/recent",
  {
    title: "Recent Sivraj Agent Writebacks",
    description: "Private-safe summaries of recent coding-agent writebacks and review status.",
    mimeType: "text/markdown",
  },
  async (uri) => {
    const response = await client.listAgentWritebacks(25);

    return resourceText(uri.href, formatWritebackList(response));
  },
);

server.registerTool(
  "sivraj.getEngineeringContext",
  {
    title: "Get Sivraj engineering context",
    description: "Return a concise, private-safe engineering context packet for coding agents.",
    inputSchema: {
      projectName: z.string().optional(),
      projectId: z.string().optional(),
      repoName: z.string().optional(),
      packageName: z.string().optional(),
      gitRemote: z.string().optional(),
      packageManager: z.string().optional(),
      frameworks: z.array(z.string()).optional(),
      lockfiles: z.array(z.string()).optional(),
      rootMarkers: z.array(z.string()).optional(),
      artifactId: z.string().uuid().optional(),
      includeCandidate: z.boolean().optional(),
      includeSuperseded: z.boolean().optional(),
      includeTemporary: z.boolean().optional(),
      preset: z.enum(["codex", "claude_code", "cursor", "generic_mcp"]).optional(),
      maxItemsPerSection: z.number().int().positive().max(100).optional(),
      limit: z.number().int().positive().max(1000).optional(),
    },
  },
  async (args) => {
    const response = await client.getEngineeringContext(mergeRepoFingerprint(localRepoFingerprint, args));
    const contextExport = response["contextExport"];
    const exportContent = contextExport && typeof contextExport === "object" && !Array.isArray(contextExport)
      ? (contextExport as Record<string, unknown>)["content"]
      : null;
    const markdown = typeof exportContent === "string"
      ? exportContent
      : typeof response["contextMarkdown"] === "string"
        ? response["contextMarkdown"]
      : JSON.stringify(response, null, 2);

    return textResult(markdown, response);
  },
);

server.registerTool(
  "sivraj.listEngineeringSources",
  {
    title: "List Sivraj engineering sources",
    description: "List private-safe summaries of instruction files and artifacts Sivraj learned engineering context from.",
    inputSchema: {
      limit: z.number().int().positive().max(500).optional(),
    },
  },
  async ({ limit }) => {
    const response = await client.listEngineeringSources(limit);

    return textResult(formatSources(response), response);
  },
);

server.registerTool(
  "sivraj.searchMemory",
  {
    title: "Search Sivraj memory",
    description: "Search source-backed Twin memories through the Sivraj API using the configured token scope.",
    inputSchema: {
      query: z.string().min(1),
      limit: z.number().int().positive().max(20).optional(),
    },
  },
  async (args) => {
    const response = await client.searchMemory(args);

    return textResult(formatSearchResults(response), response);
  },
);

server.registerTool(
  "sivraj.getProjectProfile",
  {
    title: "Get Sivraj project profile",
    description: "Return the structured engineering project profile used to build coding-agent context.",
    inputSchema: {
      projectName: z.string().optional(),
      projectId: z.string().optional(),
      repoName: z.string().optional(),
      packageName: z.string().optional(),
      gitRemote: z.string().optional(),
      packageManager: z.string().optional(),
      frameworks: z.array(z.string()).optional(),
      lockfiles: z.array(z.string()).optional(),
      rootMarkers: z.array(z.string()).optional(),
      artifactId: z.string().uuid().optional(),
      includeCandidate: z.boolean().optional(),
      includeSuperseded: z.boolean().optional(),
      includeTemporary: z.boolean().optional(),
      preset: z.enum(["codex", "claude_code", "cursor", "generic_mcp"]).optional(),
      maxItemsPerSection: z.number().int().positive().max(100).optional(),
      limit: z.number().int().positive().max(1000).optional(),
    },
  },
  async (args) => {
    const response = await client.getProjectProfile(mergeRepoFingerprint(localRepoFingerprint, args));

    return textResult(JSON.stringify(response, null, 2), response);
  },
);

server.registerTool(
  "sivraj.recordAgentWriteback",
  {
    title: "Record coding-agent writeback",
    description: "Submit a coding-agent session summary to Sivraj as an encrypted pending-review writeback.",
    inputSchema: {
      agentName: z.string().optional(),
      repo: z.string().optional(),
      branch: z.string().optional(),
      taskSummary: z.string().min(1),
      filesTouched: z.array(z.string()).optional(),
      commandsRun: z.array(z.string()).optional(),
      testsRun: z.array(z.string()).optional(),
      decisions: z.array(z.string()).optional(),
      bugsFound: z.array(z.string()).optional(),
      followUps: z.array(z.string()).optional(),
      userCorrections: z.array(z.string()).optional(),
    },
  },
  async (args) => {
    const response = await client.recordAgentWriteback(args);

    return textResult(formatWritebackResponse(response), response);
  },
);

await server.connect(new StdioServerTransport());

function textResult(text: string, data: JsonObject) {
  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
    structuredContent: data,
  };
}

function resourceText(uri: string, text: string) {
  return {
    contents: [
      {
        uri,
        mimeType: "text/markdown",
        text,
      },
    ],
  };
}

function formatSources(response: JsonObject): string {
  const sources = Array.isArray(response["sources"]) ? response["sources"] : [];
  const lines = ["# Sivraj Engineering Sources", ""];

  if (sources.length === 0) {
    lines.push("No engineering sources found.");
    return lines.join("\n");
  }

  for (const source of sources) {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      continue;
    }

    const record = source as Record<string, unknown>;
    lines.push(`- ${String(record["displayName"] ?? record["artifactId"] ?? "Unknown source")}`);
    lines.push(`  - artifact: ${String(record["artifactId"] ?? "unknown")}`);
    lines.push(`  - type: ${String(record["sourceType"] ?? "unknown")}`);
    lines.push(`  - memories: ${String(record["extractedEngineeringMemoryCount"] ?? 0)}`);
  }

  return lines.join("\n");
}

function formatSearchResults(response: JsonObject): string {
  const query = typeof response["query"] === "string" ? response["query"] : "";
  const results = Array.isArray(response["results"]) ? response["results"] : [];
  const lines = [`# Sivraj Memory Search`, "", `Query: ${query}`, ""];

  if (results.length === 0) {
    lines.push("No matching memories found.");
    return lines.join("\n");
  }

  for (const result of results) {
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      continue;
    }

    const record = result as Record<string, unknown>;
    lines.push(`## ${String(record["id"] ?? "memory")}`);
    lines.push(`Score: ${String(record["score"] ?? "unknown")}`);
    lines.push(`Source artifact: ${String(record["sourceArtifactId"] ?? "unknown")}`);
    lines.push("");
    lines.push(String(record["content"] ?? ""));
    lines.push("");
  }

  return lines.join("\n");
}

function formatWritebackResponse(response: JsonObject): string {
  return [
    "# Sivraj Agent Writeback Recorded",
    "",
    `Writeback: ${String(response["writebackId"] ?? "unknown")}`,
    `Status: ${String(response["status"] ?? "unknown")}`,
    `Storage: ${String(response["storageMode"] ?? "unknown")}`,
    `Review: ${String(response["warning"] ?? "pending_review")}`,
  ].join("\n");
}

function formatWritebackList(response: JsonObject): string {
  const writebacks = Array.isArray(response["writebacks"]) ? response["writebacks"] : [];
  const lines = ["# Sivraj Recent Agent Writebacks", ""];

  if (writebacks.length === 0) {
    lines.push("No agent writebacks found.");
    return lines.join("\n");
  }

  for (const writeback of writebacks) {
    if (!writeback || typeof writeback !== "object" || Array.isArray(writeback)) {
      continue;
    }

    const record = writeback as Record<string, unknown>;
    lines.push(`- ${String(record["agentName"] ?? "coding-agent")} / ${String(record["status"] ?? "unknown")}`);
    lines.push(`  - writeback: ${String(record["id"] ?? "unknown")}`);
    lines.push(`  - repo: ${String(record["repo"] ?? "unknown")}`);
    lines.push(`  - created: ${String(record["createdAt"] ?? "unknown")}`);
  }

  return lines.join("\n");
}
