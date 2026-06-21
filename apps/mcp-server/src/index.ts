#!/usr/bin/env node
import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadMcpConfig } from "./env.js";
import { detectLocalRepoFingerprint, mergeRepoFingerprint } from "./repo-fingerprint.js";
import { readContextExportMarkdown } from "./context-export.js";
import {
  formatSearchResults,
  formatSources,
  formatWritebackList,
  formatWritebackResponse,
} from "./format.js";
import { SivrajApiClient, type JsonObject } from "./sivraj-client.js";
import { engineeringContextInputSchema } from "./tool-schemas.js";
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
      preset: config.agentPreset,
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
    inputSchema: engineeringContextInputSchema,
  },
  async (args) => {
    const response = await client.getEngineeringContext(mergeRepoFingerprint(localRepoFingerprint, args));

    return textResult(readContextExportMarkdown(response), response);
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
    inputSchema: engineeringContextInputSchema,
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
