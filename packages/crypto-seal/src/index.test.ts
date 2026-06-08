import { describe, expect, it } from "vitest";
import {
  assertSealPolicyConfig,
  createSealEncryptor,
  parseSealKeyServers,
  type SealPolicyConfig,
} from "./index";
import {
  run_seal_encryption_adap_encrypts_with_the_configured_policy_and_returns_ciphert,
  run_seal_encryption_adap_parses_comma_separated_key_servers,
  run_seal_encryption_adap_parses_json_key_servers,
  run_seal_encryption_adap_rejects_impossible_threshold_config
} from "./index.test-scenarios.js";

describe("Seal encryption adapter", () => {
  it("encrypts with the configured policy and returns ciphertext metadata", () => run_seal_encryption_adap_encrypts_with_the_configured_policy_and_returns_ciphert());
});

describe("Seal encryption adapter", () => {
  it("parses comma-separated key servers", () => run_seal_encryption_adap_parses_comma_separated_key_servers());
});

describe("Seal encryption adapter", () => {
  it("parses JSON key servers", () => run_seal_encryption_adap_parses_json_key_servers());
});

describe("Seal encryption adapter", () => {
  it("rejects impossible threshold config", () => run_seal_encryption_adap_rejects_impossible_threshold_config());
});
