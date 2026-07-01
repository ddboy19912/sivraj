/**
 * Document retrieval for chat — inventory scan, page inspection, and chunk embedding search.
 *
 * Produces {@link DocumentContext} passages when the planner sets `retrieval: "document"`
 * or `intent: "document_qa"`.
 */
import { createConfiguredTextEmbedder, createOpenAICompatibleChatGenerator } from "@sivraj/llm";
import {
  candidateMemories,
  chatThreads,
  documentChunks,
  documentPages,
  documentStructureItems,
  memoryFragments,
  sourceArtifacts,
} from "@sivraj/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { ApiDb, AppDependencies } from "../../app.js";
import type { ChatRuntimeConfig, ChatThreadRow } from "../../types/chat.types.js";
import type { ConversationContextResolution } from "./turn-types.js";
import type {
  DocumentContext,
  DocumentInspectionSource,
  DocumentInventoryItem,
  DocumentRetrievalDegradation,
  DocumentRetrievalPlan,
  ChatRetrievalDegradationReason,
} from "./turn-types.js";
import { isUuid } from "./attachments.js";
import { parseJsonObject } from "./chat-json.js";
import {
  chunkArray,
  formatDocumentQueryScanReport,
  readDocumentSourceMetadata,
  readNonNegativeNumber,
} from "./document-formatters.js";
import { buildExactDocumentSearchReport } from "../tools/document.js";
import {
  fallbackDocumentRetrievalPlan,
  readDocumentQueryScanResult,
  readDocumentFocusArtifactIds,
  readDocumentRetrievalPlan,
  readPositivePageNumber,
  resolveDocumentNavigationPageScope,
  selectDocumentArtifactScope,
  shouldInspectNormalizedDocument,
  CHAT_DOCUMENT_TARGET_PAGE_LIMIT_DEFAULT,
} from "./document-navigation.js";
import { errorMessage, readPositiveInteger, truncate } from "./helpers.js";
import { optionalString, readRecord } from "../http/route-helpers.js";
import { mapSettledWithConcurrency } from "../memory-search/decrypt.js";
import { rankChatMemoryResults } from "./memory-ranking.js";
import { withTimeout } from "./chat-promise-timeout.js";

const CHAT_MEMORY_READABLE_STATUSES = ["verified_available", "renewed"] as const;
const CHAT_DOCUMENT_DECRYPT_TIMEOUT_DEFAULT_MS = 12_000;
const CHAT_DOCUMENT_DECRYPT_TIMEOUT_MAX_DEFAULT_MS = 12_000;
const CHAT_DOCUMENT_CONTEXT_CACHE_TTL_DEFAULT_MS = 10 * 60 * 1000;
const CHAT_DOCUMENT_RECENT_LIMIT_DEFAULT = 3;
const CHAT_DOCUMENT_PASSAGE_LIMIT_DEFAULT = 4;
const CHAT_DOCUMENT_EMBEDDING_CANDIDATE_LIMIT_DEFAULT = 48;
const CHAT_DOCUMENT_CHUNK_ROW_LIMIT_DEFAULT = 5_000;
const CHAT_DOCUMENT_DIRECT_PAGE_LIMIT_DEFAULT = 16;
const CHAT_DOCUMENT_GLOBAL_SCAN_PAGE_BATCH_DEFAULT = 6;
const CHAT_DOCUMENT_GLOBAL_SCAN_MAX_BATCHES_DEFAULT = 80;
const CHAT_DOCUMENT_GLOBAL_SCAN_CONCURRENCY_DEFAULT = 2;
const CHAT_DOCUMENT_GLOBAL_SCAN_CHAR_LIMIT_DEFAULT = 20_000;
const CHAT_DOCUMENT_GLOBAL_SCAN_TIMEOUT_DEFAULT_MS = 30_000;
const CHAT_DOCUMENT_STRUCTURE_EXTRACTION_CHAR_LIMIT_DEFAULT = 80_000;
const CHAT_DOCUMENT_STRUCTURE_EXTRACTION_TIMEOUT_DEFAULT_MS = 30_000;
const CHAT_DOCUMENT_STRUCTURE_EXTRACTION_MAX_ITEMS_DEFAULT = 250;
const CHAT_DOCUMENT_STRUCTURE_EXTRACTION_PAGE_BATCH_DEFAULT = 20;
const CHAT_DOCUMENT_STRUCTURE_EXTRACTION_MAX_BATCHES_DEFAULT = 80;
const CHAT_DOCUMENT_STRUCTURE_EXTRACTION_CONCURRENCY_DEFAULT = 2;
const CHAT_DOCUMENT_EXACT_SEARCH_SAMPLE_LIMIT_DEFAULT = 8;
const CHAT_DOCUMENT_EXACT_SEARCH_PAGE_LIMIT_DEFAULT = 2_000;

type PrivateMemoryReader = NonNullable<AppDependencies["privateMemoryReader"]>;

type DocumentReadFailure = {
  sourceArtifactId: string | null;
  memoryFragmentId: string | null;
  reason: ChatRetrievalDegradationReason;
  errorMessage: string;
};

type DocumentRetrievalDiagnostics = {
  failures: DocumentReadFailure[];
  failedMemoryFragmentIds: Set<string>;
};

const chatDocumentSourceCache = new Map<string, {
  expiresAt: number;
  value?: Awaited<ReturnType<typeof toDocumentSourceCandidate>> | null;
  promise?: ReturnType<typeof toDocumentSourceCandidate>;
}>();

/** Load document passages when the turn planner requests document retrieval. */
export async function loadDocumentContextForIntent(input: any) {
    if (!shouldLoadDocumentContext(input.contextResolution)) {
        return emptyDocumentContext();
    }
    return loadDocumentContext(input);
}
/** Whether document inventory / passage search should run for this turn. */
export function shouldLoadDocumentContext(contextResolution: any) {
    return contextResolution.retrieval === "document" ||
        contextResolution.intent === "document_qa";
}
async function loadDocumentContext(input: any) {
    const diagnostics = createDocumentRetrievalDiagnostics();
    const thread = input.thread ?? await loadThreadForDocumentFocus({
        db: input.db,
        twinId: input.twinId,
        threadId: input.threadId,
    });
    const focusedArtifactIds = readDocumentFocusArtifactIds(thread?.metadata);
    const recentRows = await loadRecentDocumentRows({
        db: input.db,
        twinId: input.twinId,
        limit: readPositiveInteger(process.env["CHAT_DOCUMENT_RECENT_LIMIT"], CHAT_DOCUMENT_RECENT_LIMIT_DEFAULT),
    });
    const focusedRows = focusedArtifactIds.length > 0
        ? await loadDocumentRowsByArtifactIds({
            db: input.db,
            twinId: input.twinId,
            artifactIds: focusedArtifactIds,
        })
        : [];
    const rows = dedupeDocumentRows([...focusedRows, ...recentRows]);
    if (rows.length === 0) {
        return emptyDocumentContext();
    }
    const inventory = await buildDocumentRetrievalInventory({
        db: input.db,
        twinId: input.twinId,
        rows,
        focusedArtifactIds,
    });
    const retrievalPlan = await createDocumentRetrievalPlan({
        query: input.query,
        inventory,
        runtimeConfig: input.runtimeConfig,
        llmFetch: input.llmFetch,
    });
    const inventoryAfterOnDemandStructure = input.privateMemoryReader
        ? await ensureDocumentStructureForPlan({
            db: input.db,
            twinId: input.twinId,
            privateMemoryReader: input.privateMemoryReader,
            rows,
            inventory,
            retrievalPlan,
            runtimeConfig: input.runtimeConfig,
            llmFetch: input.llmFetch,
            documentReadTimeoutMs: input.documentReadTimeoutMs,
            diagnostics,
        })
        : inventory;
    const metadataContext = buildDocumentMetadataContext({
        retrievalPlan,
        inventory: inventoryAfterOnDemandStructure,
        focusedArtifactIds,
    });
    if (metadataContext) {
        return metadataContext;
    }
    const scopedArtifactIds = selectDocumentArtifactScope({
        retrievalPlan,
        inventory: inventoryAfterOnDemandStructure,
        focusedArtifactIds,
    });
    if (!input.privateMemoryReader) {
        return storageUnavailableDocumentContext(retrievalPlan, scopedArtifactIds);
    }
    const scopedRows = rows.filter((row: any) => scopedArtifactIds.includes(row.sourceArtifact.id));
    const exactSearchSources = await loadDocumentExactSearchInspectionSources({
        db: input.db,
        rows: scopedRows,
        privateMemoryReader: input.privateMemoryReader,
        twinId: input.twinId,
        retrievalPlan,
        documentReadTimeoutMs: input.documentReadTimeoutMs,
        diagnostics,
    });
    if (exactSearchSources.length > 0) {
        return withDocumentDegradation({
            ...emptyDocumentContext(),
            retrievalPlan,
            inspectionSources: exactSearchSources,
        }, diagnostics, scopedArtifactIds);
    }
    const navigationScope = resolveDocumentNavigationPageScope({
        retrievalPlan,
        inventory: inventoryAfterOnDemandStructure,
        artifactIds: scopedArtifactIds,
    });
    const pageInspectionSources = await loadDocumentPageInspectionSources({
        db: input.db,
        privateMemoryReader: input.privateMemoryReader,
        twinId: input.twinId,
        artifactIds: scopedArtifactIds,
        targetPagesByArtifactId: navigationScope.mode === "page_inspection"
            ? navigationScope.pagesByArtifactId
            : new Map(),
        documentReadTimeoutMs: input.documentReadTimeoutMs,
        diagnostics,
    });
    const queryInspectionSources = pageInspectionSources.length > 0
        ? []
        : await loadDocumentQueryInspectionSources({
            db: input.db,
            rows: scopedRows,
            privateMemoryReader: input.privateMemoryReader,
            twinId: input.twinId,
            query: input.query,
            retrievalPlan,
            targetPagesByArtifactId: navigationScope.mode === "query_scan"
                ? navigationScope.pagesByArtifactId
                : undefined,
            runtimeConfig: input.runtimeConfig,
            llmFetch: input.llmFetch,
            documentReadTimeoutMs: input.documentReadTimeoutMs,
            diagnostics,
        });
    const inspectionSources = [
        ...pageInspectionSources,
        ...queryInspectionSources,
    ];
    const pageEvidenceResults = pageInspectionSources
        .filter((source: any) => source.includedFullText && source.content.trim().length > 0)
        .map((source: any, index: any) => ({
        memory: {
            id: `doc-page:${source.sourceArtifactId}:${source.pageStart ?? index}`,
            twinId: input.twinId,
            sourceArtifactId: source.sourceArtifactId,
            content: source.content,
            summary: JSON.stringify({
                sourceType: source.sourceType,
                pageStart: source.pageStart,
                pageEnd: source.pageEnd,
                indexSource: "document_pages",
            }),
            importanceScore: 0.92,
            confidenceScore: 0.98,
            occurredAt: null,
            createdAt: new Date(0),
        },
        score: 1,
        matchedTerms: ["page"],
    }));
    if (pageEvidenceResults.length > 0) {
        return withDocumentDegradation({
            results: pageEvidenceResults,
            retrievalPlan,
            inspectionSources,
            passages: pageEvidenceResults.map((result: any, index: any) => {
                const metadata = readRecord(parseJsonObject(result.memory.summary));
                return {
                    id: result.memory.id,
                    memoryFragmentId: result.memory.id,
                    sourceArtifactId: result.memory.sourceArtifactId,
                    sourceType: optionalString(metadata["sourceType"]) ?? "document",
                    chunkIndex: index,
                    pageStart: readPositivePageNumber(metadata["pageStart"]),
                    pageEnd: readPositivePageNumber(metadata["pageEnd"]),
                    content: result.memory.content,
                    score: result.score,
                    matchedTerms: result.matchedTerms,
                };
            }),
        }, diagnostics, scopedArtifactIds);
    }
    const queryScanResults = inspectionSources
        .filter((source: any) => source.scope === "llm_query_report" && source.includedFullText && source.content.trim().length > 0)
        .map((source: any, index: any) => ({
        memory: {
            id: `doc-scan:${source.sourceArtifactId}:${index}`,
            twinId: input.twinId,
            sourceArtifactId: source.sourceArtifactId,
            content: source.content,
            summary: JSON.stringify({
                sourceType: source.sourceType,
                pageStart: source.pageStart,
                pageEnd: source.pageEnd,
                indexSource: "document_query_scan",
            }),
            importanceScore: 0.9,
            confidenceScore: 0.95,
            occurredAt: null,
            createdAt: new Date(0),
        },
        score: 1,
        matchedTerms: ["query_scan"],
    }));
    if (queryScanResults.length > 0) {
        return withDocumentDegradation({
            results: queryScanResults,
            retrievalPlan,
            inspectionSources,
            passages: queryScanResults.map((result: any, index: any) => {
                const metadata = readRecord(parseJsonObject(result.memory.summary));
                return {
                    id: result.memory.id,
                    memoryFragmentId: result.memory.id,
                    sourceArtifactId: result.memory.sourceArtifactId,
                    sourceType: optionalString(metadata["sourceType"]) ?? "document",
                    chunkIndex: index,
                    pageStart: readPositivePageNumber(metadata["pageStart"]),
                    pageEnd: readPositivePageNumber(metadata["pageEnd"]),
                    content: result.memory.content,
                    score: result.score,
                    matchedTerms: result.matchedTerms,
                };
            }),
        }, diagnostics, scopedArtifactIds);
    }
    const chunkContext = await loadDocumentContextFromIndexedChunks({
        db: input.db,
        privateMemoryReader: input.privateMemoryReader,
        twinId: input.twinId,
        artifactIds: scopedArtifactIds,
        query: input.query,
        runtimeConfig: input.runtimeConfig,
        llmFetch: input.llmFetch,
        retrievalPlan,
        documentReadTimeoutMs: input.documentReadTimeoutMs,
        diagnostics,
    });
    if (chunkContext.passages.length > 0) {
        return withDocumentDegradation({
            ...chunkContext,
            inspectionSources,
        }, diagnostics, scopedArtifactIds);
    }
    return withDocumentDegradation({
        ...emptyDocumentContext(),
        retrievalPlan,
        inspectionSources,
    }, diagnostics, scopedArtifactIds);
}
function buildDocumentMetadataContext(input: {
    retrievalPlan: DocumentRetrievalPlan;
    inventory: DocumentInventoryItem[];
    focusedArtifactIds: string[];
}): DocumentContext | null {
    if (input.retrievalPlan.inspectionMode !== "metadata") {
        return null;
    }
    const focused = new Set(input.focusedArtifactIds);
    const plannedIds = new Set(input.retrievalPlan.artifactIds);
    const plannedInventory = input.inventory.filter((item) => plannedIds.has(item.artifactId));
    const focusedInventory = input.inventory.filter((item) => focused.has(item.artifactId));
    const documents = plannedInventory.length > 0
        ? plannedInventory
        : focusedInventory.length > 0
            ? focusedInventory
            : input.inventory.slice(0, 1);
    if (documents.length === 0) {
        return null;
    }
    const artifactIds = documents.map((item) => item.artifactId);
    return {
        ...emptyDocumentContext(),
        retrievalPlan: {
            ...input.retrievalPlan,
            mode: "document_qa",
            artifactIds,
            reason: [
                input.retrievalPlan.reason,
                "inventory_metadata",
            ].filter(Boolean).join("; "),
        },
        inspectionSources: documents.map((item) => ({
            sourceArtifactId: item.artifactId,
            sourceType: item.sourceType,
            title: item.title,
            fileName: item.fileName,
            pageCount: item.pageCount,
            charCount: 0,
            includedFullText: true,
            scope: "metadata" as const,
            pageStart: null,
            pageEnd: null,
            content: [
                "Document metadata:",
                item.title ? `Title: ${item.title}` : null,
                item.fileName ? `File name: ${item.fileName}` : null,
                `Source type: ${item.sourceType}`,
                `Created at: ${item.createdAt}`,
                item.pageCount ? `Page count: ${item.pageCount}` : null,
                `Indexed chunk count: ${item.chunkCount}`,
                item.subjects.length > 0 ? `Subjects: ${item.subjects.join(", ")}` : null,
                item.structure.chapterCount ? `Chapter count: ${item.structure.chapterCount}` : null,
                item.structure.headingCount ? `Heading count: ${item.structure.headingCount}` : null,
                item.structure.sectionCount ? `Section count: ${item.structure.sectionCount}` : null,
                `Source artifact id: ${item.artifactId}`,
            ].filter(Boolean).join("\n"),
        })),
    };
}
async function ensureDocumentStructureForPlan(input: {
    db: ApiDb;
    twinId: string;
    privateMemoryReader: PrivateMemoryReader;
    rows: any[];
    inventory: DocumentInventoryItem[];
    retrievalPlan: DocumentRetrievalPlan;
    runtimeConfig: ChatRuntimeConfig | null | undefined;
    llmFetch?: typeof fetch;
    documentReadTimeoutMs?: number;
    diagnostics?: DocumentRetrievalDiagnostics;
}) {
    if (!shouldExtractDocumentStructureOnDemand(input.retrievalPlan) || !input.runtimeConfig) {
        return input.inventory;
    }
    const runtimeConfig = input.runtimeConfig;
    const scopedArtifactIds = selectDocumentArtifactScope({
        retrievalPlan: input.retrievalPlan,
        inventory: input.inventory,
        focusedArtifactIds: [],
    });
    const inventoryByArtifactId = new Map(input.inventory.map((item) => [item.artifactId, item]));
    const rowsToExtract = input.rows.filter((row) =>
        scopedArtifactIds.includes(row.sourceArtifact.id) &&
        (inventoryByArtifactId.get(row.sourceArtifact.id)?.structure.itemCount ?? 0) === 0
    );
    if (rowsToExtract.length === 0) {
        return input.inventory;
    }
    const extractedCounts = await Promise.all(rowsToExtract.map(async (row) => {
        const source = await readDocumentSourceCandidateOrNull(row, input.privateMemoryReader, input.documentReadTimeoutMs, input.diagnostics);
        if (!source) {
            return 0;
        }
        const items = await extractDocumentStructureFromSource({
            db: input.db,
            row,
            source,
            runtimeConfig,
            llmFetch: input.llmFetch,
        }).catch((error: unknown) => {
            console.warn("chat document on-demand structure extraction failed", {
                sourceArtifactId: row.sourceArtifact.id,
                error: errorMessage(error),
            });
            return [];
        });
        await replaceOnDemandDocumentStructureItems(input.db, {
            twinId: row.memoryFragment.twinId,
            sourceArtifactId: row.sourceArtifact.id,
            memoryFragmentId: row.memoryFragment.id,
            items,
        });
        return items.length;
    }));
    if (extractedCounts.every((count) => count === 0)) {
        return input.inventory;
    }
    return buildDocumentRetrievalInventory({
        db: input.db,
        twinId: input.twinId,
        rows: input.rows,
        focusedArtifactIds: input.inventory
            .filter((item) => item.isThreadFocus)
            .map((item) => item.artifactId),
    });
}
function shouldExtractDocumentStructureOnDemand(retrievalPlan: DocumentRetrievalPlan) {
    if (retrievalPlan.mode !== "document_qa") {
        return false;
    }
    if (retrievalPlan.inspectionMode === "metadata") {
        return true;
    }
    return retrievalPlan.inspectionMode === "global_scan" &&
        (retrievalPlan.task === "count" || retrievalPlan.task === "extract" || retrievalPlan.task === "summarize") &&
        retrievalPlan.target.kind === "whole_document";
}
async function extractDocumentStructureFromSource(input: {
    db: ApiDb;
    row: any;
    source: Awaited<ReturnType<typeof toDocumentSourceCandidate>>;
    runtimeConfig: ChatRuntimeConfig;
    llmFetch?: typeof fetch;
}) {
    if (!input.source) {
        return [];
    }
    const source = input.source;
    const pageRows = await loadAllDocumentPageRowsByArtifactIds({
        db: input.db,
        twinId: input.row.memoryFragment.twinId,
        artifactIds: [input.row.sourceArtifact.id],
    });
    const metadata = readDocumentSourceMetadata(input.row.sourceArtifact.metadata);
    const pageBatchSize = readPositiveInteger(
        process.env["CHAT_DOCUMENT_STRUCTURE_EXTRACTION_PAGE_BATCH"],
        CHAT_DOCUMENT_STRUCTURE_EXTRACTION_PAGE_BATCH_DEFAULT,
    );
    const maxBatches = readPositiveInteger(
        process.env["CHAT_DOCUMENT_STRUCTURE_EXTRACTION_MAX_BATCHES"],
        CHAT_DOCUMENT_STRUCTURE_EXTRACTION_MAX_BATCHES_DEFAULT,
    );
    const concurrency = readPositiveInteger(
        process.env["CHAT_DOCUMENT_STRUCTURE_EXTRACTION_CONCURRENCY"],
        CHAT_DOCUMENT_STRUCTURE_EXTRACTION_CONCURRENCY_DEFAULT,
    );
    const batches = pageRows.length > 0
        ? chunkArray(pageRows, pageBatchSize)
            .slice(0, maxBatches)
            .map((pages: any[]) => ({
                pageStart: pages[0]?.documentPage.pageNumber ?? null,
                pageEnd: pages.at(-1)?.documentPage.pageNumber ?? null,
                text: pages
                    .map((pageRow) => {
                        const text = source.content
                            .slice(pageRow.documentPage.charStart, pageRow.documentPage.charEnd)
                            .trim();
                        return text ? `Page ${pageRow.documentPage.pageNumber}\n${text}` : "";
                    })
                    .filter(Boolean)
                    .join("\n\n"),
            }))
        : [{
            pageStart: null,
            pageEnd: null,
            text: source.content.slice(
                0,
                readPositiveInteger(
                    process.env["CHAT_DOCUMENT_STRUCTURE_EXTRACTION_CHAR_LIMIT"],
                    CHAT_DOCUMENT_STRUCTURE_EXTRACTION_CHAR_LIMIT_DEFAULT,
                ),
            ),
        }];
    const results = await mapSettledWithConcurrency(
        batches.filter((batch) => batch.text.trim().length > 0),
        concurrency,
        async (batch) => createDocumentStructureExtractionBatch({
            runtimeConfig: input.runtimeConfig,
            llmFetch: input.llmFetch,
            title: metadata.title,
            fileName: metadata.fileName,
            pageCount: metadata.pageCount,
            pageStart: batch.pageStart,
            pageEnd: batch.pageEnd,
            text: batch.text,
        }),
    );
    const items = results
        .filter((result: any) => result.status === "fulfilled")
        .flatMap((result: any) => result.value);
    return dedupeDocumentStructureItems(items).slice(
        0,
        readPositiveInteger(
            process.env["CHAT_DOCUMENT_STRUCTURE_EXTRACTION_MAX_ITEMS"],
            CHAT_DOCUMENT_STRUCTURE_EXTRACTION_MAX_ITEMS_DEFAULT,
        ),
    );
}
async function createDocumentStructureExtractionBatch(input: {
    runtimeConfig: ChatRuntimeConfig;
    llmFetch?: typeof fetch;
    title: string | null;
    fileName: string | null;
    pageCount: number | null;
    pageStart: number | null;
    pageEnd: number | null;
    text: string;
}) {
    const timeoutMs = readPositiveInteger(
        process.env["CHAT_DOCUMENT_STRUCTURE_EXTRACTION_TIMEOUT_MS"],
        CHAT_DOCUMENT_STRUCTURE_EXTRACTION_TIMEOUT_DEFAULT_MS,
    );
    const output = await createOpenAICompatibleChatGenerator({
        provider: input.runtimeConfig.providerKind,
        apiKey: input.runtimeConfig.apiKey,
        model: input.runtimeConfig.model,
        baseUrl: input.runtimeConfig.baseUrl,
        fetch: input.llmFetch,
        timeoutMs,
        maxRetries: 0,
    }).generateChat({
        temperature: 0,
        timeoutMs,
        messages: [
            {
                role: "system",
                content: [
                    "You extract durable document structure from one bounded page slice.",
                    "Use the supplied text only. Do not invent chapters, headings, page numbers, or sections.",
                    "Return only JSON with shape {\"items\":[{\"itemType\":\"chapter|heading|section|part|toc_entry|other\",\"label\":\"string\",\"ordinal\":1,\"pageStart\":1,\"pageEnd\":2,\"confidence\":0.0,\"notes\":\"short\"}]}",
                    "Capture explicit chapters, parts, headings, sections, and table-of-contents entries. If there is no reliable structure in this slice, return {\"items\":[]}.",
                ].join("\n"),
            },
            {
                role: "user",
                content: JSON.stringify({
                    title: input.title,
                    fileName: input.fileName,
                    pageCount: input.pageCount,
                    pageStart: input.pageStart,
                    pageEnd: input.pageEnd,
                    text: input.text,
                }),
            },
        ],
    });
    return readOnDemandDocumentStructureItems(output.content);
}
export function readOnDemandDocumentStructureItems(content: string) {
    const parsed = parseJsonObject(content);
    const record = readRecord(parsed);
    const rawItems = Array.isArray(record["items"]) ? record["items"] : [];
    return rawItems
        .map(readOnDemandDocumentStructureItem)
        .filter((item): item is OnDemandDocumentStructureItem => item !== null);
}
type OnDemandDocumentStructureItem = {
    itemType: string;
    label: string;
    normalizedLabel: string;
    ordinal: number | null;
    pageStart: number | null;
    pageEnd: number | null;
    charStart: number | null;
    charEnd: number | null;
    confidenceScore: number | null;
    extractionMethod: string;
    metadata: Record<string, unknown> | null;
};
function readOnDemandDocumentStructureItem(value: unknown): OnDemandDocumentStructureItem | null {
    const record = readRecord(value);
    const label = optionalString(record["label"]);
    const itemType = readDocumentStructureItemType(record["itemType"]);
    if (!label || !itemType) {
        return null;
    }
    return {
        itemType,
        label,
        normalizedLabel: normalizeDocumentStructureLabel(label),
        ordinal: readNullablePositiveInteger(record["ordinal"]),
        pageStart: readNullablePositiveInteger(record["pageStart"]),
        pageEnd: readNullablePositiveInteger(record["pageEnd"]),
        charStart: readNullableNonNegativeInteger(record["charStart"]),
        charEnd: readNullableNonNegativeInteger(record["charEnd"]),
        confidenceScore: readNullableConfidence(record["confidence"]),
        extractionMethod: "llm_on_demand_document_structure",
        metadata: optionalString(record["notes"])
            ? { notes: optionalString(record["notes"]) }
            : null,
    };
}
function readDocumentStructureItemType(value: unknown) {
    const itemType = optionalString(value)?.toLowerCase();
    return itemType === "chapter" ||
        itemType === "heading" ||
        itemType === "section" ||
        itemType === "part" ||
        itemType === "toc_entry" ||
        itemType === "other"
        ? itemType
        : null;
}
function normalizeDocumentStructureLabel(value: string) {
    return value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .replace(/\s+/gu, " ")
        .trim()
        .slice(0, 240);
}
function dedupeDocumentStructureItems(items: OnDemandDocumentStructureItem[]) {
    const seen = new Set<string>();
    const deduped = [];
    for (const item of items) {
        const key = [
            item.itemType,
            item.normalizedLabel,
            item.pageStart ?? "unknown",
        ].join(":");
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        deduped.push(item);
    }
    return deduped;
}
async function replaceOnDemandDocumentStructureItems(inputDb: ApiDb, input: {
    twinId: string;
    sourceArtifactId: string;
    memoryFragmentId: string;
    items: OnDemandDocumentStructureItem[];
}) {
    await inputDb
        .delete(documentStructureItems)
        .where(and(
            eq(documentStructureItems.twinId, input.twinId),
            eq(documentStructureItems.sourceArtifactId, input.sourceArtifactId),
        ));
    if (input.items.length === 0) {
        return;
    }
    await inputDb.insert(documentStructureItems).values(input.items.map((item) => ({
        twinId: input.twinId,
        sourceArtifactId: input.sourceArtifactId,
        memoryFragmentId: input.memoryFragmentId,
        itemType: item.itemType,
        label: item.label,
        normalizedLabel: item.normalizedLabel,
        ordinal: item.ordinal,
        pageStart: item.pageStart,
        pageEnd: item.pageEnd,
        charStart: item.charStart,
        charEnd: item.charEnd,
        confidenceScore: item.confidenceScore,
        extractionMethod: item.extractionMethod,
        metadata: item.metadata,
    })));
}
function readNullablePositiveInteger(value: unknown): number | null {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}
function readNullableNonNegativeInteger(value: unknown): number | null {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isInteger(number) && number >= 0 ? number : null;
}
function readNullableConfidence(value: unknown): number | null {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? Math.min(Math.max(number, 0), 1) : null;
}
async function buildDocumentRetrievalInventory(input: any) {
    const artifactIds = Array.from(new Set(input.rows.map((row: any) => row.sourceArtifact.id)));
    const chunkCounts = await loadDocumentChunkCounts(input.db, input.twinId, artifactIds);
    const subjectsByArtifactId = await loadDocumentSubjects(input.db, input.twinId, artifactIds);
    const structureByArtifactId = await loadDocumentStructureSummaries(input.db, input.twinId, artifactIds);
    const focused = new Set(input.focusedArtifactIds);
    return input.rows.map((row: any) => {
        const metadata = readDocumentSourceMetadata(row.sourceArtifact.metadata);
        return {
            artifactId: row.sourceArtifact.id,
            sourceType: row.sourceArtifact.sourceType,
            createdAt: row.sourceArtifact.createdAt.toISOString(),
            isThreadFocus: focused.has(row.sourceArtifact.id),
            title: metadata.title,
            fileName: metadata.fileName,
            pageCount: metadata.pageCount,
            chunkCount: chunkCounts.get(row.sourceArtifact.id) ?? 0,
            subjects: subjectsByArtifactId.get(row.sourceArtifact.id) ?? [],
            structure: structureByArtifactId.get(row.sourceArtifact.id) ?? emptyDocumentStructureSummary(),
        };
    });
}
async function loadDocumentChunkCounts(db: any, twinId: string, artifactIds: any) {
    const ids = artifactIds.filter(isUuid);
    if (ids.length === 0) {
        return new Map();
    }
    const rows = await db
        .select({
        sourceArtifactId: documentChunks.sourceArtifactId,
        count: sql `count(*)::int`,
    })
        .from(documentChunks)
        .where(and(
            eq(documentChunks.twinId, twinId),
            inArray(documentChunks.sourceArtifactId, ids),
            inArray(documentChunks.storageStatus, CHAT_MEMORY_READABLE_STATUSES),
        ))
        .groupBy(documentChunks.sourceArtifactId);
    return new Map(rows.map((row: any) => [row.sourceArtifactId, Number(row.count) || 0]));
}
async function loadDocumentSubjects(db: any, twinId: string, artifactIds: any) {
    const ids = artifactIds.filter(isUuid);
    if (ids.length === 0) {
        return new Map();
    }
    const rows = await db
        .select({
        sourceArtifactId: candidateMemories.sourceArtifactId,
        metadata: candidateMemories.metadata,
    })
        .from(candidateMemories)
        .where(and(
            eq(candidateMemories.twinId, twinId),
            inArray(candidateMemories.sourceArtifactId, ids),
        ))
        .limit(120);
    const subjectsByArtifactId = new Map();
    for (const row of rows) {
        const subject = optionalString(readRecord(row.metadata)["subject"]);
        if (!subject) {
            continue;
        }
        const subjects = subjectsByArtifactId.get(row.sourceArtifactId) ?? [];
        if (!subjects.includes(subject) && subjects.length < 12) {
            subjects.push(subject);
            subjectsByArtifactId.set(row.sourceArtifactId, subjects);
        }
    }
    return subjectsByArtifactId;
}
async function loadDocumentStructureSummaries(db: any, twinId: string, artifactIds: any) {
    const ids = artifactIds.filter(isUuid);
    if (ids.length === 0) {
        return new Map();
    }
    const rows = await db
        .select({
        sourceArtifactId: documentStructureItems.sourceArtifactId,
        itemType: documentStructureItems.itemType,
        label: documentStructureItems.label,
        ordinal: documentStructureItems.ordinal,
        pageStart: documentStructureItems.pageStart,
        pageEnd: documentStructureItems.pageEnd,
    })
        .from(documentStructureItems)
        .where(and(
            eq(documentStructureItems.twinId, twinId),
            inArray(documentStructureItems.sourceArtifactId, ids),
        ))
        .orderBy(documentStructureItems.sourceArtifactId, documentStructureItems.ordinal, documentStructureItems.pageStart);
    const byArtifactId = new Map();
    for (const row of rows) {
        const summary = byArtifactId.get(row.sourceArtifactId) ?? emptyDocumentStructureSummary();
        summary.itemCount += 1;
        if (row.itemType === "chapter") {
            summary.chapterCount += 1;
        }
        if (row.itemType === "heading") {
            summary.headingCount += 1;
        }
        if (row.itemType === "section") {
            summary.sectionCount += 1;
        }
        if (summary.items.length < 40) {
            summary.items.push({
                itemType: row.itemType,
                label: row.label,
                ordinal: row.ordinal,
                pageStart: row.pageStart,
                pageEnd: row.pageEnd,
            });
        }
        byArtifactId.set(row.sourceArtifactId, summary);
    }
    return byArtifactId;
}
function emptyDocumentStructureSummary() {
    return {
        itemCount: 0,
        chapterCount: 0,
        headingCount: 0,
        sectionCount: 0,
        items: [],
    };
}
async function createDocumentRetrievalPlan(input: any) {
    if (!input.runtimeConfig || input.inventory.length === 0) {
        return fallbackDocumentRetrievalPlan(input.inventory);
    }
    const timeoutMs = readPositiveInteger(process.env["CHAT_RETRIEVAL_PLAN_TIMEOUT_MS"], 30_000);
    try {
        const output = await createOpenAICompatibleChatGenerator({
            provider: input.runtimeConfig.providerKind,
            apiKey: input.runtimeConfig.apiKey,
            model: input.runtimeConfig.model,
            baseUrl: input.runtimeConfig.baseUrl,
            fetch: input.llmFetch,
            timeoutMs,
            maxRetries: 0,
        }).generateChat({
            temperature: 0,
            timeoutMs,
            messages: [
                {
                    role: "system",
                    content: [
                        "You are Sivraj's retrieval planner.",
                        "Decide which durable private documents are needed before answering the user.",
                        "Use semantic intent, conversation focus, document subjects, and recency. Do not rely on exact keyword matching.",
                        "Return only JSON with shape {\"mode\":\"document_qa|memory_qa|general_chat|ambiguous\",\"inspectionMode\":\"metadata|semantic_passages|page_range|exact_search|global_scan\",\"task\":\"answer|summarize|extract|count|compare\",\"target\":{\"kind\":\"none|pages|page_range|fraction|relative_position|whole_document\"},\"artifactIds\":[\"uuid\"],\"targetPages\":[1],\"exactQuery\":\"string|null\",\"matchMode\":\"whole_word|phrase|substring|null\",\"confidence\":0.0,\"needsClarification\":false,\"reason\":\"short\"}.",
                        "Only choose artifactIds from the provided inventory. Return an empty artifactIds array if no document is needed.",
                        "Use inspectionMode=metadata only when the answer is directly present in the provided inventory fields, such as pageCount, title, fileName, sourceType, createdAt, chunkCount, subjects, or structure counts/items.",
                        "Use inspectionMode=page_range when the answer is tied to specific pages that can be inferred from the query and document metadata. Put those 1-based page numbers in targetPages.",
                        "Use target={\"kind\":\"pages\",\"pages\":[320]} for exact page requests.",
                        "Use target={\"kind\":\"page_range\",\"pageStart\":50,\"pageEnd\":60} for exact page ranges.",
                        "Use target={\"kind\":\"fraction\",\"start\":0,\"end\":0.333} for fractional requests like the first third of a book.",
                        "Use target={\"kind\":\"relative_position\",\"position\":\"end\",\"windowFraction\":0.15} for relative spans when no exact page number is given.",
                        "Use inspectionMode=exact_search with task=count and target={\"kind\":\"whole_document\"} when the user asks how many times a specific word, name, or phrase occurs in a document. Put the literal search term in exactQuery. Use matchMode=whole_word for names/words, phrase for exact phrases, and substring only when the user asks for contains/substring behavior.",
                        "Use inspectionMode=global_scan with task=count and target={\"kind\":\"whole_document\"} when the user asks for counts not present in inventory and not reducible to exact text search, such as chapter count, character count, heading count, or table-of-contents-style structure.",
                        "Use inspectionMode=global_scan when the answer requires broad document structure, counting, summarization, or evidence that may appear across a bounded target span.",
                        "Use inspectionMode=semantic_passages for localized factual questions that can be answered from a few relevant passages.",
                        "Prefer the thread-focused document for pronouns like this PDF, the document, story, chapter, scene, or uploaded file.",
                    ].join("\n"),
                },
                {
                    role: "user",
                    content: JSON.stringify({
                        query: input.query,
                        documents: input.inventory.map((item: any) => ({
                            id: item.artifactId,
                            sourceType: item.sourceType,
                            title: item.title,
                            fileName: item.fileName,
                            pageCount: item.pageCount,
                            isThreadFocus: item.isThreadFocus,
                            createdAt: item.createdAt,
                            chunkCount: item.chunkCount,
                            subjects: item.subjects,
                            structure: item.structure,
                        })),
                    }),
                },
            ],
        });
        return readDocumentRetrievalPlan(output.content, input.inventory);
    }
    catch (error) {
        console.warn("chat document retrieval planning failed", {
            error: errorMessage(error),
        });
        return fallbackDocumentRetrievalPlan(input.inventory);
    }
}
async function loadDocumentContextFromIndexedChunks(input: any) {
    const rows = await loadDocumentChunkRowsByArtifactIds({
        db: input.db,
        twinId: input.twinId,
        artifactIds: input.artifactIds,
    });
    if (rows.length === 0) {
        return {
            ...emptyDocumentContext(),
            retrievalPlan: input.retrievalPlan,
        };
    }
    const rankedRows = await rankDocumentChunkRowsByEmbedding({
        rows,
        query: input.query,
    });
    const candidates = await loadIndexedDocumentChunkCandidates({
        rows: rankedRows.rows,
        privateMemoryReader: input.privateMemoryReader,
        documentReadTimeoutMs: input.documentReadTimeoutMs,
        diagnostics: input.diagnostics,
    });
    const rankedChunks = await rankChatMemoryResults({
        candidates,
        query: input.query,
        limit: readPositiveInteger(process.env["CHAT_DOCUMENT_PASSAGE_LIMIT"], CHAT_DOCUMENT_PASSAGE_LIMIT_DEFAULT),
        runtimeConfig: input.runtimeConfig,
        llmFetch: input.llmFetch,
    });
    return {
        results: rankedChunks,
        retrievalPlan: {
            ...input.retrievalPlan,
            reason: [
                input.retrievalPlan.reason,
                `chunkIndex=${rankedRows.source}`,
            ].filter(Boolean).join("; "),
        },
        inspectionSources: [],
        passages: rankedChunks.map((result: any) => {
            const metadata = readRecord(result.memory.summary ? parseJsonObject(result.memory.summary) : null);
            return {
                id: result.memory.id,
                memoryFragmentId: optionalString(metadata["memoryFragmentId"]) ?? result.memory.id,
                sourceArtifactId: result.memory.sourceArtifactId,
                sourceType: optionalString(metadata["sourceType"]) ?? "document",
                chunkIndex: readNonNegativeNumber(metadata["chunkIndex"]) ?? 0,
                pageStart: readPositivePageNumber(metadata["pageStart"]),
                pageEnd: readPositivePageNumber(metadata["pageEnd"]),
                content: result.memory.content,
                score: result.score,
                matchedTerms: result.matchedTerms,
            };
        }),
    };
}
async function loadThreadForDocumentFocus(input: any) {
    if (!input.threadId) {
        return null;
    }
    const [thread] = await input.db
        .select()
        .from(chatThreads)
        .where(and(eq(chatThreads.id, input.threadId), eq(chatThreads.twinId, input.twinId)))
        .limit(1);
    return thread ?? null;
}
export function emptyDocumentContext(): DocumentContext {
    return {
        results: [],
        retrievalPlan: {
            source: "skipped",
            mode: "general_chat",
            inspectionMode: "semantic_passages",
            task: "answer",
            target: { kind: "none" },
            artifactIds: [],
            targetPages: [],
            confidence: 0,
            needsClarification: false,
        },
        inspectionSources: [],
        passages: [],
        degradation: null,
    };
}
async function loadDocumentExactSearchInspectionSources(input: {
    db: ApiDb;
    rows: any[];
    privateMemoryReader: PrivateMemoryReader;
    twinId: string;
    retrievalPlan: DocumentRetrievalPlan;
    documentReadTimeoutMs?: number;
    diagnostics?: DocumentRetrievalDiagnostics;
}): Promise<DocumentInspectionSource[]> {
    const exactQuery = input.retrievalPlan.exactQuery?.trim();
    if (
        input.retrievalPlan.inspectionMode !== "exact_search" ||
        !exactQuery ||
        input.rows.length === 0
    ) {
        return [];
    }
    const sampleLimit = readPositiveInteger(
        process.env["CHAT_DOCUMENT_EXACT_SEARCH_SAMPLE_LIMIT"],
        CHAT_DOCUMENT_EXACT_SEARCH_SAMPLE_LIMIT_DEFAULT,
    );
    const pageLimit = readPositiveInteger(
        process.env["CHAT_DOCUMENT_EXACT_SEARCH_PAGE_LIMIT"],
        CHAT_DOCUMENT_EXACT_SEARCH_PAGE_LIMIT_DEFAULT,
    );
    const sources = [];
    for (const row of input.rows) {
        const source = await readDocumentSourceCandidateOrNull(row, input.privateMemoryReader, input.documentReadTimeoutMs, input.diagnostics);
        if (!source) {
            continue;
        }
        const pageRows = await loadAllDocumentPageRowsByArtifactIds({
            db: input.db,
            twinId: input.twinId,
            artifactIds: [row.sourceArtifact.id],
        });
        const limitedPageRows = pageRows.slice(0, pageLimit);
        const metadata = readDocumentSourceMetadata(row.sourceArtifact.metadata);
        const report = buildExactDocumentSearchReport({
            sourceContent: source.content,
            pages: limitedPageRows.map((pageRow: any) => ({
                pageNumber: pageRow.documentPage.pageNumber,
                content: source.content
                    .slice(pageRow.documentPage.charStart, pageRow.documentPage.charEnd)
                    .trim(),
            })),
            query: exactQuery,
            matchMode: input.retrievalPlan.matchMode ?? "whole_word",
            sampleLimit,
            title: metadata.title,
            fileName: metadata.fileName,
            pageCount: metadata.pageCount,
            pagesTruncated: pageRows.length > limitedPageRows.length,
        });
        sources.push({
            sourceArtifactId: source.sourceArtifactId,
            sourceType: source.sourceType,
            title: metadata.title,
            fileName: metadata.fileName,
            pageCount: metadata.pageCount,
            charCount: report.length,
            includedFullText: true,
            scope: "llm_query_report" as const,
            pageStart: null,
            pageEnd: null,
            content: report,
        });
    }
    return sources;
}

async function loadDocumentQueryInspectionSources(input: any) {
    if (!shouldInspectNormalizedDocument({
        retrievalPlan: input.retrievalPlan,
        hasPageTargets: Boolean(input.targetPagesByArtifactId?.size),
    }) ||
        !input.runtimeConfig ||
        input.rows.length === 0) {
        return [];
    }
    const runtimeConfig = input.runtimeConfig;
    const timeoutMs = readPositiveInteger(process.env["CHAT_DOCUMENT_GLOBAL_SCAN_TIMEOUT_MS"], CHAT_DOCUMENT_GLOBAL_SCAN_TIMEOUT_DEFAULT_MS);
    const charLimit = readPositiveInteger(process.env["CHAT_DOCUMENT_GLOBAL_SCAN_CHAR_LIMIT"], CHAT_DOCUMENT_GLOBAL_SCAN_CHAR_LIMIT_DEFAULT);
    const maxBatches = readPositiveInteger(process.env["CHAT_DOCUMENT_GLOBAL_SCAN_MAX_BATCHES"], CHAT_DOCUMENT_GLOBAL_SCAN_MAX_BATCHES_DEFAULT);
    const concurrency = readPositiveInteger(process.env["CHAT_DOCUMENT_GLOBAL_SCAN_CONCURRENCY"], CHAT_DOCUMENT_GLOBAL_SCAN_CONCURRENCY_DEFAULT);
    const pageBatchSize = readPositiveInteger(process.env["CHAT_DOCUMENT_GLOBAL_SCAN_PAGE_BATCH"], CHAT_DOCUMENT_GLOBAL_SCAN_PAGE_BATCH_DEFAULT);
    const sources = [];
    for (const row of input.rows) {
        const targetPages = input.targetPagesByArtifactId?.get(row.sourceArtifact.id);
        const pageRows = await loadAllDocumentPageRowsByArtifactIds({
            db: input.db,
            twinId: input.twinId,
            artifactIds: [row.sourceArtifact.id],
            targetPages,
        });
        const source = await readDocumentSourceCandidateOrNull(row, input.privateMemoryReader, input.documentReadTimeoutMs, input.diagnostics);
        if (!source || pageRows.length === 0) {
            continue;
        }
        const metadata = readDocumentSourceMetadata(row.sourceArtifact.metadata);
        const batches = chunkArray(pageRows, pageBatchSize)
            .slice(0, maxBatches)
            .map((pages: any) => ({
            source,
            pages,
            text: pages
                .map((pageRow: any) => {
                const text = source.content
                    .slice(pageRow.documentPage.charStart, pageRow.documentPage.charEnd)
                    .trim();
                return text ? `Page ${pageRow.documentPage.pageNumber}\n${text}` : "";
            })
                .filter(Boolean)
                .join("\n\n"),
        }))
            .filter((batch: any) => batch.text.trim().length > 0);
        const scanResults = await mapSettledWithConcurrency(batches, concurrency, async (batch: any) => createDocumentQueryScanResult({
            query: input.query,
            task: input.retrievalPlan.task,
            target: input.retrievalPlan.target,
            source,
            pages: batch.pages,
            text: batch.text,
            runtimeConfig,
            llmFetch: input.llmFetch,
            timeoutMs,
        }));
        const evidence = scanResults
            .filter((result: any) => result.status === "fulfilled")
            .map((result: any) => result.value)
            .filter((result: any) => result.relevant)
            .sort((a: any, b: any) => b.confidence - a.confidence);
        const content = formatDocumentQueryScanReport({
            query: input.query,
            task: input.retrievalPlan.task,
            target: input.retrievalPlan.target,
            title: metadata.title,
            fileName: metadata.fileName,
            pageCount: metadata.pageCount,
            evidence,
            charLimit,
        });
        if (!content) {
            continue;
        }
        sources.push({
            sourceArtifactId: source.sourceArtifactId,
            sourceType: source.sourceType,
            title: metadata.title,
            fileName: metadata.fileName,
            pageCount: metadata.pageCount,
            charCount: content.length,
            includedFullText: true,
            scope: "llm_query_report",
            pageStart: evidence[0]?.pageStart ?? null,
            pageEnd: evidence.at(-1)?.pageEnd ?? null,
            content,
        });
    }
    return sources;
}
async function createDocumentQueryScanResult(input: any) {
    const firstPage = input.pages[0]?.documentPage.pageNumber ?? null;
    const lastPage = input.pages.at(-1)?.documentPage.pageNumber ?? firstPage;
    const output = await createOpenAICompatibleChatGenerator({
        provider: input.runtimeConfig.providerKind,
        apiKey: input.runtimeConfig.apiKey,
        model: input.runtimeConfig.model,
        baseUrl: input.runtimeConfig.baseUrl,
        fetch: input.llmFetch,
        timeoutMs: input.timeoutMs,
        maxRetries: 0,
    }).generateChat({
        temperature: 0,
        timeoutMs: input.timeoutMs,
        messages: [
            {
                role: "system",
                content: [
                    "You inspect one bounded slice of a private user document for Sivraj.",
                    "Extract only evidence relevant to the user's query, task, and target range. Do not invent, summarize beyond the supplied text, or answer from outside the slice.",
                    "Return only JSON with shape {\"relevant\":true,\"evidence\":[\"short quote or precise observation\"],\"partialAnswer\":\"short answer from this slice or null\",\"confidence\":0.0}.",
                    "If the slice does not help answer the query, return {\"relevant\":false,\"evidence\":[],\"partialAnswer\":null,\"confidence\":0}.",
                ].join("\n"),
            },
            {
                role: "user",
                content: JSON.stringify({
                    query: input.query,
                    task: input.task,
                    target: input.target,
                    sourceArtifactId: input.source.sourceArtifactId,
                    pageStart: firstPage,
                    pageEnd: lastPage,
                    text: truncate(input.text, 12_000),
                }),
            },
        ],
    });
    return readDocumentQueryScanResult(output.content, firstPage, lastPage);
}
async function loadDocumentPageInspectionSources(input: any) {
    if (input.targetPagesByArtifactId.size === 0) {
        return [];
    }
    const pageRows = await loadDocumentPageRowsByArtifactPageMap({
        db: input.db,
        twinId: input.twinId,
        artifactIds: input.artifactIds,
        targetPagesByArtifactId: input.targetPagesByArtifactId,
    });
    if (pageRows.length === 0) {
        return [];
    }
    const groupedRows = groupDocumentPageRowsByMemoryFragmentId(pageRows);
    const sourceResults = await mapSettledWithConcurrency(Array.from(groupedRows.entries()), 2, async ([, rows]: any) => {
        const first = rows[0];
        if (!first) {
            return [];
        }
        const source = await readDocumentSourceCandidateOrNull({
            memoryFragment: first.memoryFragment,
            sourceArtifact: first.sourceArtifact,
        }, input.privateMemoryReader, input.documentReadTimeoutMs, input.diagnostics);
        if (!source) {
            return [];
        }
        const metadata = readDocumentSourceMetadata(first.sourceArtifact.metadata);
        return rows
            .map((row: any) => {
            const content = source.content
                .slice(row.documentPage.charStart, row.documentPage.charEnd)
                .trim();
            if (!content) {
                return null;
            }
            return {
                sourceArtifactId: source.sourceArtifactId,
                sourceType: source.sourceType,
                title: metadata.title,
                fileName: metadata.fileName,
                pageCount: metadata.pageCount,
                charCount: content.length,
                includedFullText: true,
                scope: "page_range",
                pageStart: row.documentPage.pageNumber,
                pageEnd: row.documentPage.pageNumber,
                content,
            };
        })
            .filter((source: any) => Boolean(source));
    });
    return sourceResults
        .filter((result: any) => result.status === "fulfilled")
        .flatMap((result: any) => result.value);
}
async function loadRecentDocumentRows(input: any) {
    return input.db
        .select({
        memoryFragment: memoryFragments,
        sourceArtifact: sourceArtifacts,
    })
        .from(memoryFragments)
        .innerJoin(sourceArtifacts, eq(memoryFragments.sourceArtifactId, sourceArtifacts.id))
        .where(and(
            eq(memoryFragments.twinId, input.twinId),
            eq(sourceArtifacts.twinId, input.twinId),
            eq(sourceArtifacts.ingestionStatus, "completed"),
            inArray(sourceArtifacts.sourceType, ["pdf", "ocr_pdf", "docx", "markdown", "upload", "url", "image"]),
            inArray(memoryFragments.storageStatus, CHAT_MEMORY_READABLE_STATUSES),
        ))
        .orderBy(desc(sourceArtifacts.createdAt))
        .limit(input.limit);
}
async function loadDocumentChunkRowsByArtifactIds(input: any) {
    const ids = input.artifactIds.filter(isUuid);
    if (ids.length === 0) {
        return [];
    }
    const limit = readPositiveInteger(process.env["CHAT_DOCUMENT_CHUNK_ROW_LIMIT"], CHAT_DOCUMENT_CHUNK_ROW_LIMIT_DEFAULT);
    return input.db
        .select({
        documentChunk: documentChunks,
        memoryFragment: memoryFragments,
        sourceArtifact: sourceArtifacts,
    })
        .from(documentChunks)
        .innerJoin(memoryFragments, eq(documentChunks.memoryFragmentId, memoryFragments.id))
        .innerJoin(sourceArtifacts, eq(documentChunks.sourceArtifactId, sourceArtifacts.id))
        .where(and(eq(documentChunks.twinId, input.twinId), eq(memoryFragments.twinId, input.twinId), eq(sourceArtifacts.twinId, input.twinId), inArray(documentChunks.sourceArtifactId, ids), eq(sourceArtifacts.ingestionStatus, "completed"), inArray(documentChunks.storageStatus, CHAT_MEMORY_READABLE_STATUSES)))
        .orderBy(documentChunks.sourceArtifactId, documentChunks.chunkIndex)
        .limit(limit);
}
async function loadDocumentPageRowsByArtifactIds(input: any) {
    const ids = input.artifactIds.filter(isUuid);
    const pages = input.targetPages
        .map(readPositivePageNumber)
        .filter((page: any) => page !== null);
    if (ids.length === 0 || pages.length === 0) {
        return [];
    }
    return input.db
        .select({
        documentPage: documentPages,
        memoryFragment: memoryFragments,
        sourceArtifact: sourceArtifacts,
    })
        .from(documentPages)
        .innerJoin(memoryFragments, eq(documentPages.memoryFragmentId, memoryFragments.id))
        .innerJoin(sourceArtifacts, eq(documentPages.sourceArtifactId, sourceArtifacts.id))
        .where(and(eq(documentPages.twinId, input.twinId), eq(memoryFragments.twinId, input.twinId), eq(sourceArtifacts.twinId, input.twinId), inArray(documentPages.sourceArtifactId, ids), inArray(documentPages.pageNumber, pages), eq(sourceArtifacts.ingestionStatus, "completed"), inArray(documentPages.storageStatus, CHAT_MEMORY_READABLE_STATUSES)))
        .orderBy(documentPages.sourceArtifactId, documentPages.pageNumber)
        .limit(input.limit ?? readPositiveInteger(process.env["CHAT_DOCUMENT_TARGET_PAGE_LIMIT"], CHAT_DOCUMENT_TARGET_PAGE_LIMIT_DEFAULT) * Math.max(ids.length, 1) * 3);
}
async function loadDocumentPageRowsByArtifactPageMap(input: any) {
    const allowedIds = new Set(input.artifactIds.filter(isUuid));
    const results = await Promise.all(Array.from(input.targetPagesByArtifactId.entries())
        .filter(([artifactId]: any) => allowedIds.has(artifactId))
        .map(([artifactId, pages]: any) => loadDocumentPageRowsByArtifactIds({
        db: input.db,
        twinId: input.twinId,
        artifactIds: [artifactId],
        targetPages: pages,
    })));
    return results.flat();
}
async function loadAllDocumentPageRowsByArtifactIds(input: any) {
    const ids = input.artifactIds.filter(isUuid);
    if (ids.length === 0) {
        return [];
    }
    if (input.targetPages && input.targetPages.length > 0) {
        return loadDocumentPageRowsByArtifactIds({
            db: input.db,
            twinId: input.twinId,
            artifactIds: ids,
            targetPages: input.targetPages,
            limit: Math.min(input.targetPages.length * Math.max(ids.length, 1), readPositiveInteger(process.env["CHAT_DOCUMENT_GLOBAL_SCAN_PAGE_LIMIT"], 2_000)),
        });
    }
    return input.db
        .select({
        documentPage: documentPages,
        memoryFragment: memoryFragments,
        sourceArtifact: sourceArtifacts,
    })
        .from(documentPages)
        .innerJoin(memoryFragments, eq(documentPages.memoryFragmentId, memoryFragments.id))
        .innerJoin(sourceArtifacts, eq(documentPages.sourceArtifactId, sourceArtifacts.id))
        .where(and(eq(documentPages.twinId, input.twinId), eq(memoryFragments.twinId, input.twinId), eq(sourceArtifacts.twinId, input.twinId), inArray(documentPages.sourceArtifactId, ids), eq(sourceArtifacts.ingestionStatus, "completed"), inArray(documentPages.storageStatus, CHAT_MEMORY_READABLE_STATUSES)))
        .orderBy(documentPages.sourceArtifactId, documentPages.pageNumber)
        .limit(readPositiveInteger(process.env["CHAT_DOCUMENT_GLOBAL_SCAN_PAGE_LIMIT"], 2_000));
}
async function loadDocumentRowsByArtifactIds(input: any) {
    const ids = input.artifactIds.filter(isUuid);
    if (ids.length === 0) {
        return [];
    }
    return input.db
        .select({
        memoryFragment: memoryFragments,
        sourceArtifact: sourceArtifacts,
    })
        .from(memoryFragments)
        .innerJoin(sourceArtifacts, eq(memoryFragments.sourceArtifactId, sourceArtifacts.id))
        .where(and(
            eq(memoryFragments.twinId, input.twinId),
            eq(sourceArtifacts.twinId, input.twinId),
            inArray(sourceArtifacts.id, ids),
            eq(sourceArtifacts.ingestionStatus, "completed"),
            inArray(sourceArtifacts.sourceType, ["pdf", "ocr_pdf", "docx", "markdown", "upload", "url", "image"]),
            inArray(memoryFragments.storageStatus, CHAT_MEMORY_READABLE_STATUSES),
        ))
        .orderBy(desc(sourceArtifacts.createdAt))
        .limit(ids.length);
}
function dedupeDocumentRows(rows: any) {
    const seen = new Set();
    const deduped = [];
    for (const row of rows) {
        if (seen.has(row.memoryFragment.id)) {
            continue;
        }
        seen.add(row.memoryFragment.id);
        deduped.push(row);
    }
    return deduped;
}
async function rankDocumentChunkRowsByEmbedding(input: any) {
    const limit = readPositiveInteger(process.env["CHAT_DOCUMENT_EMBEDDING_CANDIDATE_LIMIT"], CHAT_DOCUMENT_EMBEDDING_CANDIDATE_LIMIT_DEFAULT);
    const embeddableRows = input.rows.filter((row: any) => readEmbedding(row.documentChunk.embedding).length > 0);
    if (embeddableRows.length === 0) {
        throw new Error("document_query_embedding_unavailable:no_embedded_chunks");
    }
    const embedder = createConfiguredTextEmbedder(process.env);
    if (!embedder) {
        throw new Error("document_query_embedding_not_configured");
    }
    try {
        const output = await embedder.embedTexts({
            texts: [input.query],
            timeoutMs: readPositiveInteger(process.env["CHAT_DOCUMENT_QUERY_EMBEDDING_TIMEOUT_MS"], 30_000),
        });
        const queryEmbedding = output.embeddings[0] ?? [];
        if (queryEmbedding.length === 0) {
            throw new Error("document_query_embedding_failed:empty_embedding");
        }
        return {
            rows: embeddableRows
                .map((row: any) => ({
                row,
                score: cosineSimilarity(queryEmbedding, readEmbedding(row.documentChunk.embedding)),
            }))
                .sort((a: any, b: any) => b.score - a.score)
                .slice(0, limit)
                .map((ranked: any) => ranked.row),
            source: "embedding",
        };
    }
    catch (error) {
        console.warn("chat document query embedding failed", {
            error: errorMessage(error),
        });
        throw new Error(`document_query_embedding_failed:${errorMessage(error)}`);
    }
}
export function cosineSimilarity(a: any, b: any) {
    const length = Math.min(a.length, b.length);
    let dot = 0;
    let aMagnitude = 0;
    let bMagnitude = 0;
    for (let index = 0; index < length; index += 1) {
        const aValue = a[index] ?? 0;
        const bValue = b[index] ?? 0;
        dot += aValue * bValue;
        aMagnitude += aValue * aValue;
        bMagnitude += bValue * bValue;
    }
    if (aMagnitude === 0 || bMagnitude === 0) {
        return 0;
    }
    return dot / (Math.sqrt(aMagnitude) * Math.sqrt(bMagnitude));
}
function readEmbedding(value: any) {
    return Array.isArray(value)
        ? value.filter((item: any) => typeof item === "number" && Number.isFinite(item))
        : [];
}
async function loadIndexedDocumentChunkCandidates(input: any) {
    const rowsByMemoryFragmentId = groupDocumentChunkRowsByMemoryFragmentId(input.rows);
    const sourceResults = await mapSettledWithConcurrency(Array.from(rowsByMemoryFragmentId.entries()), 2, async ([, rows]: any) => {
        const first = rows[0];
        if (!first) {
            return [];
        }
        const source = await readDocumentSourceCandidateOrNull({
            memoryFragment: first.memoryFragment,
            sourceArtifact: first.sourceArtifact,
        }, input.privateMemoryReader, input.documentReadTimeoutMs, input.diagnostics);
        if (!source) {
            return [];
        }
        return rows
            .map((row: any) => toIndexedDocumentChunkCandidate(source, row))
            .filter((candidate: any) => Boolean(candidate));
    });
    return sourceResults
        .filter((result: any) => result.status === "fulfilled")
        .flatMap((result: any) => result.value);
}
function groupDocumentChunkRowsByMemoryFragmentId(rows: any) {
    const groups = new Map();
    for (const row of rows) {
        const group = groups.get(row.memoryFragment.id) ?? [];
        group.push(row);
        groups.set(row.memoryFragment.id, group);
    }
    return groups;
}
function groupDocumentPageRowsByMemoryFragmentId(rows: any) {
    const groups = new Map();
    for (const row of rows) {
        const group = groups.get(row.memoryFragment.id) ?? [];
        group.push(row);
        groups.set(row.memoryFragment.id, group);
    }
    return groups;
}
function toIndexedDocumentChunkCandidate(source: any, row: any) {
    const content = source.content.slice(row.documentChunk.charStart, row.documentChunk.charEnd).trim();
    if (!content) {
        return null;
    }
    return {
        id: `doc-chunk:${row.documentChunk.id}`,
        twinId: source.twinId,
        sourceArtifactId: source.sourceArtifactId,
        content,
        summary: JSON.stringify({
            memoryFragmentId: source.memoryFragmentId,
            sourceType: source.sourceType,
            chunkIndex: row.documentChunk.chunkIndex,
            pageStart: row.documentChunk.pageStart,
            pageEnd: row.documentChunk.pageEnd,
            documentChunkId: row.documentChunk.id,
            indexSource: "document_chunks",
        }),
        importanceScore: source.importanceScore,
        confidenceScore: source.confidenceScore,
        occurredAt: source.occurredAt,
        createdAt: source.createdAt,
    };
}
async function toDocumentSourceCandidateWithTimeout(row: any, privateMemoryReader: any, timeoutMsOverride?: number) {
    const timeoutMs = resolveDocumentReadTimeoutMs(timeoutMsOverride);
    const cacheTtlMs = readPositiveInteger(process.env["CHAT_DOCUMENT_CONTEXT_CACHE_TTL_MS"], CHAT_DOCUMENT_CONTEXT_CACHE_TTL_DEFAULT_MS);
    const cacheKey = chatDocumentSourceCacheKey(row);
    const now = Date.now();
    const cached = chatDocumentSourceCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
        if ("value" in cached) {
            return Promise.resolve(cached.value ?? null);
        }
        if (cached.promise) {
            return withTimeout(cached.promise, timeoutMs, `chat_document_read_timeout:${row.memoryFragment.id}`);
        }
    }
    const readPromise = toDocumentSourceCandidate(row, privateMemoryReader)
        .then((candidate: any) => {
        chatDocumentSourceCache.set(cacheKey, {
            value: candidate,
            expiresAt: Date.now() + cacheTtlMs,
        });
        return candidate;
    })
        .catch((error: any) => {
        chatDocumentSourceCache.delete(cacheKey);
        throw error;
    });
    chatDocumentSourceCache.set(cacheKey, {
        promise: readPromise,
        expiresAt: now + cacheTtlMs,
    });
    return withTimeout(readPromise, timeoutMs, `chat_document_read_timeout:${row.memoryFragment.id}`);
}
async function readDocumentSourceCandidateOrNull(
    row: any,
    privateMemoryReader: any,
    timeoutMsOverride?: number,
    diagnostics?: DocumentRetrievalDiagnostics,
) {
    const memoryFragmentId = optionalString(row.memoryFragment?.id);
    if (memoryFragmentId && diagnostics?.failedMemoryFragmentIds.has(memoryFragmentId)) {
        console.warn("chat document source read skipped after prior turn failure", {
            sourceArtifactId: row.sourceArtifact?.id,
            memoryFragmentId,
        });
        return null;
    }
    return toDocumentSourceCandidateWithTimeout(row, privateMemoryReader, timeoutMsOverride).catch((error: unknown) => {
        recordDocumentReadFailure(diagnostics, row, error);
        console.warn("chat document source read skipped", {
            sourceArtifactId: row.sourceArtifact?.id,
            memoryFragmentId: row.memoryFragment?.id,
            error: errorMessage(error),
        });
        return null;
    });
}
async function toDocumentSourceCandidate(row: any, privateMemoryReader: any) {
    if (!privateMemoryReader || !row.memoryFragment.contentStorageRef) {
        return null;
    }
    const content = await privateMemoryReader.readPrivateMemory({
        rawStorageRef: row.memoryFragment.contentStorageRef,
        artifactId: row.sourceArtifact.id,
        twinId: row.memoryFragment.twinId,
        expectedCiphertextSha256: row.memoryFragment.contentSha256,
    });
    const trimmedContent = content.trim();
    if (!trimmedContent) {
        return null;
    }
    return {
        id: row.memoryFragment.id,
        memoryFragmentId: row.memoryFragment.id,
        twinId: row.memoryFragment.twinId,
        sourceArtifactId: row.sourceArtifact.id,
        sourceType: row.sourceArtifact.sourceType,
        content: trimmedContent,
        summary: row.sourceArtifact.sourceType,
        importanceScore: 0.8,
        confidenceScore: row.memoryFragment.confidenceScore,
        occurredAt: row.memoryFragment.occurredAt,
        createdAt: row.memoryFragment.createdAt,
    };
}
function chatDocumentSourceCacheKey(row: any) {
    return [
        row.memoryFragment.twinId,
        row.memoryFragment.id,
        row.memoryFragment.contentSha256 ?? "no-sha",
        row.memoryFragment.contentStorageRef ?? "no-storage-ref",
    ].join(":");
}

function resolveDocumentReadTimeoutMs(timeoutMsOverride?: number) {
    const configuredTimeoutMs = timeoutMsOverride ??
        readPositiveInteger(process.env["CHAT_DOCUMENT_DECRYPT_TIMEOUT_MS"], CHAT_DOCUMENT_DECRYPT_TIMEOUT_DEFAULT_MS);
    const maxTimeoutMs = readPositiveInteger(
        process.env["CHAT_DOCUMENT_DECRYPT_TIMEOUT_MAX_MS"],
        CHAT_DOCUMENT_DECRYPT_TIMEOUT_MAX_DEFAULT_MS,
    );
    return Math.min(configuredTimeoutMs, maxTimeoutMs);
}

function createDocumentRetrievalDiagnostics(): DocumentRetrievalDiagnostics {
    return {
        failures: [],
        failedMemoryFragmentIds: new Set(),
    };
}

function recordDocumentReadFailure(
    diagnostics: DocumentRetrievalDiagnostics | undefined,
    row: any,
    error: unknown,
) {
    if (!diagnostics) {
        return;
    }
    const sourceArtifactId = optionalString(row.sourceArtifact?.id);
    const memoryFragmentId = optionalString(row.memoryFragment?.id);
    if (memoryFragmentId) {
        diagnostics.failedMemoryFragmentIds.add(memoryFragmentId);
    }
    diagnostics.failures.push({
        sourceArtifactId,
        memoryFragmentId,
        reason: classifyDocumentReadFailure(error),
        errorMessage: errorMessage(error),
    });
}

function withDocumentDegradation(
    context: Omit<DocumentContext, "degradation"> & { degradation?: DocumentRetrievalDegradation | null },
    diagnostics: DocumentRetrievalDiagnostics,
    artifactIds: string[],
): DocumentContext {
    return {
        ...context,
        degradation: buildDocumentRetrievalDegradation(diagnostics, artifactIds),
    };
}

function storageUnavailableDocumentContext(
    retrievalPlan: DocumentRetrievalPlan,
    artifactIds: string[],
): DocumentContext {
    return {
        ...emptyDocumentContext(),
        retrievalPlan,
        degradation: {
            reason: "storage_unavailable",
            message: buildDocumentRetrievalDegradationMessage("storage_unavailable"),
            artifactIds,
            failureCount: 1,
            lastError: "private_memory_reader_not_configured",
        },
    };
}

function buildDocumentRetrievalDegradation(
    diagnostics: DocumentRetrievalDiagnostics,
    artifactIds: string[],
): DocumentRetrievalDegradation | null {
    if (diagnostics.failures.length === 0) {
        return null;
    }
    const lastFailure = diagnostics.failures[diagnostics.failures.length - 1];
    const reason = prioritizeDocumentFailureReason(diagnostics.failures);
    return {
        reason,
        message: buildDocumentRetrievalDegradationMessage(reason),
        artifactIds: Array.from(new Set([
            ...artifactIds,
            ...diagnostics.failures
                .map((failure) => failure.sourceArtifactId)
                .filter((artifactId): artifactId is string => Boolean(artifactId)),
        ])),
        failureCount: diagnostics.failures.length,
        lastError: lastFailure?.errorMessage ?? "Unknown document retrieval failure",
    };
}

function prioritizeDocumentFailureReason(failures: DocumentReadFailure[]): ChatRetrievalDegradationReason {
    if (failures.some((failure) => failure.reason === "timeout")) {
        return "timeout";
    }
    if (failures.some((failure) => failure.reason === "storage_unavailable")) {
        return "storage_unavailable";
    }
    if (failures.some((failure) => failure.reason === "read_failed")) {
        return "read_failed";
    }
    return failures[0]?.reason ?? "unknown";
}

function classifyDocumentReadFailure(error: unknown): ChatRetrievalDegradationReason {
    const message = errorMessage(error).toLowerCase();
    if (
        message.includes("timeout") ||
        message.includes("timed out") ||
        message.includes("aborted")
    ) {
        return "timeout";
    }
    if (
        message.includes("gateway timeout") ||
        message.includes("service unavailable") ||
        message.includes("unavailable") ||
        message.includes("cannot connect") ||
        message.includes("connect timeout") ||
        message.includes("fetch failed")
    ) {
        return "storage_unavailable";
    }
    if (
        message.includes("read") ||
        message.includes("decrypt") ||
        message.includes("seal") ||
        message.includes("walrus")
    ) {
        return "read_failed";
    }
    return "unknown";
}

function buildDocumentRetrievalDegradationMessage(reason: ChatRetrievalDegradationReason) {
    if (reason === "timeout") {
        return "The document is saved, but private document retrieval timed out before I could read it.";
    }
    if (reason === "storage_unavailable") {
        return "The document is saved, but private document storage is temporarily unavailable.";
    }
    return "The document is saved, but I could not read its private content right now.";
}
export async function updateThreadDocumentFocusFromContext(input: any) {
    const firstPassage = input.documentContext.passages[0];
    if (!firstPassage) {
        return;
    }
    await input.db
        .update(chatThreads)
        .set({
        metadata: {
            ...readRecord(input.thread.metadata),
            documentFocus: {
                sourceArtifactId: firstPassage.sourceArtifactId,
                memoryFragmentId: firstPassage.memoryFragmentId,
                sourceType: firstPassage.sourceType,
                reason: input.reason,
                updatedAt: new Date().toISOString(),
            },
        },
        updatedAt: new Date(),
    })
        .where(and(eq(chatThreads.id, input.thread.id), eq(chatThreads.twinId, input.twinId)));
}
