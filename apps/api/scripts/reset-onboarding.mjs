#!/usr/bin/env node

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { loadNearestEnv } from "@sivraj/config";
import pg from "pg";

const DEFAULT_DATABASE_URL = "postgresql://sivraj:sivraj@localhost:5432/sivraj";
const DEFAULT_TWIN_NAME = "Primary Twin";
const ONBOARDING_SOURCE_TYPE = "onboarding_self_description";
const SESSION_STORAGE_KEY = "sivraj.session.v1";
const ONBOARDING_COMPLETION_STORAGE_KEY = "sivraj.onboarding.completed.v1";

loadNearestEnv({ quiet: true, from: import.meta.url });

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printUsage();
  process.exit(0);
}

if (!options.wallet) {
  options.wallet = await promptWalletAddress();
}

if (!options.wallet) {
  printUsage();
  process.exit(1);
}

const walletAddress = normalizeWallet(options.wallet);
const databaseUrl = process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
const client = new pg.Client({ connectionString: databaseUrl });

await client.connect();

try {
  await client.query("begin");

  const target = await loadTarget(client, walletAddress);
  if (!target) {
    throw new Error(`No Sui wallet account found for ${walletAddress}.`);
  }

  const deletedArtifacts = await countRows(
    client,
    `select count(*)::int as count
       from source_artifacts
      where twin_id = $1 and source_type = $2`,
    [target.twinId, ONBOARDING_SOURCE_TYPE],
  );
  const deletedIdentityProfiles = await countRows(
    client,
    "select count(*)::int as count from twin_identity_profiles where twin_id = $1",
    [target.twinId],
  );
  const deletedVoiceProfiles = await countRows(
    client,
    "select count(*)::int as count from twin_voice_profiles where twin_id = $1",
    [target.twinId],
  );
  const revokedSessions = await countRows(
    client,
    `select count(*)::int as count
       from refresh_sessions
      where wallet_address = $1 and revoked_at is null`,
    [walletAddress],
  );

  if (!options.dryRun) {
    await client.query(
      "delete from twin_identity_profiles where twin_id = $1",
      [target.twinId],
    );
    await client.query(
      "delete from twin_voice_profiles where twin_id = $1",
      [target.twinId],
    );
    await client.query(
      `delete from source_artifacts
        where twin_id = $1 and source_type = $2`,
      [target.twinId, ONBOARDING_SOURCE_TYPE],
    );
    await client.query(
      `update twins
          set name = $2,
              summary = null,
              current_goals = null,
              updated_at = now()
        where id = $1`,
      [target.twinId, DEFAULT_TWIN_NAME],
    );
    await client.query(
      `update users
          set display_name = null,
              onboarding_status = 'not_started',
              first_meet_intro_status = 'not_started',
              updated_at = now()
        where id = $1`,
      [target.userId],
    );
    await client.query(
      `update refresh_sessions
          set revoked_at = now(),
              updated_at = now()
        where wallet_address = $1 and revoked_at is null`,
      [walletAddress],
    );
  }

  if (options.dryRun) {
    await client.query("rollback");
  } else {
    await client.query("commit");
  }

  printSummary({
    dryRun: options.dryRun,
    walletAddress,
    userId: target.userId,
    twinId: target.twinId,
    deletedArtifacts,
    deletedIdentityProfiles,
    deletedVoiceProfiles,
    revokedSessions,
  });
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}

const CLI_FLAG_HANDLERS = {
  "--wallet": (parsed, args, index) => {
    parsed.wallet = args[index + 1] ?? "";
    return 1;
  },
  "--dry-run": (parsed) => {
    parsed.dryRun = true;
    return 0;
  },
  "--help": (parsed) => {
    parsed.help = true;
    return 0;
  },
  "-h": (parsed) => {
    parsed.help = true;
    return 0;
  },
};

function applyCliFlag(parsed, arg, args, index) {
  if (arg.startsWith("--wallet=")) {
    parsed.wallet = arg.slice("--wallet=".length);
    return 0;
  }

  const handler = CLI_FLAG_HANDLERS[arg];

  if (!handler) {
    throw new Error(`Unknown option: ${arg}`);
  }

  return handler(parsed, args, index);
}

function parseArgs(args) {
  const parsed = {
    wallet: process.env.SIVRAJ_RESET_WALLET ?? "",
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      continue;
    }

    index += applyCliFlag(parsed, arg, args, index);
  }

  return parsed;
}

async function promptWalletAddress() {
  if (!input.isTTY) {
    return "";
  }

  const rl = readline.createInterface({ input, output });

  try {
    const value = await rl.question("Sui wallet address: ");
    return value.trim();
  } finally {
    rl.close();
  }
}

function normalizeWallet(value) {
  try {
    return normalizeSuiAddress(value.trim());
  } catch {
    throw new Error("Expected --wallet to be a valid Sui address.");
  }
}

async function loadTarget(client, walletAddress) {
  const result = await client.query(
    `select users.id as user_id,
            twins.id as twin_id
       from wallet_accounts
       join users on users.id = wallet_accounts.user_id
       join twins on twins.user_id = users.id
      where wallet_accounts.chain = 'sui'
        and wallet_accounts.address = $1
      order by wallet_accounts.is_primary desc, twins.created_at asc
      limit 1`,
    [walletAddress],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    userId: String(row.user_id),
    twinId: String(row.twin_id),
  };
}

async function countRows(client, query, params) {
  const result = await client.query(query, params);
  return Number(result.rows[0]?.count ?? 0);
}

function printUsage() {
  console.log(`
Reset one wallet back to the beginning of onboarding.

Usage:
  pnpm onboarding:reset
  pnpm onboarding:reset -- --wallet 0x...
  pnpm onboarding:reset -- --wallet 0x... --dry-run

Options:
  --wallet <address>   Sui wallet address to reset. Prompts when omitted in a TTY.
  --dry-run            Show what would change, then roll back.
  --help               Show this help.
`);
}

function printSummary(summary) {
  const mode = summary.dryRun ? "Dry run complete" : "Onboarding reset complete";

  console.log(`${mode}.`);
  console.log(`Wallet: ${summary.walletAddress}`);
  console.log(`User: ${summary.userId}`);
  console.log(`Twin: ${summary.twinId}`);
  console.log(`Identity profiles removed: ${summary.deletedIdentityProfiles}`);
  console.log(`Voice profiles removed: ${summary.deletedVoiceProfiles}`);
  console.log(`Onboarding artifacts removed: ${summary.deletedArtifacts}`);
  console.log(`Refresh sessions revoked: ${summary.revokedSessions}`);

  if (!summary.dryRun) {
    console.log("");
    console.log("Then clear the browser session and reload:");
    console.log(
      `localStorage.removeItem(${JSON.stringify(SESSION_STORAGE_KEY)}); localStorage.removeItem(${JSON.stringify(ONBOARDING_COMPLETION_STORAGE_KEY)}); location.reload();`,
    );
  }
}
