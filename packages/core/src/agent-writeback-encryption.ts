import {
  formatAgentWriteback,
  type AgentWritebackFields,
} from "./agent-writeback.js";
import {
  buildPrivateSourceArtifactAad,
  buildPrivateSourceArtifactPayload,
} from "./private-source-payload.js";

export type NormalizedAgentWriteback = Required<AgentWritebackFields>;

export type AgentWritebackEncryptionArtifacts = {
  content: string;
  metadata: Record<string, unknown>;
  title: string;
  plaintextBytes: Uint8Array;
  aadBytes: Uint8Array;
  counts: AgentWritebackCounts;
};

export type AgentWritebackCounts = {
  filesTouched: number;
  commandsRun: number;
  testsRun: number;
  decisions: number;
  bugsFound: number;
  followUps: number;
  userCorrections: number;
};

export type EncryptedPayloadSealDescriptor = {
  packageId: string;
  policyId: string;
  threshold: number;
  keyServerObjectIds: string[];
};

export type EncryptedPayloadBody = {
  ciphertextBase64: string;
  ciphertextSha256: string;
  seal: EncryptedPayloadSealDescriptor;
};

const textEncoder = new TextEncoder();

export function normalizeAgentWritebackFields(
  input: Partial<AgentWritebackFields> & Pick<AgentWritebackFields, "taskSummary">,
): NormalizedAgentWriteback {
  return {
    agentName: input.agentName ?? "coding-agent",
    repo: input.repo ?? "",
    branch: input.branch ?? "",
    taskSummary: input.taskSummary,
    filesTouched: input.filesTouched ?? [],
    commandsRun: input.commandsRun ?? [],
    testsRun: input.testsRun ?? [],
    decisions: input.decisions ?? [],
    bugsFound: input.bugsFound ?? [],
    followUps: input.followUps ?? [],
    userCorrections: input.userCorrections ?? [],
  };
}

export function buildAgentWritebackCounts(
  fields: Pick<
    NormalizedAgentWriteback,
    | "filesTouched"
    | "commandsRun"
    | "testsRun"
    | "decisions"
    | "bugsFound"
    | "followUps"
    | "userCorrections"
  >,
): AgentWritebackCounts {
  return {
    filesTouched: fields.filesTouched.length,
    commandsRun: fields.commandsRun.length,
    testsRun: fields.testsRun.length,
    decisions: fields.decisions.length,
    bugsFound: fields.bugsFound.length,
    followUps: fields.followUps.length,
    userCorrections: fields.userCorrections.length,
  };
}

export function buildAgentWritebackEncryptionArtifacts(input: {
  twinId: string;
  importer: string;
  fields: NormalizedAgentWriteback;
}): AgentWritebackEncryptionArtifacts {
  const content = formatAgentWriteback(input.fields);
  const metadata = {
    uploadKind: "agent_writeback",
    importer: input.importer,
    agentName: input.fields.agentName,
    repo: input.fields.repo || null,
    branch: input.fields.branch || null,
    storageMode: "encrypted_walrus",
    sensitivity: "private",
  };
  const title = `Coding agent writeback: ${input.fields.agentName}`;
  const plaintextBytes = textEncoder.encode(
    JSON.stringify(
      buildPrivateSourceArtifactPayload({
        title,
        content,
        metadata,
      }),
    ),
  );
  const aadBytes = textEncoder.encode(
    JSON.stringify(
      buildPrivateSourceArtifactAad({
        twinId: input.twinId,
        sourceType: "note",
      }),
    ),
  );

  return {
    content,
    metadata,
    title,
    plaintextBytes,
    aadBytes,
    counts: buildAgentWritebackCounts(input.fields),
  };
}

export function buildEncryptedPayloadBody(input: {
  encryptedBytes: Uint8Array;
  ciphertextSha256: string;
  seal: EncryptedPayloadSealDescriptor;
  encodeBase64?: (bytes: Uint8Array) => string;
}): EncryptedPayloadBody {
  const encodeBase64 = input.encodeBase64 ?? defaultBase64Encode;

  return {
    ciphertextBase64: encodeBase64(input.encryptedBytes),
    ciphertextSha256: input.ciphertextSha256,
    seal: input.seal,
  };
}

export function buildEncryptedAgentWritebackRequestBody(input: {
  fields: NormalizedAgentWriteback;
  taskSummarySha256: string;
  encryptedPayload: EncryptedPayloadBody;
}): Record<string, unknown> {
  return {
    agentName: input.fields.agentName,
    ...(input.fields.repo ? { repo: input.fields.repo } : {}),
    ...(input.fields.branch ? { branch: input.fields.branch } : {}),
    taskSummarySha256: input.taskSummarySha256,
    counts: buildAgentWritebackCounts(input.fields),
    encryptedPayload: input.encryptedPayload,
  };
}

export function encodeBytesBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }

  return btoa(binary);
}

function defaultBase64Encode(bytes: Uint8Array): string {
  return encodeBytesBase64(bytes);
}
