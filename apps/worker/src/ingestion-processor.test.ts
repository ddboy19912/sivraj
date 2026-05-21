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
  const auditEvents: unknown[] = [];

  const repository: ArtifactRepository & {
    artifacts: typeof state;
    fragments: unknown[];
    auditEvents: unknown[];
  } = {
    artifacts: state,
    fragments,
    auditEvents,
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
    async storePrivateFragment(input: { content: string }) {
      return {
        contentStorageRef: "walrus://blob/encrypted-fragment",
        contentSha256: `sha256:${input.content.length}`,
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

function createStrictFakePrivateFragmentStorage() {
  return {
    async storePrivateFragment(input: { content: string }) {
      return {
        contentStorageRef: "walrus://blob/encrypted-fragment",
        contentSha256: `sha256:${input.content.length}`,
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
