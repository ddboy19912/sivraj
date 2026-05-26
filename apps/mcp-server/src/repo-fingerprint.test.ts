import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { detectLocalRepoFingerprint, mergeRepoFingerprint } from "./repo-fingerprint.js";

test("detects package manager, package name, frameworks, and instruction markers", () => {
  const root = mkdtempSync(join(tmpdir(), "sivraj-mcp-repo-"));
  writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFileSync(join(root, "AGENTS.md"), "# Agent rules\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "@acme/app",
    dependencies: {
      react: "^19.0.0",
    },
    devDependencies: {
      vite: "^7.0.0",
    },
  }));

  const fingerprint = detectLocalRepoFingerprint(root);

  assert.equal(fingerprint.packageName, "@acme/app");
  assert.equal(fingerprint.packageManager, "pnpm");
  assert.deepEqual(fingerprint.frameworks, ["vite", "react"]);
  assert.deepEqual(fingerprint.lockfiles, ["pnpm-lock.yaml"]);
  assert.deepEqual(fingerprint.rootMarkers, ["AGENTS.md"]);
});

test("walks up from nested directories and lets explicit args override detected values", () => {
  const root = mkdtempSync(join(tmpdir(), "sivraj-mcp-nested-"));
  const nested = join(root, "apps", "web");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "detected-app" }));
  writeFileSync(join(root, "package-lock.json"), "{}\n");

  const detected = detectLocalRepoFingerprint(nested);
  const merged = mergeRepoFingerprint(detected, {
    packageName: "explicit-app",
    frameworks: ["next.js"],
  });

  assert.equal(detected.packageName, "detected-app");
  assert.equal(detected.packageManager, "npm");
  assert.equal(merged.packageName, "explicit-app");
  assert.deepEqual(merged.frameworks, ["next.js"]);
  assert.equal(merged.packageManager, "npm");
});
