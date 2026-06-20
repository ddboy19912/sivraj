# API Modularization And Typing Plan

This plan breaks down the large API files and removes recovery-era `any` annotations without repeating the previous risky rewrite. Work should happen in small, verified batches. Do not use destructive git commands on dirty files.

## Current Snapshot

Primary file-size hotspots:

- `apps/api/src/routes/chat-message-handler.ts` — 4,121 lines, most production `any` usage.
- `apps/api/src/routes/voice.ts` — 1,115 lines.
- `apps/api/src/routes/chat-provider-config.ts` — 1,021 lines.
- `apps/api/src/lib/chat/memory-intake.ts` — 879 lines.
- `apps/api/src/routes/agent-writeback-handlers.ts` — 717 lines.
- `apps/api/src/routes/identity-profile.ts` — 586 lines.
- `apps/api/src/routes/artifact-handlers.ts` — 561 lines.
- `apps/api/src/lib/engineering/helpers.ts` — 525 lines.

Typing hotspot:

- `apps/api/src/routes/chat-message-handler.ts` contains the bulk of production `any` annotations because it was recovered from compiled output. Treat this as recovery debt, not acceptable final shape.

## Target Organization

Route files should only do HTTP work:

- authorize request
- parse input
- call domain/service functions
- map domain result to HTTP response

Domain files should own behavior:

- `src/types/*.types.ts` — shared domain types only.
- `src/lib/<domain>/*` — pure helpers, resolvers, parsers, formatters, policies.
- `src/services/*` — side-effectful external service clients or orchestration.
- `src/routes/*` — thin Hono route handlers and route wiring only.

For chat specifically:

- `src/types/chat.types.ts` or `src/lib/chat/turn-types.ts` — route-independent chat/domain types.
- `src/lib/chat/input.ts` — request body parsing and validation.
- `src/lib/chat/attachments.ts` — attachment metadata and artifact status hydration.
- `src/lib/chat/turn-persistence.ts` — user/assistant message insert, turn status updates, audit row persistence.
- `src/lib/chat/streaming-turn.ts` — SSE event writing and streaming completion/failure handling.
- `src/lib/chat/memory-retrieval.ts` — readable memory loading, ranking, token accounting.
- `src/lib/chat/document-retrieval.ts` — document inventory, retrieval plans, page/chunk inspection, embedding ranking.
- `src/lib/chat/conversation-context.ts` — conversation resolver prompt, fallback resolver, recent-message selection.
- `src/lib/chat/prompt-builder.ts` — final chat prompt assembly and formatting.
- `src/lib/chat/cache.ts` — runtime provider/core comms/cache-key helpers.
- `src/routes/chat-message-handler.ts` — route handlers only, ideally under 400-600 lines after migration.

## Batch Order

### Batch 1 — Stabilize Shared Chat Types

Create or complete typed contracts before moving more code:

- `ChatRouteContext` / handler dependency types.
- `ChatSurface`, `ChatMemoryIntent`, `ChatMessageRow`, `ChatThreadRow`.
- `ChatRuntimeConfig`, `ChatMemoryContext`, `DocumentContext`, `ConversationContextResolution`.
- `ChatTurnSeed`, `ChatTurnResult`, `ChatTurnTimings`.
- `ChatAttachmentMetadata`, `PostMessageInput`, `PostAttachmentInput`.

Rules:

- Prefer `unknown` at external boundaries, then narrow with parser functions.
- Use typed unions for lifecycle/status fields.
- Avoid replacing `any` with huge inferred DB types unless it improves readability.

Verification:

```sh
pnpm --filter @sivraj/api typecheck
pnpm --filter @sivraj/api test -- src/routes/chat-message-handler.test.ts
```

### Batch 2 — Move Request Input And Attachment Helpers

Extract from `chat-message-handler.ts`:

- `readPostMessageInput`
- `readPostAttachmentInput`
- `readFiniteNonNegativeNumber`
- `buildChatAttachmentMetadata`
- `readChatMessageAttachments`
- `readChatMessageAttachmentIds`
- `hydrateChatMessageAttachmentMetadata`
- `loadChatAttachmentArtifactStatuses`

Target files:

- `apps/api/src/lib/chat/input.ts`
- `apps/api/src/lib/chat/attachments.ts`

Expected impact:

- Removes a self-contained chunk near the top of the handler.
- Replaces several low-risk `any`s with explicit parsed metadata types.

Verification:

```sh
pnpm --filter @sivraj/api typecheck
pnpm --filter @sivraj/api test -- src/routes/chat-message-handler.test.ts
```

### Batch 3 — Move Turn Persistence

Extract persistence/status functions:

- `insertUserMessage`
- `createQueuedTurn`
- `insertAssistantMessage`
- `persistChatTurn`
- `markTurnRetrievingContext`
- `markTurnGenerating`
- `updateAssistantPartial`
- `completeStreamingTurn`
- `markTurnCancelled`
- `markTurnFailed`
- `toTurnResponse`
- `buildPostMessageResponse`
- audit helpers tightly tied to turn persistence

Target files:

- `apps/api/src/lib/chat/turn-persistence.ts`
- `apps/api/src/lib/chat/turn-events.ts`

Rules:

- Keep DB writes typed by explicit input objects.
- Keep surface metadata (`web_chat` / `voice_chat`) explicit on every message/turn write.
- Preserve existing route-level re-exports until tests are moved.

Verification:

```sh
pnpm --filter @sivraj/api typecheck
pnpm --filter @sivraj/api test -- src/routes/chat-message-handler.test.ts
pnpm --filter @sivraj/web test -- chat-api-stream.test.ts
```

### Batch 4 — Move Conversation Context And Prompt Builder

Extract:

- `resolveConversationContext`
- `readConversationContextResolution`
- conversation enum readers
- `fallbackConversationContextResolution`
- `selectMeaningfulConversationMessages`
- `buildPromptMessages`
- `formatCurrentUserPrompt`
- `formatCoreCommsContext`
- `formatHandles`
- document-inspection formatting used only by prompts

Target files:

- `apps/api/src/lib/chat/conversation-context.ts`
- `apps/api/src/lib/chat/prompt-builder.ts`

Rules:

- Keep prompt formatting pure.
- Use `ChatMessage[]` return types.
- Avoid hidden dependency on `process.env`; pass limits/timeouts where practical or centralize env reads.

Verification:

```sh
pnpm --filter @sivraj/api typecheck
pnpm --filter @sivraj/api test -- src/routes/chat-message-handler.test.ts
```

### Batch 5 — Move Document Retrieval

Extract the full document path:

- document inventory builders
- retrieval-plan creation/parsing
- page-scope resolution
- page/chunk row loaders
- indexed chunk ranking
- query scan result parsing/formatting
- document focus metadata helpers

Target files:

- `apps/api/src/lib/chat/document-retrieval.ts`
- `apps/api/src/lib/chat/document-navigation.ts`
- `apps/api/src/lib/chat/document-formatters.ts`

Rules:

- Keep row-loader functions close to retrieval logic unless reused elsewhere.
- Keep `DocumentRetrievalPlan` and navigation target types in one shared type module.
- Prefer typed row aliases over `any` for `{ sourceArtifact, memoryFragment, documentChunk }` shapes.

Verification:

```sh
pnpm --filter @sivraj/api typecheck
pnpm --filter @sivraj/api test -- src/routes/chat-message-handler.test.ts
```

### Batch 6 — Move Memory Retrieval

Extract:

- `loadMemoryContext`
- current-truth candidate loading/formatting
- candidate-memory search loading/formatting
- memory ranking and semantic selection
- timeout/cache helpers related to memory reads
- token accounting helpers
- memory read failure classification

Target files:

- `apps/api/src/lib/chat/memory-retrieval.ts`
- `apps/api/src/lib/chat/current-truth.ts`
- `apps/api/src/lib/chat/candidate-memory-search.ts`
- `apps/api/src/lib/chat/token-accounting.ts`

Rules:

- Reuse existing `src/lib/memory-search/*` primitives.
- Do not duplicate decrypt/retrieval helpers already in `memory-search`.
- Type private-memory reader inputs explicitly.

Verification:

```sh
pnpm --filter @sivraj/api typecheck
pnpm --filter @sivraj/api test -- src/routes/chat-message-handler.test.ts
```

### Batch 7 — Shrink Chat Route To Route Handlers

After the domain modules are in place:

- Keep only `handleListThreads`, `handleCreateThread`, `handleDeleteThread`, `handleGetThreadMessages`, `handlePostThreadAttachment`, `handlePostThreadMessage`, `handlePostThreadTurn`.
- Move route-independent exports to their domain modules.
- Update tests to import pure helper contracts from domain modules instead of `routes/chat-message-handler`.
- Keep `chat-message-handler.ts` below 600 lines.

Verification:

```sh
pnpm --filter @sivraj/api typecheck
pnpm --filter @sivraj/api test -- src/routes/chat-message-handler.test.ts
pnpm --filter @sivraj/web test -- chat-api-stream.test.ts
pnpm --filter @sivraj/web build
PATH=/Users/apple/.nvm/versions/node/v24.5.0/bin:$PATH npx react-doctor@latest --verbose --scope changed
```

## Other API File Plans

### `routes/voice.ts`

Split into:

- `src/lib/voice/input.ts` — request parsing.
- `src/lib/voice/settings.ts` — settings/default resolution.
- `src/lib/voice/session.ts` — LiveKit/session/token behavior.
- `src/lib/voice/agent-config.ts` — provider/voice-agent configuration.
- `src/routes/voice.ts` — route handlers only.

Run:

```sh
pnpm --filter @sivraj/api test -- src/routes/voice.test.ts
pnpm --filter @sivraj/api typecheck
```

### `routes/chat-provider-config.ts`

Split into:

- `src/lib/chat-provider-config/input.ts`
- `src/lib/chat-provider-config/oauth.ts`
- `src/lib/chat-provider-config/encryption.ts`
- `src/lib/chat-provider-config/runtime-config.ts`
- `src/routes/chat-provider-config.ts`

Run:

```sh
pnpm --filter @sivraj/api test -- src/routes/chat-provider-config.test.ts
pnpm --filter @sivraj/api typecheck
```

### `lib/chat/memory-intake.ts`

Split after the handler stops depending on it as a monolith:

- `memory-intake/types.ts`
- `memory-intake/profile-facts.ts`
- `memory-intake/engineering-facts.ts`
- `memory-intake/prompt.ts`
- `memory-intake/persistence.ts`
- `memory-intake/index.ts`

Run:

```sh
pnpm --filter @sivraj/api test -- src/routes/chat-message-handler.test.ts
pnpm --filter @sivraj/api typecheck
```

### `routes/agent-writeback-handlers.ts`

Split into:

- `src/lib/agent-writebacks/input.ts` already exists; keep expanding it.
- `src/lib/agent-writebacks/persistence.ts`
- `src/lib/agent-writebacks/audit.ts`
- `src/routes/agent-writeback-handlers.ts`

### `routes/identity-profile.ts` And `routes/artifact-handlers.ts`

Apply the same pattern:

- route input parsers
- domain service functions
- pure metadata/format helpers
- thin route handlers

## Typing Rules

- New files should not introduce `any`.
- When touching recovered `any`, replace with:
  - `unknown` for untrusted input,
  - typed input objects for internal functions,
  - `Record<string, unknown>` for JSON metadata,
  - existing DB row inferred types only when readable.
- Use parser functions at boundaries instead of casting.
- Export types from domain modules only when another module actually consumes them.
- Keep compatibility re-exports from `chat-message-handler.ts` only during migration; remove them once tests import domain modules directly.

## Definition Of Done

The cleanup is complete when:

- `chat-message-handler.ts` is below 600 lines.
- No production `any` remains in `apps/api/src/routes/chat-message-handler.ts`.
- No API source file over 600 lines remains without a documented reason.
- Route files mostly contain handlers and route wiring.
- Helper tests import from domain modules, not route handlers.
- Focused API tests, web stream tests, web build, and React Doctor pass.
