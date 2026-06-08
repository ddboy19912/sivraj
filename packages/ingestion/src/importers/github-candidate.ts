import type { GitHubImporterFetch } from "./github.js";

type GitHubContentResponse = {
  type?: string;
  path?: string;
  size?: number;
  content?: string;
  encoding?: string;
};

export type GitHubCandidateImportResult =
  | {
      kind: "imported";
      path: string;
      size: number;
      section: string;
    }
  | {
      kind: "skipped";
      path: string;
      reason: string;
    };

export async function importGitHubCandidatePath(input: {
  fetcher: GitHubImporterFetch;
  owner: string;
  repo: string;
  defaultBranch: string;
  path: string;
  currentBundleLength: number;
  importedCount: number;
  maxImportFiles: number;
  maxFileBytes: number;
  maxBundleChars: number;
  fetchOptionalGitHubJson: <T>(fetcher: GitHubImporterFetch, url: string) => Promise<T | null>;
}): Promise<GitHubCandidateImportResult> {
  if (input.importedCount >= input.maxImportFiles) {
    return { kind: "skipped", path: input.path, reason: "max_files_reached" };
  }

  const file = await input.fetchOptionalGitHubJson<GitHubContentResponse>(
    input.fetcher,
    `https://api.github.com/repos/${input.owner}/${input.repo}/contents/${encodeURIComponentPath(input.path)}?ref=${encodeURIComponent(input.defaultBranch)}`,
  );

  if (!file) {
    return { kind: "skipped", path: input.path, reason: "not_found" };
  }

  if (file.type !== "file" || file.encoding !== "base64" || typeof file.content !== "string") {
    return { kind: "skipped", path: input.path, reason: "unsupported_content_response" };
  }

  const size = file.size ?? 0;

  if (size > input.maxFileBytes) {
    return { kind: "skipped", path: input.path, reason: "file_too_large" };
  }

  const content = Buffer.from(file.content.replace(/\s/g, ""), "base64").toString("utf8").trim();

  if (!content) {
    return { kind: "skipped", path: input.path, reason: "empty_file" };
  }

  const nextSection = `\n\nFile: ${file.path ?? input.path}\n\n${content}`;

  if ((input.currentBundleLength + nextSection.length) > input.maxBundleChars) {
    return { kind: "skipped", path: input.path, reason: "bundle_too_large" };
  }

  return {
    kind: "imported",
    path: file.path ?? input.path,
    size,
    section: nextSection,
  };
}

function encodeURIComponentPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
