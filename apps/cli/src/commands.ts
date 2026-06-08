import { readFile, writeFile } from "node:fs/promises";
import { loadMcpServerConfig } from "@sivraj/config";
import { SivrajCliClient, type ContextRequest, type WritebackRequest } from "./client.js";
import {
  formatContextSummary,
  formatDemoResponse,
  formatEvalHarnessResponse,
  formatWritebackResponse,
  readContextExportContent,
} from "./format.js";
import { readBooleanOption, readListOption, readNumberOption, readStringOption } from "./args.js";

export async function runContextCommand(
  client: SivrajCliClient,
  options: Record<string, string | boolean | string[]>,
  includeCandidatesDefault: boolean,
): Promise<string> {
  const context = await client.getContext(readContextRequest(options, includeCandidatesDefault));
  const output = readBooleanOption(options, "json", false)
    ? `${JSON.stringify(context, null, 2)}\n`
    : readBooleanOption(options, "summary", false)
      ? `${formatContextSummary(context)}\n`
      : readContextExportContent(context);
  const outputPath = readStringOption(options, "output");

  if (outputPath) {
    await writeFile(outputPath, output);
    return `Wrote Sivraj context export to ${outputPath}\n`;
  }

  return output;
}

export async function runWritebackCommand(
  client: SivrajCliClient,
  options: Record<string, string | boolean | string[]>,
): Promise<string> {
  const writeback = await client.createWriteback(await readWritebackRequest(options));
  return `${formatWritebackResponse(writeback)}\n`;
}

export async function runDemoCommand(
  client: SivrajCliClient,
  command: "demo" | "research-demo" | "strategy-demo",
  options: Record<string, string | boolean | string[]>,
  includeCandidatesDefault: boolean,
): Promise<string> {
  const context = await client.getContext(readContextRequest(options, includeCandidatesDefault));
  const shouldRecordWriteback = readBooleanOption(options, "recordWriteback", false);
  const writeback = shouldRecordWriteback
    ? await client.createWriteback(await readWritebackRequest({
      ...options,
      summary: readStringOption(options, "summary") ??
        "Demo coding-agent session fetched Sivraj context and validated the handoff flow.",
    }))
    : undefined;
  const mode = command === "research-demo"
    ? "research"
    : command === "strategy-demo"
      ? "strategy"
      : "coding";

  return `${formatDemoResponse({
    context,
    writeback,
    mode,
    question: readStringOption(options, "question"),
  })}\n`;
}

export async function runEvalCommand(
  client: SivrajCliClient,
  options: Record<string, string | boolean | string[]>,
): Promise<string> {
  const task = readStringOption(options, "task") ?? "Unspecified coding-agent task";
  const context = await client.getContext(readContextRequest({
    ...options,
    includeCandidate: readStringOption(options, "includeCandidate") ?? "false",
  }, false));

  return `${formatEvalHarnessResponse({ task, context })}\n`;
}

export function createCliClient(env: NodeJS.ProcessEnv = process.env): SivrajCliClient {
  return new SivrajCliClient(loadMcpServerConfig(env));
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
