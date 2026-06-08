export type AgentWritebackRequest = {
  agentName?: string;
  repo?: string;
  branch?: string;
  taskSummary: string;
  filesTouched?: string[];
  commandsRun?: string[];
  testsRun?: string[];
  decisions?: string[];
  bugsFound?: string[];
  followUps?: string[];
  userCorrections?: string[];
};

export function buildAgentWritebackRequestBody(args: AgentWritebackRequest) {
  return {
    agentName: args.agentName,
    repo: args.repo,
    branch: args.branch,
    taskSummary: args.taskSummary,
    filesTouched: args.filesTouched,
    commandsRun: args.commandsRun,
    testsRun: args.testsRun,
    decisions: args.decisions,
    bugsFound: args.bugsFound,
    followUps: args.followUps,
    userCorrections: args.userCorrections,
  };
}

export type AgentWritebackFields = {
  agentName: string;
  repo?: string;
  branch?: string;
  taskSummary: string;
  filesTouched: string[];
  commandsRun: string[];
  testsRun: string[];
  decisions: string[];
  bugsFound: string[];
  followUps: string[];
  userCorrections: string[];
};

export type PrOrCommitImportWritebackFields = {
  kind: "pull_request" | "commit";
  agentName: string;
  repo?: string;
  identifier?: string;
  title: string;
  url?: string;
  author?: string;
  mergedAt?: string;
  committedAt?: string;
  summary: string;
  filesChanged: string[];
  commandsRun: string[];
  testsRun: string[];
  decisions: string[];
  bugsFixed: string[];
  reviewComments: string[];
  userCorrections: string[];
};

export function formatAgentWriteback(input: AgentWritebackFields): string {
  const lines = [
    "# Coding Agent Writeback",
    "",
    `Agent: ${input.agentName}`,
    `Repo: ${input.repo?.trim() || "unknown"}`,
    `Branch: ${input.branch?.trim() || "unknown"}`,
    "",
    "## Task Summary",
    input.taskSummary,
  ];

  pushMarkdownListSection(lines, "Files Touched", input.filesTouched);
  pushMarkdownListSection(lines, "Commands Run", input.commandsRun);
  pushMarkdownListSection(lines, "Tests Run", input.testsRun);
  pushMarkdownListSection(lines, "Decisions", input.decisions);
  pushMarkdownListSection(lines, "Bugs Found", input.bugsFound);
  pushMarkdownListSection(lines, "Follow Ups", input.followUps);
  pushMarkdownListSection(lines, "User Corrections", input.userCorrections);

  return `${lines.join("\n")}\n`;
}

export function formatPrOrCommitImportWriteback(
  input: PrOrCommitImportWritebackFields,
): string {
  const heading = input.kind === "pull_request"
    ? "Pull Request Writeback Import"
    : "Commit Writeback Import";
  const lines = [
    `# ${heading}`,
    "",
    `Agent: ${input.agentName}`,
    `Repo: ${input.repo?.trim() || "unknown"}`,
    `Identifier: ${input.identifier?.trim() || "unknown"}`,
    `Title: ${input.title}`,
    `URL: ${input.url?.trim() || "unknown"}`,
    `Author: ${input.author?.trim() || "unknown"}`,
  ];

  if (input.kind === "pull_request") {
    lines.push(`Merged At: ${input.mergedAt?.trim() || "unknown"}`);
  } else {
    lines.push(`Committed At: ${input.committedAt?.trim() || "unknown"}`);
  }

  lines.push("", "## Summary", input.summary);
  pushMarkdownListSection(lines, "Files Changed", input.filesChanged);
  pushMarkdownListSection(lines, "Commands Run", input.commandsRun);
  pushMarkdownListSection(lines, "Tests Run", input.testsRun);
  pushMarkdownListSection(lines, "Decisions", input.decisions);
  pushMarkdownListSection(lines, "Bugs Found", input.bugsFixed);
  pushMarkdownListSection(lines, "Review Comments", input.reviewComments);
  pushMarkdownListSection(lines, "User Corrections", input.userCorrections);

  return `${lines.join("\n")}\n`;
}

function pushMarkdownListSection(
  lines: string[],
  heading: string,
  values: string[],
): void {
  if (values.length === 0) {
    return;
  }

  lines.push("", `## ${heading}`);
  for (const value of values) {
    lines.push(`- ${value}`);
  }
}
