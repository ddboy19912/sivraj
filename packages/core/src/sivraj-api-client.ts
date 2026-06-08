export type JsonObject = Record<string, unknown>;

export function setSearchParam(
  params: URLSearchParams,
  key: string,
  value: string | null | undefined,
): void {
  if (value && value.trim().length > 0) {
    params.set(key, value);
  }
}

export function setSearchListParam(
  params: URLSearchParams,
  key: string,
  value: string[] | string | null | undefined,
): void {
  if (Array.isArray(value)) {
    const joined = value.map((item) => item.trim()).filter(Boolean).join(",");

    if (joined.length > 0) {
      params.set(key, joined);
    }

    return;
  }

  setSearchParam(params, key, value);
}

export function createSivrajRequester(config: { apiUrl: string; token: string }) {
  return (method: string, path: string, body?: unknown) =>
    requestSivrajJson(config, method, path, body);
}

export async function requestSivrajJson(
  config: { apiUrl: string; token: string },
  method: string,
  path: string,
  body?: unknown,
): Promise<JsonObject> {
  const response = await fetch(`${config.apiUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.token}`,
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

export type EngineeringContextQueryArgs = {
  preset?: string;
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
  maxItemsPerSection?: number;
  limit?: number;
};

export type EngineeringContextDefaults = {
  projectName?: string;
  projectId?: string;
  includeCandidates: boolean;
  maxItemsPerSection: number;
};

export function buildEngineeringContextParams(
  args: EngineeringContextQueryArgs,
  defaults: EngineeringContextDefaults,
): URLSearchParams {
  const params = new URLSearchParams();
  setSearchParam(params, "preset", args.preset);
  setSearchParam(params, "projectName", args.projectName ?? defaults.projectName);
  setSearchParam(params, "projectId", args.projectId ?? defaults.projectId);
  setSearchParam(params, "repoName", args.repoName);
  setSearchParam(params, "packageName", args.packageName);
  setSearchParam(params, "gitRemote", args.gitRemote);
  setSearchParam(params, "packageManager", args.packageManager);
  setSearchListParam(params, "frameworks", args.frameworks);
  setSearchListParam(params, "lockfiles", args.lockfiles);
  setSearchListParam(params, "rootMarkers", args.rootMarkers);
  setSearchParam(params, "artifactId", args.artifactId);
  setSearchParam(params, "includeCandidate", String(args.includeCandidate ?? defaults.includeCandidates));
  setSearchParam(params, "includeSuperseded", String(args.includeSuperseded ?? false));
  setSearchParam(params, "includeTemporary", String(args.includeTemporary ?? false));
  setSearchParam(params, "maxItemsPerSection", String(args.maxItemsPerSection ?? defaults.maxItemsPerSection));
  setSearchParam(params, "limit", String(args.limit ?? 500));
  return params;
}
