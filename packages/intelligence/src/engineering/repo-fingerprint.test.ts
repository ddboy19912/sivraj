import { describe, expect, it } from "vitest";
import { normalizeRepoFingerprint } from "./repo-fingerprint.js";

describe("normalizeRepoFingerprint", () => {
  it("normalizes repo fingerprint fields", () => {
    expect(normalizeRepoFingerprint({
      projectName: " Sivraj ",
      gitRemote: "https://github.com/org/repo.git",
      packageManager: "PNPM",
      frameworks: [" React ", "", "vite"],
    })).toEqual({
      projectId: null,
      projectName: "Sivraj",
      repoName: null,
      packageName: null,
      gitRemote: "https://github.com/org/repo",
      packageManager: "pnpm",
      frameworks: ["React", "vite"],
      lockfiles: [],
      rootMarkers: [],
    });
  });

  it("returns empty defaults for missing input", () => {
    expect(normalizeRepoFingerprint(null)).toEqual({
      projectId: null,
      projectName: null,
      repoName: null,
      packageName: null,
      gitRemote: null,
      packageManager: null,
      frameworks: [],
      lockfiles: [],
      rootMarkers: [],
    });
  });
});
