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

- [x] Entity extraction.
- [x] Graph canonicalization and normalized graph node identity.
- [x] Memory extraction.
- [x] Canonical memory consolidation for duplicate extracted memories.
- [x] LLM semantic merge judgment for same-meaning duplicate memories.
- [x] Run intelligence extraction as background Twin learning job after encrypted fragment storage.
- [x] Batch encrypted candidate-memory statement storage per artifact.
- [x] Add Twin identity onboarding profile.
- [x] Store user names, aliases, handles, emails, and optional phones for attribution.
- [x] Allow open-ended "tell Sivraj about yourself" onboarding context.
- [x] Convert onboarding self-description into encrypted candidate memories.
- [x] Add source-specific speaker mapping for imports.
- [x] Speaker attribution for chat/conversation imports.
- [x] User-vs-other-party message classification.
- [x] Conversation understanding from voice transcripts.
- [x] Convert voice conversations into candidate memories.
- [x] Basic memory retrieval ranking.
- [x] Retrieval duplicate result suppression.
- [x] Project clustering.
- [x] Goal inference.
- [x] Decision extraction.
- [x] Pattern detection.
- [x] Create pattern detection engine module.
- [x] Define pattern signal types.
- [x] Define pattern detector interface.
- [x] Add repeated subject detector.
- [x] Add worker graph writer for detected patterns.
- [x] Add historical signal repository query.
- [x] Weekly reflection generation.
- [x] User feedback capture.

## Testing Console UI

Temporary POC UI for verifying the backend and intelligence layer before final product redesign.

- [x] Create test console navigation/pages.
- [x] Add ingestion test page for manual note, file uploads, voice note, and voice conversation.
- [x] Add artifact status page with live processing, intelligence status, timings, and retry controls.
- [x] Add retrieval test page for `POST /v1/twins/:twinId/memories/search`.
- [x] Add candidate memory review page with approve/reject feedback actions.
- [x] Add coding agent context export page with raw JSON and copyable markdown packet.
- [x] Add engineering instruction sources page showing uploaded instruction files and extracted memories.
- [x] Add graph inspection page for projects, goals, decisions, concepts, patterns, and edges.
- [x] Add weekly reflection test page with generate/list status controls.
- [x] Add privacy verification page showing storage refs, hashes, and no-plaintext checklist.
- [x] Add API testing guide with curl examples for ingestion, retrieval, feedback, and weekly reflections.
- [x] Add UI tests for the testing console critical flows.

## Engineering Intelligence

- [x] Define engineering memory taxonomy.
- [x] Add agent instruction file detector for `CLAUDE.md`, `AGENTS.md`, `SKILL.md`, Cursor rules, and similar repo guidance.
- [x] Classify engineering instructions by scope: global user, project, organization, agent-specific, temporary.
- [x] Extract reusable engineering preferences from instruction files without blindly applying repo-local rules globally.
- [x] Detect stale or conflicting engineering instructions.
- [x] Extract coding preferences from repos, chats, PRs, docs, and voice conversations.
- [x] Extract architecture decisions.
- [x] Extract recurring bugs and failure patterns.
- [x] Extract project conventions and style rules.
- [x] Extract deployment and environment knowledge.
- [x] Extract security and privacy boundaries.
- [x] Build repo/project engineering profile.
- [x] Generate agent-ready coding context packets.
- [x] Add coding-agent context endpoint.
- [x] Add engineering instruction sources endpoint.
- [x] Add copyable Codex/Claude Code/Cursor context packet format.
- [x] Add Codex/Claude Code/Cursor integration plan.
- [x] Add engineering memory verification tests with source-backed evidence.

## Conversation

- [x] Define Sivraj voice conversation UX.
- [x] Add push-to-talk or recording control.
- [x] Stream or upload recorded audio securely.
- [x] Transcribe audio to text.
- [x] Generate conversation summary.
- [x] Extract candidate memories, goals, decisions, and preferences from conversation.
- [x] Ask user to approve or edit extracted memories before updating the Twin.
- [x] Store approved conversation memories through encrypted Walrus path.
- [x] Add audit events for voice-derived memory updates.

## Connectors

- [x] Define connector permission and sync model.
- [x] Add connector account/link table to data model.
- [x] Add connector sync job queue.
- [x] Add connector sync audit events.
- [x] Add connector settings UI.
- [x] Add connected-source health/status UI.
- [x] Add provider adapter interface for connector fetch/diff/artifact creation.
- [x] Add recurring connector scheduling/reconciliation loop.
- [x] Add Notion connector.
- [x] Add GitHub connector with recurring repository sync.
- [x] Add Microsoft Docs/OneDrive connector.
- [x] Add Google Drive/Docs connector.
- [x] Add Slack connector.
- [x] Add email connector.
- [x] Add calendar connector.
- [x] Add browser history connector/import.
- [x] Add ChatGPT export import for `conversations.json`/data-export JSON.
- [x] Add Claude export import for conversation JSON.
- [x] Normalize AI chat imports into `chat_export` artifacts.
- [x] Detect AI chat conversation title, timestamps, roles, and source IDs.
- [x] Detect and store AI chat provider metadata at import time.
- [x] Preserve AI chat conversation and message IDs in parser metadata for dedup/review.
- [x] Add duplicate detection for re-imported AI chat conversations.
- [x] Add AI chat import review UI showing imported and skipped conversations.
- [x] Use agent writebacks as the primary Codex history path instead of a brittle Codex history connector.
- [x] Reprocess changed connector documents into updated memories.
- [x] Show user what each sync added, updated, or skipped.

## Agent Layer

- [x] Define agent scope types.
- [x] Implement context packet endpoint.
- [x] Build coding agent demo client.
- [x] Implement Sivraj MCP server for coding agents.
- [x] Expose MCP tool: `sivraj.getEngineeringContext`.
- [x] Expose MCP tool: `sivraj.listEngineeringSources`.
- [x] Expose MCP tool: `sivraj.searchMemory`.
- [x] Expose MCP tool: `sivraj.getProjectProfile`.
- [x] Expose MCP tool: `sivraj.recordAgentWriteback`.
- [x] Add delegated agent/client token flow for MCP.
- [x] Add client-side MCP writeback encryption before remote agent deployments.
- [x] Add agent writeback API for decisions, bugs, commands, tests, and summaries.
- [x] Add coding-session writeback review UI.
- [x] Build repo fingerprinting and project matching for local agent sessions.
- [x] Generate repo-specific context packets from current working directory metadata.
- [x] Add approved-only handoff mode for production coding agents.
- [x] Add candidate/review handoff mode for testing.
- [x] Add context quality scoring before handoff.
- [x] Detect context conflicts before exporting to agents.
- [x] Add stale instruction review queue.
- [x] Add suggested `AGENTS.md` / `CLAUDE.md` / Cursor rules patch generation.
- [x] Add one-click copy/export presets for Codex, Claude Code, Cursor, and generic MCP clients.
- [x] Add local CLI command: `sivraj context`.
- [x] Add local CLI command: `sivraj writeback`.
- [x] Add repo health memory for flaky tests, build quirks, dependency risks, and deployment gotchas.
- [x] Add review copilot memory from recurring user code-review feedback.
- [x] Add agent eval harness to compare coding-agent performance with and without Sivraj context.
- [x] Add MCP resources for project context, instruction sources, and recent writebacks.
- [x] Add PR/commit writeback imports.
- [x] Add audit events for all agent context reads and writebacks.
- [x] Add permission UI for each connected coding agent.
- [x] Build research agent demo client.
- [x] Build strategy agent demo client.
- [x] Add permission checks before context assembly.

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
