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
- [x] Define private memory index boundary for derived fragments, embeddings, previews, and retrieval.
- [x] Encrypt derived private memory fragments before storing retrievable content.

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
- [x] Markdown parser.
- [x] Plain text parser.
- [x] PDF text extraction parser.
- [x] OCR scanned PDF parser.
- [x] DOCX parser.
- [x] CSV parser.
- [x] Email import parser.
- [x] Chat export parser.
- [x] Slack export parser.
- [x] WhatsApp export parser.
- [x] GitHub import adapter.
- [x] Screenshot/image upload parser.
- [x] Browser history import adapter.
- [x] Audio/voice note upload flow.
- [x] Speech-to-text transcription pipeline.
- [x] Voice conversation capture flow.
- [x] Manual memory form.
- [x] Text/Markdown file upload form.
- [x] Live encrypted manual memory smoke test with DB/audit/no-plaintext verification.
- [x] First queued artifact worker with encrypted-memory pending state.
- [x] Redis/BullMQ ingestion queue from API to worker.
- [x] Live encrypted artifact decrypt smoke test with memory fragment creation.
- [x] Upload progress state.
- [x] Failed ingestion retry.

## Intelligence

- [ ] Entity extraction.
- [ ] Memory extraction.
- [ ] Speaker attribution for chat/conversation imports.
- [ ] User-vs-other-party message classification.
- [ ] Conversation understanding from voice transcripts.
- [ ] Convert voice conversations into candidate memories.
- [x] Basic memory retrieval ranking.
- [ ] Project clustering.
- [ ] Goal inference.
- [ ] Decision extraction.
- [ ] Pattern detection.
- [ ] Weekly reflection generation.
- [ ] User feedback capture.

## Conversation

- [x] Define Sivraj voice conversation UX.
- [x] Add push-to-talk or recording control.
- [x] Stream or upload recorded audio securely.
- [x] Transcribe audio to text.
- [ ] Generate conversation summary.
- [ ] Extract candidate memories, goals, decisions, and preferences from conversation.
- [ ] Ask user to approve or edit extracted memories before updating the Twin.
- [ ] Store approved conversation memories through encrypted Walrus path.
- [ ] Add audit events for voice-derived memory updates.

## Connectors

- [ ] Define connector permission and sync model.
- [ ] Add connector account/link table to data model.
- [ ] Add connector sync job queue.
- [ ] Add connector sync audit events.
- [ ] Add connector settings UI.
- [ ] Add connected-source health/status UI.
- [ ] Add Notion connector.
- [ ] Add GitHub connector with recurring repository sync.
- [ ] Add Microsoft Docs/OneDrive connector.
- [ ] Add Google Drive/Docs connector.
- [ ] Add Slack connector.
- [ ] Add email connector.
- [ ] Add calendar connector.
- [ ] Add browser history connector/import.
- [ ] Add ChatGPT/Codex history import or connector where APIs allow.
- [ ] Add Claude history import or connector where APIs allow.
- [ ] Reprocess changed connector documents into updated memories.
- [ ] Show user what each sync added, updated, or skipped.

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
- [x] Move first-party private artifact encryption from API-side to browser/client-side before public beta.
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
