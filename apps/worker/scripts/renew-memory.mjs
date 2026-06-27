#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { promisify } from "node:util";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const execFileAsync = promisify(execFile);
const DEFAULT_DATABASE_URL = "postgresql://sivraj:sivraj@localhost:5432/sivraj";
const DEFAULT_AGGREGATORS = {
  mainnet: "https://aggregator.walrus-mainnet.walrus.space",
  testnet: "https://aggregator.walrus-testnet.walrus.space",
};
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workerDir = path.resolve(scriptDir, "..");
const DEFAULT_WALRUS_BIN = path.join(workerDir, "bin", process.platform === "win32" ? "walrus.exe" : "walrus");
const DEFAULT_WALRUS_CONFIG = path.join(workerDir, "walrus", "client_config.yaml");
const RENEWABLE_STATUSES = [
  "verified_available",
  "renewed",
  "expiring_soon",
  "renewing",
];

loadNearestEnv(import.meta.url);

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printUsage();
  process.exit(0);
}

prepareWalrusCliDefaults(options);

if (!options.yes && !options.dryRun) {
  options.dryRun = await promptDryRunDefault();
}

const databaseUrl = process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
const client = new pg.Client({ connectionString: databaseUrl });

try {
  await client.connect();

  const currentEpoch = options.currentEpoch ?? await readCurrentWalrusEpoch(options);
  const renewBeforeEpochs = options.renewBeforeEpochs;
  const dueEndEpoch = currentEpoch + renewBeforeEpochs;
  const fragments = await loadRenewalCandidates(client, {
    dueEndEpoch,
    limit: options.limit,
    twinId: options.twinId,
  });
  const plan = splitRenewalPlan(fragments, currentEpoch);

  printPlan({
    currentEpoch,
    dueEndEpoch,
    renewBeforeEpochs,
    epochsExtended: options.epochsExtended,
    dryRun: options.dryRun,
    expiredFragments: plan.expired,
    renewableFragments: plan.renewable,
  });

  if (!options.dryRun && plan.expired.length > 0) {
    await markExpiredFragments(client, plan.expired);
  }

  if (!options.dryRun && plan.renewable.length > 0) {
    const results = [];

    for (const fragment of plan.renewable) {
      results.push(await renewFragment(client, fragment, options));
    }

    printResults(results);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}

function parseArgs(args) {
  const parsed = {
    currentEpoch: readOptionalInteger(process.env.WALRUS_CURRENT_EPOCH),
    dryRun: false,
    epochsExtended: readInteger(process.env.WALRUS_MEMORY_EXTEND_EPOCHS, readInteger(process.env.WALRUS_EPOCHS, 30)),
    help: false,
    limit: readInteger(process.env.WALRUS_MEMORY_RENEW_LIMIT, 25),
    renewBeforeEpochs: readInteger(process.env.WALRUS_MEMORY_RENEW_BEFORE_EPOCHS, 2),
    twinId: "",
    walrusBin: process.env.WALRUS_CLI_BIN?.trim() || (existsSync(DEFAULT_WALRUS_BIN) ? DEFAULT_WALRUS_BIN : "walrus"),
    walrusConfig: process.env.WALRUS_CONFIG?.trim() || (existsSync(DEFAULT_WALRUS_CONFIG) ? DEFAULT_WALRUS_CONFIG : ""),
    walrusContext: process.env.WALRUS_CONTEXT?.trim() || readWalrusContext(process.env.WALRUS_NETWORK ?? process.env.SUI_NETWORK),
    walrusRpcUrl: process.env.SUI_RPC_URL?.trim() || "",
    walrusWallet: process.env.WALRUS_WALLET?.trim() || "",
    yes: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    if (arg === "--yes" || arg === "-y") {
      parsed.yes = true;
      continue;
    }

    index += applyOptionWithValue(parsed, arg, args, index);
  }

  assertPositiveInteger(parsed.epochsExtended, "--epochs");
  assertPositiveInteger(parsed.limit, "--limit");
  assertNonNegativeInteger(parsed.renewBeforeEpochs, "--renew-before-epochs");

  return parsed;
}

function prepareWalrusCliDefaults(options) {
  if (options.walrusWallet || !process.env.SUI_PRIVATE_KEY?.trim()) {
    return;
  }

  const walletDir = path.join(os.tmpdir(), "sivraj-walrus-wallet");
  const keystorePath = path.join(walletDir, "sui.keystore");
  const walletPath = path.join(walletDir, "client.yaml");
  const rpcUrl = options.walrusRpcUrl || readSuiRpcUrl(options.walrusContext);
  const activeEnv = options.walrusContext || "testnet";

  mkdirSync(walletDir, { recursive: true, mode: 0o700 });
  chmodSync(walletDir, 0o700);
  writeFileSync(keystorePath, `${JSON.stringify([process.env.SUI_PRIVATE_KEY.trim()], null, 2)}\n`, {
    mode: 0o600,
  });
  chmodSync(keystorePath, 0o600);
  writeFileSync(walletPath, [
    "---",
    "keystore:",
    `  File: ${keystorePath}`,
    "envs:",
    `  - alias: ${activeEnv}`,
    `    rpc: "${rpcUrl}"`,
    "    ws: ~",
    "    basic_auth: ~",
    `active_env: ${activeEnv}`,
    "",
  ].join("\n"), {
    mode: 0o600,
  });
  chmodSync(walletPath, 0o600);

  options.walrusWallet = walletPath;
}

function readWalrusContext(value) {
  return value === "mainnet" || value === "testnet" || value === "devnet" || value === "localnet"
    ? value
    : "testnet";
}

function readSuiRpcUrl(context) {
  if (process.env.SUI_RPC_URL?.trim()) {
    return process.env.SUI_RPC_URL.trim();
  }

  if (context === "mainnet") {
    return "https://fullnode.mainnet.sui.io:443";
  }

  if (context === "devnet") {
    return "https://fullnode.devnet.sui.io:443";
  }

  if (context === "localnet") {
    return "http://127.0.0.1:9000";
  }

  return "https://fullnode.testnet.sui.io:443";
}

function applyOptionWithValue(parsed, arg, args, index) {
  const options = {
    "--current-epoch": "currentEpoch",
    "--epochs": "epochsExtended",
    "--limit": "limit",
    "--renew-before-epochs": "renewBeforeEpochs",
    "--twin": "twinId",
    "--walrus-bin": "walrusBin",
    "--walrus-config": "walrusConfig",
    "--walrus-context": "walrusContext",
    "--wallet": "walrusWallet",
  };
  const equals = arg.indexOf("=");
  const name = equals >= 0 ? arg.slice(0, equals) : arg;
  const key = options[name];

  if (!key) {
    throw new Error(`Unknown option: ${arg}`);
  }

  const rawValue = equals >= 0 ? arg.slice(equals + 1) : args[index + 1];
  if (!rawValue) {
    throw new Error(`Missing value for ${name}`);
  }

  if (key === "currentEpoch") {
    parsed.currentEpoch = parseRequiredInteger(rawValue, name);
  } else if (key === "epochsExtended" || key === "limit" || key === "renewBeforeEpochs") {
    parsed[key] = parseRequiredInteger(rawValue, name);
  } else {
    parsed[key] = rawValue.trim();
  }

  return equals >= 0 ? 0 : 1;
}

async function promptDryRunDefault() {
  if (!input.isTTY) {
    return true;
  }

  const rl = readline.createInterface({ input, output });

  try {
    const answer = await rl.question("Run as dry-run first? [Y/n] ");
    return !/^n(o)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function readCurrentWalrusEpoch(options) {
  const args = ["info", "epoch", "--json", ...walrusCliConfigArgs(options, { includeRpcUrl: false })];
  const { stdout, stderr } = await execFileAsync(options.walrusBin, args, {
    env: process.env,
    maxBuffer: 1024 * 1024,
  });
  const parsed = parseJsonFromWalrusOutput(stdout || stderr);
  const currentEpoch = parsed?.currentEpoch;

  if (!Number.isInteger(currentEpoch)) {
    throw new Error("Walrus CLI did not return currentEpoch. Pass --current-epoch manually.");
  }

  return currentEpoch;
}

async function loadRenewalCandidates(client, input) {
  const params = [input.dueEndEpoch, input.limit];
  const twinFilter = input.twinId
    ? `and twin_id = $${params.push(input.twinId)}`
    : "";
  const result = await client.query(
    `
      select id,
             twin_id,
             source_artifact_id,
             content_storage_ref,
             content_sha256,
             storage_status,
             coalesce(walrus_network, metadata #>> '{walrus,network}') as walrus_network,
             coalesce(walrus_blob_id, metadata #>> '{walrus,blobId}') as walrus_blob_id,
             coalesce(walrus_blob_object_id, metadata #>> '{walrus,blobObjectId}') as walrus_blob_object_id,
             coalesce(walrus_start_epoch, nullif(metadata #>> '{walrus,startEpoch}', '')::integer) as walrus_start_epoch,
             coalesce(walrus_end_epoch, nullif(metadata #>> '{walrus,endEpoch}', '')::integer) as walrus_end_epoch,
             storage_renewal_due_epoch
        from memory_fragments
       where storage_provider = 'walrus'
         and content_storage_ref is not null
         and coalesce(walrus_blob_object_id, metadata #>> '{walrus,blobObjectId}') is not null
         and coalesce(walrus_end_epoch, nullif(metadata #>> '{walrus,endEpoch}', '')::integer) is not null
         and coalesce(walrus_end_epoch, nullif(metadata #>> '{walrus,endEpoch}', '')::integer) <= $1
         and storage_status = any($${params.push(RENEWABLE_STATUSES)}::memory_storage_status[])
         ${twinFilter}
       order by coalesce(walrus_end_epoch, nullif(metadata #>> '{walrus,endEpoch}', '')::integer) asc, created_at asc
       limit $2
    `,
    params,
  );

  return result.rows;
}

function splitRenewalPlan(fragments, currentEpoch) {
  return {
    expired: fragments.filter((fragment) => Number(fragment.walrus_end_epoch) <= currentEpoch),
    renewable: fragments.filter((fragment) => Number(fragment.walrus_end_epoch) > currentEpoch),
  };
}

async function markExpiredFragments(client, fragments) {
  for (const fragment of fragments) {
    await client.query(
      `
        update memory_fragments
           set storage_status = 'expired',
               storage_last_read_error_code = 'expired_storage',
               storage_last_read_error_message = $2,
               updated_at = now()
         where id = $1
      `,
      [
        fragment.id,
        `Walrus blob end epoch ${fragment.walrus_end_epoch} is not after current epoch; expired blobs cannot be extended.`,
      ],
    );
  }
}

async function renewFragment(client, fragment, options) {
  await markRenewing(client, fragment.id);

  try {
    const extend = await runWalrusExtend(fragment, options);
    const verify = await verifyFragment(fragment);
    const newEndEpoch = readNewEndEpoch(extend, fragment, options);

    await client.query(
      `
        update memory_fragments
           set storage_status = 'renewed',
               walrus_end_epoch = $2,
               storage_verified_at = now(),
               storage_last_read_at = now(),
               storage_last_read_error_code = null,
               storage_last_read_error_message = null,
               storage_renewal_due_epoch = $3,
               updated_at = now()
         where id = $1
      `,
      [
        fragment.id,
        newEndEpoch,
        Math.max(newEndEpoch - options.renewBeforeEpochs, 0),
      ],
    );

    return {
      id: fragment.id,
      status: "renewed",
      blobObjectId: fragment.walrus_blob_object_id,
      newEndEpoch,
      verifyBytes: verify.bytes,
    };
  } catch (error) {
    const errorCode = classifyRenewalError(error);
    await client.query(
      `
        update memory_fragments
           set storage_status = $2,
               storage_last_read_error_code = $3,
               storage_last_read_error_message = $4,
               storage_renewal_attempted_at = now(),
               updated_at = now()
         where id = $1
      `,
      [
        fragment.id,
        errorCode === "expired_storage" ? "expired" : "read_failed",
        errorCode,
        errorMessage(error).slice(0, 1000),
      ],
    );

    return {
      id: fragment.id,
      status: "failed",
      blobObjectId: fragment.walrus_blob_object_id,
      error: errorMessage(error),
    };
  }
}

async function markRenewing(client, memoryFragmentId) {
  await client.query(
    `
      update memory_fragments
         set storage_status = 'renewing',
             storage_renewal_attempted_at = now(),
             updated_at = now()
       where id = $1
    `,
    [memoryFragmentId],
  );
}

async function runWalrusExtend(fragment, options) {
  const args = [
    "extend",
    "--blob-obj-id",
    fragment.walrus_blob_object_id,
    "--epochs-extended",
    String(options.epochsExtended),
    "--json",
    ...walrusCliConfigArgs(options, { includeRpcUrl: false }),
  ];
  const { stdout, stderr } = await execFileAsync(options.walrusBin, args, {
    env: process.env,
    maxBuffer: 1024 * 1024 * 4,
  });

  return parseJsonFromWalrusOutput(stdout || stderr) ?? { stdout, stderr };
}

async function verifyFragment(fragment) {
  const blobId = parseWalrusBlobId(fragment.content_storage_ref);
  const aggregatorUrl = readAggregatorUrl(fragment.walrus_network);

  if (!blobId || !aggregatorUrl) {
    throw new Error("Cannot verify renewed fragment: missing blob id or aggregator URL");
  }

  const response = await fetch(`${aggregatorUrl}/v1/blobs/${encodeURIComponent(blobId)}`);

  if (!response.ok) {
    throw new Error(`Walrus aggregator returned ${response.status} ${response.statusText}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const expectedSha256 = normalizeSha256(fragment.content_sha256);

  if (expectedSha256 && sha256Hex(bytes) !== expectedSha256) {
    throw new Error("Walrus blob SHA-256 mismatch after renewal");
  }

  return { bytes: bytes.length };
}

function readNewEndEpoch(output, fragment, options) {
  const candidates = [
    output?.blob?.storage?.endEpoch,
    output?.blob?.storage?.end_epoch,
    output?.blobObject?.storage?.endEpoch,
    output?.blobObject?.storage?.end_epoch,
    output?.endEpoch,
    output?.end_epoch,
  ];

  for (const candidate of candidates) {
    if (Number.isInteger(candidate)) {
      return candidate;
    }
  }

  return Number(fragment.walrus_end_epoch) + options.epochsExtended;
}

function walrusCliConfigArgs(options, settings) {
  return [
    ...(options.walrusConfig ? ["--config", options.walrusConfig] : []),
    ...(options.walrusContext ? ["--context", options.walrusContext] : []),
    ...(options.walrusWallet ? ["--wallet", options.walrusWallet] : []),
    ...(settings.includeRpcUrl && options.walrusRpcUrl ? ["--rpc-url", options.walrusRpcUrl] : []),
  ];
}

function printPlan(plan) {
  const candidates = plan.expiredFragments.length + plan.renewableFragments.length;
  console.log("");
  console.log("Memory renewal plan");
  console.log("-------------------");
  console.log(`current epoch:        ${plan.currentEpoch}`);
  console.log(`renew before epochs:  ${plan.renewBeforeEpochs}`);
  console.log(`due end epoch:        ${plan.dueEndEpoch}`);
  console.log(`epochs to extend:     ${plan.epochsExtended}`);
  console.log(`dry run:              ${plan.dryRun ? "yes" : "no"}`);
  console.log(`candidates:           ${candidates}`);
  console.log(`expired skipped:      ${plan.expiredFragments.length}`);
  console.log(`renewable:            ${plan.renewableFragments.length}`);

  for (const fragment of plan.expiredFragments) {
    printFragmentPlanRow(fragment, "expired_skip");
  }

  for (const fragment of plan.renewableFragments) {
    printFragmentPlanRow(fragment, "renew");
  }

  console.log("");
}

function printFragmentPlanRow(fragment, action) {
    console.log("");
    console.log(`- fragment:           ${fragment.id}`);
    console.log(`  action:             ${action}`);
    console.log(`  twin:               ${fragment.twin_id}`);
    console.log(`  status:             ${fragment.storage_status}`);
    console.log(`  blob object id:     ${fragment.walrus_blob_object_id}`);
    console.log(`  blob id:            ${fragment.walrus_blob_id ?? parseWalrusBlobId(fragment.content_storage_ref)}`);
    console.log(`  end epoch:          ${fragment.walrus_end_epoch}`);
}

function printResults(results) {
  console.log("");
  console.log("Memory renewal results");
  console.log("----------------------");

  for (const result of results) {
    if (result.status === "renewed") {
      console.log(`- renewed ${result.id}: endEpoch=${result.newEndEpoch}, bytes=${result.verifyBytes}`);
    } else {
      console.log(`- failed ${result.id}: ${result.error}`);
    }
  }

  console.log("");
}

function parseJsonFromWalrusOutput(output) {
  const text = String(output ?? "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start < 0 || end < start) {
    return null;
  }

  return JSON.parse(text.slice(start, end + 1));
}

function parseWalrusBlobId(rawStorageRef) {
  const prefix = "walrus://blob/";
  return rawStorageRef?.startsWith(prefix) ? rawStorageRef.slice(prefix.length) : "";
}

function readAggregatorUrl(network) {
  const configured = process.env.WALRUS_AGGREGATOR_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  return DEFAULT_AGGREGATORS[network]?.replace(/\/+$/, "") ?? "";
}

function classifyRenewalError(error) {
  const message = errorMessage(error).toLowerCase();
  if (message.includes("assert_certified_not_expired") || message.includes("expired")) {
    return "expired_storage";
  }
  if (message.includes("404") || message.includes("not found") || message.includes("does not exist")) {
    return "blob_not_found";
  }
  if (message.includes("sha-256 mismatch")) {
    return "sha_mismatch";
  }
  if (message.includes("insufficient") || message.includes("balance")) {
    return "walrus_insufficient_balance";
  }
  return "renewal_failed";
}

function normalizeSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value)
    ? value.toLowerCase()
    : "";
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function errorMessage(error) {
  if (error instanceof Error) {
    const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
    return stderr || error.message;
  }

  return String(error);
}

function readInteger(value, fallback) {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readOptionalInteger(value) {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRequiredInteger(value, name) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be an integer`);
  }
  return parsed;
}

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function printUsage() {
  console.log(`
Usage:
  pnpm memory:renew
  pnpm memory:renew --dry-run
  pnpm memory:renew --yes --epochs 30

Options:
  --dry-run                    Print due fragments without extending.
  --yes, -y                    Run without the dry-run prompt.
  --current-epoch <epoch>      Skip walrus info epoch and use this epoch.
  --renew-before-epochs <n>    Renew blobs ending within n epochs. Default: 2.
  --epochs <n>                 Number of epochs to extend. Default: WALRUS_MEMORY_EXTEND_EPOCHS, WALRUS_EPOCHS, or 30.
  --limit <n>                  Max fragments to renew. Default: 25.
  --twin <id>                  Restrict renewal to one twin.
  --walrus-bin <path>          Walrus CLI binary. Default: apps/worker/bin/walrus, then PATH.
  --walrus-config <path>       Walrus config file. Default: apps/worker/walrus/client_config.yaml.
  --walrus-context <name>      Walrus config context.
  --wallet <path>              Sui wallet config for Walrus CLI. Default: temp wallet from SUI_PRIVATE_KEY.

Environment:
  DATABASE_URL
  WALRUS_AGGREGATOR_URL
  WALRUS_CLI_BIN
  WALRUS_CONFIG
  WALRUS_CONTEXT
  WALRUS_WALLET
  WALRUS_MEMORY_EXTEND_EPOCHS
  WALRUS_MEMORY_RENEW_BEFORE_EPOCHS
  WALRUS_MEMORY_RENEW_LIMIT
`);
}

function loadNearestEnv(fromUrl) {
  const startDir = path.dirname(fileURLToPath(fromUrl));
  const candidates = [
    path.join(process.cwd(), ".env"),
    ...ancestorDirs(startDir).map((dir) => path.join(dir, ".env")),
  ];
  const seen = new Set();

  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);

    if (existsSync(candidate)) {
      loadEnvFile(candidate);
      return;
    }
  }
}

function ancestorDirs(startDir) {
  const dirs = [];
  let current = startDir;

  while (true) {
    dirs.push(current);
    const parent = path.dirname(current);

    if (parent === current) {
      return dirs;
    }

    current = parent;
  }
}

function loadEnvFile(filePath) {
  const content = readFileSync(filePath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);

    if (!parsed || process.env[parsed.key] !== undefined) {
      continue;
    }

    process.env[parsed.key] = parsed.value;
  }
}

function parseEnvLine(line) {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const separator = trimmed.indexOf("=");

  if (separator <= 0) {
    return null;
  }

  const key = trimmed.slice(0, separator).trim();
  const rawValue = trimmed.slice(separator + 1).trim();
  const value = rawValue.replace(/^['"]|['"]$/g, "");

  return { key, value };
}
