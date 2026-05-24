import { describe, expect, it } from "vitest";
import {
  ENCRYPTED_DECRYPTION_REQUIRED,
  ENCRYPTED_DECRYPTION_RETRYING,
  MISSING_PROCESSABLE_CONTENT,
  PARSED_BROWSER_HISTORY_EMPTY,
  PARSED_GITHUB_EMPTY,
  PARSED_IMAGE_EMPTY,
  PARSED_MARKDOWN_EMPTY,
  PARSED_OCR_PDF_EMPTY,
  PARSED_PLAIN_TEXT_EMPTY,
  SPEECH_TO_TEXT_EMPTY,
  SPEECH_TO_TEXT_FAILED,
  SPEECH_TO_TEXT_REQUIRED,
  createCanonicalMemoryMergeJudge,
  processArtifact,
  processCandidateMemoryArchive,
  processArtifactIntelligence,
  processQueuedArtifacts,
  generateWeeklyReflection,
  RetryableArtifactProcessingError,
  type ArtifactRepository,
  type QueuedArtifact,
} from "./ingestion-processor.js";

describe("createCanonicalMemoryMergeJudge", () => {
  it("accepts semantic same-memory judgments for known canonical memories", async () => {
    const judge = createCanonicalMemoryMergeJudge({
      async generateJson(input) {
        expect(input.prompt).toContain("Polytope Labs");

        return {
          json: {
            decision: "same",
            canonicalMemoryId: "canonical-1",
            confidence: 0.92,
            reason: "Both describe the same Polytope Labs Hyperbridge work memory.",
          },
          provider: "openai",
          model: "test-model",
        };
      },
    });

    await expect(judge.judge({
      candidate: {
        memoryType: "experience",
        statement: "I helped Polytope Labs build Hyperbridge bridge infrastructure.",
        normalizedStatement: "i helped polytope labs build hyperbridge bridge infrastructure",
        subject: "Polytope Labs",
        normalizedStatementHash: "hash-1",
        metadata: { subject: "Polytope Labs" },
      },
      existing: [
        {
          id: "canonical-1",
          memoryType: "experience",
          canonicalKey: "subject:experience:polytope_labs:general",
          subject: "Polytope Labs",
          confidenceScore: 0.9,
          metadata: { subject: "Polytope Labs" },
        },
      ],
    })).resolves.toMatchObject({
      decision: "same",
      canonicalMemoryId: "canonical-1",
      confidence: 0.92,
    });
  });

  it("rejects merge judgments that point at unknown canonical memories", async () => {
    const judge = createCanonicalMemoryMergeJudge({
      async generateJson() {
        return {
          json: {
            decision: "same",
            canonicalMemoryId: "not-real",
            confidence: 0.99,
            reason: "Bad id.",
          },
          provider: "openai",
          model: "test-model",
        };
      },
    });

    await expect(judge.judge({
      candidate: {
        memoryType: "preference",
        statement: "I prefer TypeScript.",
        normalizedStatement: "i prefer typescript",
        subject: "TypeScript",
        normalizedStatementHash: "hash-2",
        metadata: { subject: "TypeScript" },
      },
      existing: [
        {
          id: "canonical-1",
          memoryType: "preference",
          canonicalKey: "subject:preference:typescript:general",
          subject: "TypeScript",
          confidenceScore: 0.8,
          metadata: { subject: "TypeScript" },
        },
      ],
    })).resolves.toMatchObject({
      decision: "separate",
      canonicalMemoryId: null,
    });
  });
});

describe("processQueuedArtifacts", () => {
  it("moves encrypted private artifacts to pending without creating plaintext fragments", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "note",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
          ciphertextSha256: "ciphertext-hash",
        },
      },
    ]);
    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      now: new Date("2026-05-18T00:00:00.000Z"),
    });

    expect(result).toEqual({ scanned: 1, completed: 0, pending: 1, failed: 0 });
    expect(repository.fragments).toEqual([]);
    expect(repository.artifacts[0]?.status).toBe("pending");
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        status: "pending",
        reason: ENCRYPTED_DECRYPTION_REQUIRED,
      },
    });
    expect(repository.auditEvents[0]).toMatchObject({
      eventType: "artifact.processing_pending",
      resourceId: "artifact-id",
      metadata: {
        reason: ENCRYPTED_DECRYPTION_REQUIRED,
        rawStorageRef: "walrus://blob/blob-id",
      },
    });
  });

  it("creates a normalized memory fragment for explicit non-private plain text processing input", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "upload",
        rawStorageRef: null,
        metadata: {
          sensitivity: "public",
          processingInput: {
            content: "  Plain   public memory.\r\n\r\n\r\nSecond line.  ",
          },
        },
      },
    ]);

    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
    });

    expect(result).toEqual({ scanned: 1, completed: 1, pending: 0, failed: 0 });
    expect(repository.fragments[0]).toMatchObject({
      twinId: "twin-id",
      sourceArtifactId: "artifact-id",
      content: "Plain public memory.\n\nSecond line.",
    });
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        parser: {
          name: "plain_text",
          warnings: [],
        },
      },
    });
    expect(repository.artifacts[0]?.status).toBe("completed");
    expect(repository.auditEvents[0]).toMatchObject({
      eventType: "artifact.processed",
      resourceId: "artifact-id",
    });
  });

  it("decrypts encrypted private artifacts when a scoped reader is available", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "note",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
          ciphertextSha256: "ciphertext-hash",
        },
      },
    ]);
    const readerCalls: unknown[] = [];

    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory(input) {
          readerCalls.push(input);
          return "Decrypted private memory.";
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 1, pending: 0, failed: 0 });
    expect(readerCalls).toEqual([
      {
        rawStorageRef: "walrus://blob/blob-id",
        artifactId: "artifact-id",
        twinId: "twin-id",
        expectedCiphertextSha256: "ciphertext-hash",
      },
    ]);
    expect(repository.fragments[0]).toMatchObject({
      twinId: "twin-id",
      sourceArtifactId: "artifact-id",
      content: "Decrypted private memory.",
      contentStorageRef: "walrus://blob/encrypted-fragment",
    });
    expect(repository.artifacts[0]?.status).toBe("completed");
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        status: "completed",
        decryptPath: "seal_walrus",
      },
    });
    expect(repository.auditEvents[0]).toMatchObject({
      eventType: "artifact.processed",
      resourceId: "artifact-id",
      metadata: {
        decryptPath: "seal_walrus",
        rawStorageRef: "walrus://blob/blob-id",
      },
    });
  });

  it("stores private memory fragments as encrypted refs without plaintext content", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "note",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createStrictFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return "Decrypted private memory.";
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 1, pending: 0, failed: 0 });
    expect(repository.fragments[0]).toMatchObject({
      contentStorageRef: "walrus://blob/encrypted-fragment",
      contentSha256: "sha256:25",
      metadata: {
        storageMode: "encrypted_walrus",
        sensitivity: "private",
        contentKind: "memory_fragment",
      },
    });
  });

  it("extracts entities into graph nodes and edges after memory fragment creation", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "note",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    const entityExtractor = {
      async extract(input: {
        twinId: string;
        sourceArtifactId: string;
        memoryFragmentId: string;
        sourceType: string;
        content: string;
        title?: string | null;
      }) {
        expect(input).toMatchObject({
          twinId: "twin-id",
          sourceArtifactId: "artifact-id",
          memoryFragmentId: "fragment-1",
          sourceType: "note",
          title: null,
        });

        return {
          entities: [
            {
              name: "Polytope Labs",
              normalizedName: "polytope labs",
              type: "organization" as const,
              graphNodeType: "organization" as const,
              aliases: [],
              confidence: 0.93,
              evidenceHash: "hash",
              evidenceLength: 14,
              metadata: { relationship: "client" },
            },
          ],
          metadata: {
            extractor: "llm_structured_entity_extractor",
            provider: "openai",
            model: "gpt-4o",
            originalLength: input.content.length,
            returnedEntities: 1,
            acceptedEntities: 1,
            warnings: [],
          },
        };
      },
    };

    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return privateSourcePayload({
            title: "Founder note",
            content: "I worked with Polytope Labs on Hyperbridge.",
          });
        },
      },
    });
    await processArtifactIntelligence(repository, {
      artifactId: "artifact-id",
      twinId: "twin-id",
      sourceType: "note",
      memoryFragmentId: "fragment-1",
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return "I worked with Polytope Labs on Hyperbridge.";
        },
      },
      entityExtractor,
    });

    expect(result).toEqual({ scanned: 1, completed: 1, pending: 0, failed: 0 });
    expect(repository.graphNodes).toHaveLength(2);
    expect(repository.graphNodes[0]).toMatchObject({
      nodeType: "artifact",
      name: "source_artifact:artifact-id",
    });
    expect(repository.graphNodes[1]).toMatchObject({
      nodeType: "organization",
      name: "Polytope Labs",
      normalizedName: "polytope labs",
      properties: {
        normalizedName: "polytope labs",
        entityType: "organization",
        evidenceHash: "hash",
        evidenceLength: 14,
        metadata: { relationship: "client" },
      },
    });
    expect(repository.graphEdges[0]).toMatchObject({
      edgeType: "mentions",
      evidenceMemoryIds: ["fragment-1"],
      confidenceScore: 0.93,
    });
    expect(JSON.stringify(repository.graphNodes)).not.toContain("I worked with");
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        intelligence: {
          entityExtraction: {
            status: "completed",
            entityCount: 1,
            provider: "openai",
          },
        },
      },
    });
  });

  it("merges repeated extracted entities by canonical graph identity", async () => {
    const repository = createRepository([
      {
        id: "artifact-one",
        twinId: "twin-id",
        sourceType: "note",
        rawStorageRef: "walrus://blob/blob-one",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
      {
        id: "artifact-two",
        twinId: "twin-id",
        sourceType: "pdf",
        rawStorageRef: "walrus://blob/blob-two",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    const entityExtractor = {
      async extract(input: {
        sourceArtifactId: string;
        sourceType: string;
        content: string;
      }) {
        return {
          entities: [
            {
              name:
                input.sourceArtifactId === "artifact-one"
                  ? "Polytope Labs"
                  : "polytope labs",
              normalizedName: "polytope labs",
              type: "organization" as const,
              graphNodeType: "organization" as const,
              aliases:
                input.sourceArtifactId === "artifact-one"
                  ? ["Hyperbridge"]
                  : ["Polytope"],
              confidence:
                input.sourceArtifactId === "artifact-one" ? 0.82 : 0.94,
              evidenceHash: `hash-${input.sourceArtifactId}`,
              evidenceLength: 18,
              metadata: { source: input.sourceType },
            },
          ],
          metadata: {
            extractor: "llm_structured_entity_extractor",
            provider: "openai",
            model: "gpt-4o",
            originalLength: input.content.length,
            returnedEntities: 1,
            acceptedEntities: 1,
            warnings: [],
          },
        };
      },
    };

    const result = await processQueuedArtifacts(repository, {
      limit: 2,
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory(input) {
          return privateSourcePayload({
            content:
              input.artifactId === "artifact-one"
                ? "Polytope Labs shipped Hyperbridge."
                : "polytope labs appears again in this PDF.",
          });
        },
      },
    });

    expect(result).toEqual({ scanned: 2, completed: 2, pending: 0, failed: 0 });
    await processArtifactIntelligence(repository, {
      artifactId: "artifact-one",
      twinId: "twin-id",
      sourceType: "note",
      memoryFragmentId: "fragment-1",
      privateMemoryReader: {
        async readPrivateMemory() {
          return "Polytope Labs shipped Hyperbridge.";
        },
      },
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      entityExtractor,
    });
    await processArtifactIntelligence(repository, {
      artifactId: "artifact-two",
      twinId: "twin-id",
      sourceType: "pdf",
      memoryFragmentId: "fragment-2",
      privateMemoryReader: {
        async readPrivateMemory() {
          return "polytope labs appears again in this PDF.";
        },
      },
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      entityExtractor,
    });

    const organizationNodes = repository.graphNodes.filter(
      (node) => node.nodeType === "organization",
    );
    expect(organizationNodes).toHaveLength(1);
    expect(organizationNodes[0]).toMatchObject({
      name: "Polytope Labs",
      normalizedName: "polytope labs",
      confidenceScore: 0.94,
      properties: {
        normalizedName: "polytope labs",
        aliases: ["Hyperbridge", "Polytope"],
        sourceTypes: ["note", "pdf"],
        mentionCount: 2,
      },
    });
    expect(repository.graphEdges).toHaveLength(2);
    expect(repository.graphEdges.map((edge) => edge.toNodeId)).toEqual([
      organizationNodes[0]?.id,
      organizationNodes[0]?.id,
    ]);
  });

  it("does not fail ingestion when entity extraction fails", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "note",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return privateSourcePayload({ content: "Private memory." });
        },
      },
    });
    await processArtifactIntelligence(repository, {
      artifactId: "artifact-id",
      twinId: "twin-id",
      sourceType: "note",
      memoryFragmentId: "fragment-1",
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return "Private memory.";
        },
      },
      entityExtractor: {
        async extract() {
          throw new Error("model unavailable");
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 1, pending: 0, failed: 0 });
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        intelligence: {
          entityExtraction: {
            status: "failed",
            reason: "entity_extraction_failed",
            detail: "model unavailable",
          },
        },
      },
    });
    expect(repository.auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: "artifact.entity_extraction_failed",
      }),
    ]));
  });

  it("extracts candidate memories into encrypted storage without plaintext DB statements", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "note",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    const memoryExtractor = {
      async extract(input: {
        twinId: string;
        sourceArtifactId: string;
        memoryFragmentId: string;
        sourceType: string;
        content: string;
        title?: string | null;
      }) {
        expect(input).toMatchObject({
          twinId: "twin-id",
          sourceArtifactId: "artifact-id",
          memoryFragmentId: "fragment-1",
          sourceType: "note",
          title: null,
        });

        return {
          memories: [
            {
              statement: "The user worked with Polytope Labs on Hyperbridge.",
              normalizedStatement: "the user worked with polytope labs on hyperbridge.",
              memoryType: "experience" as const,
              subject: "Polytope Labs",
              confidence: 0.91,
              evidenceHash: "evidence-hash",
              evidenceLength: 24,
              metadata: { category: "work_history" },
            },
          ],
          metadata: {
            extractor: "llm_structured_memory_extractor",
            provider: "openai",
            model: "gpt-4o",
            originalLength: input.content.length,
            returnedMemories: 1,
            acceptedMemories: 1,
            warnings: [],
          },
        };
      },
    };
    const candidateMemoryArchiveQueue = createFakeCandidateMemoryArchiveQueue();

    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return privateSourcePayload({
            title: "Founder note",
            content: "The user worked with Polytope Labs on Hyperbridge.",
          });
        },
      },
    });
    await processArtifactIntelligence(repository, {
      artifactId: "artifact-id",
      twinId: "twin-id",
      sourceType: "note",
      memoryFragmentId: "fragment-1",
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return "The user worked with Polytope Labs on Hyperbridge.";
        },
      },
      memoryExtractor,
      candidateMemoryArchiveQueue,
    });

    expect(result).toEqual({ scanned: 1, completed: 1, pending: 0, failed: 0 });
    expect(repository.candidateMemories).toHaveLength(1);
    expect(repository.candidateMemories[0]).toMatchObject({
      twinId: "twin-id",
      sourceArtifactId: "artifact-id",
      memoryFragmentId: "fragment-1",
      memoryType: "experience",
      statementStorageRef: "pending://candidate-memory-archive/artifact-id/fragment-1",
      statementSha256: "sha256:candidate:261",
      evidenceHash: "evidence-hash",
      evidenceLength: 24,
      confidenceScore: 0.91,
    });
    expect(repository.candidateMemories[0]?.metadata).toMatchObject({
      archiveStatus: "pending",
    });
    expect(candidateMemoryArchiveQueue.enqueueCalls).toHaveLength(1);
    expect(JSON.stringify(repository.candidateMemories)).not.toContain(
      "The user worked with Polytope Labs",
    );
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        intelligence: {
          memoryExtraction: {
            status: "completed",
            candidateMemoryCount: 1,
            provider: "openai",
            candidateMemoryArchiveQueued: true,
            durationMs: expect.any(Number),
          },
          timing: {
            entityExtractionMs: expect.any(Number),
            memoryExtractionMs: expect.any(Number),
            totalIntelligenceMs: expect.any(Number),
          },
        },
      },
    });
    expect(repository.auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: "artifact.memories_extracted",
      }),
    ]));

    await processCandidateMemoryArchive(repository, {
      ...candidateMemoryArchiveQueue.enqueueCalls[0]!,
      privateFragmentStorage: createFakePrivateFragmentStorage(),
    });

    expect(repository.candidateMemories[0]).toMatchObject({
      statementStorageRef: "walrus://blob/encrypted-candidate-memory",
      statementSha256: "sha256:candidate:261",
    });
    expect(repository.candidateMemories[0]?.metadata).toMatchObject({
      archiveStatus: "completed",
    });
    expect(repository.auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: "artifact.candidate_memories_archived",
      }),
    ]));
  });

  it("clusters project graph nodes from extracted project and product entities", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "github",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return privateSourcePayload({
            title: "repo.md",
            content: "Sivraj uses Walrus and Seal for private memory.",
          });
        },
      },
    });
    await processArtifactIntelligence(repository, {
      artifactId: "artifact-id",
      twinId: "twin-id",
      sourceType: "github",
      memoryFragmentId: "fragment-1",
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return "Sivraj uses Walrus and Seal for private memory.";
        },
      },
      entityExtractor: {
        async extract(input) {
          return {
            entities: [
              {
                name: "Sivraj",
                normalizedName: "sivraj",
                type: "product" as const,
                graphNodeType: "concept" as const,
                aliases: [],
                confidence: 0.9,
                evidenceHash: "sivraj-evidence",
                evidenceLength: 6,
                metadata: {},
              },
              {
                name: "Walrus",
                normalizedName: "walrus",
                type: "technology" as const,
                graphNodeType: "concept" as const,
                aliases: [],
                confidence: 0.88,
                evidenceHash: "walrus-evidence",
                evidenceLength: 6,
                metadata: {},
              },
            ],
            metadata: {
              extractor: "llm_structured_entity_extractor" as const,
              provider: "openai",
              model: "gpt-4o",
              originalLength: input.content.length,
              returnedEntities: 2,
              acceptedEntities: 2,
              warnings: [],
            },
          };
        },
      },
    });

    const projectNodes = repository.graphNodes.filter((node) => node.nodeType === "project");
    expect(projectNodes).toHaveLength(1);
    expect(projectNodes[0]).toMatchObject({
      name: "Sivraj",
      normalizedName: "sivraj",
      properties: {
        projectCluster: true,
        clusterMethod: "deterministic_project_clustering",
        clusterSignals: ["product_entity"],
      },
    });
    expect(repository.graphEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromNodeId: "node-1",
        toNodeId: projectNodes[0]?.id,
        edgeType: "belongs_to_project",
      }),
      expect.objectContaining({
        fromNodeId: projectNodes[0]?.id,
        edgeType: "project_context",
      }),
    ]));
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        intelligence: {
          entityExtraction: {
            projectClustering: {
              projectClusterCount: 1,
            },
          },
        },
      },
    });
  });

  it("clusters project graph nodes from candidate memory subjects", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "note",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return privateSourcePayload({
            title: "Founder note",
            content: "Sivraj positioning changed to owned memory.",
          });
        },
      },
    });
    await processArtifactIntelligence(repository, {
      artifactId: "artifact-id",
      twinId: "twin-id",
      sourceType: "note",
      memoryFragmentId: "fragment-1",
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return "Sivraj positioning changed to owned memory.";
        },
      },
      memoryExtractor: {
        async extract(input) {
          return {
            memories: [
              {
                statement: "The user changed Sivraj positioning to owned memory.",
                normalizedStatement: "the user changed sivraj positioning to owned memory.",
                memoryType: "project_update" as const,
                subject: "Sivraj",
                confidence: 0.88,
                evidenceHash: "evidence-hash",
                evidenceLength: 42,
                metadata: {},
              },
            ],
            metadata: {
              extractor: "llm_structured_memory_extractor" as const,
              provider: "openai",
              model: "gpt-4o",
              originalLength: input.content.length,
              returnedMemories: 1,
              acceptedMemories: 1,
              warnings: [],
            },
          };
        },
      },
      candidateMemoryArchiveQueue: createFakeCandidateMemoryArchiveQueue(),
    });

    const projectNodes = repository.graphNodes.filter((node) => node.nodeType === "project");
    expect(projectNodes).toHaveLength(1);
    expect(projectNodes[0]).toMatchObject({
      name: "Sivraj",
      normalizedName: "sivraj",
      properties: {
        projectCluster: true,
        clusterSignals: ["project_update_subject"],
        clusterSources: ["candidate_memory"],
      },
    });
    expect(repository.graphEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toNodeId: projectNodes[0]?.id,
        edgeType: "belongs_to_project",
      }),
    ]));
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        intelligence: {
          memoryExtraction: {
            projectClustering: {
              projectClusterCount: 1,
              projectLinkCount: 1,
            },
          },
        },
      },
    });
  });

  it("creates private-safe decision graph nodes from decision candidate memories", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "note",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return privateSourcePayload({
            title: "Architecture note",
            content: "We decided to use Vite instead of Next.js for Sivraj web.",
          });
        },
      },
    });
    await processArtifactIntelligence(repository, {
      artifactId: "artifact-id",
      twinId: "twin-id",
      sourceType: "note",
      memoryFragmentId: "fragment-1",
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return "We decided to use Vite instead of Next.js for Sivraj web.";
        },
      },
      memoryExtractor: {
        async extract(input) {
          return {
            memories: [
              {
                statement: "The user decided to use Vite instead of Next.js for Sivraj web.",
                normalizedStatement: "the user decided to use vite instead of next.js for sivraj web.",
                memoryType: "decision" as const,
                subject: "Sivraj",
                confidence: 0.94,
                evidenceHash: "decision-evidence-hash",
                evidenceLength: 59,
                metadata: {
                  category: "architecture",
                },
              },
            ],
            metadata: {
              extractor: "llm_structured_memory_extractor" as const,
              provider: "openai",
              model: "gpt-4o",
              originalLength: input.content.length,
              returnedMemories: 1,
              acceptedMemories: 1,
              warnings: [],
            },
          };
        },
      },
      candidateMemoryArchiveQueue: createFakeCandidateMemoryArchiveQueue(),
    });

    const decisionNodes = repository.graphNodes.filter((node) => node.nodeType === "decision");
    const projectNodes = repository.graphNodes.filter((node) => node.nodeType === "project");
    expect(decisionNodes).toHaveLength(1);
    expect(decisionNodes[0]).toMatchObject({
      name: expect.stringMatching(/^decision:[a-f0-9]{12}$/),
      normalizedName: expect.stringMatching(/^decision:[a-f0-9]{64}$/),
      properties: {
        sourceArtifactId: "artifact-id",
        memoryFragmentId: "fragment-1",
        candidateMemoryId: "candidate-memory-1",
        subject: "Sivraj",
        evidenceHash: "decision-evidence-hash",
        privateStatementStoredEncrypted: true,
      },
    });
    expect(projectNodes).toHaveLength(1);
    expect(repository.graphEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toNodeId: decisionNodes[0]?.id,
        edgeType: "records_decision",
      }),
      expect.objectContaining({
        fromNodeId: projectNodes[0]?.id,
        toNodeId: decisionNodes[0]?.id,
        edgeType: "project_decision",
      }),
    ]));
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        intelligence: {
          memoryExtraction: {
            decisionExtraction: {
              decisionCount: 1,
              decisionLinkCount: 1,
              projectDecisionLinkCount: 1,
            },
          },
        },
      },
    });
    expect(JSON.stringify(repository.graphNodes)).not.toContain("Vite instead of Next");
  });

  it("creates private-safe goal graph nodes from goal candidate memories", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "note",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return privateSourcePayload({
            title: "Goal note",
            content: "I want Sivraj to help coding agents understand my architecture decisions.",
          });
        },
      },
    });
    await processArtifactIntelligence(repository, {
      artifactId: "artifact-id",
      twinId: "twin-id",
      sourceType: "note",
      memoryFragmentId: "fragment-1",
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return "I want Sivraj to help coding agents understand my architecture decisions.";
        },
      },
      memoryExtractor: {
        async extract(input) {
          return {
            memories: [
              {
                statement: "The user wants Sivraj to help coding agents understand their architecture decisions.",
                normalizedStatement: "the user wants sivraj to help coding agents understand their architecture decisions.",
                memoryType: "goal" as const,
                subject: "Sivraj",
                confidence: 0.91,
                evidenceHash: "goal-evidence-hash",
                evidenceLength: 72,
                metadata: {
                  conversationSignal: "goal",
                  requiresApproval: true,
                },
              },
            ],
            metadata: {
              extractor: "llm_structured_memory_extractor" as const,
              provider: "openai",
              model: "gpt-4o",
              originalLength: input.content.length,
              returnedMemories: 1,
              acceptedMemories: 1,
              warnings: [],
              sourceKind: "conversation" as const,
              conversationUnderstanding: {
                enabled: true as const,
                sourceType: "voice_conversation",
                goalCount: 1,
                decisionCount: 0,
                preferenceCount: 0,
                commitmentCount: 0,
                followUpCount: 0,
              },
            },
          };
        },
      },
      candidateMemoryArchiveQueue: createFakeCandidateMemoryArchiveQueue(),
    });

    const goalNodes = repository.graphNodes.filter((node) => node.nodeType === "goal");
    const projectNodes = repository.graphNodes.filter((node) => node.nodeType === "project");
    expect(goalNodes).toHaveLength(1);
    expect(goalNodes[0]).toMatchObject({
      name: expect.stringMatching(/^goal:[a-f0-9]{12}$/),
      normalizedName: expect.stringMatching(/^goal:[a-f0-9]{64}$/),
      properties: {
        sourceArtifactId: "artifact-id",
        memoryFragmentId: "fragment-1",
        candidateMemoryId: "candidate-memory-1",
        subject: "Sivraj",
        evidenceHash: "goal-evidence-hash",
        inferenceMethod: "candidate_memory_goal_graph_linking",
        privateStatementStoredEncrypted: true,
      },
    });
    expect(projectNodes).toHaveLength(1);
    expect(repository.graphEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toNodeId: goalNodes[0]?.id,
        edgeType: "states_goal",
      }),
      expect.objectContaining({
        fromNodeId: projectNodes[0]?.id,
        toNodeId: goalNodes[0]?.id,
        edgeType: "project_goal",
      }),
    ]));
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        intelligence: {
          memoryExtraction: {
            goalInference: {
              goalCount: 1,
              goalLinkCount: 1,
              projectGoalLinkCount: 1,
            },
          },
        },
      },
    });
    expect(JSON.stringify(repository.graphNodes)).not.toContain("help coding agents");
  });

  it("detects repeated subject patterns from current and historical candidate memories", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "note",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);
    await repository.createCandidateMemory({
      twinId: "twin-id",
      sourceArtifactId: "old-artifact-id",
      memoryFragmentId: "old-fragment-id",
      memoryType: "goal",
      statementStorageRef: "walrus://blob/old-candidate",
      statementSha256: "old-statement-sha",
      evidenceHash: "old-goal-evidence",
      evidenceLength: 42,
      confidenceScore: 0.84,
      metadata: {
        subject: "Sivraj",
        sourceType: "note",
        normalizedStatementHash: "old-normalized-hash",
      },
    });

    await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return privateSourcePayload({
            title: "Goal note",
            content: "I want Sivraj to become the memory layer for coding agents.",
          });
        },
      },
    });
    await processArtifactIntelligence(repository, {
      artifactId: "artifact-id",
      twinId: "twin-id",
      sourceType: "note",
      memoryFragmentId: "fragment-1",
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return "I want Sivraj to become the memory layer for coding agents.";
        },
      },
      memoryExtractor: {
        async extract(input) {
          return {
            memories: [
              {
                statement: "The user wants Sivraj to become the memory layer for coding agents.",
                normalizedStatement: "the user wants sivraj to become the memory layer for coding agents.",
                memoryType: "goal" as const,
                subject: "Sivraj",
                confidence: 0.91,
                evidenceHash: "new-goal-evidence",
                evidenceLength: 61,
                metadata: {},
              },
            ],
            metadata: {
              extractor: "llm_structured_memory_extractor" as const,
              provider: "openai",
              model: "gpt-4o",
              originalLength: input.content.length,
              returnedMemories: 1,
              acceptedMemories: 1,
              warnings: [],
            },
          };
        },
      },
      candidateMemoryArchiveQueue: createFakeCandidateMemoryArchiveQueue(),
    });

    const patternNodes = repository.graphNodes.filter(
      (node) => node.nodeType === "other" && readTestRecord(node.properties).kind === "pattern",
    );
    const projectNodes = repository.graphNodes.filter((node) => node.nodeType === "project");
    expect(patternNodes).toHaveLength(1);
    expect(patternNodes[0]).toMatchObject({
      name: expect.stringMatching(/^pattern:[a-f0-9]{12}$/),
      normalizedName: expect.stringMatching(/^pattern:[a-f0-9]{64}$/),
      properties: {
        kind: "pattern",
        patternType: "repeated_goal_subject",
        subject: "Sivraj",
        normalizedSubject: "sivraj",
        evidenceCount: 2,
        privateStatementStoredEncrypted: true,
      },
    });
    expect(repository.graphEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toNodeId: patternNodes[0]?.id,
        edgeType: "supports_pattern",
      }),
      expect.objectContaining({
        fromNodeId: projectNodes[0]?.id,
        toNodeId: patternNodes[0]?.id,
        edgeType: "project_pattern",
      }),
    ]));
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        intelligence: {
          memoryExtraction: {
            patternDetection: {
              patternCount: 1,
              patternLinkCount: 1,
              projectPatternLinkCount: 1,
            },
          },
        },
      },
    });
    expect(JSON.stringify(patternNodes)).not.toContain("memory layer for coding agents");
  });

  it("detects repeated launch-delay behavior patterns across different projects", async () => {
    const repository = createRepository([
      {
        id: "artifact-gamma",
        twinId: "twin-id",
        sourceType: "note",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);
    await repository.createCandidateMemory({
      twinId: "twin-id",
      sourceArtifactId: "artifact-alpha",
      memoryFragmentId: "fragment-alpha",
      memoryType: "project_update",
      statementStorageRef: "walrus://blob/alpha-candidate",
      statementSha256: "alpha-statement-sha",
      evidenceHash: "alpha-evidence",
      evidenceLength: 59,
      confidenceScore: 0.84,
      metadata: {
        subject: "Project Alpha",
        sourceType: "note",
        normalizedStatementHash: "alpha-normalized-hash",
        patternKey: "launch_delay_ui_polish",
        patternTags: ["launch", "delay", "ui_polish"],
      },
    });
    await repository.createCandidateMemory({
      twinId: "twin-id",
      sourceArtifactId: "artifact-beta",
      memoryFragmentId: "fragment-beta",
      memoryType: "project_update",
      statementStorageRef: "walrus://blob/beta-candidate",
      statementSha256: "beta-statement-sha",
      evidenceHash: "beta-evidence",
      evidenceLength: 64,
      confidenceScore: 0.86,
      metadata: {
        subject: "Project Beta",
        sourceType: "note",
        normalizedStatementHash: "beta-normalized-hash",
        patternKey: "launch_delay_ui_polish",
        patternTags: ["launch", "delay", "ui_polish"],
      },
    });
    const gammaFragment = await repository.createMemoryFragment({
      twinId: "twin-id",
      sourceArtifactId: "artifact-gamma",
      contentStorageRef: "walrus://blob/gamma-fragment",
      contentSha256: "gamma-fragment-sha",
      importanceScore: 0.5,
      confidenceScore: 0.8,
    });

    await processArtifactIntelligence(repository, {
      artifactId: "artifact-gamma",
      twinId: "twin-id",
      sourceType: "note",
      memoryFragmentId: gammaFragment.id,
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return "I delayed launching Project Gamma because I wanted the interface to feel perfect before shipping.";
        },
      },
      memoryExtractor: {
        async extract(input) {
          return {
            memories: [
              {
                statement: "The user delayed launching Project Gamma because they wanted the interface to feel perfect before shipping.",
                normalizedStatement: "the user delayed launching project gamma because they wanted the interface to feel perfect before shipping.",
                memoryType: "project_update" as const,
                subject: "Project Gamma",
                confidence: 0.91,
                evidenceHash: "gamma-evidence",
                evidenceLength: 91,
                metadata: {},
              },
            ],
            metadata: {
              extractor: "llm_structured_memory_extractor" as const,
              provider: "openai",
              model: "gpt-4o",
              originalLength: input.content.length,
              returnedMemories: 1,
              acceptedMemories: 1,
              warnings: [],
            },
          };
        },
      },
      candidateMemoryArchiveQueue: createFakeCandidateMemoryArchiveQueue(),
    });

    const patternNodes = repository.graphNodes.filter(
      (node) => node.nodeType === "other" && readTestRecord(node.properties).kind === "pattern",
    );
    expect(patternNodes).toHaveLength(1);
    expect(patternNodes[0]).toMatchObject({
      properties: {
        kind: "pattern",
        patternType: "repeated_behavior_theme",
        subject: "Launch delay from UI polish",
        normalizedSubject: "launch_delay_ui_polish",
        evidenceCount: 3,
      },
    });
    expect(repository.graphEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toNodeId: patternNodes[0]?.id,
        edgeType: "supports_pattern",
      }),
      expect.objectContaining({
        toNodeId: patternNodes[0]?.id,
        edgeType: "project_pattern",
      }),
    ]));
    expect(JSON.stringify(patternNodes)).not.toContain("interface to feel perfect");
  });

  it("marks candidate memories from attributed conversations with speaker policy metadata", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "chat_export",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return privateSourcePayload({
            title: "Conversation export",
            content: "self/Fortune: I prefer async work.\nother/Ada: I prefer async work too.",
          });
        },
      },
    });

    await processArtifactIntelligence(repository, {
      artifactId: "artifact-id",
      twinId: "twin-id",
      sourceType: "chat_export",
      memoryFragmentId: "fragment-1",
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return "self/Fortune: I prefer async work.\nother/Ada: I prefer async work too.";
        },
      },
      memoryExtractor: {
        async extract(input) {
          expect(input.content).toContain("self/Fortune:");
          expect(input.content).toContain("other/Ada:");

          return {
            memories: [
              {
                statement: "The user prefers async work.",
                normalizedStatement: "the user prefers async work.",
                memoryType: "preference" as const,
                subject: null,
                confidence: 0.9,
                evidenceHash: "evidence-hash",
                evidenceLength: 34,
                metadata: {
                  evidenceSpeakerRole: "self",
                  speakerRole: "self",
                  attributionPolicy: "self_claims_only_for_user_memory",
                },
              },
            ],
            metadata: {
              extractor: "llm_structured_memory_extractor" as const,
              provider: "openai",
              model: "gpt-4o",
              originalLength: input.content.length,
              returnedMemories: 1,
              acceptedMemories: 1,
              warnings: [],
              attributionAware: true,
            },
          };
        },
      },
      candidateMemoryArchiveQueue: createFakeCandidateMemoryArchiveQueue(),
    });

    expect(repository.candidateMemories).toHaveLength(1);
    expect(repository.candidateMemories[0]?.metadata).toMatchObject({
      sourceKind: "conversation",
      attributionAware: true,
      speakerRolePolicy: "self_claims_only_for_user_memory",
      memoryMetadata: {
        evidenceSpeakerRole: "self",
        speakerRole: "self",
        attributionPolicy: "self_claims_only_for_user_memory",
      },
    });
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        intelligence: {
          memoryExtraction: {
            sourceKind: "conversation",
            attributionAware: true,
            speakerRolePolicy: "self_claims_only_for_user_memory",
          },
        },
      },
    });
    expect(JSON.stringify(repository.candidateMemories)).not.toContain("I prefer async work");
  });

  it("does not fail ingestion when memory extraction fails", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "note",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return privateSourcePayload({ content: "Private memory." });
        },
      },
    });
    await processArtifactIntelligence(repository, {
      artifactId: "artifact-id",
      twinId: "twin-id",
      sourceType: "note",
      memoryFragmentId: "fragment-1",
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return "Private memory.";
        },
      },
      memoryExtractor: {
        async extract() {
          throw new Error("model unavailable");
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 1, pending: 0, failed: 0 });
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        intelligence: {
          memoryExtraction: {
            status: "failed",
            reason: "memory_extraction_failed",
            detail: "model unavailable",
          },
        },
      },
    });
    expect(repository.auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: "artifact.memory_extraction_failed",
      }),
    ]));
  });

  it("keeps transient encrypted decrypt failures pending and throws for queue retry", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "note",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    await expect(
      processArtifact(repository, "artifact-id", {
        now: new Date("2026-05-18T00:00:00.000Z"),
        privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
          async readPrivateMemory() {
            throw new Error("seal_decrypt failed: fetch failed");
          },
        },
      }),
    ).rejects.toBeInstanceOf(RetryableArtifactProcessingError);
    expect(repository.artifacts[0]?.status).toBe("pending");
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        status: "pending",
        reason: ENCRYPTED_DECRYPTION_RETRYING,
        detail: "seal_decrypt failed: fetch failed",
      },
    });
    expect(repository.auditEvents[0]).toMatchObject({
      eventType: "artifact.processing_retrying",
      metadata: {
        reason: ENCRYPTED_DECRYPTION_RETRYING,
        detail: "seal_decrypt failed: fetch failed",
      },
    });
  });

  it("parses encrypted markdown artifacts into cleaned memory text", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "markdown",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return [
            "---",
            "client: fintech",
            "---",
            "",
            "# Compliance Pitch",
            "",
            "Lead with [trust](https://example.com), not features.",
            "",
            "- Procurement wants reduced risk.",
          ].join("\n");
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 1, pending: 0, failed: 0 });
    expect(repository.fragments[0]).toMatchObject({
      content: [
        "Compliance Pitch",
        "Lead with trust, not features.",
        "- Procurement wants reduced risk.",
      ].join("\n"),
    });
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        status: "completed",
        decryptPath: "seal_walrus",
        parser: {
          name: "markdown",
          originalLength: expect.any(Number),
          parsedLength: expect.any(Number),
          warnings: [],
        },
      },
    });
    expect(repository.auditEvents[0]).toMatchObject({
      eventType: "artifact.processed",
      metadata: {
        parser: {
          name: "markdown",
        },
      },
    });
  });

  it("fails encrypted markdown artifacts that parse to empty text", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "markdown",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return "---\n---\n\n---";
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 0, pending: 0, failed: 1 });
    expect(repository.fragments).toEqual([]);
    expect(repository.artifacts[0]?.status).toBe("failed");
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        status: "failed",
        reason: PARSED_MARKDOWN_EMPTY,
        parser: {
          name: "markdown",
          warnings: ["markdown_empty_after_parse"],
        },
      },
    });
  });

  it("parses encrypted plain text uploads into normalized memory text", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "upload",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return "  Useful\u0000 client   note.\n\n\n- Keep compliance first.  ";
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 1, pending: 0, failed: 0 });
    expect(repository.fragments[0]).toMatchObject({
      content: "Useful client note.\n\n- Keep compliance first.",
    });
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        status: "completed",
        decryptPath: "seal_walrus",
        parser: {
          name: "plain_text",
          warnings: ["plain_text_control_characters_removed"],
        },
      },
    });
  });

  it("fails encrypted plain text uploads that parse to empty text", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "upload",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return " \n\t\n ";
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 0, pending: 0, failed: 1 });
    expect(repository.fragments).toEqual([]);
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        status: "failed",
        reason: PARSED_PLAIN_TEXT_EMPTY,
        parser: {
          name: "plain_text",
          warnings: ["plain_text_empty_after_parse"],
        },
      },
    });
  });

  it("parses encrypted csv artifacts into readable row text", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "csv",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return "client,angle,result\nFintechCo,compliance-first,closed";
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 1, pending: 0, failed: 0 });
    expect(repository.fragments[0]).toMatchObject({
      content: "client | angle | result\nFintechCo | compliance-first | closed",
    });
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        parser: {
          name: "csv",
        },
      },
    });
  });

  it("parses encrypted email artifacts into readable message text", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "email",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return [
            "From: Ada <ada@example.com>",
            "To: Tunde <tunde@example.com>",
            "Subject: Compliance angle",
            "",
            "Lead with trust before features.",
          ].join("\r\n");
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 1, pending: 0, failed: 0 });
    expect(String((repository.fragments[0] as { content: string }).content)).toContain("Subject: Compliance angle");
    expect(String((repository.fragments[0] as { content: string }).content)).toContain("Lead with trust before features.");
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        parser: {
          name: "email",
        },
      },
    });
  });

  it("parses encrypted chat exports into readable conversation text", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "chat_export",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return JSON.stringify({
            messages: [
              { role: "user", content: "What angle should I use?" },
              { role: "assistant", content: "Lead with trust." },
            ],
          });
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 1, pending: 0, failed: 0 });
    expect(repository.fragments[0]).toMatchObject({
      content: "unknown/user: What angle should I use?\nunknown/assistant: Lead with trust.",
    });
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        conversation: {
          messageCount: 2,
          counts: {
            unknown: 2,
          },
          unknownSpeakers: ["user", "assistant"],
        },
        parser: {
          name: "chat_export",
          speakers: ["user", "assistant"],
        },
      },
    });
  });

  it("applies identity profile and source mappings to chat speaker attribution", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "chat_export",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);
    repository.setTwinIdentityProfile({
      displayName: "Fortune Ogunsusi",
      aliases: ["Fortune"],
      emails: [],
      phones: [],
      handles: {},
    });
    repository.setSourceSpeakerMappings([
      {
        sourceSpeaker: "Ada",
        role: "other",
        mappedName: "Ada Lovelace",
      },
    ]);

    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return JSON.stringify({
            messages: [
              { author: "Fortune", content: "I want to lead with compliance." },
              { author: "Ada", content: "That reduces procurement friction." },
              { author: "Mystery", content: "Ship it." },
            ],
          });
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 1, pending: 0, failed: 0 });
    expect(repository.fragments[0]).toMatchObject({
      content: [
        "self/Fortune: I want to lead with compliance.",
        "other/Ada: That reduces procurement friction.",
        "unknown/Mystery: Ship it.",
      ].join("\n"),
    });
    expect(repository.fragments[0]).toMatchObject({
      metadata: {
        conversation: {
          messageCount: 3,
          counts: {
            self: 1,
            other: 1,
            unknown: 1,
          },
          unknownSpeakers: ["Mystery"],
          mappedSpeakers: 1,
        },
      },
    });
  });

  it("parses encrypted Slack exports into readable conversation text", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "slack_export",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return JSON.stringify([
            {
              user: "U123",
              text: "Lead with <https://example.com|trust> in <#C123|strategy>.",
              ts: "1711965600.000000",
            },
          ]);
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 1, pending: 0, failed: 0 });
    expect(repository.fragments[0]).toMatchObject({
      content: "[1711965600.000000] unknown/U123: Lead with trust in #strategy.",
    });
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        parser: {
          name: "slack_export",
        },
      },
    });
  });

  it("parses encrypted WhatsApp exports into readable conversation text", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "whatsapp_export",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return [
            "01/04/2024, 10:00 - Tunde: Lead with compliance.",
            "01/04/2024, 10:02 - Ada: Trust reduces procurement friction.",
          ].join("\n");
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 1, pending: 0, failed: 0 });
    expect(repository.fragments[0]).toMatchObject({
      content: [
        "[01/04/2024 10:00] unknown/Tunde: Lead with compliance.",
        "[01/04/2024 10:02] unknown/Ada: Trust reduces procurement friction.",
      ].join("\n"),
    });
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        parser: {
          name: "whatsapp_export",
        },
      },
    });
  });

  it("parses encrypted docx extracted text into normalized memory text", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "docx",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return "  Compliance   first.\n\n\nTrust before features.  ";
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 1, pending: 0, failed: 0 });
    expect(repository.fragments[0]).toMatchObject({
      content: "Compliance first.\n\nTrust before features.",
    });
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        parser: {
          name: "docx",
          warnings: ["docx_text_input_without_binary_parse"],
        },
      },
    });
  });

  it("does not create duplicate fragments when a processing artifact is retried", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "pdf",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    repository.fragments.push({
      id: "existing-fragment",
      sourceArtifactId: "artifact-id",
    });

    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return "Decrypted private memory.";
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 1, pending: 0, failed: 0 });
    expect(repository.fragments).toHaveLength(1);
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        status: "completed",
        memoryFragmentId: "existing-fragment",
      },
    });
  });

  it("fails scanned PDF OCR artifacts when the decrypted payload is empty", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "ocr_pdf",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return "";
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 0, pending: 0, failed: 1 });
    expect(repository.fragments).toEqual([]);
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        status: "failed",
        reason: PARSED_OCR_PDF_EMPTY,
        parser: {
          name: "ocr_scanned_pdf",
          warnings: ["ocr_pdf_empty_payload"],
        },
      },
    });
  });

  it("fails image OCR artifacts when the decrypted payload is empty", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "image",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
          fileType: "image/png",
        },
      },
    ]);

    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return "";
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 0, pending: 0, failed: 1 });
    expect(repository.fragments).toEqual([]);
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        status: "failed",
        reason: PARSED_IMAGE_EMPTY,
        parser: {
          name: "image_ocr",
          warnings: ["image_empty_payload"],
        },
      },
    });
  });

  it("parses encrypted GitHub imports into memory fragments", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "github",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return "GitHub repository: sivraj/app\n\n\n\nFile: README.md\n# Sivraj";
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 1, pending: 0, failed: 0 });
    expect(repository.fragments[0]).toMatchObject({
      content: "GitHub repository: sivraj/app\n\n\nFile: README.md\n# Sivraj",
    });
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        parser: {
          name: "github",
        },
      },
    });
  });

  it("fails empty encrypted GitHub imports", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "github",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return "    \n";
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 0, pending: 0, failed: 1 });
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        reason: PARSED_GITHUB_EMPTY,
        parser: {
          name: "github",
        },
      },
    });
  });

  it("parses encrypted browser history exports into memory fragments", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "browser_history",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return "title,url,lastVisitTime\nSivraj,https://sivraj.ai,2026-05-20T10:00:00Z";
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 1, pending: 0, failed: 0 });
    expect(repository.fragments[0]).toMatchObject({
      content: expect.stringContaining("Browser history export: Untitled export"),
    });
    expect(repository.fragments[0]).toMatchObject({
      content: expect.stringContaining("URL: https://sivraj.ai"),
    });
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        parser: {
          name: "browser_history",
        },
      },
    });
  });

  it("fails empty encrypted browser history exports", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "browser_history",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return "no visits here";
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 0, pending: 0, failed: 1 });
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        reason: PARSED_BROWSER_HISTORY_EMPTY,
        parser: {
          name: "browser_history",
        },
      },
    });
  });

  it("keeps encrypted voice notes pending until speech-to-text is available", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "voice_note",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    const result = await processQueuedArtifacts(repository, {
      now: new Date("2026-05-20T10:00:00.000Z"),
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return privateSourcePayload({
            content: "ZmFrZSBhdWRpbw==",
            title: "founder-reflection.m4a",
            metadata: {
              fileName: "founder-reflection.m4a",
              fileType: "audio/mp4",
            },
          });
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 0, pending: 1, failed: 0 });
    expect(repository.fragments).toEqual([]);
    expect(repository.artifacts[0]?.status).toBe("pending");
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        status: "pending",
        reason: SPEECH_TO_TEXT_REQUIRED,
        decryptPath: "seal_walrus",
      },
    });
    expect(repository.auditEvents[0]).toMatchObject({
      eventType: "artifact.processing_pending",
      resourceId: "artifact-id",
      metadata: {
        reason: SPEECH_TO_TEXT_REQUIRED,
        rawStorageRef: "walrus://blob/blob-id",
        decryptPath: "seal_walrus",
      },
    });
  });

  it("transcribes encrypted voice notes into memory fragments", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "voice_note",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
          fileName: "founder-reflection.m4a",
          fileType: "audio/mp4",
        },
      },
    ]);

    const result = await processQueuedArtifacts(repository, {
      now: new Date("2026-05-20T10:00:00.000Z"),
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return privateSourcePayload({
            content: "ZmFrZSBhdWRpbw==",
            title: "founder-reflection.m4a",
            metadata: {
              fileName: "founder-reflection.m4a",
              fileType: "audio/mp4",
            },
          });
        },
      },
      speechToTextTranscriber: {
        async transcribe(input) {
          expect(input).toEqual({
            audioBase64: "ZmFrZSBhdWRpbw==",
            fileName: "founder-reflection.m4a",
            mimeType: "audio/mp4",
          });

          return {
            text: "I need to stop over-polishing and ship the founder demo.",
            provider: "openai",
            model: "gpt-4o-mini-transcribe",
          };
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 1, pending: 0, failed: 0 });
    expect(repository.fragments[0]).toMatchObject({
      sourceArtifactId: "artifact-id",
      content: "I need to stop over-polishing and ship the founder demo.",
    });
    expect(repository.artifacts[0]?.status).toBe("completed");
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        status: "completed",
        memoryFragmentId: "fragment-1",
        decryptPath: "seal_walrus",
        transcription: {
          provider: "openai",
          model: "gpt-4o-mini-transcribe",
          transcriptLength: 56,
        },
      },
    });
    expect(repository.auditEvents[0]).toMatchObject({
      eventType: "artifact.processed",
      resourceId: "artifact-id",
      metadata: {
        memoryFragmentId: "fragment-1",
        rawStorageRef: "walrus://blob/blob-id",
        decryptPath: "seal_walrus",
        transcription: {
          provider: "openai",
          model: "gpt-4o-mini-transcribe",
        },
      },
    });
  });

  it("transcribes encrypted voice conversations into memory fragments", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "voice_conversation",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
          fileName: "voice-conversation-2026-05-20.webm",
          fileType: "audio/webm",
          audio: {
            kind: "voice_conversation",
            durationMs: 42000,
          },
        },
      },
    ]);

    const result = await processQueuedArtifacts(repository, {
      now: new Date("2026-05-20T10:00:00.000Z"),
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return privateSourcePayload({
            content: "ZmFrZSBhdWRpbw==",
            title: "voice-conversation-2026-05-20.webm",
            metadata: {
              fileName: "voice-conversation-2026-05-20.webm",
              fileType: "audio/webm",
            },
          });
        },
      },
      speechToTextTranscriber: {
        async transcribe(input) {
          expect(input).toEqual({
            audioBase64: "ZmFrZSBhdWRpbw==",
            fileName: "voice-conversation-2026-05-20.webm",
            mimeType: "audio/webm",
          });

          return {
            text: "We should position Sivraj around owned memory and trust.",
            provider: "openai",
            model: "gpt-4o-mini-transcribe",
          };
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 1, pending: 0, failed: 0 });
    expect(repository.fragments[0]).toMatchObject({
      sourceArtifactId: "artifact-id",
      content: "We should position Sivraj around owned memory and trust.",
    });
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        status: "completed",
        memoryFragmentId: "fragment-1",
        decryptPath: "seal_walrus",
        transcription: {
          provider: "openai",
          model: "gpt-4o-mini-transcribe",
        },
      },
    });
  });

  it("extracts encrypted candidate memories from voice conversation transcripts", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "voice_conversation",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
          fileName: "voice-conversation-2026-05-20.webm",
          fileType: "audio/webm",
        },
      },
    ]);
    const candidateMemoryArchiveQueue = createFakeCandidateMemoryArchiveQueue();

    await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return privateSourcePayload({
            content: "ZmFrZSBhdWRpbw==",
            title: "voice-conversation-2026-05-20.webm",
            metadata: {
              fileName: "voice-conversation-2026-05-20.webm",
              fileType: "audio/webm",
            },
          });
        },
      },
      speechToTextTranscriber: {
        async transcribe() {
          return {
            text: "I decided to position Sivraj around owned memory. Remind me to write the demo script.",
            provider: "openai",
            model: "gpt-4o-mini-transcribe",
          };
        },
      },
    });

    await processArtifactIntelligence(repository, {
      artifactId: "artifact-id",
      twinId: "twin-id",
      sourceType: "voice_conversation",
      memoryFragmentId: "fragment-1",
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return "I decided to position Sivraj around owned memory. Remind me to write the demo script.";
        },
      },
      memoryExtractor: {
        async extract(input) {
          expect(input.sourceType).toBe("voice_conversation");
          expect(input.content).toContain("owned memory");

          return {
            memories: [
              {
                statement: "The user decided to position Sivraj around owned memory.",
                normalizedStatement: "the user decided to position sivraj around owned memory.",
                memoryType: "decision" as const,
                subject: "Sivraj positioning",
                confidence: 0.9,
                evidenceHash: "decision-evidence-hash",
                evidenceLength: 52,
                metadata: {
                  conversationSignal: "decision",
                  requiresApproval: true,
                },
              },
              {
                statement: "The user needs to write the Sivraj demo script.",
                normalizedStatement: "the user needs to write the sivraj demo script.",
                memoryType: "commitment" as const,
                subject: "Sivraj demo script",
                confidence: 0.82,
                evidenceHash: "follow-up-evidence-hash",
                evidenceLength: 34,
                metadata: {
                  conversationSignal: "follow_up",
                  requiresApproval: true,
                },
              },
            ],
            metadata: {
              extractor: "llm_structured_memory_extractor" as const,
              provider: "openai",
              model: "gpt-4o",
              originalLength: input.content.length,
              returnedMemories: 2,
              acceptedMemories: 2,
              warnings: [],
              sourceKind: "conversation" as const,
              conversationUnderstanding: {
                enabled: true as const,
                sourceType: "voice_conversation",
                goalCount: 0,
                decisionCount: 1,
                preferenceCount: 0,
                commitmentCount: 1,
                followUpCount: 1,
              },
            },
          };
        },
      },
      candidateMemoryArchiveQueue,
    });

    expect(repository.candidateMemories).toHaveLength(2);
    expect(repository.candidateMemories[0]?.metadata).toMatchObject({
      sourceKind: "conversation",
      conversationSourceType: "voice_conversation",
      voiceDerived: true,
      conversationUnderstanding: {
        sourceType: "voice_conversation",
        decisionCount: 1,
        commitmentCount: 1,
        followUpCount: 1,
      },
      memoryMetadata: {
        conversationSignal: "decision",
        requiresApproval: true,
      },
    });
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        intelligence: {
          memoryExtraction: {
            sourceKind: "conversation",
            conversationSourceType: "voice_conversation",
            voiceDerived: true,
            candidateMemoryCount: 2,
            conversationUnderstanding: {
              sourceType: "voice_conversation",
              decisionCount: 1,
              commitmentCount: 1,
              followUpCount: 1,
            },
          },
        },
      },
    });
    expect(candidateMemoryArchiveQueue.enqueueCalls).toHaveLength(1);
    expect(JSON.stringify(repository.candidateMemories)).not.toContain("I decided");
    expect(JSON.stringify(repository.candidateMemories)).not.toContain("Remind me");
  });

  it("fails encrypted voice notes when transcription fails", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "voice_note",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return "ZmFrZSBhdWRpbw==";
        },
      },
      speechToTextTranscriber: {
        async transcribe() {
          throw new Error("provider unavailable");
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 0, pending: 0, failed: 1 });
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        status: "failed",
        reason: SPEECH_TO_TEXT_FAILED,
        decryptPath: "seal_walrus",
      },
    });
  });

  it("fails encrypted voice notes when transcription is empty", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "voice_note",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    const result = await processQueuedArtifacts(repository, {
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      privateMemoryReader: {
        async readPrivateMemory() {
          return "ZmFrZSBhdWRpbw==";
        },
      },
      speechToTextTranscriber: {
        async transcribe() {
          return {
            text: " ",
            provider: "openai",
            model: "gpt-4o-mini-transcribe",
          };
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 0, pending: 0, failed: 1 });
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        status: "failed",
        reason: SPEECH_TO_TEXT_EMPTY,
        decryptPath: "seal_walrus",
      },
    });
  });

  it("fails non-encrypted artifacts that have no processing input", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "upload",
        rawStorageRef: null,
        metadata: {},
      },
    ]);

    const result = await processQueuedArtifacts(repository);

    expect(result).toEqual({ scanned: 1, completed: 0, pending: 0, failed: 1 });
    expect(repository.artifacts[0]?.status).toBe("failed");
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        status: "failed",
        reason: MISSING_PROCESSABLE_CONTENT,
      },
    });
  });
});

describe("generateWeeklyReflection", () => {
  it("stores weekly reflection text encrypted and records safe metadata only", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "note",
        rawStorageRef: "walrus://blob/source",
        metadata: {},
      },
    ]);
    repository.fragments.push({
      id: "fragment-id",
      twinId: "twin-id",
      sourceArtifactId: "artifact-id",
      contentStorageRef: "walrus://blob/fragment",
      contentSha256: "sha256:fragment",
    });
    repository.candidateMemories.push({
      id: "candidate-memory-id",
      twinId: "twin-id",
      sourceArtifactId: "artifact-id",
      memoryFragmentId: "fragment-id",
      memoryType: "goal",
      status: "approved",
      evidenceHash: "evidence-hash",
      evidenceLength: 12,
      confidenceScore: 0.8,
      metadata: { subject: "Sivraj" },
    });

    const result = await generateWeeklyReflection(repository, {
      twinId: "twin-id",
      periodStart: new Date("2026-05-01T00:00:00.000Z"),
      periodEnd: new Date("2026-05-08T00:00:00.000Z"),
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      generator: {
        async generateJson() {
          return {
            provider: "openrouter",
            model: "google/gemini-3.1-flash-lite",
            json: {
              reflection: "You made steady progress on Sivraj this week.",
              highlights: ["1 artifact", "1 candidate memory"],
              questions: ["What should be approved next?"],
            },
          };
        },
      },
    });

    expect(result).toMatchObject({
      status: "completed",
      reflectionRunId: "reflection-run-1",
      summaryStorageRef: "walrus://blob/encrypted-reflection",
    });
    expect(repository.reflectionRuns).toHaveLength(1);
    expect(repository.reflectionRuns[0]).toMatchObject({
      status: "completed",
      summaryStorageRef: "walrus://blob/encrypted-reflection",
      summarySha256: "sha256:reflection",
      metadata: {
        storageMode: "encrypted_walrus",
        sensitivity: "private",
        provider: "openrouter",
        model: "google/gemini-3.1-flash-lite",
      },
    });
    expect(JSON.stringify(repository.reflectionRuns)).not.toContain("steady progress");
    expect(repository.auditEvents).toContainEqual(
      expect.objectContaining({
        eventType: "reflection.weekly_generated",
        resourceId: "reflection-run-1",
      }),
    );
  });

  it("skips weekly reflection when there are no signals", async () => {
    const repository = createRepository([]);

    const result = await generateWeeklyReflection(repository, {
      twinId: "twin-id",
      periodStart: new Date("2026-05-01T00:00:00.000Z"),
      periodEnd: new Date("2026-05-08T00:00:00.000Z"),
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      generator: {
        async generateJson() {
          throw new Error("should not generate");
        },
      },
    });

    expect(result).toMatchObject({
      status: "skipped",
      reason: "no_weekly_reflection_signals",
    });
    expect(repository.reflectionRuns[0]).toMatchObject({
      status: "skipped",
      metadata: {
        reason: "no_weekly_reflection_signals",
      },
    });
  });

  it("updates an existing on-demand reflection run instead of creating another row", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "note",
        rawStorageRef: "walrus://blob/source",
        metadata: {},
      },
    ]);

    const result = await generateWeeklyReflection(repository, {
      reflectionRunId: "reflection-run-existing",
      twinId: "twin-id",
      periodStart: new Date("2026-05-01T00:00:00.000Z"),
      periodEnd: new Date("2026-05-08T00:00:00.000Z"),
      privateFragmentStorage: createFakePrivateFragmentStorage(),
      generator: {
        async generateJson() {
          return {
            provider: "openrouter",
            model: "google/gemini-3.1-flash-lite",
            json: {
              reflection: "A private reflection for an existing request.",
            },
          };
        },
      },
    });

    expect(result).toMatchObject({
      status: "completed",
      reflectionRunId: "reflection-run-existing",
    });
    expect(repository.reflectionRuns).toHaveLength(1);
    expect(repository.reflectionRuns[0]).toMatchObject({
      id: "reflection-run-existing",
      status: "completed",
      summaryStorageRef: "walrus://blob/encrypted-reflection",
    });
  });
});

function createRepository(artifacts: QueuedArtifact[]) {
  const state = artifacts.map((artifact) => ({
    ...artifact,
    status: "queued",
  }));
  const fragments: unknown[] = [];
  const graphNodes: Array<Record<string, unknown> & { id: string }> = [];
  const graphEdges: Array<Record<string, unknown> & { id: string }> = [];
  const candidateMemories: Array<Record<string, unknown> & { id: string }> = [];
  const auditEvents: unknown[] = [];
  const reflectionRuns: Array<Record<string, unknown> & { id: string }> = [];
  let twinIdentityProfile = null as Record<string, unknown> | null;
  let sourceSpeakerMappings = [] as Array<Record<string, unknown>>;

  const repository: ArtifactRepository & {
    artifacts: typeof state;
    fragments: unknown[];
    graphNodes: typeof graphNodes;
    graphEdges: typeof graphEdges;
    candidateMemories: typeof candidateMemories;
    auditEvents: unknown[];
    reflectionRuns: typeof reflectionRuns;
    setTwinIdentityProfile(profile: Record<string, unknown> | null): void;
    setSourceSpeakerMappings(mappings: Array<Record<string, unknown>>): void;
  } = {
    artifacts: state,
    fragments,
    graphNodes,
    graphEdges,
    candidateMemories,
    auditEvents,
    reflectionRuns,
    async findArtifactById(id) {
      return state.find((artifact) => artifact.id === id) ?? null;
    },
    async findQueuedArtifacts(limit) {
      return state.filter((artifact) => artifact.status === "queued").slice(0, limit);
    },
    async claimArtifact(id) {
      const artifact = state.find((candidate) => candidate.id === id && candidate.status === "queued");

      if (!artifact) {
        return null;
      }

      artifact.status = "processing";
      return artifact;
    },
    async claimRecoverableArtifact(id) {
      const artifact = state.find((candidate) => candidate.id === id && candidate.status === "queued");

      if (!artifact) {
        return null;
      }

      artifact.status = "processing";
      return artifact;
    },
    async markArtifactPending(id, metadata) {
      updateArtifact(state, id, "pending", metadata);
    },
    async markArtifactCompleted(id, metadata) {
      updateArtifact(state, id, "completed", metadata);
    },
    async markArtifactFailed(id, metadata) {
      updateArtifact(state, id, "failed", metadata);
    },
    async findMemoryFragmentBySourceArtifactId(sourceArtifactId) {
      return (
        fragments.find(
          (fragment) =>
            typeof fragment === "object" &&
            fragment !== null &&
            "sourceArtifactId" in fragment &&
            fragment.sourceArtifactId === sourceArtifactId,
        ) as { id: string } | undefined
      ) ?? null;
    },
    async findMemoryFragmentById(id) {
      const fragment = fragments.find(
        (candidate) =>
          typeof candidate === "object" &&
          candidate !== null &&
          "id" in candidate &&
          candidate.id === id,
      ) as
        | {
            id: string;
            twinId: string;
            sourceArtifactId: string;
            contentStorageRef: string | null;
            contentSha256: string | null;
          }
        | undefined;

      return fragment ?? null;
    },
    async findTwinIdentityProfile() {
      return twinIdentityProfile;
    },
    async findSourceSpeakerMappings() {
      return sourceSpeakerMappings.map((mapping) => ({
        sourceSpeaker: String(mapping.sourceSpeaker),
        sourceSpeakerId: typeof mapping.sourceSpeakerId === "string" ? mapping.sourceSpeakerId : null,
        role: mapping.role as "self" | "other" | "system" | "unknown",
        mappedName: typeof mapping.mappedName === "string" ? mapping.mappedName : null,
      }));
    },
    async findRecentPatternSignals(twinId, limit) {
      return candidateMemories
        .filter((candidate) => candidate.twinId === twinId)
        .slice(0, limit)
        .map((candidate) => {
          const metadata = readTestRecord(candidate.metadata);
          const subject = typeof metadata.subject === "string" ? metadata.subject : null;
          const sourceType = typeof metadata.sourceType === "string" ? metadata.sourceType : "unknown";

          if (!subject) {
            return null;
          }

          return {
            twinId,
            sourceArtifactId: String(candidate.sourceArtifactId),
            memoryFragmentId: String(candidate.memoryFragmentId),
            candidateMemoryId: candidate.id,
            memoryType: candidate.memoryType as "fact" | "preference" | "goal" | "decision" | "commitment" | "experience" | "project_update" | "relationship" | "other",
            subject,
            confidence: typeof candidate.confidenceScore === "number" ? candidate.confidenceScore : 0.5,
            evidenceHash: String(candidate.evidenceHash),
            evidenceLength: typeof candidate.evidenceLength === "number" ? candidate.evidenceLength : null,
            sourceType,
            metadata,
          };
        })
        .filter((signal): signal is NonNullable<typeof signal> => Boolean(signal));
    },
    async createMemoryFragment(input) {
      const testPlaintext = readTestPlaintext(input.metadata);
      const fragment = {
        ...input,
        content: testPlaintext ?? "",
        id: `fragment-${fragments.length + 1}`,
      };
      fragments.push(fragment);
      return fragment;
    },
    async upsertGraphNode(input) {
      const normalizedName = input.normalizedName ?? normalizeTestGraphNodeName(input.name);
      const existing = graphNodes.find(
        (node) =>
          node.twinId === input.twinId &&
          node.nodeType === input.nodeType &&
          node.normalizedName === normalizedName,
      );

      if (existing) {
        Object.assign(existing, {
          ...input,
          name: existing.name,
          normalizedName,
          properties: mergeTestGraphNodeProperties(
            existing.properties,
            input.properties,
          ),
          confidenceScore: Math.max(
            readTestNumber(existing.confidenceScore),
            input.confidenceScore,
          ),
        });
        return { id: existing.id };
      }

      const node = {
        ...input,
        normalizedName,
        properties: mergeTestGraphNodeProperties(null, input.properties),
        id: `node-${graphNodes.length + 1}`,
      };
      graphNodes.push(node);
      return { id: node.id };
    },
    async upsertGraphEdge(input) {
      const existing = graphEdges.find(
        (edge) =>
          edge.twinId === input.twinId &&
          edge.fromNodeId === input.fromNodeId &&
          edge.toNodeId === input.toNodeId &&
          edge.edgeType === input.edgeType,
      );

      if (existing) {
        Object.assign(existing, {
          ...input,
          evidenceMemoryIds: Array.from(new Set([
            ...((existing.evidenceMemoryIds as string[] | undefined) ?? []),
            ...input.evidenceMemoryIds,
          ])),
        });
        return { id: existing.id };
      }

      const edge = {
        ...input,
        id: `edge-${graphEdges.length + 1}`,
      };
      graphEdges.push(edge);
      return { id: edge.id };
    },
    async createCandidateMemory(input) {
      const {
        statement: _statement,
        normalizedStatement: _normalizedStatement,
        mergeJudge: _mergeJudge,
        ...storedInput
      } = input;
      const existing = candidateMemories.find(
        (candidate) =>
          candidate.memoryFragmentId === input.memoryFragmentId &&
          candidate.memoryType === input.memoryType &&
          candidate.evidenceHash === input.evidenceHash,
      );

      if (existing) {
        Object.assign(existing, storedInput);
        return { id: existing.id };
      }

      const candidate = {
        ...storedInput,
        id: `candidate-memory-${candidateMemories.length + 1}`,
      };
      candidateMemories.push(candidate);
      return { id: candidate.id };
    },
    async markCandidateMemoriesArchived(input) {
      for (const id of input.candidateMemoryIds) {
        const candidate = candidateMemories.find((item) => item.id === id);

        if (!candidate) {
          continue;
        }

        Object.assign(candidate, {
          statementStorageRef: input.statementStorageRef,
          statementSha256: input.statementSha256,
          metadata: {
            ...((candidate.metadata as Record<string, unknown> | undefined) ?? {}),
            ...input.metadata,
          },
        });
      }
    },
    async findWeeklyReflectionSignals() {
      return {
        sourceArtifactCount: state.length,
        memoryFragmentCount: fragments.length,
        candidateMemoryCount: candidateMemories.length,
        approvedCandidateMemoryCount: candidateMemories.filter((candidate) => candidate.status === "approved").length,
        rejectedCandidateMemoryCount: candidateMemories.filter((candidate) => candidate.status === "rejected").length,
        graphNodeCount: graphNodes.length,
        projectCount: graphNodes.filter((node) => node.nodeType === "project").length,
        goalCount: graphNodes.filter((node) => node.nodeType === "goal").length,
        decisionCount: graphNodes.filter((node) => node.nodeType === "decision").length,
        patternCount: graphNodes.filter((node) => readTestRecord(node.properties).kind === "pattern").length,
        feedbackCount: 0,
        usefulFeedbackCount: 0,
        negativeFeedbackCount: 0,
        candidateSubjects: candidateMemories
          .map((candidate) => ({
            subject: readTestRecord(candidate.metadata).subject,
            memoryType: candidate.memoryType,
          }))
          .filter((item): item is { subject: string; memoryType: "fact" | "preference" | "goal" | "decision" | "commitment" | "experience" | "project_update" | "relationship" | "other" } =>
            typeof item.subject === "string" && typeof item.memoryType === "string",
          )
          .map((item) => ({
            ...item,
            count: 1,
          })),
        graphSubjects: graphNodes.map((node) => ({
          name: String(node.name),
          nodeType: node.nodeType as "person" | "organization" | "project" | "concept" | "event" | "artifact" | "goal" | "decision" | "topic" | "other",
        })),
        feedbackBreakdown: {},
        sourceArtifactIds: state.map((artifact) => artifact.id),
        memoryFragmentIds: fragments
          .map((fragment) => readTestRecord(fragment).id)
          .filter((id): id is string => typeof id === "string"),
        candidateMemoryIds: candidateMemories.map((candidate) => candidate.id),
        graphNodeIds: graphNodes.map((node) => node.id),
      };
    },
    async createReflectionRun(input) {
      const run = {
        ...input,
        id: `reflection-run-${reflectionRuns.length + 1}`,
      };
      reflectionRuns.push(run);
      return { id: run.id };
    },
    async updateReflectionRun(input) {
      const run = reflectionRuns.find((candidate) => candidate.id === input.id);

      if (run) {
        Object.assign(run, input);
        return;
      }

      reflectionRuns.push({ ...input, id: input.id });
    },
    async createAuditEvent(input) {
      auditEvents.push(input);
    },
    setTwinIdentityProfile(profile) {
      twinIdentityProfile = profile;
    },
    setSourceSpeakerMappings(mappings) {
      sourceSpeakerMappings = mappings;
    },
  };

  return repository;
}

function updateArtifact(
  artifacts: Array<QueuedArtifact & { status: string }>,
  id: string,
  status: string,
  metadata: Record<string, unknown>,
) {
  const artifact = artifacts.find((candidate) => candidate.id === id);

  if (!artifact) {
    throw new Error(`Missing artifact ${id}`);
  }

  artifact.status = status;
  artifact.metadata = metadata;
}

function privateSourcePayload(input: {
  content: string;
  title?: string | null;
  metadata?: Record<string, unknown>;
}): string {
  return JSON.stringify({
    kind: "source_artifact",
    version: 1,
    title: input.title ?? null,
    content: input.content,
    metadata: input.metadata ?? {},
  });
}

function createFakePrivateFragmentStorage() {
  return {
    async encryptPrivateFragment(input: { content: string; contentKind?: string }) {
      if (input.contentKind === "candidate_memory") {
        return {
          encryptedBytesBase64: Buffer.from(`candidate:${input.content}`).toString("base64"),
          contentSha256: `sha256:candidate:${input.content.length}`,
          metadata: {
            storageMode: "encrypted_walrus",
            sensitivity: "private",
            contentKind: "candidate_memory",
            sealEncryptMs: 1,
          },
        };
      }

      return {
        encryptedBytesBase64: Buffer.from(input.content).toString("base64"),
        contentSha256: `sha256:${input.content.length}`,
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
          contentKind: "memory_fragment",
          sealEncryptMs: 1,
          testPlaintext: input.content,
        },
      };
    },
    async storeEncryptedPrivateFragment(input: {
      encryptedBytesBase64: string;
      contentSha256: string;
      metadata: Record<string, unknown>;
      contentKind?: string;
    }) {
      return {
        contentStorageRef: input.contentKind === "candidate_memory"
          ? "walrus://blob/encrypted-candidate-memory"
          : "walrus://blob/encrypted-fragment",
        contentSha256: input.contentSha256,
        encryptedBytesBase64: input.encryptedBytesBase64,
        metadata: {
          ...input.metadata,
          walrusStoreMs: 1,
          walrus: {
            blobId: "test-blob",
          },
        },
      };
    },
    async storePrivateFragment(input: { content: string; contentKind?: string }) {
      if (input.contentKind === "candidate_memory") {
        return {
          contentStorageRef: "walrus://blob/encrypted-candidate-memory",
          contentSha256: `sha256:candidate:${input.content.length}`,
          encryptedBytesBase64: Buffer.from(`candidate:${input.content}`).toString("base64"),
          metadata: {
            storageMode: "encrypted_walrus",
            sensitivity: "private",
            contentKind: "candidate_memory",
          },
        };
      }

      if (input.contentKind === "reflection") {
        return {
          contentStorageRef: "walrus://blob/encrypted-reflection",
          contentSha256: "sha256:reflection",
          encryptedBytesBase64: Buffer.from(`reflection:${input.content}`).toString("base64"),
          metadata: {
            storageMode: "encrypted_walrus",
            sensitivity: "private",
            contentKind: "reflection",
          },
        };
      }

      return {
        contentStorageRef: "walrus://blob/encrypted-fragment",
        contentSha256: `sha256:${input.content.length}`,
        encryptedBytesBase64: Buffer.from(input.content).toString("base64"),
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
          contentKind: "memory_fragment",
          testPlaintext: input.content,
        },
      };
    },
  };
}

function createFakeCandidateMemoryArchiveQueue() {
  const enqueueCalls: Array<{
    artifactId: string;
    twinId: string;
    memoryFragmentId: string;
    sourceType: string;
    candidateMemoryIds: string[];
    encryptedBytesBase64: string;
    contentSha256: string;
    metadata: Record<string, unknown>;
  }> = [];

  return {
    enqueueCalls,
    async enqueueCandidateMemoryArchive(input: typeof enqueueCalls[number]) {
      enqueueCalls.push(input);
      return { jobId: `${input.artifactId}:candidate-memory-archive:${input.contentSha256.slice(0, 16)}` };
    },
  };
}

function createStrictFakePrivateFragmentStorage() {
  return {
    async storePrivateFragment(input: { content: string }) {
      return {
        contentStorageRef: "walrus://blob/encrypted-fragment",
        contentSha256: `sha256:${input.content.length}`,
        encryptedBytesBase64: Buffer.from(input.content).toString("base64"),
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
          contentKind: "memory_fragment",
        },
      };
    },
  };
}

function readTestPlaintext(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const value = (metadata as Record<string, unknown>)["testPlaintext"];
  return typeof value === "string" ? value : null;
}

function normalizeTestGraphNodeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function mergeTestGraphNodeProperties(
  existing: unknown,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const existingRecord = readTestRecord(existing);
  const aliases = mergeTestStringArrays(
    readTestStringArray(existingRecord.aliases),
    readTestStringArray(incoming.aliases),
  );
  const sourceTypes = mergeTestStringArrays(
    readTestStringArray(existingRecord.sourceTypes),
    readTestStringArray(incoming.sourceTypes),
    typeof incoming.sourceType === "string" ? [incoming.sourceType] : [],
  );

  return {
    ...existingRecord,
    ...incoming,
    aliases,
    sourceTypes,
    mentionCount:
      readTestNumber(existingRecord.mentionCount) +
      Math.max(1, readTestNumber(incoming.mentionCount)),
  };
}

function readTestRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function readTestStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function mergeTestStringArrays(...arrays: string[][]): string[] {
  return Array.from(new Set(arrays.flat().map((value) => value.trim()).filter(Boolean)));
}

function readTestNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
