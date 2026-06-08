import { importGitHubCandidatePath } from "./github-candidate.js";

export type GitHubImporterFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type GitHubImportResult = {
  owner: string;
  repo: string;
  repoUrl: string;
  title: string;
  content: string;
  metadata: {
    importer: "github_public_repo";
    owner: string;
    repo: string;
    repoUrl: string;
    description: string | null;
    defaultBranch: string;
    files: Array<{
      path: string;
      size: number;
      source: "contents_api";
    }>;
    skipped: Array<{
      path: string;
      reason: string;
    }>;
  };
};

type GitHubRepoResponse = {
  full_name?: string;
  html_url?: string;
  description?: string | null;
  default_branch?: string;
};

const GITHUB_API_URL = "https://api.github.com";
const MAX_IMPORT_FILES = 12;
const MAX_FILE_BYTES = 128 * 1024;
const MAX_BUNDLE_CHARS = 500 * 1024;
const CANDIDATE_PATHS = [
  "README.md",
  "README",
  "docs/README.md",
  "docs/index.md",
  "docs/architecture.md",
  "docs/product.md",
  "docs/roadmap.md",
  "package.json",
  "pnpm-workspace.yaml",
  "turbo.json",
  "vite.config.ts",
  "tsconfig.json",
];

export function parseGitHubRepoUrl(repoUrl: string): { owner: string; repo: string; repoUrl: string } | null {
  let url: URL;

  try {
    url = new URL(repoUrl);
  } catch {
    return null;
  }

  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    return null;
  }

  const [owner, repo] = url.pathname
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean);

  if (!owner || !repo) {
    return null;
  }

  return {
    owner,
    repo: repo.replace(/\.git$/, ""),
    repoUrl: `https://github.com/${owner}/${repo.replace(/\.git$/, "")}`,
  };
}

export async function importPublicGitHubRepository(input: {
  repoUrl: string;
  fetch?: GitHubImporterFetch;
}): Promise<GitHubImportResult> {
  const parsed = parseGitHubRepoUrl(input.repoUrl);

  if (!parsed) {
    throw new Error("invalid_github_repo_url");
  }

  const fetcher = input.fetch ?? fetch;
  const repo = await fetchGitHubJson<GitHubRepoResponse>(
    fetcher,
    `${GITHUB_API_URL}/repos/${parsed.owner}/${parsed.repo}`,
  );
  const defaultBranch = repo.default_branch ?? "main";
  const importedFiles: GitHubImportResult["metadata"]["files"] = [];
  const skipped: GitHubImportResult["metadata"]["skipped"] = [];
  const sections: string[] = [
    `GitHub repository: ${repo.full_name ?? `${parsed.owner}/${parsed.repo}`}`,
    `URL: ${repo.html_url ?? parsed.repoUrl}`,
    `Description: ${repo.description ?? "No description"}`,
    `Default branch: ${defaultBranch}`,
  ];

  const collected = await collectGitHubCandidateImports({
    fetcher,
    owner: parsed.owner,
    repo: parsed.repo,
    defaultBranch,
    sections,
    importedFiles,
    skipped,
  });
  sections.push(...collected.sections);
  importedFiles.push(...collected.importedFiles);
  skipped.push(...collected.skipped);

  if (importedFiles.length === 0) {
    throw new Error("github_import_no_supported_files");
  }

  return {
    owner: parsed.owner,
    repo: parsed.repo,
    repoUrl: parsed.repoUrl,
    title: `${parsed.owner}/${parsed.repo}`,
    content: sections.join("\n").trim(),
    metadata: {
      importer: "github_public_repo",
      owner: parsed.owner,
      repo: parsed.repo,
      repoUrl: parsed.repoUrl,
      description: repo.description ?? null,
      defaultBranch,
      files: importedFiles,
      skipped,
    },
  };
}

async function collectGitHubCandidateImports(input: {
  fetcher: GitHubImporterFetch;
  owner: string;
  repo: string;
  defaultBranch: string;
  sections: string[];
  importedFiles: GitHubImportResult["metadata"]["files"];
  skipped: GitHubImportResult["metadata"]["skipped"];
}) {
  const nextSections: string[] = [];
  const nextImportedFiles: GitHubImportResult["metadata"]["files"] = [];
  const nextSkipped: GitHubImportResult["metadata"]["skipped"] = [];

  for (const path of CANDIDATE_PATHS) {
    const result = await importGitHubCandidatePath({
      fetcher: input.fetcher,
      owner: input.owner,
      repo: input.repo,
      defaultBranch: input.defaultBranch,
      path,
      currentBundleLength: input.sections.join("\n").length + nextSections.join("\n").length,
      importedCount: input.importedFiles.length + nextImportedFiles.length,
      maxImportFiles: MAX_IMPORT_FILES,
      maxFileBytes: MAX_FILE_BYTES,
      maxBundleChars: MAX_BUNDLE_CHARS,
      fetchOptionalGitHubJson,
    });

    if (result.kind === "skipped") {
      if (result.reason !== "not_found") {
        nextSkipped.push({ path: result.path, reason: result.reason });
      }

      if (result.reason === "bundle_too_large") {
        break;
      }

      continue;
    }

    nextSections.push(result.section);
    nextImportedFiles.push({
      path: result.path,
      size: result.size,
      source: "contents_api",
    });
  }

  return {
    sections: nextSections,
    importedFiles: nextImportedFiles,
    skipped: nextSkipped,
  };
}

async function fetchGitHubJson<T>(fetcher: GitHubImporterFetch, url: string): Promise<T> {
  const response = await fetcher(url, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "sivraj-github-importer",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("github_repo_not_found");
    }

    if (response.status === 403 || response.status === 429) {
      throw new Error("github_rate_limited");
    }

    throw new Error(`github_fetch_failed_${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function fetchOptionalGitHubJson<T>(fetcher: GitHubImporterFetch, url: string): Promise<T | null> {
  const response = await fetcher(url, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "sivraj-github-importer",
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    if (response.status === 403 || response.status === 429) {
      throw new Error("github_rate_limited");
    }

    throw new Error(`github_fetch_failed_${response.status}`);
  }

  return response.json() as Promise<T>;
}

