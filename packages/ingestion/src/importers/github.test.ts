import { describe, expect, it } from "vitest";
import { importPublicGitHubRepository, parseGitHubRepoUrl, type GitHubImporterFetch } from "./github.js";

describe("parseGitHubRepoUrl", () => {
  it("parses GitHub repository URLs", () => {
    expect(parseGitHubRepoUrl("https://github.com/sivraj/app")).toEqual({
      owner: "sivraj",
      repo: "app",
      repoUrl: "https://github.com/sivraj/app",
    });
  });

  it("rejects non-GitHub URLs", () => {
    expect(parseGitHubRepoUrl("https://example.com/sivraj/app")).toBeNull();
  });
});

describe("importPublicGitHubRepository", () => {
  it("builds a source-faithful text bundle from public repo responses", async () => {
    const fetcher = createGitHubFetch({
      "https://api.github.com/repos/sivraj/app": {
        full_name: "sivraj/app",
        html_url: "https://github.com/sivraj/app",
        description: "Persistent intelligence",
        default_branch: "main",
      },
      "https://api.github.com/repos/sivraj/app/contents/README.md?ref=main": contentFile(
        "README.md",
        "# Sivraj\n\nYour memory.",
      ),
      "https://api.github.com/repos/sivraj/app/contents/package.json?ref=main": contentFile(
        "package.json",
        '{"name":"sivraj"}',
      ),
    });

    const result = await importPublicGitHubRepository({
      repoUrl: "https://github.com/sivraj/app",
      fetch: fetcher,
    });

    expect(result.title).toBe("sivraj/app");
    expect(result.content).toContain("GitHub repository: sivraj/app");
    expect(result.content).toContain("File: README.md");
    expect(result.content).toContain("# Sivraj");
    expect(result.content).toContain("File: package.json");
    expect(result.metadata.files).toEqual([
      { path: "README.md", size: 22, source: "contents_api" },
      { path: "package.json", size: 17, source: "contents_api" },
    ]);
  });

  it("rejects repositories with no supported files", async () => {
    const fetcher = createGitHubFetch({
      "https://api.github.com/repos/sivraj/empty": {
        full_name: "sivraj/empty",
        html_url: "https://github.com/sivraj/empty",
        description: null,
        default_branch: "main",
      },
    });

    await expect(importPublicGitHubRepository({
      repoUrl: "https://github.com/sivraj/empty",
      fetch: fetcher,
    })).rejects.toThrow("github_import_no_supported_files");
  });
});

function contentFile(path: string, content: string) {
  return {
    type: "file",
    path,
    size: content.length,
    encoding: "base64",
    content: Buffer.from(content).toString("base64"),
  };
}

function createGitHubFetch(responses: Record<string, unknown>): GitHubImporterFetch {
  return async (input) => {
    const response = responses[input];

    if (!response) {
      return jsonResponse({ error: "not found" }, 404);
    }

    return jsonResponse(response, 200);
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}
