import { errorMessage, getAuthedJson, postAuthedJson, postJson } from "@/lib/api";
import { buildClientEncryptedAgentWritebackBody } from "@/lib/encryption";
import type { AgentWritebacksResponse } from "@/types/console.types";
import type { Session } from "@/lib/session";

export async function loadAgentWritebacks({
  session,
  statusFilter,
  onSessionRefreshed,
}: {
  session: Session;
  statusFilter: string;
  onSessionRefreshed: (session: Session) => void;
}) {
  const query = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
  return getAuthedJson<AgentWritebacksResponse>(
    `/v1/twins/${session.twinId}/agents/writebacks${query}`,
    session,
    onSessionRefreshed,
  );
}

export async function approveAgentWriteback({
  session,
  writebackId,
  onSessionRefreshed,
}: {
  session: Session;
  writebackId: string;
  onSessionRefreshed: (session: Session) => void;
}) {
  return postAuthedJson<{
    artifactId: string;
    processingJobId: string | null;
  }>(
    `/v1/twins/${session.twinId}/agents/writebacks/${writebackId}/approve`,
    {},
    session,
    onSessionRefreshed,
  );
}

export async function rejectAgentWriteback({
  session,
  writebackId,
  onSessionRefreshed,
}: {
  session: Session;
  writebackId: string;
  onSessionRefreshed: (session: Session) => void;
}) {
  return postAuthedJson(
    `/v1/twins/${session.twinId}/agents/writebacks/${writebackId}/reject`,
    {},
    session,
    onSessionRefreshed,
  );
}

export async function createEncryptedAgentWriteback({
  session,
  agentToken,
  agentName,
  repo,
  branch,
  taskSummary,
  filesTouched,
  commandsRun,
  testsRun,
  decisions,
  bugsFound,
  followUps,
  userCorrections,
}: {
  session: Session;
  agentToken: string;
  agentName: string;
  repo: string;
  branch: string;
  taskSummary: string;
  filesTouched: string;
  commandsRun: string;
  testsRun: string;
  decisions: string;
  bugsFound: string;
  followUps: string;
  userCorrections: string;
}) {
  const trimmedToken = agentToken.trim();
  if (!trimmedToken) {
    throw new Error("Paste an agent token with agent:writeback:create.");
  }

  if (!taskSummary.trim()) {
    throw new Error("Task summary is required.");
  }

  const body = await buildClientEncryptedAgentWritebackBody({
    twinId: session.twinId,
    agentName: agentName.trim() || "Coding Agent",
    repo: repo.trim(),
    branch: branch.trim(),
    taskSummary: taskSummary.trim(),
    filesTouched: lines(filesTouched),
    commandsRun: lines(commandsRun),
    testsRun: lines(testsRun),
    decisions: lines(decisions),
    bugsFound: lines(bugsFound),
    followUps: lines(followUps),
    userCorrections: lines(userCorrections),
  });

  try {
    return await postJson<{
      writebackId: string;
      status: string;
      rawStorageRef: string;
    }>(`/v1/twins/${session.twinId}/agents/writebacks`, body, trimmedToken);
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}

function lines(value: string) {
  return value.split("\n").flatMap((line) => {
    const trimmed = line.trim();
    return trimmed ? [trimmed] : [];
  });
}
