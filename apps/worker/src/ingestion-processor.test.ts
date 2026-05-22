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
  processArtifact,
  processCandidateMemoryArchive,
  processArtifactIntelligence,
  processQueuedArtifacts,
  RetryableArtifactProcessingError,
  type ArtifactRepository,
  type QueuedArtifact,
} from "./ingestion-processor.js";

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
      content: "user: What angle should I use?\nassistant: Lead with trust.",
    });
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        parser: {
          name: "chat_export",
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
      content: "[1711965600.000000] U123: Lead with trust in #strategy.",
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
        "[01/04/2024 10:00] Tunde: Lead with compliance.",
        "[01/04/2024 10:02] Ada: Trust reduces procurement friction.",
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

  const repository: ArtifactRepository & {
    artifacts: typeof state;
    fragments: unknown[];
    graphNodes: typeof graphNodes;
    graphEdges: typeof graphEdges;
    candidateMemories: typeof candidateMemories;
    auditEvents: unknown[];
  } = {
    artifacts: state,
    fragments,
    graphNodes,
    graphEdges,
    candidateMemories,
    auditEvents,
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
      const existing = candidateMemories.find(
        (candidate) =>
          candidate.memoryFragmentId === input.memoryFragmentId &&
          candidate.memoryType === input.memoryType &&
          candidate.evidenceHash === input.evidenceHash,
      );

      if (existing) {
        Object.assign(existing, input);
        return { id: existing.id };
      }

      const candidate = {
        ...input,
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
    async createAuditEvent(input) {
      auditEvents.push(input);
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
