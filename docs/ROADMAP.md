# Roadmap

This roadmap is the living product direction for Sivraj. It is not a historical implementation checklist; completed foundation work now lives in the codebase and supporting docs.

For deeper context, see [Product Requirements](./PRD.md), [Product Foundation](./PRODUCT_FOUNDATION.md), [Architecture](./ARCHITECTURE.md), [Brain Architecture](./BRAIN_ARCHITECTURE.md), [Intelligence Layer](./INTELLIGENCE.md), [Coding Agent Integrations](./CODING_AGENT_INTEGRATIONS.md), and [Environment Contract](./ENVIRONMENT.md).

## Current Baseline

Sivraj already has the core web product path in motion:

- Wallet-backed user and Twin identity.
- Onboarding identity profile and self-description memory intake.
- Encrypted private source storage through the Seal/Walrus path.
- Artifact upload and processing for user-provided context.
- Chat over saved memory and uploaded documents.
- Brain, memory, document, and retrieval hardening for source-grounded answers.
- Brain view surfaces for inspecting what the Twin knows.
- Engineering memory groundwork for coding-agent context packets.
- Audit, processing state, retry, and storage metadata foundations.

The near-term roadmap should therefore focus less on proving that memory ingestion works and more on making Sivraj portable across the places users already work.

## Product Direction

Sivraj is becoming a persistent intelligence layer with multiple first-party surfaces:

1. **Web App** - the primary control plane for onboarding, memory, chat, brain inspection, uploads, providers, and permissions.
2. **Sivraj CLI** - the fastest path for developers, coding agents, repo context, and scripted workflows.
3. **Desktop App** - an always-available local companion for capture, context, documents, voice, and agent handoff.
4. **Mobile Companion App** - lightweight memory capture, voice reflection, review, and daily continuity.

The web app remains the source of truth for account setup and inspection. The new products should extend that truth, not fork it.

## Near-Term Priorities

### 1. Reliability and Demo Readiness

Goal: make the current web experience hard to break in front of real users.

- Make upload, processing, and retrieval states explicit and retryable.
- Keep PDF/document answers source-grounded and honest when retrieval is degraded.
- Ensure onboarding memories, first-meet intro runtime voice state, and identity profile state survive reloads and retries.
- Improve failed-upload recovery and user-facing notices.
- Keep Railway/live environment configuration documented and easy to verify.
- Maintain a polished demo path using private demo scripts kept outside the public repo.

Exit criteria:

- A new account can complete onboarding, upload meaningful files, chat with memory, inspect the brain, and recover gracefully from common live failures.

### 2. Memory Quality and Brain Trust

Goal: make Sivraj feel less like a chatbot and more like a reliable memory layer.

- Improve canonical memory reconciliation so repeated evidence strengthens one durable truth instead of creating duplicates.
- Make memory correction, deletion, and supersession easy from the Brain view.
- Distinguish user profile, preferences, engineering context, documents, and general memories in retrieval and inspection.
- Add clearer confidence language: saved, likely, unclear, not found, temporarily unavailable.
- Improve document inventory, page/chapter/section structure, and exact-search answers.
- Expand token-savings and source-evidence visibility where it helps users trust the system.

Exit criteria:

- Users can ask what Sivraj knows, see why it knows it, correct mistakes, and understand whether a failed answer was caused by missing memory or degraded retrieval.

## Major Product Tracks

### Sivraj CLI

Goal: make Sivraj useful inside developer and agent workflows without requiring the web app to stay open.

Primary users:

- Developers.
- Coding agents.
- Power users who want scriptable memory workflows.

Core capabilities:

- Authenticate with a Sivraj account or scoped token.
- Select a Twin and active project/repo.
- Fetch engineering context packets for Codex, Claude Code, Cursor, OpenClaw, and custom agents.
- Render context as Markdown, JSON, or agent-specific prefaces.
- Search scoped memory from the terminal.
- Upload local docs, notes, repo instructions, and task summaries.
- Submit agent writebacks for user review.
- Inspect source registry, processing state, and failed jobs.
- Run health checks for API, auth, storage, queue, and provider configuration.

Important commands:

```bash
sivraj login
sivraj twins list
sivraj context codex --repo sivraj --format markdown
sivraj context claude --repo sivraj --format markdown
sivraj memory search "deployment pitfalls"
sivraj upload ./docs/architecture.md --project sivraj
sivraj writeback create --summary ./task-summary.md
sivraj doctor
```

Exit criteria:

- A coding agent can start with Sivraj context, complete work, write back what happened, and future sessions can reuse that history without the user repeating themselves.

Related docs:

- [Coding Agent Integrations](./CODING_AGENT_INTEGRATIONS.md)
- [Engineering Intelligence](./ENGINEERING_INTELLIGENCE.md)
- [API Design](./API.md)

### Desktop App

Goal: make Sivraj feel like a local memory companion that is always close to the user's work.

Primary users:

- Builders and operators who live across documents, browsers, terminals, meetings, and AI tools.

Core capabilities:

- Local app shell for chat, brain inspection, uploads, and provider settings.
- Quick capture for notes, files, screenshots, links, and voice snippets.
- Local document drop zone with processing status and retry UX.
- Global command palette for memory search and context copy.
- Repo/project awareness for coding-agent workflows.
- Desktop notifications for processing failures, review queues, and reflection prompts.
- Safe handoff into the web account and API permission model.

Design requirements:

- The desktop app should feel like a quiet control surface, not a marketing wrapper.
- It should make capture and recall faster than opening a browser tab.
- It must respect the same encryption, permission, and audit boundaries as the web app.

Exit criteria:

- A user can capture context from their daily work, search their Twin, and hand context to an agent without leaving the desktop flow.

### Mobile Companion App

Goal: make memory capture and reflection available when the user is away from their desk.

Primary users:

- Operators, founders, consultants, researchers, and creators who think on the move.

Core capabilities:

- Voice-first memory capture.
- Quick text notes and lightweight uploads.
- Daily review of candidate memories.
- Approve, edit, or reject extracted memories.
- Ask quick questions from the Twin.
- Review recent insights, reminders, and unresolved memory conflicts.
- Push notifications for reflection prompts and review queues.

Mobile should not try to replicate the full web app. It should focus on capture, review, and continuity.

Exit criteria:

- A user can record an important thought, approve the extracted memory, and later retrieve it from web, desktop, CLI, or chat.

## Platform and Intelligence Roadmap

These capabilities support all first-party products.

### Connectors and Recurring Sync

- GitHub source and repo sync.
- Google Drive/Docs and Microsoft OneDrive/Docs.
- Notion.
- Slack, email, and calendar.
- Browser history/import where permissioned.
- ChatGPT, Claude, and Codex history imports where APIs or exports allow.

Exit criteria:

- A user can connect at least one external source, backfill it, receive recurring updates, and inspect what changed.

### App Memory Permissions

- Per-app permission profiles.
- Scoped memory categories and document access.
- Purpose-bound agent tokens.
- Audit logs for reads, writes, exports, and denied access.
- Revoke, pause, and expiry controls.

Exit criteria:

- Users can give a coding agent engineering context without exposing private life memories, and can audit every access.

### Synthesis and Reflection

- Weekly founder/operator reflections.
- Project drift and bottleneck detection.
- Decision memory and contradiction review.
- Pattern detection across documents, chats, voice, and work history.
- User feedback loop on insight quality.

Exit criteria:

- Sivraj produces source-backed insights that users would pay to receive because they are specific to their own history.

### Portability and Sovereignty

- Portable Twin export.
- Verifiable memory references.
- Durable identity snapshots.
- Storage funding and quota model that does not rely permanently on one subsidized server wallet.
- Bring-your-own storage wallet or prepaid storage credits where appropriate.

Exit criteria:

- Users can understand, verify, export, and control the long-term state of their Twin.

## What Is No Longer Roadmap

These are no longer useful as roadmap items because they are already part of the product foundation or implementation baseline:

- Basic product thesis and brand definition.
- Initial architecture and data model direction.
- Wallet-backed account/Twin creation.
- Encrypted private source storage boundary.
- Manual/onboarding memory intake.
- Basic upload and processing pipeline.
- Basic chat retrieval over saved memory.
- Queue-backed artifact processing.
- Initial Brain and document retrieval architecture.

Future roadmap items should describe product outcomes and durable capabilities, not repeat low-level setup tasks that have already been absorbed into the platform.
