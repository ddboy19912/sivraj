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

type GitHubContentResponse = {
  type?: string;
  path?: string;
  name?: string;
  size?: number;
  content?: string;
  encoding?: string;
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

  for (const path of CANDIDATE_PATHS) {
    if (importedFiles.length >= MAX_IMPORT_FILES) {
      skipped.push({ path, reason: "max_files_reached" });
      continue;
    }

    const file = await fetchOptionalGitHubJson<GitHubContentResponse>(
      fetcher,
      `${GITHUB_API_URL}/repos/${parsed.owner}/${parsed.repo}/contents/${encodeURIComponentPath(path)}?ref=${encodeURIComponent(defaultBranch)}`,
    );

    if (!file) {
      continue;
    }

    if (file.type !== "file" || file.encoding !== "base64" || typeof file.content !== "string") {
      skipped.push({ path, reason: "unsupported_content_response" });
      continue;
    }

    const size = file.size ?? 0;

    if (size > MAX_FILE_BYTES) {
      skipped.push({ path, reason: "file_too_large" });
      continue;
    }

    const content = Buffer.from(file.content.replace(/\s/g, ""), "base64").toString("utf8").trim();

    if (!content) {
      skipped.push({ path, reason: "empty_file" });
      continue;
    }

    const nextSection = `\n\nFile: ${file.path ?? path}\n\n${content}`;

    if ((sections.join("\n").length + nextSection.length) > MAX_BUNDLE_CHARS) {
      skipped.push({ path, reason: "bundle_too_large" });
      break;
    }

    sections.push(nextSection);
    importedFiles.push({
      path: file.path ?? path,
      size,
      source: "contents_api",
    });
  }

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

function encodeURIComponentPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
