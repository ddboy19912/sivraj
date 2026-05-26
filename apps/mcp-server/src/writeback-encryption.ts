import { TextEncoder } from "node:util";
import { createHash } from "node:crypto";
import {
  assertSealPolicyConfig,
  createSealEncryptor,
  parseSealKeyServers,
  type SealEncryptor,
} from "@sivraj/crypto-seal";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import type { AgentWritebackArgs } from "./sivraj-client.js";
import type { McpConfig } from "./env.js";

const textEncoder = new TextEncoder();
const PRIVATE_SOURCE_PAYLOAD_VERSION = 1;

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

export function createAgentWritebackEncryptor(params: {
  twinId: string;
  seal: SealEncryptor;
}): AgentWritebackEncryptor {
  return {
    async encryptWriteback(args) {
      const normalized = normalizeWriteback(args);
      const content = formatAgentWriteback(normalized);
      const metadata = {
        uploadKind: "agent_writeback",
        importer: "sivraj_mcp_client",
        agentName: normalized.agentName,
        repo: normalized.repo ?? null,
        branch: normalized.branch ?? null,
        storageMode: "encrypted_walrus",
        sensitivity: "private",
      };
      const plaintextBytes = textEncoder.encode(
        JSON.stringify({
          kind: "source_artifact",
          version: PRIVATE_SOURCE_PAYLOAD_VERSION,
          title: `Coding agent writeback: ${normalized.agentName}`,
          content,
          metadata,
        }),
      );
      const aad = textEncoder.encode(
        JSON.stringify({
          twinId: params.twinId,
          sourceType: "note",
          kind: "source_artifact",
          version: PRIVATE_SOURCE_PAYLOAD_VERSION,
        }),
      );
      const encrypted = await params.seal.encrypt({
        data: plaintextBytes,
        aad,
      });

      return {
        agentName: normalized.agentName,
        repo: normalized.repo,
        branch: normalized.branch,
        taskSummarySha256: sha256Hex(normalized.taskSummary),
        counts: {
          filesTouched: normalized.filesTouched.length,
          commandsRun: normalized.commandsRun.length,
          testsRun: normalized.testsRun.length,
          decisions: normalized.decisions.length,
          bugsFound: normalized.bugsFound.length,
          followUps: normalized.followUps.length,
          userCorrections: normalized.userCorrections.length,
        },
        encryptedPayload: {
          ciphertextBase64: Buffer.from(encrypted.encryptedBytes).toString("base64"),
          ciphertextSha256: encrypted.ciphertextSha256,
          seal: {
            packageId: encrypted.packageId,
            policyId: encrypted.policyId,
            threshold: encrypted.threshold,
            keyServerObjectIds: encrypted.keyServerObjectIds,
          },
        },
      };
    },
  };
}

function normalizeWriteback(args: AgentWritebackArgs): Required<AgentWritebackArgs> {
  return {
    agentName: args.agentName ?? "coding-agent",
    repo: args.repo ?? "",
    branch: args.branch ?? "",
    taskSummary: args.taskSummary,
    filesTouched: args.filesTouched ?? [],
    commandsRun: args.commandsRun ?? [],
    testsRun: args.testsRun ?? [],
    decisions: args.decisions ?? [],
    bugsFound: args.bugsFound ?? [],
    followUps: args.followUps ?? [],
    userCorrections: args.userCorrections ?? [],
  };
}

function formatAgentWriteback(input: Required<AgentWritebackArgs>): string {
  const lines = [
    "# Coding Agent Writeback",
    "",
    `Agent: ${input.agentName}`,
    `Repo: ${input.repo || "unknown"}`,
    `Branch: ${input.branch || "unknown"}`,
    "",
    "## Task Summary",
    input.taskSummary,
  ];

  pushList(lines, "Files Touched", input.filesTouched);
  pushList(lines, "Commands Run", input.commandsRun);
  pushList(lines, "Tests Run", input.testsRun);
  pushList(lines, "Decisions", input.decisions);
  pushList(lines, "Bugs Found", input.bugsFound);
  pushList(lines, "Follow Ups", input.followUps);
  pushList(lines, "User Corrections", input.userCorrections);

  return `${lines.join("\n")}\n`;
}

function pushList(lines: string[], title: string, values: string[]): void {
  if (values.length === 0) {
    return;
  }

  lines.push("", `## ${title}`, ...values.map((value) => `- ${value}`));
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readSuiNetwork(value: string): "mainnet" | "testnet" | "devnet" | "localnet" {
  if (value === "mainnet" || value === "testnet" || value === "devnet" || value === "localnet") {
    return value;
  }

  return "testnet";
}
