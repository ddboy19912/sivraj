# Application Stack

## Stack Decision

Sivraj will use a lightweight, speed-oriented TypeScript stack:

- **Web app:** Vite + React.
- **API:** Standalone TypeScript service.
- **API runtime:** Hono or Fastify.
- **Worker:** Standalone TypeScript worker service.
- **Database:** Postgres.
- **Retrieval:** MemWal, with pgvector as a possible local development bridge.
- **Storage:** Walrus.
- **Encryption and access:** Seal.
- **Identity and ownership:** Sui.
- **LLM access:** provider adapter package.
- **Auth:** dedicated platform auth package.
- **Jobs:** queue abstraction package.
- **Observability:** shared logs, traces, metrics, and audit helpers.
- **Package manager:** pnpm workspaces.

## Product Boundary

The web app is not the platform.

The web app is one client of the Sivraj platform, alongside:

- External AI agents.
- Third-party apps.
- SDK users.
- Enterprise clients.
- Future native clients.

## Why Vite React

Vite React is the right UI layer because Sivraj wants speed:

- Fast startup.
- Fast hot reload.
- Minimal framework overhead.
- Clean static app deployment.
- No unnecessary server rendering.
- No coupling between UI routes and platform APIs.

## Why a Standalone API

The API is a core product surface and must serve external clients directly.

It needs:

- Stable `/v1` versioning.
- External client auth.
- Delegated user consent.
- Agent tokens.
- Scoped context packets.
- Rate limits.
- Webhooks.
- Streaming responses.
- Audit logs.
- SDK compatibility.

This should not be hidden inside a frontend framework.

## Hono vs Fastify

### Hono

Choose Hono if the priority is:

- Minimalism.
- Speed.
- Simple route definitions.
- Edge/server flexibility.
- Small mental model.

### Fastify

Choose Fastify if the priority is:

- Mature Node plugin ecosystem.
- Long-running backend service.
- Rich validation and lifecycle hooks.
- Operational familiarity.

## Recommendation

Start with **Hono** unless we discover a concrete plugin or operational need that makes Fastify more valuable.

Hono fits the current product direction: fast, lean, typed, and easy to expose as a clean external API.

## Proposed Monorepo

```text
apps/
  web/      # Vite React dashboard and user app
  api/      # External API platform
  worker/   # Ingestion, graph, retrieval, and synthesis jobs

packages/
  core/             # Shared domain types and business logic
  config/           # Typed environment and runtime config
  auth/             # External client auth, tokens, and sessions
  db/               # Postgres schema and migrations
  queue/            # Job queue abstraction
  observability/    # Logs, traces, metrics, and audit helpers
  llm/              # LLM and embedding provider abstraction
  ingestion/        # Source adapters and processing logic
  graph/            # Cognitive graph logic
  retrieval/        # Retrieval and context selection
  synthesis/        # Pattern detection and reflections
  permissions/      # Policy evaluation
  storage-walrus/   # Walrus adapter
  crypto-seal/      # Seal adapter
  identity-sui/     # Sui identity adapter
  sdk-js/           # TypeScript SDK
  sdk-python/       # Python SDK
```
