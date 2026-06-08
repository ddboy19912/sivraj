import {
  DEFAULT_MANUAL_MEMORY_SENSITIVITY,
  ENCRYPTED_WALRUS_STORAGE_MODE,
  formatPrOrCommitImportWriteback,
} from "@sivraj/core";
import type { agentWritebacks } from "@sivraj/db";
import {
  optionalSha256,
  optionalString,
  readBodyEncryptedPayload,
  readCount,
  readRecord,
  readStringArray,
  requiredString,
  sha256Hex,
} from "../http/route-helpers.js";

export function readCountRecord(value: unknown): {
  filesTouched: number;
  commandsRun: number;
  testsRun: number;
  decisions: number;
  bugsFound: number;
  followUps: number;
  userCorrections: number;
} {
  const counts = readRecord(value);

  return {
    filesTouched: readCount(counts["filesTouched"]),
    commandsRun: readCount(counts["commandsRun"]),
    testsRun: readCount(counts["testsRun"]),
    decisions: readCount(counts["decisions"]),
    bugsFound: readCount(counts["bugsFound"]),
    followUps: readCount(counts["followUps"]),
    userCorrections: readCount(counts["userCorrections"]),
  };
}

export function validateWritebackCreateInput(body: Record<string, unknown>) {
  const encryptedPayload = readBodyEncryptedPayload(body);

  if (encryptedPayload === "invalid") {
    return { ok: false as const, error: { status: 400 as const, body: { error: "invalid_encrypted_payload" } } };
  }

  const taskSummary = requiredString(body["taskSummary"]);
  const taskSummarySha256 = optionalSha256(body["taskSummarySha256"]);

  if (!taskSummary && !encryptedPayload) {
    return { ok: false as const, error: { status: 400 as const, body: { error: "missing_task_summary" } } };
  }

  if (body["taskSummarySha256"] !== undefined && !taskSummarySha256) {
    return { ok: false as const, error: { status: 400 as const, body: { error: "invalid_task_summary_sha256" } } };
  }

  const agentName = optionalString(body["agentName"]) ?? "coding-agent";
  const writebackPayload = {
    agentName,
    repo: optionalString(body["repo"]),
    branch: optionalString(body["branch"]),
    taskSummary: taskSummary ?? "[client-encrypted writeback]",
    filesTouched: readStringArray(body["filesTouched"]),
    commandsRun: readStringArray(body["commandsRun"]),
    testsRun: readStringArray(body["testsRun"]),
    decisions: readStringArray(body["decisions"]),
    bugsFound: readStringArray(body["bugsFound"]),
    followUps: readStringArray(body["followUps"]),
    userCorrections: readStringArray(body["userCorrections"]),
  };

  return {
    ok: true as const,
    value: {
      encryptedPayload,
      taskSummary,
      taskSummarySha256,
      agentName,
      safeCounts: readCountRecord(body["counts"]),
      writebackPayload,
      metadata: {
        uploadKind: "agent_writeback",
        importer: "sivraj_agent_api",
        agentName,
        repo: writebackPayload.repo ?? null,
        branch: writebackPayload.branch ?? null,
        storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
        sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
        encryptionBoundary: encryptedPayload ? "client" : "api",
      },
    },
  };
}

export function buildWritebackPayload(
  input: Extract<ReturnType<typeof validateWritebackCreateInput>, { ok: true }>["value"],
  stored: {
    rawStorageRef: string;
    ciphertextSha256: string;
    seal: unknown;
    walrus: unknown;
  },
) {
  const { encryptedPayload, taskSummary, taskSummarySha256, agentName, safeCounts, writebackPayload, metadata } = input;

  return {
    kind: "coding_agent_writeback",
    agentName,
    repo: metadata.repo,
    branch: metadata.branch,
    summarySha256: taskSummarySha256 ?? sha256Hex(taskSummary ?? ""),
    counts: {
      filesTouched: encryptedPayload ? safeCounts.filesTouched : writebackPayload.filesTouched.length,
      commandsRun: encryptedPayload ? safeCounts.commandsRun : writebackPayload.commandsRun.length,
      testsRun: encryptedPayload ? safeCounts.testsRun : writebackPayload.testsRun.length,
      decisions: encryptedPayload ? safeCounts.decisions : writebackPayload.decisions.length,
      bugsFound: encryptedPayload ? safeCounts.bugsFound : writebackPayload.bugsFound.length,
      followUps: encryptedPayload ? safeCounts.followUps : writebackPayload.followUps.length,
      userCorrections: encryptedPayload ? safeCounts.userCorrections : writebackPayload.userCorrections.length,
    },
    storage: {
      rawStorageRef: stored.rawStorageRef,
      ciphertextSha256: stored.ciphertextSha256,
      seal: stored.seal,
      walrus: stored.walrus,
      storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
      sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
      encryptionBoundary: encryptedPayload ? "client" : "api",
    },
    artifactMetadata: metadata,
  };
}

export function readPrOrCommitImportPayload(
  payload: Record<string, unknown>,
  kind: "pull_request" | "commit",
) {
  const agentName = optionalString(payload["agentName"]) ?? "coding-agent";
  const repo = optionalString(payload["repo"]);
  const title = requiredString(payload["title"]);
  const url = optionalString(payload["url"]);
  const author = optionalString(payload["author"]);
  const mergedAt = optionalString(payload["mergedAt"]);
  const committedAt = optionalString(payload["committedAt"]);
  const identifier = optionalString(payload["number"]) ?? optionalString(payload["sha"]) ?? optionalString(payload["id"]);
  const summary = requiredString(payload["summary"]) ?? requiredString(payload["body"]);
  const filesChanged = readStringArray(payload["filesChanged"]);
  const commandsRun = readStringArray(payload["commandsRun"]);
  const testsRun = readStringArray(payload["testsRun"]);
  const decisions = readStringArray(payload["decisions"]);
  const bugsFixed = readStringArray(payload["bugsFixed"]);
  const reviewComments = readStringArray(payload["reviewComments"]);
  const userCorrections = readStringArray(payload["userCorrections"]);

  if (!title || !summary) {
    return {
      ok: false as const,
      error: {
        status: 400 as const,
        body: {
          error: kind === "pull_request" ? "missing_pr_title_or_summary" : "missing_commit_title_or_summary",
        },
      },
    };
  }

  return {
    ok: true as const,
    value: {
      agentName,
      repo,
      identifier,
      title,
      url,
      author,
      mergedAt,
      committedAt,
      summary,
      filesChanged,
      commandsRun,
      testsRun,
      decisions,
      bugsFixed,
      reviewComments,
      userCorrections,
      content: formatPrOrCommitImportWriteback({
        kind,
        agentName,
        repo: repo ?? undefined,
        identifier: identifier ?? undefined,
        title,
        url: url ?? undefined,
        author: author ?? undefined,
        mergedAt: mergedAt ?? undefined,
        committedAt: committedAt ?? undefined,
        summary,
        filesChanged,
        commandsRun,
        testsRun,
        decisions,
        bugsFixed,
        reviewComments,
        userCorrections,
      }),
      metadata: {
        uploadKind: "agent_writeback",
        importer: "sivraj_agent_api",
        writebackKind: kind === "pull_request" ? "pr_import" : "commit_import",
        agentName,
        repo: repo ?? null,
        storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
        sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
      },
    },
  };
}

export function toAgentWritebackSummary(row: typeof agentWritebacks.$inferSelect) {
  const payload = readRecord(row.payload);
  const storage = readRecord(payload["storage"]);
  const counts = readRecord(payload["counts"]);

  return {
    id: row.id,
    twinId: row.twinId,
    clientId: row.clientId,
    status: row.status,
    agentName: optionalString(payload["agentName"]) ?? "coding-agent",
    repo: optionalString(payload["repo"]) ?? null,
    branch: optionalString(payload["branch"]) ?? null,
    summarySha256: optionalString(payload["summarySha256"]) ?? null,
    rawStorageRef: optionalString(storage["rawStorageRef"]) ?? null,
    ciphertextSha256: optionalString(storage["ciphertextSha256"]) ?? null,
    approvedArtifactId: optionalString(payload["approvedArtifactId"]) ?? null,
    counts: {
      filesTouched: readCount(counts["filesTouched"]),
      filesChanged: readCount(counts["filesChanged"]),
      commandsRun: readCount(counts["commandsRun"]),
      testsRun: readCount(counts["testsRun"]),
      decisions: readCount(counts["decisions"]),
      bugsFound: readCount(counts["bugsFound"]),
      bugsFixed: readCount(counts["bugsFixed"]),
      reviewComments: readCount(counts["reviewComments"]),
      followUps: readCount(counts["followUps"]),
      userCorrections: readCount(counts["userCorrections"]),
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    rejectedAt: row.rejectedAt?.toISOString() ?? null,
  };
}
