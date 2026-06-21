import type {
  AgentClientGrant,
  AgentContextPreset,
  AgentContextScope,
  AgentContextTargetFile,
} from "@/types/agent-context.types";

export type AgentContextPresetOption = {
  id: AgentContextPreset;
  label: string;
  targetFile: AgentContextTargetFile;
  setupLabel: string;
};

export type AgentContextDownload = {
  filename: string;
  content: string;
  contentType: string;
};

const READ_ONLY_AGENT_SCOPES = [
  "agent:context:read",
  "agent:sources:read",
  "agent:project_profile:read",
] as const satisfies readonly AgentContextScope[];

const OPTIONAL_AGENT_SCOPES = {
  memorySearch: "agent:memory:search",
  writeback: "agent:writeback:create",
} as const satisfies Record<string, AgentContextScope>;

export const AGENT_CONTEXT_PRESETS: AgentContextPresetOption[] = [
  {
    id: "codex",
    label: "Codex",
    targetFile: "AGENTS.md",
    setupLabel: "AGENTS.md and MCP config",
  },
  {
    id: "claude_code",
    label: "Claude Code",
    targetFile: "CLAUDE.md",
    setupLabel: "CLAUDE.md and MCP config",
  },
  {
    id: "cursor",
    label: "Cursor",
    targetFile: ".cursor/rules/sivraj.mdc",
    setupLabel: "Cursor rules and MCP config",
  },
  {
    id: "generic_mcp",
    label: "OpenClaw / MCP",
    targetFile: "sivraj-context.json",
    setupLabel: "JSON packet and MCP config",
  },
];

const presetIds = new Set(AGENT_CONTEXT_PRESETS.map((preset) => preset.id));
const AGENT_GRANT_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function resolveAgentContextPreset(value: string): AgentContextPreset {
  return presetIds.has(value as AgentContextPreset)
    ? value as AgentContextPreset
    : "codex";
}

export function targetFileForPreset(preset: AgentContextPreset): AgentContextTargetFile {
  return AGENT_CONTEXT_PRESETS.find((option) => option.id === preset)?.targetFile ?? "AGENTS.md";
}

export function buildAgentTokenScopes(input: {
  memorySearchEnabled: boolean;
  writebackEnabled: boolean;
}): AgentContextScope[] {
  return [
    ...READ_ONLY_AGENT_SCOPES,
    ...(input.memorySearchEnabled ? [OPTIONAL_AGENT_SCOPES.memorySearch] : []),
    ...(input.writebackEnabled ? [OPTIONAL_AGENT_SCOPES.writeback] : []),
  ];
}

export function createAgentContextDownload(input: {
  targetFile: AgentContextTargetFile;
  content: string;
  format: "markdown" | "mdc" | "json";
}): AgentContextDownload {
  return {
    filename: input.targetFile.split("/").at(-1) ?? input.targetFile,
    content: input.content,
    contentType: input.format === "json"
      ? "application/json;charset=utf-8"
      : "text/markdown;charset=utf-8",
  };
}

export function createMcpConfigDownload(input: {
  preset: AgentContextPreset;
  token: string | null;
  twinId: string;
  apiUrl: string;
  includeMemorySearch: boolean;
  includeWriteback: boolean;
}): AgentContextDownload {
  return {
    filename: `${input.preset}-sivraj-mcp.json`,
    content: buildMcpConfig(input),
    contentType: "application/json;charset=utf-8",
  };
}

export function buildMcpConfig(input: {
  preset: AgentContextPreset;
  token: string | null;
  twinId: string;
  apiUrl: string;
  includeMemorySearch: boolean;
  includeWriteback: boolean;
}) {
  const token = input.token ?? "<agent-token>";
  const enabledCapabilities = [
    "engineering_context",
    "engineering_sources",
    "project_profile",
    ...(input.includeMemorySearch ? ["memory_search"] : []),
    ...(input.includeWriteback ? ["agent_writeback"] : []),
  ];

  return JSON.stringify(
    {
      mcpServers: {
        "sivraj-context": {
          command: "pnpm",
          args: ["--filter", "@sivraj/mcp-server", "dev"],
          env: {
            SIVRAJ_API_URL: input.apiUrl,
            SIVRAJ_TWIN_ID: input.twinId,
            SIVRAJ_TOKEN: token,
            SIVRAJ_AGENT_PRESET: input.preset,
            SIVRAJ_INCLUDE_CANDIDATES: "false",
          },
        },
      },
      sivraj: {
        packet: "Sovereign Context Packet V1",
        privacyBoundary: "derived_engineering_context_only",
        enabledCapabilities,
      },
    },
    null,
    2,
  );
}

export function downloadTextFile(download: AgentContextDownload) {
  const blob = new Blob([download.content], { type: download.contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = download.filename;
  link.rel = "noopener noreferrer";
  link.click();
  URL.revokeObjectURL(url);
}

export function formatGrantDate(value: string | null) {
  if (!value) {
    return "No expiry";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown date"
    : AGENT_GRANT_DATE_FORMATTER.format(date);
}

export function describeGrant(grant: AgentClientGrant) {
  const expiry = grant.status === "active"
    ? `expires ${formatGrantDate(grant.expiresAt)}`
    : grant.status;
  return `${grant.scopes.length} scopes, ${expiry}`;
}
