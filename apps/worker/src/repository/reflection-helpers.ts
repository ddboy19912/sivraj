import { and, eq, gte, lt } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  candidateMemories,
  graphNodes,
  memoryFragments,
  sourceArtifacts,
  userFeedbackEvents,
  type Db,
} from "@sivraj/db";
import { asRecord, summarizeCandidateSubjects, summarizeFeedbackTypes } from "./helpers.js";

export async function fetchWeeklyReflectionData(
  db: Db,
  input: {
    twinId: string;
    periodStart: Date;
    periodEnd: Date;
  },
) {
  const periodFilter = (table: { twinId: AnyPgColumn; createdAt: AnyPgColumn }) =>
    and(
      eq(table.twinId, input.twinId),
      gte(table.createdAt, input.periodStart),
      lt(table.createdAt, input.periodEnd),
    );

  const [artifactRows, fragmentRows, candidateRows, graphRows, feedbackRows] = await Promise.all([
    db
      .select({ id: sourceArtifacts.id })
      .from(sourceArtifacts)
      .where(periodFilter(sourceArtifacts)),
    db
      .select({ id: memoryFragments.id })
      .from(memoryFragments)
      .where(periodFilter(memoryFragments)),
    db
      .select({
        id: candidateMemories.id,
        status: candidateMemories.status,
        memoryType: candidateMemories.memoryType,
        metadata: candidateMemories.metadata,
      })
      .from(candidateMemories)
      .where(periodFilter(candidateMemories)),
    db
      .select({
        id: graphNodes.id,
        nodeType: graphNodes.nodeType,
        name: graphNodes.name,
        properties: graphNodes.properties,
      })
      .from(graphNodes)
      .where(periodFilter(graphNodes)),
    db
      .select({
        id: userFeedbackEvents.id,
        feedbackType: userFeedbackEvents.feedbackType,
      })
      .from(userFeedbackEvents)
      .where(periodFilter(userFeedbackEvents)),
  ]);

  return {
    artifactRows,
    fragmentRows,
    candidateRows,
    graphRows,
    feedbackRows,
  };
}

export function summarizeWeeklyReflectionSignals(data: Awaited<ReturnType<typeof fetchWeeklyReflectionData>>) {
  const { artifactRows, fragmentRows, candidateRows, graphRows, feedbackRows } = data;
  const candidateSubjects = summarizeCandidateSubjects(candidateRows);
  const feedbackBreakdown = summarizeFeedbackTypes(feedbackRows);

  return {
    sourceArtifactCount: artifactRows.length,
    memoryFragmentCount: fragmentRows.length,
    candidateMemoryCount: candidateRows.length,
    approvedCandidateMemoryCount: candidateRows.filter((row) => row.status === "approved").length,
    rejectedCandidateMemoryCount: candidateRows.filter((row) => row.status === "rejected").length,
    graphNodeCount: graphRows.length,
    projectCount: graphRows.filter((row) => row.nodeType === "project").length,
    goalCount: graphRows.filter((row) => row.nodeType === "goal").length,
    decisionCount: graphRows.filter((row) => row.nodeType === "decision").length,
    patternCount: graphRows.filter((row) => asRecord(row.properties).kind === "pattern").length,
    feedbackCount: feedbackRows.length,
    usefulFeedbackCount: feedbackRows.filter((row) => row.feedbackType === "useful" || row.feedbackType === "approved").length,
    negativeFeedbackCount: feedbackRows.filter((row) =>
      row.feedbackType === "wrong" ||
      row.feedbackType === "not_me" ||
      row.feedbackType === "too_generic" ||
      row.feedbackType === "too_sensitive" ||
      row.feedbackType === "rejected",
    ).length,
    candidateSubjects,
    graphSubjects: graphRows
      .map((row) => ({
        name: row.name,
        nodeType: row.nodeType,
      }))
      .slice(0, 30),
    feedbackBreakdown,
    sourceArtifactIds: artifactRows.map((row) => row.id),
    memoryFragmentIds: fragmentRows.map((row) => row.id),
    candidateMemoryIds: candidateRows.map((row) => row.id),
    graphNodeIds: graphRows.map((row) => row.id),
  };
}
