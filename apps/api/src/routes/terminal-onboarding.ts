import {
  auditEvents,
  refreshSessions,
  sourceArtifacts,
  twinIdentityProfiles,
  twins,
  twinVoiceProfiles,
  users,
} from "@sivraj/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { AuthClaims } from "@sivraj/auth";
import type { AppDependencies } from "../app.js";
import type { TerminalOutputLine } from "./terminal-types.js";

const DEFAULT_TWIN_NAME = "Primary Twin";
const ONBOARDING_SOURCE_TYPE = "onboarding_self_description";

export type OnboardingResetSummary = {
  dryRun: boolean;
  walletAddress: string;
  userId: string;
  twinId: string;
  deletedArtifacts: number;
  deletedIdentityProfiles: number;
  deletedVoiceProfiles: number;
  revokedSessions: number;
};

export async function loadTerminalOnboardingStatus(
  db: AppDependencies["db"],
  input: {
    userId: string;
    twinId: string;
  },
) {
  const [user] = await db
    .select({
      displayName: users.displayName,
      onboardingStatus: users.onboardingStatus,
      firstMeetIntroStatus: users.firstMeetIntroStatus,
    })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  const [identity] = await db
    .select({
      displayName: twinIdentityProfiles.displayName,
      selfDescriptionArtifactId: twinIdentityProfiles.selfDescriptionArtifactId,
    })
    .from(twinIdentityProfiles)
    .where(eq(twinIdentityProfiles.twinId, input.twinId))
    .limit(1);
  const [twin] = await db
    .select({ name: twins.name })
    .from(twins)
    .where(eq(twins.id, input.twinId))
    .limit(1);

  return {
    twinName: twin?.name ?? DEFAULT_TWIN_NAME,
    displayName: identity?.displayName ?? user?.displayName ?? null,
    onboardingStatus: user?.onboardingStatus ?? "not_started",
    firstMeetIntroStatus: user?.firstMeetIntroStatus ?? "not_started",
    selfDescriptionArtifactId: identity?.selfDescriptionArtifactId ?? null,
  };
}

export async function resetTerminalOnboarding(
  db: AppDependencies["db"],
  input: {
    auth: AuthClaims;
    twinId: string;
    dryRun: boolean;
  },
): Promise<
  | { ok: true; summary: OnboardingResetSummary }
  | { ok: false; status: 403; error: string }
> {
  if (input.auth.type !== "user" || !input.auth.walletAddress) {
    return { ok: false, status: 403, error: "user_wallet_required" };
  }

  const summary = await summarizeOnboardingReset(db, {
    userId: input.auth.sub,
    twinId: input.twinId,
    walletAddress: input.auth.walletAddress,
    dryRun: input.dryRun,
  });

  if (!input.dryRun) {
    await applyOnboardingReset(db, summary);
    await db.insert(auditEvents).values({
      twinId: input.twinId,
      actorType: input.auth.type,
      actorId: input.auth.sub,
      eventType: "terminal.onboarding_reset.completed",
      resourceType: "user",
      resourceId: input.auth.sub,
      metadata: {
        walletAddress: input.auth.walletAddress,
        deletedArtifacts: summary.deletedArtifacts,
        deletedIdentityProfiles: summary.deletedIdentityProfiles,
        deletedVoiceProfiles: summary.deletedVoiceProfiles,
        revokedSessions: summary.revokedSessions,
      },
    });
  }

  return { ok: true, summary };
}

export function formatOnboardingStatusLines(status: {
  twinName: string;
  displayName: string | null;
  onboardingStatus: string;
  firstMeetIntroStatus: string;
  selfDescriptionArtifactId: string | null;
}): TerminalOutputLine[] {
  return [
    { kind: "info", text: `Twin: ${status.twinName}` },
    { kind: "info", text: `Display name: ${status.displayName ?? "not set"}` },
    { kind: "info", text: `Onboarding: ${status.onboardingStatus}` },
    { kind: "info", text: `First meet intro: ${status.firstMeetIntroStatus}` },
    {
      kind: status.selfDescriptionArtifactId ? "success" : "warning",
      text: `First memory artifact: ${status.selfDescriptionArtifactId ?? "not linked"}`,
    },
  ];
}

export function formatOnboardingResetLines(
  summary: OnboardingResetSummary,
): TerminalOutputLine[] {
  const mode = summary.dryRun ? "Dry run complete." : "Onboarding reset complete.";

  return [
    { kind: summary.dryRun ? "info" : "success", text: mode },
    { kind: "info", text: `Wallet: ${summary.walletAddress}` },
    { kind: "info", text: `User: ${summary.userId}` },
    { kind: "info", text: `Twin: ${summary.twinId}` },
    {
      kind: "info",
      text: `Identity profiles removed: ${summary.deletedIdentityProfiles}`,
    },
    { kind: "info", text: `Voice profiles removed: ${summary.deletedVoiceProfiles}` },
    { kind: "info", text: `Onboarding artifacts removed: ${summary.deletedArtifacts}` },
    { kind: "info", text: `Refresh sessions revoked: ${summary.revokedSessions}` },
  ];
}

async function summarizeOnboardingReset(
  db: AppDependencies["db"],
  input: {
    userId: string;
    twinId: string;
    walletAddress: string;
    dryRun: boolean;
  },
): Promise<OnboardingResetSummary> {
  const [deletedArtifacts] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sourceArtifacts)
    .where(
      and(
        eq(sourceArtifacts.twinId, input.twinId),
        eq(sourceArtifacts.sourceType, ONBOARDING_SOURCE_TYPE),
      ),
    );
  const [deletedIdentityProfiles] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(twinIdentityProfiles)
    .where(eq(twinIdentityProfiles.twinId, input.twinId));
  const [deletedVoiceProfiles] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(twinVoiceProfiles)
    .where(eq(twinVoiceProfiles.twinId, input.twinId));
  const [revokedSessions] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(refreshSessions)
    .where(
      and(
        eq(refreshSessions.userId, input.userId),
        eq(refreshSessions.twinId, input.twinId),
        eq(refreshSessions.walletAddress, input.walletAddress),
        isNull(refreshSessions.revokedAt),
      ),
    );

  return {
    dryRun: input.dryRun,
    walletAddress: input.walletAddress,
    userId: input.userId,
    twinId: input.twinId,
    deletedArtifacts: Number(deletedArtifacts?.count ?? 0),
    deletedIdentityProfiles: Number(deletedIdentityProfiles?.count ?? 0),
    deletedVoiceProfiles: Number(deletedVoiceProfiles?.count ?? 0),
    revokedSessions: Number(revokedSessions?.count ?? 0),
  };
}

async function applyOnboardingReset(
  db: AppDependencies["db"],
  summary: OnboardingResetSummary,
) {
  await db
    .delete(twinIdentityProfiles)
    .where(eq(twinIdentityProfiles.twinId, summary.twinId));
  await db
    .delete(twinVoiceProfiles)
    .where(eq(twinVoiceProfiles.twinId, summary.twinId));
  await db
    .delete(sourceArtifacts)
    .where(
      and(
        eq(sourceArtifacts.twinId, summary.twinId),
        eq(sourceArtifacts.sourceType, ONBOARDING_SOURCE_TYPE),
      ),
    );
  await db
    .update(twins)
    .set({
      name: DEFAULT_TWIN_NAME,
      summary: null,
      currentGoals: null,
      updatedAt: new Date(),
    })
    .where(eq(twins.id, summary.twinId));
  await db
    .update(users)
    .set({
      displayName: null,
      onboardingStatus: "not_started",
      firstMeetIntroStatus: "not_started",
      updatedAt: new Date(),
    })
    .where(eq(users.id, summary.userId));
  await db
    .update(refreshSessions)
    .set({
      revokedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(refreshSessions.userId, summary.userId),
        eq(refreshSessions.twinId, summary.twinId),
        eq(refreshSessions.walletAddress, summary.walletAddress),
        isNull(refreshSessions.revokedAt),
      ),
    );
}
