import type {
  AgentClientGrant,
  AgentContextPreset,
  AgentContextScope,
  AgentContextTargetFile,
  AgentMcpClient,
  AgentMcpTransport,
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

export type AgentMcpClientOption = {
  id: AgentMcpClient;
  label: string;
  detail: string;
};

export type AgentMcpTransportOption = {
  id: AgentMcpTransport;
  label: string;
  detail: string;
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

export const AGENT_MCP_CLIENTS: AgentMcpClientOption[] = [
  {
    id: "generic_json",
    label: "Generic MCP JSON",
    detail: "mcpServers JSON for most MCP clients",
  },
  {
    id: "codex",
    label: "Codex",
    detail: "config.toml",
  },
  {
    id: "claude_code",
    label: "Claude Code",
    detail: "claude mcp add",
  },
  {
    id: "vscode",
    label: "VS Code",
    detail: ".vscode/mcp.json",
  },
  {
    id: "cursor",
    label: "Cursor",
    detail: "mcp.json",
  },
  {
    id: "windsurf",
    label: "Windsurf / Cascade",
    detail: "~/.codeium/windsurf/mcp_config.json",
  },
  {
    id: "cline",
    label: "Cline",
    detail: "cline_mcp_settings.json",
  },
];

export const AGENT_MCP_TRANSPORTS: AgentMcpTransportOption[] = [
  {
    id: "stdio",
    label: "Local stdio",
    detail: "Runs @sivraj/mcp-server from this repo",
  },
  {
    id: "http",
    label: "Remote HTTP",
    detail: "For hosted streamable HTTP MCP servers",
  },
];

const presetIds = new Set(AGENT_CONTEXT_PRESETS.map((preset) => preset.id));
const mcpClientIds = new Set(AGENT_MCP_CLIENTS.map((client) => client.id));
const mcpTransportIds = new Set(
  AGENT_MCP_TRANSPORTS.map((transport) => transport.id),
);
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

export function resolveAgentMcpClient(value: string): AgentMcpClient {
  return mcpClientIds.has(value as AgentMcpClient)
    ? value as AgentMcpClient
    : "generic_json";
}

export function resolveAgentMcpTransport(value: string): AgentMcpTransport {
  return mcpTransportIds.has(value as AgentMcpTransport)
    ? value as AgentMcpTransport
    : "stdio";
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
  client?: AgentMcpClient;
  transport?: AgentMcpTransport;
  token: string | null;
  twinId: string;
  apiUrl: string;
  includeMemorySearch: boolean;
  includeWriteback: boolean;
}): AgentContextDownload {
  const client = input.client ?? "generic_json";
  const transport = input.transport ?? "stdio";

  return {
    filename: mcpConfigFilename({ client, transport }),
    content: buildMcpConfig({ ...input, client, transport }),
    contentType: client === "codex"
      ? "text/plain;charset=utf-8"
      : client === "claude_code"
        ? "text/x-shellscript;charset=utf-8"
        : "application/json;charset=utf-8",
  };
}

export function buildMcpConfig(input: {
  preset: AgentContextPreset;
  client?: AgentMcpClient;
  transport?: AgentMcpTransport;
  token: string | null;
  twinId: string;
  apiUrl: string;
  includeMemorySearch: boolean;
  includeWriteback: boolean;
}) {
  const client = input.client ?? "generic_json";
  const transport = input.transport ?? "stdio";
  const token = input.token ?? "<agent-token>";
  const serverName = "sivraj-context";
  const httpUrl = `${input.apiUrl.replace(/\/$/u, "")}/mcp`;
  const enabledCapabilities = [
    "engineering_context",
    "engineering_sources",
    "project_profile",
    ...(input.includeMemorySearch ? ["memory_search"] : []),
    ...(input.includeWriteback ? ["agent_writeback"] : []),
  ];

  if (client === "codex") {
    return transport === "http"
      ? [
          `[mcp_servers.${tomlKey(serverName)}]`,
          `url = "${httpUrl}"`,
          `bearer_token_env_var = "SIVRAJ_TOKEN"`,
          `startup_timeout_sec = 10`,
          `tool_timeout_sec = 60`,
          `enabled = true`,
          "",
          `# Export SIVRAJ_TOKEN=${token} before running Codex.`,
        ].join("\n")
      : [
          `[mcp_servers.${tomlKey(serverName)}]`,
          `command = "pnpm"`,
          `args = ["--filter", "@sivraj/mcp-server", "dev"]`,
          `startup_timeout_sec = 10`,
          `tool_timeout_sec = 60`,
          `enabled = true`,
          "",
          `[mcp_servers.${tomlKey(serverName)}.env]`,
          `SIVRAJ_API_URL = "${input.apiUrl}"`,
          `SIVRAJ_TWIN_ID = "${input.twinId}"`,
          `SIVRAJ_TOKEN = "${token}"`,
          `SIVRAJ_AGENT_PRESET = "${input.preset}"`,
          `SIVRAJ_INCLUDE_CANDIDATES = "false"`,
        ].join("\n");
  }

  if (client === "claude_code") {
    return transport === "http"
      ? [
          `claude mcp add --transport http ${serverName} ${httpUrl} \\`,
          `  --header "Authorization: Bearer ${token}"`,
        ].join("\n")
      : [
          `claude mcp add --transport stdio ${serverName} --scope local \\`,
          `  --env SIVRAJ_API_URL=${shellQuote(input.apiUrl)} \\`,
          `  --env SIVRAJ_TWIN_ID=${shellQuote(input.twinId)} \\`,
          `  --env SIVRAJ_TOKEN=${shellQuote(token)} \\`,
          `  --env SIVRAJ_AGENT_PRESET=${shellQuote(input.preset)} \\`,
          `  --env SIVRAJ_INCLUDE_CANDIDATES=false \\`,
          `  -- pnpm --filter @sivraj/mcp-server dev`,
        ].join("\n");
  }

  if (client === "vscode") {
    return JSON.stringify(
      {
        servers: {
          [serverName]: createMcpServerDefinition({
            apiUrl: input.apiUrl,
            preset: input.preset,
            token,
            transport,
            twinId: input.twinId,
          }),
        },
      },
      null,
      2,
    );
  }

  if (client === "cline") {
    return JSON.stringify(
      {
        mcpServers: {
          [serverName]: {
            ...createMcpServerDefinition({
              apiUrl: input.apiUrl,
              preset: input.preset,
              token,
              transport,
              twinId: input.twinId,
            }),
            disabled: false,
            autoApprove: [],
          },
        },
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    {
      mcpServers: {
        [serverName]: createMcpServerDefinition({
          apiUrl: input.apiUrl,
          preset: input.preset,
          token,
          transport,
          twinId: input.twinId,
        }),
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

function createMcpServerDefinition(input: {
  apiUrl: string;
  preset: AgentContextPreset;
  token: string;
  transport: AgentMcpTransport;
  twinId: string;
}) {
  const httpUrl = `${input.apiUrl.replace(/\/$/u, "")}/mcp`;

  return input.transport === "http"
    ? {
        type: "http",
        url: httpUrl,
        headers: {
          Authorization: `Bearer ${input.token}`,
        },
      }
    : {
        command: "pnpm",
        args: ["--filter", "@sivraj/mcp-server", "dev"],
        env: {
          SIVRAJ_API_URL: input.apiUrl,
          SIVRAJ_TWIN_ID: input.twinId,
          SIVRAJ_TOKEN: input.token,
          SIVRAJ_AGENT_PRESET: input.preset,
          SIVRAJ_INCLUDE_CANDIDATES: "false",
        },
      };
}

function mcpConfigFilename({
  client,
  transport,
}: {
  client: AgentMcpClient;
  transport: AgentMcpTransport;
}) {
  if (client === "codex") {
    return `codex-sivraj-${transport}.toml`;
  }

  if (client === "claude_code") {
    return `claude-code-sivraj-${transport}.sh`;
  }

  if (client === "vscode") {
    return `vscode-sivraj-mcp-${transport}.json`;
  }

  if (client === "windsurf") {
    return `windsurf-sivraj-mcp-${transport}.json`;
  }

  if (client === "cline") {
    return `cline-sivraj-mcp-${transport}.json`;
  }

  if (client === "cursor") {
    return `cursor-sivraj-mcp-${transport}.json`;
  }

  return `sivraj-mcp-${transport}.json`;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function tomlKey(value: string) {
  return value.replaceAll("-", "_");
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
