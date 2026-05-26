import type { McpConfig } from "./env.js";
import type { AgentWritebackEncryptor } from "./writeback-encryption.js";

export type JsonObject = Record<string, unknown>;

export type EngineeringContextArgs = {
  projectName?: string;
  projectId?: string;
  repoName?: string;
  packageName?: string;
  gitRemote?: string;
  packageManager?: string;
  frameworks?: string[] | string;
  lockfiles?: string[] | string;
  rootMarkers?: string[] | string;
  artifactId?: string;
  includeCandidate?: boolean;
  includeSuperseded?: boolean;
  includeTemporary?: boolean;
  preset?: "codex" | "claude_code" | "cursor" | "generic_mcp";
  maxItemsPerSection?: number;
  limit?: number;
};

export type SearchMemoryArgs = {
  query: string;
  limit?: number;
};

export type AgentWritebackArgs = {
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

export class SivrajApiClient {
  constructor(
    private readonly config: McpConfig,
    private readonly writebackEncryptor: AgentWritebackEncryptor | null = null,
  ) {}

  async getEngineeringContext(args: EngineeringContextArgs = {}): Promise<JsonObject> {
    const params = new URLSearchParams();
    setParam(params, "projectName", args.projectName ?? this.config.projectName);
    setParam(params, "projectId", args.projectId ?? this.config.projectId);
    setParam(params, "repoName", args.repoName);
    setParam(params, "packageName", args.packageName);
    setParam(params, "gitRemote", args.gitRemote);
    setParam(params, "packageManager", args.packageManager);
    setListParam(params, "frameworks", args.frameworks);
    setListParam(params, "lockfiles", args.lockfiles);
    setListParam(params, "rootMarkers", args.rootMarkers);
    setParam(params, "artifactId", args.artifactId);
    setParam(params, "includeCandidate", String(args.includeCandidate ?? this.config.includeCandidates));
    setParam(params, "includeSuperseded", String(args.includeSuperseded ?? false));
    setParam(params, "includeTemporary", String(args.includeTemporary ?? false));
    setParam(params, "preset", args.preset);
    setParam(params, "maxItemsPerSection", String(args.maxItemsPerSection ?? this.config.maxItemsPerSection));
    setParam(params, "limit", String(args.limit ?? 500));

    return this.request("GET", `/v1/twins/${this.config.twinId}/engineering/context?${params.toString()}`);
  }

  async listEngineeringSources(limit = 50): Promise<JsonObject> {
    const params = new URLSearchParams({ limit: String(limit) });

    return this.request("GET", `/v1/twins/${this.config.twinId}/engineering/sources?${params.toString()}`);
  }

  async listAgentWritebacks(limit = 25): Promise<JsonObject> {
    const params = new URLSearchParams({ limit: String(limit) });

    return this.request("GET", `/v1/twins/${this.config.twinId}/agents/writebacks?${params.toString()}`);
  }

  async searchMemory(args: SearchMemoryArgs): Promise<JsonObject> {
    return this.request("POST", `/v1/twins/${this.config.twinId}/memories/search`, args);
  }

  async getProjectProfile(args: EngineeringContextArgs = {}): Promise<JsonObject> {
    const response = await this.getEngineeringContext(args);

    return {
      policy: response["policy"],
      relationship: response["relationship"],
      profileSummary: response["profileSummary"],
      contextPacket: response["contextPacket"],
    };
  }

  async recordAgentWriteback(args: AgentWritebackArgs): Promise<JsonObject> {
    const body = this.config.writebackEncryption === "client"
      ? await this.encryptWriteback(args)
      : {
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

    return this.request("POST", `/v1/twins/${this.config.twinId}/agents/writebacks`, body);
  }

  private async encryptWriteback(args: AgentWritebackArgs): Promise<JsonObject> {
    if (!this.writebackEncryptor) {
      throw new Error("SIVRAJ_WRITEBACK_ENCRYPTION=client requires a configured writeback encryptor.");
    }

    return this.writebackEncryptor.encryptWriteback(args);
  }

  private async request(method: string, path: string, body?: unknown): Promise<JsonObject> {
    const url = `${this.config.apiUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const detail = payload && typeof payload === "object" ? JSON.stringify(payload) : response.statusText;
      throw new Error(`Sivraj API request failed: ${response.status} ${detail}`);
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Sivraj API returned a non-object JSON response.");
    }

    return payload as JsonObject;
  }
}

function setParam(params: URLSearchParams, key: string, value: string | null | undefined): void {
  if (value && value.trim().length > 0) {
    params.set(key, value);
  }
}

function setListParam(params: URLSearchParams, key: string, value: string[] | string | null | undefined): void {
  if (Array.isArray(value)) {
    const joined = value.map((item) => item.trim()).filter(Boolean).join(",");

    if (joined.length > 0) {
      params.set(key, joined);
    }

    return;
  }

  setParam(params, key, value);
}
