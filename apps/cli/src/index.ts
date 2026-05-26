#!/usr/bin/env node
import "dotenv/config";

import { loadMcpServerConfig } from "@sivraj/config";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs, readBooleanOption, readListOption, readNumberOption, readStringOption } from "./args.js";
import { SivrajCliClient, type ContextRequest, type WritebackRequest } from "./client.js";
import {
  formatContextSummary,
  formatDemoResponse,
  formatEvalHarnessResponse,
  formatWritebackResponse,
  readContextExportContent,
} from "./format.js";

const USAGE = `Sivraj CLI

Usage:
  sivraj context [--preset codex|claude_code|cursor|generic_mcp] [--output <file>]
  sivraj writeback --summary "What the agent did" [--files-touched a.ts,b.ts]
  sivraj demo [--preset codex] [--record-writeback]
  sivraj research-demo --question "What should I research next?"
  sivraj strategy-demo --question "What should I prioritize?"
  sivraj eval --task "Implement the next feature"

Environment:
  SIVRAJ_API_URL   API base URL, defaults to API_URL or http://127.0.0.1:3000
  SIVRAJ_TWIN_ID   Twin ID
  SIVRAJ_TOKEN     Scoped token with agent context/writeback scopes

Context options:
  --project-name, --project-id, --repo-name, --package-name, --git-remote
  --package-manager, --frameworks, --lockfiles, --root-markers
  --include-candidate true|false, --approved-only, --include-temporary
  --max-items <n>, --limit <n>, --json, --summary

Writeback options:
  --agent-name, --repo, --branch, --summary, --summary-file
  --files-touched, --commands-run, --tests-run, --decisions
  --bugs-found, --follow-ups, --user-corrections
`;

export async function run(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const parsed = parseArgs(argv);

  if (!parsed.command || parsed.command === "help" || parsed.options["help"]) {
    return USAGE;
  }

  const config = loadMcpServerConfig(env);
  const client = new SivrajCliClient(config);

  if (parsed.command === "context") {
    const context = await client.getContext(readContextRequest(parsed.options, config.includeCandidates));
    const output = readBooleanOption(parsed.options, "json", false)
      ? `${JSON.stringify(context, null, 2)}\n`
      : readBooleanOption(parsed.options, "summary", false)
        ? `${formatContextSummary(context)}\n`
        : readContextExportContent(context);
    const outputPath = readStringOption(parsed.options, "output");

    if (outputPath) {
      await writeFile(outputPath, output);
      return `Wrote Sivraj context export to ${outputPath}\n`;
    }

    return output;
  }

  if (parsed.command === "writeback") {
    const writeback = await client.createWriteback(await readWritebackRequest(parsed.options));
    return `${formatWritebackResponse(writeback)}\n`;
  }

  if (parsed.command === "demo" || parsed.command === "research-demo" || parsed.command === "strategy-demo") {
    const context = await client.getContext(readContextRequest(parsed.options, config.includeCandidates));
    const shouldRecordWriteback = readBooleanOption(parsed.options, "recordWriteback", false);
    const writeback = shouldRecordWriteback
      ? await client.createWriteback(await readWritebackRequest({
        ...parsed.options,
        summary: readStringOption(parsed.options, "summary") ??
          "Demo coding-agent session fetched Sivraj context and validated the handoff flow.",
      }))
      : undefined;
    const mode = parsed.command === "research-demo"
      ? "research"
      : parsed.command === "strategy-demo"
        ? "strategy"
        : "coding";

    return `${formatDemoResponse({
      context,
      writeback,
      mode,
      question: readStringOption(parsed.options, "question"),
    })}\n`;
  }

  if (parsed.command === "eval") {
    const task = readStringOption(parsed.options, "task") ?? "Unspecified coding-agent task";
    const context = await client.getContext(readContextRequest({
      ...parsed.options,
      includeCandidate: readStringOption(parsed.options, "includeCandidate") ?? "false",
    }, false));

    return `${formatEvalHarnessResponse({ task, context })}\n`;
  }

  throw new Error(`Unknown command: ${parsed.command}\n\n${USAGE}`);
}

function readContextRequest(
  options: Record<string, string | boolean | string[]>,
  includeCandidatesDefault: boolean,
): ContextRequest {
  const approvedOnly = readBooleanOption(options, "approvedOnly", false);

  return {
    preset: readPreset(options),
    projectName: readStringOption(options, "projectName"),
    projectId: readStringOption(options, "projectId"),
    repoName: readStringOption(options, "repoName"),
    packageName: readStringOption(options, "packageName"),
    gitRemote: readStringOption(options, "gitRemote"),
    packageManager: readStringOption(options, "packageManager"),
    frameworks: readListOption(options, "frameworks"),
    lockfiles: readListOption(options, "lockfiles"),
    rootMarkers: readListOption(options, "rootMarkers"),
    artifactId: readStringOption(options, "artifactId"),
    includeCandidate: approvedOnly
      ? false
      : readBooleanOption(options, "includeCandidate", includeCandidatesDefault),
    includeSuperseded: readBooleanOption(options, "includeSuperseded", false),
    includeTemporary: readBooleanOption(options, "includeTemporary", false),
    maxItemsPerSection: readNumberOption(options, "maxItems"),
    limit: readNumberOption(options, "limit"),
  };
}

async function readWritebackRequest(
  options: Record<string, string | boolean | string[]>,
): Promise<WritebackRequest> {
  const taskSummary = readStringOption(options, "summary") ??
    await readSummaryFile(readStringOption(options, "summaryFile"));

  if (!taskSummary) {
    throw new Error("Missing required writeback summary. Use --summary or --summary-file.");
  }

  return {
    agentName: readStringOption(options, "agentName") ?? "Sivraj CLI",
    repo: readStringOption(options, "repo"),
    branch: readStringOption(options, "branch"),
    taskSummary,
    filesTouched: readListOption(options, "filesTouched"),
    commandsRun: readListOption(options, "commandsRun"),
    testsRun: readListOption(options, "testsRun"),
    decisions: readListOption(options, "decisions"),
    bugsFound: readListOption(options, "bugsFound"),
    followUps: readListOption(options, "followUps"),
    userCorrections: readListOption(options, "userCorrections"),
  };
}

async function readSummaryFile(path: string | undefined): Promise<string | undefined> {
  if (!path) {
    return undefined;
  }

  return (await readFile(path, "utf8")).trim();
}

function readPreset(options: Record<string, string | boolean | string[]>): string {
  const preset = readStringOption(options, "preset");

  if (preset === "claude_code" || preset === "cursor" || preset === "generic_mcp") {
    return preset;
  }

  return "codex";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2))
    .then((output) => {
      process.stdout.write(output);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
