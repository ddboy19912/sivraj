import { createHash } from "node:crypto";
import {
  buildEncryptedAgentWritebackRequestBody,
  buildAgentWritebackEncryptionArtifacts,
  buildEncryptedPayloadBody,
  normalizeAgentWritebackFields,
  readSuiNetwork,
} from "@sivraj/core";
import {
  assertSealPolicyConfig,
  createSealEncryptor,
  parseSealKeyServers,
  type SealEncryptor,
} from "@sivraj/crypto-seal";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import type { AgentWritebackArgs } from "./sivraj-client.js";
import type { McpConfig } from "./env.js";

export type EncryptedAgentWritebackBody = {
  agentName?: string;
  repo?: string;
  branch?: string;
  taskSummarySha256: string;
  counts: {
    filesTouched: number;
    commandsRun: number;
    testsRun: number;
    decisions: number;
    bugsFound: number;
    followUps: number;
    userCorrections: number;
  };
  encryptedPayload: {
    ciphertextBase64: string;
    ciphertextSha256: string;
    seal: {
      packageId: string;
      policyId: string;
      threshold: number;
      keyServerObjectIds: string[];
    };
  };
};

export type AgentWritebackEncryptor = {
  encryptWriteback(args: AgentWritebackArgs): Promise<EncryptedAgentWritebackBody>;
};

export function createMcpWritebackEncryptor(config: McpConfig): AgentWritebackEncryptor | null {
  if (config.writebackEncryption !== "client") {
    return null;
  }

  if (!config.seal || !config.sui) {
    throw new Error("Client-side MCP writeback encryption requires SIVRAJ_SEAL_* and SIVRAJ_SUI_RPC_URL.");
  }

  const policy = {
    packageId: config.seal.packageId,
    policyId: config.seal.policyId,
    threshold: config.seal.threshold,
    keyServers: parseSealKeyServers(config.seal.keyServers),
  };

  assertSealPolicyConfig(policy);

  const seal = createSealEncryptor({
    suiClient: new SuiGrpcClient({
      network: readSuiNetwork(config.sui.network),
      baseUrl: config.sui.rpcUrl,
    }),
    policy,
  });

  return createAgentWritebackEncryptor({
    twinId: config.twinId,
    seal,
  });
}

function createAgentWritebackEncryptor(params: {
  twinId: string;
  seal: SealEncryptor;
}): AgentWritebackEncryptor {
  return {
    async encryptWriteback(args) {
      const fields = normalizeAgentWritebackFields(args);
      const artifacts = buildAgentWritebackEncryptionArtifacts({
        twinId: params.twinId,
        importer: "sivraj_mcp_client",
        fields,
      });
      const encrypted = await params.seal.encrypt({
        data: artifacts.plaintextBytes,
        aad: artifacts.aadBytes,
      });

      return buildEncryptedAgentWritebackRequestBody({
        fields,
        taskSummarySha256: sha256Hex(fields.taskSummary),
        encryptedPayload: buildEncryptedPayloadBody({
          encryptedBytes: encrypted.encryptedBytes,
          ciphertextSha256: encrypted.ciphertextSha256,
          seal: {
            packageId: encrypted.packageId,
            policyId: encrypted.policyId,
            threshold: encrypted.threshold,
            keyServerObjectIds: encrypted.keyServerObjectIds,
          },
        }),
      }) as EncryptedAgentWritebackBody;
    },
  };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
