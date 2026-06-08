import { parseGitHubRepoUrl } from "@sivraj/ingestion";
import type { ConnectorSource } from "../types/connector.types.js";

export function readGitHubRepoUrl(source: ConnectorSource): string {
  const repoUrl = source.uri ?? source.externalSourceId;

  if (!parseGitHubRepoUrl(repoUrl)) {
    throw new Error("invalid_github_repo_url");
  }

  return repoUrl;
}
