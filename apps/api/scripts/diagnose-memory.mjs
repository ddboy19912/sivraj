#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const DEFAULT_DATABASE_URL = "postgresql://sivraj:sivraj@localhost:5432/sivraj";
const DEFAULT_AGGREGATORS = {
  mainnet: "https://aggregator.walrus-mainnet.walrus.space",
  testnet: "https://aggregator.walrus-testnet.walrus.space",
};

loadNearestEnv(import.meta.url);

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printUsage();
  process.exit(0);
}

if (!options.id) {
  options.id = await promptMemoryId();
}

if (!options.id) {
  printUsage();
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
const client = new pg.Client({ connectionString: databaseUrl });

try {
  await client.connect();

  const target = await loadMemoryTarget(client, options.id);

  if (!target) {
    throw new Error(`No source artifact or memory fragment found for ${options.id}.`);
  }

  const refs = buildStorageRefs(target);
  const results = [];

  for (const ref of refs) {
    results.push(await diagnoseStorageRef(ref));
  }

  printReport({
    inputId: options.id,
    target,
    results,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}

function parseArgs(args) {
  const parsed = {
    id: process.env.SIVRAJ_MEMORY_DIAGNOSE_ID ?? "",
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--artifact" || arg === "--id") {
      parsed.id = args[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--artifact=")) {
      parsed.id = arg.slice("--artifact=".length);
      continue;
    }

    if (arg.startsWith("--id=")) {
      parsed.id = arg.slice("--id=".length);
      continue;
    }

    if (!arg.startsWith("-") && !parsed.id) {
      parsed.id = arg;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  parsed.id = parsed.id.trim();
  return parsed;
}

async function promptMemoryId() {
  if (!input.isTTY) {
    return "";
  }

  const rl = readline.createInterface({ input, output });

  try {
    const value = await rl.question("Source artifact or memory fragment id: ");
    return value.trim();
  } finally {
    rl.close();
  }
}

async function loadMemoryTarget(client, id) {
  const byArtifact = await client.query(
    `
      select source_artifacts.id as source_artifact_id,
             source_artifacts.twin_id,
             source_artifacts.source_type,
             source_artifacts.uri,
             source_artifacts.raw_storage_ref,
             source_artifacts.hash,
             source_artifacts.metadata as source_metadata,
             source_artifacts.ingestion_status,
             source_artifacts.created_at as source_created_at,
             source_artifacts.updated_at as source_updated_at,
             memory_fragments.id as memory_fragment_id,
             memory_fragments.content_storage_ref,
             memory_fragments.content_sha256,
             memory_fragments.storage_status,
             memory_fragments.storage_provider,
             memory_fragments.walrus_network,
             memory_fragments.walrus_blob_id,
             memory_fragments.walrus_blob_object_id,
             memory_fragments.walrus_start_epoch,
             memory_fragments.walrus_end_epoch,
             memory_fragments.storage_verified_at,
             memory_fragments.storage_last_read_at,
             memory_fragments.storage_last_read_error_code,
             memory_fragments.storage_last_read_error_message,
             memory_fragments.storage_renewal_due_epoch,
             memory_fragments.metadata as memory_fragment_metadata,
             memory_fragments.created_at as memory_fragment_created_at,
             memory_fragments.updated_at as memory_fragment_updated_at
        from source_artifacts
        left join memory_fragments on memory_fragments.source_artifact_id = source_artifacts.id
       where source_artifacts.id = $1
       limit 1
    `,
    [id],
  );

  if (byArtifact.rows[0]) {
    return byArtifact.rows[0];
  }

  const byFragment = await client.query(
    `
      select source_artifacts.id as source_artifact_id,
             source_artifacts.twin_id,
             source_artifacts.source_type,
             source_artifacts.uri,
             source_artifacts.raw_storage_ref,
             source_artifacts.hash,
             source_artifacts.metadata as source_metadata,
             source_artifacts.ingestion_status,
             source_artifacts.created_at as source_created_at,
             source_artifacts.updated_at as source_updated_at,
             memory_fragments.id as memory_fragment_id,
             memory_fragments.content_storage_ref,
             memory_fragments.content_sha256,
             memory_fragments.storage_status,
             memory_fragments.storage_provider,
             memory_fragments.walrus_network,
             memory_fragments.walrus_blob_id,
             memory_fragments.walrus_blob_object_id,
             memory_fragments.walrus_start_epoch,
             memory_fragments.walrus_end_epoch,
             memory_fragments.storage_verified_at,
             memory_fragments.storage_last_read_at,
             memory_fragments.storage_last_read_error_code,
             memory_fragments.storage_last_read_error_message,
             memory_fragments.storage_renewal_due_epoch,
             memory_fragments.metadata as memory_fragment_metadata,
             memory_fragments.created_at as memory_fragment_created_at,
             memory_fragments.updated_at as memory_fragment_updated_at
        from memory_fragments
        join source_artifacts on source_artifacts.id = memory_fragments.source_artifact_id
       where memory_fragments.id = $1
       limit 1
    `,
    [id],
  );

  return byFragment.rows[0] ?? null;
}

function buildStorageRefs(target) {
  return [
    {
      label: "source artifact",
      rawStorageRef: target.raw_storage_ref,
      expectedSha256: target.hash,
      metadata: target.source_metadata,
    },
    {
      label: "memory fragment",
      rawStorageRef: target.content_storage_ref,
      expectedSha256: target.content_sha256,
      metadata: target.memory_fragment_metadata,
      walrusNetwork: target.walrus_network,
      walrusBlobId: target.walrus_blob_id,
      walrusBlobObjectId: target.walrus_blob_object_id,
      walrusStartEpoch: target.walrus_start_epoch,
      walrusEndEpoch: target.walrus_end_epoch,
    },
  ].filter((ref) => Boolean(ref.rawStorageRef));
}

async function diagnoseStorageRef(ref) {
  const blobId = parseWalrusBlobId(ref.rawStorageRef);
  const walrus = readWalrusMetadata(ref.metadata);
  const network = ref.walrusNetwork || process.env.WALRUS_NETWORK?.trim() || process.env.SUI_NETWORK?.trim() || "unknown";
  const aggregatorUrl = readAggregatorUrl(network);

  if (!blobId) {
    return {
      ...ref,
      network,
      aggregatorUrl,
      walrus,
      status: ref.rawStorageRef?.startsWith("walrus://blob/")
        ? "invalid_walrus_ref"
        : "not_walrus_ref",
      diagnosis: "metadata_mismatch",
    };
  }

  if (!aggregatorUrl) {
    return {
      ...ref,
      blobId,
      network,
      aggregatorUrl,
      walrus,
      status: "aggregator_not_configured",
      diagnosis: "missing_diagnostic_config",
    };
  }

  const startedAt = Date.now();

  try {
    const response = await fetch(`${aggregatorUrl}/v1/blobs/${encodeURIComponent(blobId)}`);
    const durationMs = Date.now() - startedAt;

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ...ref,
        blobId,
        network,
        aggregatorUrl,
        walrus,
        durationMs,
        status: response.status === 404 ? "blob_not_found" : "http_error",
        httpStatus: response.status,
        httpStatusText: response.statusText,
        aggregatorError: body.slice(0, 500),
        diagnosis: response.status === 404 ? diagnoseMissingBlob(walrus) : "aggregator_read_failed",
      };
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const actualSha256 = sha256Hex(bytes);
    const expectedSha256 = normalizeSha256(ref.expectedSha256);
    const shaMatches = expectedSha256 ? actualSha256 === expectedSha256 : null;

    return {
      ...ref,
      blobId,
      network,
      aggregatorUrl,
      walrus,
      durationMs,
      status: shaMatches === false ? "sha_mismatch" : "ok",
      bytes: bytes.length,
      expectedSha256,
      actualSha256,
      diagnosis: shaMatches === false ? "metadata_mismatch" : "healthy",
    };
  } catch (error) {
    return {
      ...ref,
      blobId,
      network,
      aggregatorUrl,
      walrus,
      durationMs: Date.now() - startedAt,
      status: "network_failed",
      error: error instanceof Error ? error.message : String(error),
      diagnosis: "aggregator_unreachable",
    };
  }
}

function readWalrusMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const walrus = metadata.walrus;
  return walrus && typeof walrus === "object" ? walrus : null;
}

function readAggregatorUrl(network) {
  const configured = process.env.WALRUS_AGGREGATOR_URL?.trim();

  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  return DEFAULT_AGGREGATORS[network]?.replace(/\/+$/, "") ?? "";
}

function parseWalrusBlobId(rawStorageRef) {
  const prefix = "walrus://blob/";

  if (!rawStorageRef?.startsWith(prefix)) {
    return "";
  }

  return rawStorageRef.slice(prefix.length).trim();
}

function diagnoseMissingBlob(walrus) {
  if (!walrus) {
    return "missing_walrus_metadata";
  }

  return "missing_blob_or_expired_storage";
}

function normalizeSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value)
    ? value.toLowerCase()
    : "";
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function printReport(report) {
  const { target, results } = report;

  console.log("");
  console.log("Memory diagnostic");
  console.log("-----------------");
  console.log(`input id:             ${report.inputId}`);
  console.log(`source artifact id:   ${target.source_artifact_id}`);
  console.log(`memory fragment id:   ${target.memory_fragment_id ?? "(none)"}`);
  console.log(`twin id:              ${target.twin_id}`);
  console.log(`source type:          ${target.source_type}`);
  console.log(`ingestion status:     ${target.ingestion_status}`);
  console.log(`source created:       ${formatDate(target.source_created_at)}`);
  console.log(`fragment created:     ${formatDate(target.memory_fragment_created_at)}`);
  console.log(`storage status:       ${target.storage_status ?? "(legacy)"}`);
  console.log(`storage verified:     ${formatDate(target.storage_verified_at)}`);
  console.log(`last read:            ${formatDate(target.storage_last_read_at)}`);
  console.log(`last read error:      ${target.storage_last_read_error_code ?? "(none)"}`);
  console.log(`renewal due epoch:    ${target.storage_renewal_due_epoch ?? "(unknown)"}`);

  for (const result of results) {
    console.log("");
    console.log(`${result.label}`);
    console.log("-".repeat(result.label.length));
    console.log(`storage ref:          ${result.rawStorageRef}`);
    console.log(`blob id:              ${result.blobId ?? "(none)"}`);
    console.log(`network:              ${result.network}`);
    console.log(`aggregator:           ${result.aggregatorUrl || "(none)"}`);
    console.log(`status:               ${result.status}`);
    console.log(`diagnosis:            ${result.diagnosis}`);
    console.log(`duration:             ${formatDuration(result.durationMs)}`);

    if (result.httpStatus) {
      console.log(`http:                 ${result.httpStatus} ${result.httpStatusText}`);
    }

    if (result.bytes !== undefined) {
      console.log(`bytes:                ${result.bytes}`);
    }

    if (result.expectedSha256) {
      console.log(`expected sha256:      ${result.expectedSha256}`);
      console.log(`actual sha256:        ${result.actualSha256}`);
    }

    if (result.walrus || result.walrusBlobObjectId || result.walrusEndEpoch !== null) {
      console.log(`blob object id:       ${readValue(result.walrusBlobObjectId ?? result.walrus?.blobObjectId)}`);
      console.log(`start epoch:          ${readValue(result.walrusStartEpoch ?? result.walrus?.startEpoch)}`);
      console.log(`end epoch:            ${readValue(result.walrusEndEpoch ?? result.walrus?.endEpoch)}`);
      console.log(`size:                 ${readValue(result.walrus?.size)}`);
    }

    if (result.aggregatorError) {
      console.log(`aggregator error:     ${result.aggregatorError}`);
    }

    if (result.error) {
      console.log(`error:                ${result.error}`);
    }
  }

  console.log("");
  console.log("Recommended next step");
  console.log("---------------------");
  console.log(recommendNextStep(results));
  console.log("");
}

function recommendNextStep(results) {
  if (results.some((result) => result.status === "blob_not_found")) {
    return "Inspect Walrus endEpoch/current epoch and upload logs. If storage expired, re-store/renew this memory and add renewal before expiry.";
  }

  if (results.some((result) => result.status === "sha_mismatch")) {
    return "Treat this as metadata corruption: do not use the fragment until the DB hash/storage ref is repaired.";
  }

  if (results.some((result) => result.status === "network_failed")) {
    return "Retry against another aggregator or verify local network/DNS before marking the memory unavailable.";
  }

  if (results.every((result) => result.status === "ok")) {
    return "Walrus bytes are available. If chat still fails, investigate Seal decrypt policy/key-server access next.";
  }

  return "Review the status above; the diagnostic could not prove a healthy Walrus read.";
}

function readValue(value) {
  return value === undefined || value === null || value === "" ? "(unknown)" : String(value);
}

function formatDate(value) {
  return value instanceof Date ? value.toISOString() : readValue(value);
}

function formatDuration(value) {
  return typeof value === "number" ? `${value}ms` : "(not run)";
}

function printUsage() {
  console.log(`
Usage:
  pnpm memory:diagnose
  pnpm memory:diagnose <source-artifact-or-memory-fragment-id>
  pnpm memory:diagnose --artifact <source-artifact-id>

Environment:
  DATABASE_URL
  WALRUS_NETWORK or SUI_NETWORK
  WALRUS_AGGREGATOR_URL
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
