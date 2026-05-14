# Development Setup

## Current Status

This repository currently contains product and planning documentation. The application stack still needs to be selected and scaffolded.

## Recommended First Technical Milestones

1. Initialize Git.
2. Select stack.
3. Scaffold app.
4. Add database.
5. Implement ingestion.
6. Implement retrieval.
7. Implement synthesis.
8. Implement agent context API.

## Suggested Stack

Recommended default:

- TypeScript.
- Next.js or Vite.
- Node.js API.
- Postgres.
- Queue worker for ingestion.
- LLM provider abstraction.
- Walrus storage adapter.
- MemWal retrieval adapter.
- Seal permission/encryption adapter.

## Environment Variables

Likely variables:

```bash
DATABASE_URL=
LLM_PROVIDER=
LLM_API_KEY=
EMBEDDING_MODEL=
WALRUS_ENDPOINT=
WALRUS_API_KEY=
MEMWAL_ENDPOINT=
MEMWAL_API_KEY=
SEAL_PROJECT_ID=
SEAL_API_KEY=
SUI_NETWORK=
SUI_PRIVATE_KEY=
APP_URL=
```

## Repository Structure Proposal

```text
apps/
  web/
  api/
packages/
  core/
  ingestion/
  graph/
  retrieval/
  synthesis/
  permissions/
docs/
```

## Engineering Guidelines

- Keep raw source storage separate from memory fragments.
- Keep retrieval separate from synthesis.
- Treat permissions as part of retrieval, not an afterthought.
- Add provenance to every generated memory and insight.
- Prefer small adapters for Walrus, MemWal, Seal, and LLM providers.
- Design for replacement of infrastructure components during early iteration.

## First Implementation Slice

Build a narrow vertical slice:

1. User creates Twin.
2. User adds manual memory.
3. System creates memory fragment.
4. System embeds memory.
5. User asks a question.
6. Retrieval returns relevant memory with citation.
7. Synthesis answers using retrieved context.

This proves the core product loop before broad integrations.

