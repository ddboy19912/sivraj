# Brain Document Tools

Sivraj document tools are backend-owned brain capabilities the LLM planner can choose when answering questions about uploaded documents from any surface: chat, homepage voice, or future agents. The LLM decides semantic intent; code executes typed tools against authorized stored document data.

Reusable tool executors live under `apps/api/src/lib/tools`. Surface-specific chat modules may orchestrate today, but the tools themselves must not be chat-owned.

## Planner Contract

- File: `apps/api/src/lib/chat/document-navigation.ts`
- Main function: `readDocumentRetrievalPlan`
- Scope: parses the LLM's typed JSON plan into a bounded `DocumentRetrievalPlan`.
- Non-scope: does not infer document intent from user text.

Supported `inspectionMode` values:

- `metadata` - answer from inventory fields such as page count, file name, title, and persisted structure counts.
- `page_range` - read exact page or page-range text.
- `exact_search` - count/search a planner-supplied literal word, name, or phrase across the extracted document.
- `global_scan` - ask the model to inspect bounded page batches for broad structure/summarization/extraction questions.
- `semantic_passages` - retrieve relevant indexed chunks using embeddings/ranking.

## Tool Orchestration

- File: `apps/api/src/lib/chat/document-retrieval.ts`
- Main entry: `loadDocumentContextForIntent`
- Current scope: selects focused/recent documents, builds inventory, asks the planner for a retrieval plan, reads authorized private document text, executes the selected inspection path, and returns evidence for the answer model.
- Non-scope: does not compose the final natural-language answer.

This orchestration should be treated as brain logic even though the current file sits in `lib/chat`. Chat and voice should call the same brain path so spoken homepage questions can pick the same tools as typed chat questions.

Important helpers:

- `buildDocumentMetadataContext` - turns inventory metadata/structure into authoritative document evidence.
- `loadDocumentExactSearchInspectionSources` - reads stored full text/pages and delegates exact counting to `lib/tools/document.ts`.
- `loadDocumentPageInspectionSources` - reads exact requested pages.
- `loadDocumentQueryInspectionSources` - runs bounded LLM inspection over page batches.
- `loadDocumentContextFromIndexedChunks` - retrieves semantic passages from indexed chunks.
- `ensureDocumentStructureForPlan` - backfills durable structure for older documents when the plan needs it.

## Exact Search And Count

- File: `apps/api/src/lib/tools/document.ts`
- Main function: `buildExactDocumentSearchReport`
- Scope: executes the exact-search/count tool after the planner has supplied `exactQuery` and `matchMode`.
- Non-scope: does not decide whether a user meant to search/count; that remains planner-owned.

Functions:

- `buildExactDocumentSearchReport` - counts against full extracted text and formats an evidence report with total matches, page distribution, and sample contexts.
- `countExactDocumentMatches` - pure exact-count helper used by tests and diagnostics.
- `findExactDocumentMatches` - pure helper that returns count plus bounded snippets.

Match modes:

- `whole_word` - names or standalone words, e.g. `Tom`.
- `phrase` - exact phrase with flexible whitespace, e.g. `Artful Dodger`.
- `substring` - contained text only when the planner intentionally asks for substring behavior.

## Answer Composition

- File: `apps/api/src/lib/chat/prompt-builder.ts`
- Main function: `buildPromptMessages`
- Scope: gives the response model the selected evidence and tells it how to treat inspection sources.
- Non-scope: does not fetch documents or choose tools.

## Product Rule

Never add user-message regex routing for document meaning. Add planner-visible tools and typed arguments, then execute those tools deterministically.
