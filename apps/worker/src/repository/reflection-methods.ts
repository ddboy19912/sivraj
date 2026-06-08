import { eq } from "drizzle-orm";
import { reflectionRuns, type Db } from "@sivraj/db";
import {
  fetchWeeklyReflectionData,
  summarizeWeeklyReflectionSignals,
} from "./reflection-helpers.js";

async function findWeeklyReflectionSignals(
  db: Db,
  input: {
    twinId: string;
    periodStart: Date;
    periodEnd: Date;
  },
) {
  const data = await fetchWeeklyReflectionData(db, input);
  return summarizeWeeklyReflectionSignals(data);
}

async function createReflectionRun(
  db: Db,
  input: {
    twinId: string;
    periodStart: Date;
    periodEnd: Date;
    status: "completed" | "failed" | "skipped";
    summaryStorageRef?: string | null;
    summarySha256?: string | null;
    metadata: Record<string, unknown>;
  },
) {
  const [run] = await db
    .insert(reflectionRuns)
    .values({
      twinId: input.twinId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: input.status,
      summaryStorageRef: input.summaryStorageRef ?? null,
      summarySha256: input.summarySha256 ?? null,
      metadata: input.metadata,
    })
    .returning({ id: reflectionRuns.id });

  if (!run) {
    throw new Error("Failed to create reflection run");
  }

  return run;
}

async function updateReflectionRun(
  db: Db,
  input: {
    id: string;
    status: "processing" | "completed" | "failed" | "skipped";
    summaryStorageRef?: string | null;
    summarySha256?: string | null;
    metadata: Record<string, unknown>;
  },
) {
  await db
    .update(reflectionRuns)
    .set({
      status: input.status,
      summaryStorageRef: input.summaryStorageRef ?? null,
      summarySha256: input.summarySha256 ?? null,
      metadata: input.metadata,
      updatedAt: new Date(),
    })
    .where(eq(reflectionRuns.id, input.id));
}

export function createReflectionMethods(db: Db) {
  return {
    findWeeklyReflectionSignals: (input: Parameters<typeof findWeeklyReflectionSignals>[1]) =>
      findWeeklyReflectionSignals(db, input),
    createReflectionRun: (input: Parameters<typeof createReflectionRun>[1]) =>
      createReflectionRun(db, input),
    updateReflectionRun: (input: Parameters<typeof updateReflectionRun>[1]) =>
      updateReflectionRun(db, input),
  };
}
