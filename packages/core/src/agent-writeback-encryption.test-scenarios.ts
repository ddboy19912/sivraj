import { expect } from "vitest";

import {
  buildAgentWritebackEncryptionArtifacts,
  buildEncryptedAgentWritebackRequestBody,
  buildEncryptedPayloadBody,
  normalizeAgentWritebackFields,
} from "./agent-writeback-encryption.js";

export async function run_builds_shared_encryption_artifacts_and_request_bodies() {
  const fields = normalizeAgentWritebackFields({
      agentName: "coding-agent",
      repo: "sivraj",
      branch: "main",
      taskSummary: "Ship encrypted writebacks",
      filesTouched: ["apps/web/src/lib/encryption.ts"],
      commandsRun: ["pnpm test"],
      testsRun: ["vitest"],
      decisions: ["Use shared core helpers"],
      bugsFound: [],
      followUps: [],
      userCorrections: [],
    });
    const artifacts = buildAgentWritebackEncryptionArtifacts({
      twinId: "twin-id",
      importer: "sivraj_test",
      fields,
    });

    expect(JSON.parse(new TextDecoder().decode(artifacts.plaintextBytes))).toMatchObject({
      kind: "source_artifact",
      title: "Coding agent writeback: coding-agent",
      content: expect.stringContaining("Ship encrypted writebacks"),
      metadata: {
        uploadKind: "agent_writeback",
        importer: "sivraj_test",
        agentName: "coding-agent",
        repo: "sivraj",
        branch: "main",
      },
    });
    expect(JSON.parse(new TextDecoder().decode(artifacts.aadBytes))).toMatchObject({
      twinId: "twin-id",
      sourceType: "note",
      kind: "source_artifact",
    });

    const body = buildEncryptedAgentWritebackRequestBody({
      fields,
      taskSummarySha256: "abc123",
      encryptedPayload: buildEncryptedPayloadBody({
        encryptedBytes: new Uint8Array([1, 2, 3]),
        ciphertextSha256: "deadbeef",
        seal: {
          packageId: "0xpackage",
          policyId: "0xpolicy",
          threshold: 1,
          keyServerObjectIds: ["0xkeyserver"],
        },
      }),
    });

    expect(body).toMatchObject({
      agentName: "coding-agent",
      repo: "sivraj",
      branch: "main",
      taskSummarySha256: "abc123",
      counts: {
        filesTouched: 1,
        commandsRun: 1,
        testsRun: 1,
        decisions: 1,
        bugsFound: 0,
        followUps: 0,
        userCorrections: 0,
      },
      encryptedPayload: {
        ciphertextSha256: "deadbeef",
        seal: {
          packageId: "0xpackage",
          policyId: "0xpolicy",
          threshold: 1,
          keyServerObjectIds: ["0xkeyserver"],
        },
      },
    });
}
