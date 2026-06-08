#!/usr/bin/env node
import "dotenv/config";

import { loadMcpServerConfig } from "@sivraj/config";
import { parseArgs } from "./args.js";
import {
  createCliClient,
  runContextCommand,
  runDemoCommand,
  runEvalCommand,
  runWritebackCommand,
} from "./commands.js";

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

  const client = createCliClient(env);
  const includeCandidatesDefault = loadMcpServerConfig(env).includeCandidates;

  switch (parsed.command) {
    case "context":
      return runContextCommand(client, parsed.options, includeCandidatesDefault);
    case "writeback":
      return runWritebackCommand(client, parsed.options);
    case "demo":
    case "research-demo":
    case "strategy-demo":
      return runDemoCommand(client, parsed.command, parsed.options, includeCandidatesDefault);
    case "eval":
      return runEvalCommand(client, parsed.options);
    default:
      throw new Error(`Unknown command: ${parsed.command}\n\n${USAGE}`);
  }
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
