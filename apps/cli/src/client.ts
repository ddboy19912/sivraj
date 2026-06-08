import {
  buildEngineeringContextParams,
  createSivrajRequester,
  type JsonObject,
} from "@sivraj/core";

export type { JsonObject };

export type SivrajCliConfig = {
  apiUrl: string;
  twinId: string;
  token: string;
  projectName?: string;
  projectId?: string;
  includeCandidates: boolean;
  maxItemsPerSection: number;
};

export type ContextRequest = {
  preset?: string;
  projectName?: string;
  projectId?: string;
  repoName?: string;
  packageName?: string;
  gitRemote?: string;
  packageManager?: string;
  frameworks?: string[];
  lockfiles?: string[];
  rootMarkers?: string[];
  artifactId?: string;
  includeCandidate?: boolean;
  includeSuperseded?: boolean;
  includeTemporary?: boolean;
  maxItemsPerSection?: number;
  limit?: number;
};

export type WritebackRequest = {
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

export class SivrajCliClient {
  private readonly request: ReturnType<typeof createSivrajRequester>;

  constructor(private readonly config: SivrajCliConfig) {
    this.request = createSivrajRequester({
      apiUrl: config.apiUrl,
      token: config.token,
    });
  }

  async getContext(args: ContextRequest): Promise<JsonObject> {
    const params = buildEngineeringContextParams(args, {
      projectName: this.config.projectName,
      projectId: this.config.projectId,
      includeCandidates: this.config.includeCandidates,
      maxItemsPerSection: this.config.maxItemsPerSection,
    });

    return this.request("GET", `/v1/twins/${this.config.twinId}/engineering/context?${params.toString()}`);
  }

  async createWriteback(args: WritebackRequest): Promise<JsonObject> {
    return this.request("POST", `/v1/twins/${this.config.twinId}/agents/writebacks`, args);
  }

}
