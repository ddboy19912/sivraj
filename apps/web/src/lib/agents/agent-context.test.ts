import { describe, expect, it, vi } from "vitest";
import {
  buildAgentTokenScopes,
  buildMcpConfig,
  createAgentContextDownload,
  createMcpConfigDownload,
  downloadTextFile,
  resolveAgentContextPreset,
  targetFileForPreset,
} from "@/lib/agents/agent-context";

describe("agent context helpers", () => {
  it("resolves presets and target files", () => {
    expect(resolveAgentContextPreset("cursor")).toBe("cursor");
    expect(resolveAgentContextPreset("unknown")).toBe("codex");
    expect(targetFileForPreset("codex")).toBe("AGENTS.md");
    expect(targetFileForPreset("claude_code")).toBe("CLAUDE.md");
    expect(targetFileForPreset("cursor")).toBe(".cursor/rules/sivraj.mdc");
    expect(targetFileForPreset("generic_mcp")).toBe("sivraj-context.json");
  });

  it("keeps agent token scopes read-only by default", () => {
    expect(buildAgentTokenScopes({
      memorySearchEnabled: false,
      writebackEnabled: false,
    })).toEqual([
      "agent:context:read",
      "agent:sources:read",
      "agent:project_profile:read",
    ]);
  });

  it("adds sensitive scopes only when explicit toggles are enabled", () => {
    expect(buildAgentTokenScopes({
      memorySearchEnabled: true,
      writebackEnabled: true,
    })).toEqual([
      "agent:context:read",
      "agent:sources:read",
      "agent:project_profile:read",
      "agent:memory:search",
      "agent:writeback:create",
    ]);
  });

  it("builds MCP config with token placeholder and selected capabilities", () => {
    const config = JSON.parse(buildMcpConfig({
      preset: "codex",
      token: null,
      twinId: "twin-id",
      apiUrl: "http://127.0.0.1:3000",
      includeMemorySearch: false,
      includeWriteback: false,
    }));

    expect(config.mcpServers["sivraj-context"].env).toMatchObject({
      SIVRAJ_TWIN_ID: "twin-id",
      SIVRAJ_TOKEN: "<agent-token>",
      SIVRAJ_AGENT_PRESET: "codex",
    });
    expect(config.sivraj.enabledCapabilities).toEqual([
      "engineering_context",
      "engineering_sources",
      "project_profile",
    ]);
  });

  it("builds downloads for packet and MCP config", () => {
    expect(createAgentContextDownload({
      targetFile: ".cursor/rules/sivraj.mdc",
      content: "rules",
      format: "mdc",
    })).toMatchObject({
      filename: "sivraj.mdc",
      contentType: "text/markdown;charset=utf-8",
    });

    expect(createMcpConfigDownload({
      preset: "generic_mcp",
      token: "agent-token",
      twinId: "twin-id",
      apiUrl: "http://127.0.0.1:3000",
      includeMemorySearch: true,
      includeWriteback: false,
    }).filename).toBe("sivraj-mcp-stdio.json");
  });

  it("builds client-specific MCP install artifacts", () => {
    const codexConfig = createMcpConfigDownload({
      preset: "codex",
      client: "codex",
      transport: "stdio",
      token: "agent-token",
      twinId: "twin-id",
      apiUrl: "http://127.0.0.1:3000",
      includeMemorySearch: false,
      includeWriteback: false,
    });
    expect(codexConfig.filename).toBe("codex-sivraj-stdio.toml");
    expect(codexConfig.content).toContain("[mcp_servers.sivraj_context]");
    expect(codexConfig.content).toContain('SIVRAJ_AGENT_PRESET = "codex"');

    const claudeConfig = createMcpConfigDownload({
      preset: "claude_code",
      client: "claude_code",
      transport: "stdio",
      token: "agent-token",
      twinId: "twin-id",
      apiUrl: "http://127.0.0.1:3000",
      includeMemorySearch: false,
      includeWriteback: false,
    });
    expect(claudeConfig.filename).toBe("claude-code-sivraj-stdio.sh");
    expect(claudeConfig.content).toContain("claude mcp add --transport stdio");
  });

  it("downloads text files through object URLs", () => {
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const click = vi.fn();

    URL.createObjectURL = vi.fn(() => "blob:agent-context");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(document, "createElement").mockReturnValue({
      click,
      rel: "",
      download: "",
      href: "",
    } as unknown as HTMLAnchorElement);

    downloadTextFile({
      filename: "AGENTS.md",
      content: "packet",
      contentType: "text/markdown;charset=utf-8",
    });

    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:agent-context");
    expect(click).toHaveBeenCalledOnce();

    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
    vi.restoreAllMocks();
  });

});
