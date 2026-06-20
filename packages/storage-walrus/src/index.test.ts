import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertWalrusStorageConfig,
  createWalrusReader,
  createWalrusStorage,
  parseWalrusBlobId,
} from "./index";
import {
  run_stores_encrypted_bytes_and_returns_a_durable_ref,
  run_rejects_missing_config,
  run_reads_encrypted_bytes_from_a_walrus_blob_ref,
  run_falls_back_to_an_aggregator_when_sdk_reads_fail,
  run_falls_back_to_an_aggregator_when_sdk_cannot_decode_slivers,
  run_classifies_sui_gas_selection_failures_as_insufficient_balance,
  run_classifies_insufficient_balance_when_balance_diagnostics_fail,
  run_classifies_wal_balance_failures_as_insufficient_balance,
  run_rejects_walrus_reads_when_bytes_do_not_match_the_expected_ha,
  run_parses_walrus_blob_refs
} from "./index.test-scenarios.js";

describe("Walrus storage adapter / stores encrypted bytes and returns a durable ", () => {
  it("stores encrypted bytes and returns a durable ref", () => run_stores_encrypted_bytes_and_returns_a_durable_ref());
});

describe("Walrus storage adapter / rejects missing config", () => {
  it("rejects missing config", () => run_rejects_missing_config());
});

describe("Walrus storage adapter / reads encrypted bytes from a Walrus blob ref", () => {
  it("reads encrypted bytes from a Walrus blob ref", () => run_reads_encrypted_bytes_from_a_walrus_blob_ref());
});

describe("Walrus storage adapter / falls back to an aggregator when SDK reads fa", () => {
  it("falls back to an aggregator when SDK reads fail", () => run_falls_back_to_an_aggregator_when_sdk_reads_fail());
});

describe("Walrus storage adapter / falls back when SDK cannot decode slivers", () => {
  it("falls back when SDK cannot decode slivers", () => run_falls_back_to_an_aggregator_when_sdk_cannot_decode_slivers());
});

describe("Walrus storage adapter / classifies SUI gas selection failures", () => {
  it("classifies SUI gas selection failures as insufficient balance", () => run_classifies_sui_gas_selection_failures_as_insufficient_balance());
  it("does not fail classification when balance diagnostics fail", () => run_classifies_insufficient_balance_when_balance_diagnostics_fail());
  it("classifies WAL balance failures as insufficient balance", () => run_classifies_wal_balance_failures_as_insufficient_balance());
});

describe("Walrus storage adapter / rejects Walrus reads when bytes do not match ", () => {
  it("rejects Walrus reads when bytes do not match the expected hash", () => run_rejects_walrus_reads_when_bytes_do_not_match_the_expected_ha());
});

describe("Walrus storage adapter / parses Walrus blob refs", () => {
  it("parses Walrus blob refs", () => run_parses_walrus_blob_refs());
});
