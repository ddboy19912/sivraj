import { describe, expect, it } from "vitest";
import {
  createPrivateMemoryStorage,
  createPrivateMemoryStorageService,
} from "./private-memory-storage";
import {
  run_private_memory_stora_encrypts_content_before_storing_it_on_walrus,
  run_private_memory_stora_stores_client_encrypted_ciphertext_without_re_encryptin,
  run_private_memory_stora_does_not_require_worker_or_llm_env_to_build_storage_con
} from "./private-memory-storage.test-scenarios.js";

describe("private memory storage service", () => {
  it("encrypts content before storing it on Walrus", () => run_private_memory_stora_encrypts_content_before_storing_it_on_walrus());
});

describe("private memory storage service", () => {
  it("stores client-encrypted ciphertext without re-encrypting it in the API", () => run_private_memory_stora_stores_client_encrypted_ciphertext_without_re_encryptin());
});

describe("private memory storage service", () => {
  it("does not require worker or LLM env to build storage config", () => run_private_memory_stora_does_not_require_worker_or_llm_env_to_build_storage_con());
});
