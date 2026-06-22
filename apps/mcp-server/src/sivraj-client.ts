import {
  buildAgentWritebackRequestBody,
  buildEngineeringContextParams,
  createSivrajRequester,
  setSearchParam,
  type EngineeringContextQueryArgs,
  type JsonObject,
} from "@sivraj/core";
import type { McpConfig } from "./env.js";
import type { AgentWritebackEncryptor } from "./writeback-encryption.js";

export type { JsonObject };

export type EngineeringContextArgs = EngineeringContextQueryArgs & {
  preset?: "codex" | "claude_code" | "cursor" | "generic_mcp";
};

export type SearchMemoryArgs = {
  query: string;
  limit?: number;
};

export type ContextWarmupArgs = {
  reason: "app_boot" | "voice_start" | "mcp_connect" | "artifact_processed" | "connector_sync_completed" | "manual";
  surface?: "mcp" | "cli";
  scope?: string;
  projectFingerprint?: JsonObject;
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
  private readonly request: ReturnType<typeof createSivrajRequester>;

  constructor(
    private readonly config: McpConfig,
    private readonly writebackEncryptor: AgentWritebackEncryptor | null = null,
  ) {
    this.request = createSivrajRequester({
      apiUrl: config.apiUrl,
      token: config.token,
    });
  }

  async getEngineeringContext(args: EngineeringContextArgs = {}): Promise<JsonObject> {
    const preset = args.preset ?? this.config.agentPreset;
    const params = buildEngineeringContextParams(args, {
      projectName: this.config.projectName,
      projectId: this.config.projectId,
      includeCandidates: this.config.includeCandidates,
      maxItemsPerSection: this.config.maxItemsPerSection,
    });
    setSearchParam(params, "preset", preset);

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

  async warmContext(args: ContextWarmupArgs): Promise<JsonObject> {
    return this.request("POST", `/v1/twins/${this.config.twinId}/context/warmup`, {
      surface: args.surface ?? "mcp",
      reason: args.reason,
      scope: args.scope,
      projectFingerprint: args.projectFingerprint,
    });
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
      : buildAgentWritebackRequestBody(args);

    return this.request("POST", `/v1/twins/${this.config.twinId}/agents/writebacks`, body);
  }

  private async encryptWriteback(args: AgentWritebackArgs): Promise<JsonObject> {
    if (!this.writebackEncryptor) {
      throw new Error("SIVRAJ_WRITEBACK_ENCRYPTION=client requires a configured writeback encryptor.");
    }

    return this.writebackEncryptor.encryptWriteback(args);
  }

}
