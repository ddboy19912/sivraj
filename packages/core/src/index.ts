export type TwinId = string;
export type MemoryId = string;
export type ContextPacketId = string;

export type AgentScope =
  | "coding_agent"
  | "research_agent"
  | "strategy_agent"
  | "finance_agent"
  | "reflection_agent"
  | "full_access";

export type StorageMode = "dev_plaintext" | "encrypted_walrus";

export type Sensitivity = "public" | "private";

export const DEV_PLAINTEXT_STORAGE_WARNING =
  "DEV_ONLY_PLAINTEXT_MEMORY_STORAGE: raw memory content is stored in Postgres for local development only. Do not use with real user/private beta data.";

export const DEFAULT_MANUAL_MEMORY_STORAGE_MODE: StorageMode = "dev_plaintext";

export const ENCRYPTED_WALRUS_STORAGE_MODE: StorageMode = "encrypted_walrus";

export const DEFAULT_MANUAL_MEMORY_SENSITIVITY: Sensitivity = "private";
