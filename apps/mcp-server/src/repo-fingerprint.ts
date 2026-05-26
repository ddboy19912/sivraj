import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export type LocalRepoFingerprint = {
  repoName?: string;
  packageName?: string;
  gitRemote?: string;
  packageManager?: string;
  frameworks?: string[];
  lockfiles?: string[];
  rootMarkers?: string[];
};

export function detectLocalRepoFingerprint(startDirectory = process.cwd()): LocalRepoFingerprint {
  const root = findRepoRoot(startDirectory);
  const packageJson = readPackageJson(root);
  const lockfiles = detectLockfiles(root);
  const rootMarkers = detectRootMarkers(root);
  const frameworks = detectFrameworks(packageJson);

  return {
    repoName: basename(root),
    packageName: typeof packageJson["name"] === "string" ? packageJson["name"] : undefined,
    gitRemote: readGitRemote(root),
    packageManager: detectPackageManager(lockfiles, packageJson),
    frameworks,
    lockfiles,
    rootMarkers,
  };
}

export function mergeRepoFingerprint<TArgs extends LocalRepoFingerprint>(detected: LocalRepoFingerprint, args: TArgs): TArgs {
  return {
    ...detected,
    ...args,
    frameworks: args.frameworks ?? detected.frameworks,
    lockfiles: args.lockfiles ?? detected.lockfiles,
    rootMarkers: args.rootMarkers ?? detected.rootMarkers,
  };
}

function findRepoRoot(startDirectory: string): string {
  let current = startDirectory;

  while (true) {
    if (existsSync(join(current, ".git")) || existsSync(join(current, "package.json"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return startDirectory;
    }

    current = parent;
  }
}

function readPackageJson(root: string): Record<string, unknown> {
  try {
    const content = readFileSync(join(root, "package.json"), "utf8");
    const parsed = JSON.parse(content);

    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function detectLockfiles(root: string): string[] {
  return ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb", "bun.lock"]
    .filter((fileName) => existsSync(join(root, fileName)));
}

function detectRootMarkers(root: string): string[] {
  return ["AGENTS.md", "CLAUDE.md", ".cursorrules", ".cursor/rules"]
    .filter((fileName) => existsSync(join(root, fileName)));
}

function detectPackageManager(lockfiles: string[], packageJson: Record<string, unknown>): string | undefined {
  const packageManager = typeof packageJson["packageManager"] === "string"
    ? packageJson["packageManager"].split("@")[0]
    : undefined;

  if (packageManager) {
    return packageManager;
  }

  if (lockfiles.includes("pnpm-lock.yaml")) {
    return "pnpm";
  }

  if (lockfiles.includes("package-lock.json")) {
    return "npm";
  }

  if (lockfiles.includes("yarn.lock")) {
    return "yarn";
  }

  if (lockfiles.some((fileName) => fileName.startsWith("bun."))) {
    return "bun";
  }

  return undefined;
}

function detectFrameworks(packageJson: Record<string, unknown>): string[] {
  const dependencies = {
    ...readDependencyRecord(packageJson["dependencies"]),
    ...readDependencyRecord(packageJson["devDependencies"]),
  };
  const frameworks: string[] = [];

  if ("vite" in dependencies) {
    frameworks.push("vite");
  }

  if ("react" in dependencies) {
    frameworks.push("react");
  }

  if ("next" in dependencies) {
    frameworks.push("next.js");
  }

  return frameworks;
}

function readDependencyRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readGitRemote(root: string): string | undefined {
  try {
    return execFileSync("git", ["config", "--get", "remote.origin.url"], {
      cwd: root,
      encoding: "utf8",
      timeout: 1_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}
