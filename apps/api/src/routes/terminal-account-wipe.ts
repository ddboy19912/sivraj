import type { AuthClaims } from "@sivraj/auth";
import {
  auditEvents,
  canonicalMemories,
  candidateMemories,
  chatMessages,
  chatThreads,
  connectorAccounts,
  contextPackets,
  contextRuntimePackets,
  documentChunks,
  documentPages,
  documentStructureItems,
  graphNodes,
  memoryFragments,
  refreshSessions,
  sourceArtifacts,
  twins,
  users,
  walletAccounts,
} from "@sivraj/db";
import { and, eq, or, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { AppDependencies } from "../app.js";
import type { TerminalOutputLine } from "./terminal-types.js";

const WALRUS_DELETION_NOTE =
  "Walrus ciphertext may remain durable; Sivraj deletes local metadata and removes future cryptographic access.";

export type AccountWipeSummary = {
  dryRun: boolean;
  userId: string;
  twinId: string;
  walletAddress: string;
  deletedUsers: number;
  deletedWalletAccounts: number;
  deletedTwins: number;
  deletedRefreshSessions: number;
  deletedAuditEvents: number;
  deletedChatThreads: number;
  deletedChatMessages: number;
  deletedSourceArtifacts: number;
  deletedMemoryFragments: number;
  deletedCanonicalMemories: number;
  deletedCandidateMemories: number;
  deletedConnectorAccounts: number;
  deletedContextPackets: number;
  deletedContextRuntimePackets: number;
  deletedDocumentRows: number;
  deletedGraphNodes: number;
  walrusNote: string;
};

export async function wipeTerminalAccount(
  db: AppDependencies["db"],
  input: {
    auth: AuthClaims;
    twinId: string;
    dryRun: boolean;
  },
): Promise<
  | { ok: true; summary: AccountWipeSummary }
  | { ok: false; status: 403 | 404; error: string }
> {
  if (input.auth.type !== "user" || !input.auth.walletAddress) {
    return { ok: false, status: 403, error: "user_wallet_required" };
  }

  const ownership = await loadAccountOwnership(db, {
    userId: input.auth.sub,
    twinId: input.twinId,
    walletAddress: input.auth.walletAddress,
  });

  if (!ownership.ok) {
    return ownership;
  }

  const summary = await summarizeAccountWipe(db, {
    userId: input.auth.sub,
    twinId: input.twinId,
    walletAddress: input.auth.walletAddress,
    dryRun: input.dryRun,
  });

  if (!input.dryRun) {
    await applyAccountWipe(db, summary);
  }

  return { ok: true, summary };
}

export function formatAccountWipeLines(summary: AccountWipeSummary): TerminalOutputLine[] {
  const heading = summary.dryRun
    ? "Account wipe preview."
    : "Account wipe complete.";

  return [
    { kind: summary.dryRun ? "warning" : "success", text: heading },
    { kind: "info", text: `Wallet: ${summary.walletAddress}` },
    { kind: "info", text: `User: ${summary.userId}` },
    { kind: "info", text: `Current twin: ${summary.twinId}` },
    { kind: "info", text: `Users removed: ${summary.deletedUsers}` },
    { kind: "info", text: `Wallet accounts removed: ${summary.deletedWalletAccounts}` },
    { kind: "info", text: `Twins removed: ${summary.deletedTwins}` },
    { kind: "info", text: `Refresh sessions removed: ${summary.deletedRefreshSessions}` },
    {
      kind: "info",
      text: `Brain rows removed: artifacts ${summary.deletedSourceArtifacts}, fragments ${summary.deletedMemoryFragments}, canonical ${summary.deletedCanonicalMemories}, candidates ${summary.deletedCandidateMemories}`,
    },
    {
      kind: "info",
      text: `Chat rows removed: threads ${summary.deletedChatThreads}, messages ${summary.deletedChatMessages}`,
    },
    {
      kind: "info",
      text: `Runtime rows removed: context packets ${summary.deletedContextPackets}, runtime packets ${summary.deletedContextRuntimePackets}`,
    },
    {
      kind: "info",
      text: `Document/graph rows removed: documents ${summary.deletedDocumentRows}, graph nodes ${summary.deletedGraphNodes}`,
    },
    { kind: "info", text: `Connector accounts removed: ${summary.deletedConnectorAccounts}` },
    { kind: "info", text: `Audit events removed: ${summary.deletedAuditEvents}` },
    { kind: "warning", text: summary.walrusNote },
  ];
}

async function loadAccountOwnership(
  db: AppDependencies["db"],
  input: {
    userId: string;
    twinId: string;
    walletAddress: string;
  },
): Promise<
  | { ok: true }
  | { ok: false; status: 403 | 404; error: string }
> {
  const [twin] = await db
    .select({ id: twins.id })
    .from(twins)
    .where(and(eq(twins.id, input.twinId), eq(twins.userId, input.userId)))
    .limit(1);

  if (!twin) {
    return { ok: false, status: 404, error: "twin_not_found_for_user" };
  }

  const [wallet] = await db
    .select({ id: walletAccounts.id })
    .from(walletAccounts)
    .where(
      and(
        eq(walletAccounts.userId, input.userId),
        eq(walletAccounts.chain, "sui"),
        eq(walletAccounts.address, input.walletAddress),
      ),
    )
    .limit(1);

  return wallet
    ? { ok: true }
    : { ok: false, status: 403, error: "wallet_account_not_found" };
}

async function summarizeAccountWipe(
  db: AppDependencies["db"],
  input: {
    userId: string;
    twinId: string;
    walletAddress: string;
    dryRun: boolean;
  },
): Promise<AccountWipeSummary> {
  const [
    deletedUsers,
    deletedWalletAccounts,
    deletedTwins,
    deletedRefreshSessions,
    deletedAuditEvents,
    deletedChatThreads,
    deletedChatMessages,
    deletedSourceArtifacts,
    deletedMemoryFragments,
    deletedCanonicalMemories,
    deletedCandidateMemories,
    deletedConnectorAccounts,
    deletedContextPackets,
    deletedContextRuntimePackets,
    deletedDocumentChunks,
    deletedDocumentPages,
    deletedDocumentStructureItems,
    deletedGraphNodes,
  ] = await Promise.all([
    countRows(db, users, eq(users.id, input.userId)),
    countRows(
      db,
      walletAccounts,
      and(
        eq(walletAccounts.userId, input.userId),
        eq(walletAccounts.address, input.walletAddress),
      ),
    ),
    countRows(db, twins, eq(twins.userId, input.userId)),
    countRows(
      db,
      refreshSessions,
      and(
        eq(refreshSessions.userId, input.userId),
        eq(refreshSessions.walletAddress, input.walletAddress),
      ),
    ),
    countRows(
      db,
      auditEvents,
      or(eq(auditEvents.twinId, input.twinId), eq(auditEvents.actorId, input.userId)),
    ),
    countRows(db, chatThreads, eq(chatThreads.twinId, input.twinId)),
    countRows(db, chatMessages, eq(chatMessages.twinId, input.twinId)),
    countRows(db, sourceArtifacts, eq(sourceArtifacts.twinId, input.twinId)),
    countRows(db, memoryFragments, eq(memoryFragments.twinId, input.twinId)),
    countRows(db, canonicalMemories, eq(canonicalMemories.twinId, input.twinId)),
    countRows(db, candidateMemories, eq(candidateMemories.twinId, input.twinId)),
    countRows(db, connectorAccounts, eq(connectorAccounts.twinId, input.twinId)),
    countRows(db, contextPackets, eq(contextPackets.twinId, input.twinId)),
    countRows(db, contextRuntimePackets, eq(contextRuntimePackets.twinId, input.twinId)),
    countRows(db, documentChunks, eq(documentChunks.twinId, input.twinId)),
    countRows(db, documentPages, eq(documentPages.twinId, input.twinId)),
    countRows(db, documentStructureItems, eq(documentStructureItems.twinId, input.twinId)),
    countRows(db, graphNodes, eq(graphNodes.twinId, input.twinId)),
  ]);

  return {
    dryRun: input.dryRun,
    userId: input.userId,
    twinId: input.twinId,
    walletAddress: input.walletAddress,
    deletedUsers,
    deletedWalletAccounts,
    deletedTwins,
    deletedRefreshSessions,
    deletedAuditEvents,
    deletedChatThreads,
    deletedChatMessages,
    deletedSourceArtifacts,
    deletedMemoryFragments,
    deletedCanonicalMemories,
    deletedCandidateMemories,
    deletedConnectorAccounts,
    deletedContextPackets,
    deletedContextRuntimePackets,
    deletedDocumentRows: deletedDocumentChunks + deletedDocumentPages + deletedDocumentStructureItems,
    deletedGraphNodes,
    walrusNote: WALRUS_DELETION_NOTE,
  };
}

async function applyAccountWipe(
  db: AppDependencies["db"],
  summary: AccountWipeSummary,
) {
  await db
    .delete(auditEvents)
    .where(or(eq(auditEvents.twinId, summary.twinId), eq(auditEvents.actorId, summary.userId)));
  await db.delete(users).where(eq(users.id, summary.userId));
}

async function countRows(
  db: AppDependencies["db"],
  table: PgTable,
  whereClause: SQL | undefined,
) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(table)
    .where(whereClause);

  return Number(row?.count ?? 0);
}
