import { loadMcpServerConfig, type McpServerConfig } from "@sivraj/config";

export type McpConfig = McpServerConfig;

export function loadMcpConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  return loadMcpServerConfig(env);
}
