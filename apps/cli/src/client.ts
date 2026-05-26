export type JsonObject = Record<string, unknown>;

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
  constructor(private readonly config: SivrajCliConfig) {}

  async getContext(args: ContextRequest): Promise<JsonObject> {
    const params = new URLSearchParams();
    setParam(params, "preset", args.preset);
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
    setParam(params, "maxItemsPerSection", String(args.maxItemsPerSection ?? this.config.maxItemsPerSection));
    setParam(params, "limit", String(args.limit ?? 500));

    return this.request("GET", `/v1/twins/${this.config.twinId}/engineering/context?${params.toString()}`);
  }

  async createWriteback(args: WritebackRequest): Promise<JsonObject> {
    return this.request("POST", `/v1/twins/${this.config.twinId}/agents/writebacks`, args);
  }

  private async request(method: string, path: string, body?: unknown): Promise<JsonObject> {
    const response = await fetch(`${this.config.apiUrl}${path}`, {
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

function setListParam(params: URLSearchParams, key: string, value: string[] | null | undefined): void {
  if (!value || value.length === 0) {
    return;
  }

  const joined = value.map((item) => item.trim()).filter(Boolean).join(",");

  if (joined.length > 0) {
    params.set(key, joined);
  }
}
