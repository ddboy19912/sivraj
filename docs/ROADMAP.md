# Roadmap

## Phase 0: Product Foundation

Goal: Align thesis, scope, and technical direction.

- Finalize PRD.
- Define first target user and demo path.
- Lock Sivraj/Twin brand language.
- Choose initial stack.
- Create architecture plan.
- Define data model.
- Define permission model.

Exit criteria:

- Team can start implementation without re-litigating product identity.

## Phase 1: Memory Ingestion Foundation

Goal: Users can import meaningful context.

- Implement account and Twin creation.
- Implement Sui wallet auth.
- Define private-memory storage boundary. (done)
- Integrate Seal encryption for raw private memory.
- Integrate Walrus storage for encrypted raw memory blobs.
- Build manual memory entry.
- Test wallet authentication and manual memory UI against the local API.
- Deploy Sivraj Seal access-control policy on Sui testnet.
- Configure live Sui, Walrus, and Seal testnet environment.
- Run first live encrypted manual memory upload.
- Add markdown/text upload.
- Add PDF text extraction ingestion. (done)
- Add DOCX and CSV ingestion.
- Add OCR scanned PDF ingestion.
- Add screenshots/image ingestion.
- Add audio/voice note ingestion.
- Add chat export ingestion.
- Add email export ingestion.
- Add Slack and WhatsApp export ingestion.
- Add GitHub source import.
- Add browser history import.
- Store raw source metadata and encrypted raw storage refs.
- Build Redis/BullMQ processing queue. (done)

Exit criteria:

- User can import at least 50 artifacts into a Twin without relying on plaintext raw memory storage.

## Phase 1.5: Source Connectors and Recurring Sync

Goal: Keep the Twin current by connecting to the user's active tools.

- Define connector permission and sync model.
- Add connector account/link records.
- Add recurring sync jobs.
- Add connector sync audit events.
- Add connector status and settings UI.
- Add Notion connector.
- Add GitHub recurring repository sync.
- Add Microsoft Docs/OneDrive connector.
- Add Google Drive/Docs connector.
- Add Slack, email, and calendar connectors.
- Add browser history connector/import.
- Add Claude and ChatGPT/Codex history imports or connectors where APIs allow.
- Reprocess changed documents, conversations, commits, and notes into updated memories.

Exit criteria:

- A user can connect at least one external source, perform an initial backfill, receive recurring updates, and see what the sync added or changed.

## Phase 2: Cognitive Graph V1

Goal: Convert raw data into structured identity context.

- Extract entities.
- Create project nodes.
- Create goal nodes.
- Create people nodes.
- Create decision nodes.
- Link memories to graph nodes.
- Add confidence and source citations.
- Build graph inspection UI.

Exit criteria:

- User can see a useful graph of projects, people, goals, and decisions.

## Phase 2.1: Sovereign Memory Experience

Goal: Make Sivraj's memory feel visible, inspectable, correctable, and meaningfully sovereign.

- Build Memory Brain View: a graph and timeline of people, skills, documents, projects, preferences, and remembered facts.
- Let users click memory nodes to inspect evidence, confidence, source, storage state, and connected memories.
- Add memory correction and deletion flows from the Brain view.
- Add Memory Receipts after memory intake, e.g. saved category, confidence, archive state, and whether the turn was private.
- Show Walrus archive status separately from hot operational memory, e.g. archived, pending archive, retrying, or failed.
- Add Memory Diff and Corrections: show when Sivraj updates a prior truth, such as changing age, workplace, preference, or project status.
- Add Memory Confidence language for chat and inspection surfaces: certain, likely, unclear, or not saved.
- Add Ask Across Your Life mode for broad self-queries such as work patterns, learning history, uploaded documents, recurring themes, and personal context.
- Add Token Savings Dashboard to show estimated tokens saved by using memory instead of replaying raw history or documents.
- Add Private Document Navigator for uploaded PDFs/books/docs with document list, pages, sections, summaries, extracted entities, search, and evidence links.
- Preserve Voice Twin Continuity: same selected Cartesia voice, Twin name, memory, and personality across chat and voice surfaces.

Exit criteria:

- A user can see what Sivraj knows, why it knows it, correct it, delete it, and understand when memory saved model tokens.

## Phase 2.5: Voice Conversation Memory

Goal: Let users talk to Sivraj and turn meaningful conversation into Twin updates.

- Add voice recording UX.
- Add speech-to-text transcription.
- Extract candidate memories, goals, decisions, preferences, and project updates from conversation.
- Ask the user to approve or edit extracted updates.
- Store approved updates through the encrypted Walrus path.
- Add audit events for voice-derived memory changes.

Exit criteria:

- A user can talk to Sivraj, approve extracted memories, and later retrieve those memories with citations.

## Phase 3: Retrieval and Context Routing

Goal: Retrieve the right memories for the right AI system.

- Build semantic search.
- Add recency and authority ranking.
- Add permission-scoped retrieval.
- Generate context packets.
- Add API endpoint for agent context.
- Add source citations.

Exit criteria:

- Coding, research, and strategy agents receive different context from the same Twin.

## Phase 3.5: Coding Agent Memory Layer

Goal: Make Sivraj the persistent engineering memory layer for Codex, Claude Code, Cursor, and custom coding agents.

- Build repo/project engineering profiles from instruction files, docs, package configs, GitHub imports, chats, PR notes, and voice conversations.
- Add Sovereign Context Packet export/API for Codex, Cursor, Claude Code, OpenClaw, and custom agents.
- Add approved-only coding-agent handoff packets for production use.
- Add review-mode packets for testing candidate rules.
- Add a Sivraj MCP server with tools for context, source registry, retrieval, project profile, and writeback.
- Add local CLI commands for context export and writeback.
- Add repo fingerprinting so local agents receive the right project profile automatically.
- Add agent writeback for implementation summaries, commands run, test failures, decisions, recurring bugs, and user corrections.
- Add user review UI for agent writebacks before they update the Twin.
- Add stale/conflicting engineering instruction review.
- Add suggested patches for `AGENTS.md`, `CLAUDE.md`, Cursor rules, and repo docs.
- Add permission and audit UI for each connected coding agent.

Exit criteria:

- A coding agent can start with Sivraj context, complete a task, write back what happened, and a future coding agent can use that history without the user repeating themselves.

## Phase 3.6: App Memory Permissions

Goal: Make scoped memory access concrete for every connected app and agent.

- Define app classes and default scopes, such as coding agent, health app, personal assistant, research agent, and strategy agent.
- Add per-app permission profiles for memory categories, documents, graph nodes, and context packets.
- Let users grant a coding agent skills, repo conventions, tools, and project context without exposing private life memories.
- Let users grant a personal assistant schedules, preferences, and relationship context without exposing repo or strategy memories.
- Add per-app audit logs showing exactly which memories were read, written, exported, or denied.
- Add revoke, pause, and expire controls for every app connection.

Exit criteria:

- A user can connect an app, grant scoped memory access, inspect every access, and revoke it without deleting the underlying Twin memory.

## Phase 4: Synthesis Engine

Goal: Turn memory into strategic intelligence.

- Build pattern detection prompts.
- Generate recurring bottleneck analysis.
- Generate project drift analysis.
- Generate weekly founder reflection.
- Track insight evidence.
- Add user feedback on insight quality.

Exit criteria:

- User receives at least one non-obvious, high-value personal insight.

## Phase 5: Sovereign Access Control

Goal: Users own and control memory access.

- Define access scopes.
- Add per-memory policies.
- Add agent authorization.
- Add audit log.
- Add permission management UI.

Exit criteria:

- User can grant and revoke scoped memory access for agent classes.

## Phase 6: Web3 Persistence

Goal: Make Sivraj portable, verifiable, and sovereign.

- Add identity state snapshots.
- Add portable export.
- Add verifiable memory references.
- Future, not current priority: design scalable gas and storage payment management so private memory writes do not rely forever on one subsidized server wallet. Evaluate user-paid Walrus writes, prepaid credits, quotas/free tiers, bring-your-own storage wallet, and sponsored onboarding limits.

Exit criteria:

- User can prove and port long-term identity state across systems.

## Phase 7: Operator Intelligence Product

Goal: Package the strongest wedge into paid workflows for high-leverage independent operators.

- Build independent-operator dashboard.
- Add recovered expertise and reusable-framework flows.
- Add client/project context tracking.
- Add founder-specific dashboard views.
- Add investor conversation tracking.
- Add roadmap and execution bottleneck synthesis.
- Add weekly chief-of-staff report.
- Add decision memory.
- Add strategic focus recommendations.

Exit criteria:

- Independent operators convert to Pro after reaching the activation moment, and founder/operator users show willingness to pay for premium intelligence workflows.
