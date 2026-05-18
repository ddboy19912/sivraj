# TODO

## Immediate

- [x] Initialize Git repository.
- [x] Choose application stack: Vite React + standalone TypeScript API + worker.
- [x] Create pnpm workspace scaffold.
- [x] Add platform packages for config, auth, queue, observability, and LLM providers.
- [x] Scaffold `apps/web` with Vite React.
- [x] Scaffold `apps/api` with Hono.
- [x] Scaffold `apps/worker`.
- [x] Define environment variable contract.
- [x] Create initial database schema.
- [x] Set up local Postgres and Redis with Docker Compose.
- [x] Build Sui wallet auth foundation.
- [x] Build first ingestion endpoint.
- [x] Define private memory storage boundary for current plaintext dev path.
- [x] Implement encrypted Walrus storage path for manual memory.
- [x] Store only ciphertext refs/raw storage refs for private memory.
- [x] Build manual memory entry UI.
- [x] Test wallet auth + manual memory UI against local API.
- [x] Create Seal policy package for Sivraj testnet.
- [x] Deploy Seal policy package for Sivraj testnet.
- [x] Configure live Sui/Walrus/Seal testnet env.
- [x] Run first live encrypted memory upload and verify Postgres/Walrus/audit records.
- [x] Add upload/storage health check.
- [x] Build text/Markdown upload flow.
- [x] Build PDF upload flow.
- [x] Create first memory processing worker.
- [x] Add scoped Seal/Walrus decrypt path for worker.
- [x] Add basic semantic retrieval.

## Product

- [x] Finalize brand language: Sivraj vs Sovereign naming relationship.
- [x] Define the first user persona in detail.
- [x] Write demo script.
- [x] Define activation event.
- [x] Define insight quality rubric.
- [x] Define pricing test plan.

## Data

- [x] Define source artifact schema.
- [x] Define memory fragment schema.
- [x] Define graph node schema.
- [x] Define graph edge schema.
- [x] Define insight schema.
- [x] Define context packet schema.
- [x] Define access policy schema.

## Ingestion

- [x] Mark current manual note ingestion as dev-only until encrypted storage lands.
- [ ] Markdown parser.
- [ ] Plain text parser.
- [x] PDF text extraction parser.
- [ ] Chat export parser.
- [ ] GitHub import adapter.
- [x] Manual memory form.
- [x] Text/Markdown file upload form.
- [x] Live encrypted manual memory smoke test with DB/audit/no-plaintext verification.
- [x] First queued artifact worker with encrypted-memory pending state.
- [x] Redis/BullMQ ingestion queue from API to worker.
- [x] Live encrypted artifact decrypt smoke test with memory fragment creation.
- [ ] Upload progress state.
- [ ] Failed ingestion retry.

## Intelligence

- [ ] Entity extraction.
- [ ] Memory extraction.
- [x] Basic memory retrieval ranking.
- [ ] Project clustering.
- [ ] Goal inference.
- [ ] Decision extraction.
- [ ] Pattern detection.
- [ ] Weekly reflection generation.
- [ ] User feedback capture.

## Agent Layer

- [ ] Define agent scope types.
- [ ] Implement context packet endpoint.
- [ ] Build coding agent demo client.
- [ ] Build research agent demo client.
- [ ] Build strategy agent demo client.
- [ ] Add permission checks before context assembly.

## Security

- [x] Define encryption boundary.
- [x] Implement Seal encryption adapter.
- [x] Implement Walrus storage adapter.
- [x] Enforce encrypted-at-rest raw memory for private artifacts.
- [x] Create Seal access-control policy package.
- [x] Deploy Seal access-control policy package on Sui testnet.
- [x] Configure testnet Seal policy IDs and key servers.
- [x] Use Seal policy approval for worker decryption.
- [ ] Add audit logs.
- [ ] Add access revocation.
- [ ] Design Seal integration.
- [x] Design Sui identity integration.
- [ ] Add data export.
- [ ] Add data deletion.

## Demo

- [ ] Create sample independent-operator dataset.
- [ ] Create sample founder dataset.
- [ ] Create sample GitHub project import.
- [ ] Create sample investor notes.
- [ ] Create sample strategy docs.
- [ ] Create demo identity graph.
- [ ] Create wow-moment query flow.
- [ ] Create multi-agent context demo.
