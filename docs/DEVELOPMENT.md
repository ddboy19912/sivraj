# Development Setup

## Local Postgres and Redis (Docker)

Start Postgres and Redis for Drizzle migrations, the API, and upcoming worker jobs:

```bash
pnpm db:up
```

Apply database migrations (requires containers running and `DATABASE_URL` in `.env` matching `.env.example`):

```bash
pnpm db:migrate
```

Stop containers (data persists in named volumes until removed):

```bash
pnpm db:down
```

Other helpers: `pnpm db:logs`, `pnpm db:generate` (Drizzle SQL from schema), `pnpm db:studio` (Drizzle Studio).

If Compose cannot bind **`5432`**, something else is using that port (common: a local Postgres install). Stop that process or service so the container can use **`5432`**, matching `.env.example`, then run **`pnpm db:up`** again.

## OCR Tooling

Scanned PDF ingestion uses the worker after encrypted Walrus storage. The worker expects these local command-line tools:

- `pdftoppm` from Poppler to render PDF pages to images.
- `tesseract` to OCR rendered page images.

On macOS:

```bash
brew install poppler tesseract
```

If either tool is missing, `ocr_pdf` artifacts fail closed with parser failure metadata instead of creating an empty memory fragment.

## Current Status

This repository has:

- Vite + React web app in `apps/web`.
- Hono API service in `apps/api`.
- TypeScript worker in `apps/worker`.
- Drizzle + Postgres schema in `packages/db`.
- Docker Compose Postgres and Redis for local development.
- Shared packages for config, auth, queue, observability, LLM, graph, retrieval, synthesis, permissions, Walrus, Seal, Sui, and SDKs.

## Current Technical Milestones

1. Initialize Git.
2. Scaffold pnpm monorepo.
3. Scaffold Vite React app.
4. Scaffold standalone API service.
5. Scaffold worker service.
6. Add database package.
7. Set up local Postgres and Redis.
8. Implement ingestion.
9. Implement retrieval.
10. Implement synthesis.
11. Implement external agent context API.

## Stack

- TypeScript.
- Vite + React.
- Hono API service.
- Dedicated worker service.
- Postgres.
- Redis-backed queue worker for ingestion.
- LLM provider abstraction.
- Walrus storage adapter.
- MemWal retrieval adapter.
- Seal permission/encryption adapter.
- Sui identity adapter.

## Why Not Next.js

Next.js is unnecessary for Sivraj's chosen architecture because the API is a separate platform service.

Sivraj needs speed and low framework overhead:

- Fast local development.
- Simple client-side dashboard.
- Clean separation from the external API.
- No server-rendering requirement for the core product.
- No framework coupling between app UI and agent API.

Vite React is the better fit for the web app because the app should be a focused client for the Sivraj platform, not the platform itself.

## Environment Variables

Root `.env.example` is the source of truth. See [Environment Contract](./ENVIRONMENT.md).

## Repository Structure

```text
apps/
  web/
  api/
  worker/
packages/
  core/
  config/
  auth/
  db/
  queue/
  observability/
  llm/
  ingestion/
  graph/
  retrieval/
  synthesis/
  permissions/
  storage-walrus/
  crypto-seal/
  identity-sui/
  sdk-js/
  sdk-python/
contracts/
  sivraj_seal_policy/
docs/
```

## Engineering Guidelines

- Keep raw source storage separate from memory fragments.
- Keep retrieval separate from synthesis.
- Treat permissions as part of retrieval, not an afterthought.
- Add provenance to every generated memory and insight.
- Prefer small adapters for Walrus, MemWal, Seal, and LLM providers.
- Design for replacement of infrastructure components during early iteration.

## First Platform Slice

Build first end-to-end slice:

1. User creates Twin.
2. User adds manual memory.
3. System creates memory fragment.
4. System embeds memory.
5. User asks a question.
6. Retrieval returns relevant memory with citation.
7. Synthesis answers using retrieved context.

This proves core product loop before broad integrations.

Current worker boundary:

- `pnpm dev:worker` starts the Redis/BullMQ artifact processing worker.
- The API enqueues one `process-artifact` job after each encrypted artifact upload.
- Encrypted private artifacts are claimed from queue jobs and, when Seal/Walrus config is present, decrypted through the deployed Seal policy before memory fragments are created.
- Worker boot drains existing queued/pending/processing artifacts once for restart recovery; the main runtime path is queue-driven, not database polling.
- If decrypt config is missing, encrypted private artifacts are marked `pending` and audited with `artifact.processing_pending`.
- Retryable Walrus/Seal/Sui failures are kept `pending`, audited with `artifact.processing_retrying`, and thrown back to BullMQ so the queue can retry with exponential backoff. Worker logs include the failing stage, artifact ID, attempt count, and error message.
- Memory fragments store encrypted content references only; the `memory_fragments` table has no plaintext content or summary columns.

Current retrieval boundary:

- `POST /v1/twins/:twinId/memories/search` is the first memory retrieval endpoint.
- It requires `memory:read`.
- It searches processed `memory_fragments`, not raw Walrus artifacts.
- The current scorer is local and deterministic for development; MemWal/vector retrieval should replace the scoring layer without changing the API contract.
