import { readTrimmedStringList } from "@sivraj/core";
import type { EngineeringRepoFingerprint } from "./profile.js";

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeGitRemote(value: unknown): string | null {
  const remote = normalizeNullableString(value);

  if (!remote) {
    return null;
  }

  return remote.replace(/\.git$/i, "").toLowerCase();
}

function normalizeStringList(value: unknown): string[] {
  return readTrimmedStringList(value);
}

export function normalizeRepoFingerprint(
  value: Partial<EngineeringRepoFingerprint> | null | undefined,
): EngineeringRepoFingerprint {
  const packageManager = normalizeNullableString(value?.packageManager);

  return {
    projectId: normalizeNullableString(value?.projectId),
    projectName: normalizeNullableString(value?.projectName),
    repoName: normalizeNullableString(value?.repoName),
    packageName: normalizeNullableString(value?.packageName),
    gitRemote: normalizeGitRemote(value?.gitRemote),
    packageManager: packageManager ? packageManager.toLowerCase() : null,
    frameworks: normalizeStringList(value?.frameworks),
    lockfiles: normalizeStringList(value?.lockfiles),
    rootMarkers: normalizeStringList(value?.rootMarkers),
  };
}
