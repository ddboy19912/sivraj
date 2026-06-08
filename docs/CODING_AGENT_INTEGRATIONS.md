# Coding Agent Integrations

## Purpose

Sivraj should make coding agents better without replacing them.

The split is:

- Sivraj stores and evolves the user's engineering memory.
- Coding agents edit code, inspect repos, run commands, debug, test, and ship changes.
- The bridge between them is a scoped engineering context packet.

The first implemented packet endpoint is:

```http
GET /v1/twins/:twinId/engineering/context
```

It returns `coding_agent_context` with safe metadata and evidence refs. It does not decrypt or return raw private memory statements.

## Integration Principles

1. Context packets first, raw memory never by default.
2. Agents receive only the scope they need for the current repo/task.
3. Every item must be source-backed by evidence refs.
4. Repo-local rules must not become global user preferences unless approved or repeatedly supported.
5. Agent-specific rules should stay agent-specific.
6. Failed or stale rules should remain reviewable, not silently deleted.
7. Agent outputs can become new Sivraj memory only through explicit writeback or reviewed ingestion.

## Shared Flow

The common flow for Codex, Claude Code, Cursor, and future coding agents:

1. User connects a repo or imports repo context into Sivraj.
2. Sivraj detects engineering sources such as `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, README, architecture docs, package config, deployment docs, PR notes, and coding conversations.
3. Worker extracts engineering candidate memories.
4. User approves high-value reusable rules where needed.
5. Agent requests a context packet before a coding session.
6. Sivraj returns bounded context grouped by preference, architecture, project convention, style, deployment, security, pitfalls, agent instructions, and testing practice.
7. Agent uses the packet as guidance, not as an instruction to override local repo files or current user messages.
8. Agent can write back observations or implementation summaries through future writeback endpoints.

## Endpoint Contract

```http
GET /v1/twins/:twinId/engineering/context
Authorization: Bearer <token>
```

Query options:

- `projectId`: optional stable project/repo id.
- `projectName`: optional display label.
- `artifactId`: optional source-artifact scope.
- `includeCandidate=true`: include unapproved candidates for review/testing.
- `includeSuperseded=true`: include superseded memories.
- `includeTemporary=true`: include temporary task/session rules.
- `maxItemsPerSection`: cap items per section.

Required scope:

- `memory:read`

Future external agent scope:

- `engineering:context:read`

First response shape:

```json
{
  "policy": {
    "rawArtifactsIncluded": false,
    "decryptedMemoryIncluded": false,
    "plaintextStatementsIncluded": false,
    "scope": "memory:read"
  },
  "contextPacket": {
    "purpose": "coding_agent_context",
    "project": {
      "id": null,
      "name": "sivraj"
    },
    "sections": {
      "userPreferences": [],
      "architectureRules": [],
      "projectConventions": [],
      "styleRules": [],
      "deploymentEnvironment": [],
      "securityBoundaries": [],
      "knownPitfalls": [],
      "agentInstructions": [],
      "testingPractices": []
    },
    "evidence": []
  },
  "profileSummary": {
    "totalEngineeringMemories": 0,
    "includedContextItems": 0,
    "evidenceRefs": 0,
    "warnings": []
  }
}
```

## Codex Integration

### First Path

Build a small Sivraj context command that a Codex session can run before work starts:

```bash
sivraj context codex --repo sivraj --format markdown
```

The command should:

1. Read `SIVRAJ_API_URL`, `SIVRAJ_TOKEN`, `SIVRAJ_TWIN_ID`.
2. Call `GET /v1/twins/:twinId/engineering/context`.
3. Render a compact Markdown packet.
4. Include only source refs and safe metadata.
5. Save nothing by default unless the user asks.

### Codex Packet Shape

Codex should receive:

- Current user coding preferences.
- Repo architecture decisions.
- Testing and verification expectations.
- Safety boundaries such as "do not store private plaintext in Postgres."
- Known pitfalls and recurring bugs.
- Agent behavior rules relevant to Codex.

Codex should not receive:

- Raw decrypted memories.
- API keys, private env values, private user docs, or raw Walrus blobs.
- Candidate rules unless explicitly requested.

### Codex Writeback

Future writeback can capture:

- Work summaries.
- New architecture decisions.
- Newly discovered recurring bugs.
- Test failures and fixes.
- User corrections to agent behavior.

Writeback should create encrypted artifacts first, then extraction candidates, not direct plaintext memories.

## Claude Code Integration

### First Path

Claude Code should consume the same endpoint, but render into a Claude-friendly session preface:

```bash
sivraj context claude --repo sivraj --format markdown
```

The rendered output should be short and operational:

- "Follow these repo conventions."
- "Respect these security boundaries."
- "These are known pitfalls."
- "Evidence refs are available for audit."

### CLAUDE.md Relationship

`CLAUDE.md` remains local repo guidance.

Sivraj should not overwrite it automatically. Instead:

1. Ingest `CLAUDE.md`.
2. Extract reusable rules.
3. Detect stale/conflicting instructions.
4. Generate a context packet that can complement the local file.
5. Later, suggest updates to `CLAUDE.md` with user approval.

This prevents Sivraj from silently mutating repo-local agent behavior.

## Cursor Integration

### First Path

Cursor should receive a compact packet that can map into `.cursorrules`-style guidance or a chat preface:

```bash
sivraj context cursor --repo sivraj --format cursor
```

Cursor packet should emphasize:

- Framework/style preferences.
- Repo architecture rules.
- Common commands.
- Testing expectations.
- Boundaries around security, privacy, and generated code.

### Cursor Rules Relationship

`.cursorrules` and `.cursor/rules/*` are source inputs, not automatic outputs.

Sivraj may later generate suggested Cursor rule patches, but the first integration should be read-only.

## Permissions

Current POC:

- First-party wallet session token.
- `memory:read` scope.
- User token must match `twinId`.

Production direction:

- Register each external agent/client.
- Issue delegated client or agent tokens.
- Use explicit scopes such as `engineering:context:read`, `engineering:writeback:create`, and `engineering:rules:review`.
- Add purpose-bound consent.
- Audit every context packet request.

## MCP Server

The strongest coding-agent integration is a Sivraj MCP server.

Initial package:

```text
apps/mcp-server
```

The MCP server should not talk directly to Postgres or decrypt private storage. It should call the Sivraj API with a scoped token. This keeps auth, permissions, audit, and privacy policy in one place.

First tools:

- `sivraj.getEngineeringContext`
  - returns concise handoff context for the current repo/task.
- `sivraj.listEngineeringSources`
  - shows what instruction files/docs Sivraj learned from.
- `sivraj.searchMemory`
  - retrieves source-backed memories under permission scope.
- `sivraj.getProjectProfile`
  - returns repo/project engineering profile.
- `sivraj.recordAgentWriteback`
  - submits task summaries, decisions, bugs, commands, and test outcomes for user review.

First resources:

- `sivraj://engineering/context`
  - current repo-aware engineering context packet for coding agents.
- `sivraj://engineering/sources`
  - private-safe registry of instruction files and artifacts Sivraj learned from.
- `sivraj://agents/writebacks/recent`
  - recent writeback summaries and review states.

Implemented package:

```text
apps/mcp-server
```

Local development:

```bash
pnpm dev:mcp
```

## Local CLI

The local CLI gives users and coding agents a direct shell workflow without needing to manually call curl.

Implemented package:

```text
apps/cli
```

Local development:

```bash
pnpm dev:cli -- context --preset codex
pnpm dev:cli -- context --preset cursor --output .cursor/rules/sivraj.mdc
pnpm dev:cli -- writeback --agent-name Codex --summary "Implemented the local Sivraj CLI." --files-touched apps/cli/src/index.ts
pnpm dev:cli -- demo --preset codex
```

The CLI uses the same environment contract as the MCP server:

- `SIVRAJ_API_URL`
- `SIVRAJ_TWIN_ID`
- `SIVRAJ_TOKEN`

`sivraj context` returns the preset-specific `contextExport.content`. `sivraj writeback` submits an encrypted pending-review coding-agent writeback through the API. `sivraj demo` shows the before-work context packet and, with `--record-writeback`, can submit a demo writeback after the handoff.

Additional demo and evaluation commands:

```bash
sivraj research-demo --question "What should I research next?"
sivraj strategy-demo --question "What should I prioritize?"
sivraj eval --task "Implement the next connector"
```

`research-demo` and `strategy-demo` are lightweight agent clients that prove the same Twin context can be shaped for non-coding agents. `eval` is the first deterministic harness: it fetches the source-backed context packet, reports baseline-without-context vs with-context quality, evidence count, issue count, and readiness. Use it before and after real agent runs, then submit outcomes with `sivraj writeback`.

MCP environment:

```bash
SIVRAJ_API_URL=http://127.0.0.1:3000
SIVRAJ_TWIN_ID=<twin-id>
SIVRAJ_TOKEN=<scoped-token>
SIVRAJ_PROJECT_NAME=sivraj
SIVRAJ_PROJECT_ID=
SIVRAJ_INCLUDE_CANDIDATES=true
SIVRAJ_MAX_ITEMS_PER_SECTION=12
```

For local testing, first mint/use a normal wallet session token, then create a delegated coding-agent token:

```http
POST /v1/twins/:twinId/agents/tokens
Authorization: Bearer <user-token>
```

The delegated token should use the narrow agent scopes:

- `agent:context:read`
- `agent:sources:read`
- `agent:project_profile:read`
- `agent:memory:search`
- `agent:writeback:create`

Generic MCP client config for local development:

```json
{
  "mcpServers": {
    "sivraj": {
      "command": "pnpm",
      "args": ["--dir", "/absolute/path/to/sivraj", "--filter", "@sivraj/mcp-server", "dev"],
      "env": {
        "SIVRAJ_API_URL": "http://127.0.0.1:3000",
        "SIVRAJ_TWIN_ID": "<twin-id>",
        "SIVRAJ_TOKEN": "<scoped-token>",
        "SIVRAJ_PROJECT_NAME": "sivraj",
        "SIVRAJ_INCLUDE_CANDIDATES": "true"
      }
    }
  }
}
```

Current writeback path:

- `sivraj.recordAgentWriteback` submits to `POST /v1/twins/:twinId/agents/writebacks`.
- Local/dev agents may let the API encrypt the writeback and store a pending review record.
- Remote MCP agents should set `SIVRAJ_WRITEBACK_ENCRYPTION=client`. In that mode the MCP process formats the full writeback locally, Seal-encrypts it locally, sends only ciphertext plus safe hashes/counts to the API, and the API stores that ciphertext on Walrus.
- Writeback approve/reject review should live in the product review surface; the removed diagnostics page no longer exposes this workflow.
- Approval creates the encrypted private `note` artifact and queues normal processing.
- The worker then extracts candidate engineering memories for user review.

Client-encrypted MCP writeback environment:

```bash
SIVRAJ_WRITEBACK_ENCRYPTION=client
SIVRAJ_SEAL_PACKAGE_ID=0x...
SIVRAJ_SEAL_POLICY_ID=0x...
SIVRAJ_SEAL_KEY_SERVERS=0xkeyserver1,0xkeyserver2
SIVRAJ_SEAL_THRESHOLD=1
SIVRAJ_SUI_RPC_URL=https://fullnode.testnet.sui.io:443
```

The API accepts the client-encrypted writeback without `taskSummary`; it uses `taskSummarySha256`, safe counts, Seal metadata, Walrus refs, and audit events for review. Plaintext remains local to the MCP process until a user explicitly approves the encrypted writeback for ingestion.

PR/commit imports:

- `POST /v1/twins/:twinId/agents/writebacks/imports/pr`
- `POST /v1/twins/:twinId/agents/writebacks/imports/commit`

These endpoints convert completed pull requests and commits into encrypted pending-review writebacks. Sivraj stores the full imported body through the encrypted memory path and keeps only hashes, safe counts, storage refs, and review status in Postgres. After approval, the normal worker pipeline extracts repo health memories, review-copilot feedback, architecture decisions, tests, and project conventions for future coding-agent context.

Permission control:

- Product permission management creates scoped coding-agent tokens.
- The permission management surface lists active/revoked/expired grants and lets the user revoke a grant.
- Agent tokens are time-limited. Agent reads/search/writebacks require an active, unexpired, unrevoked grant before the API serves the request.
- Agent-scoped context assembly now checks both the JWT scope and the persisted grant scopes. Revoking or narrowing a grant prevents stale tokens from continuing to receive engineering context, project profile data, sources, memory search, or writeback access.

Security rules:

- MCP tools return private-safe context by default.
- Raw decrypted memory is never returned by default.
- Writeback creates reviewed candidate memory, not immediate permanent truth.
- Every read/write should become an audit event.
- Production agents should use delegated agent/client tokens, not the user's full wallet session token.

## Agent Writeback

Agent writeback closes the loop.

After Codex, Claude Code, Cursor, or another coding agent finishes a task, it can submit:

- task summary
- files touched
- commands run
- tests passed/failed
- bugs discovered
- architecture decisions made
- user corrections
- new repo conventions
- instructions that became stale or conflicted

Writeback flow:

1. Agent submits writeback through MCP or API.
2. Sivraj stores it as an encrypted artifact.
3. Worker extracts candidate engineering memories.
4. User reviews and approves/rejects.
5. Approved memories become part of future coding-agent context.

This makes Sivraj compound across coding sessions instead of merely exporting static instructions.

### Repo Health Memory

Approved agent writebacks now become repo-health signals during engineering extraction. Sivraj deterministically extracts:

- bugs found as `recurring_bug`
- failing/flaky tests as `recurring_bug`
- successful verification commands as `testing_practice`
- build, dependency, CI, Docker, database, deployment, and environment gotchas as `deployment_environment`

These memories remain source-backed by the encrypted writeback artifact and can appear later in agent context under known pitfalls, testing practices, and deployment environment. This lets the next coding agent start with knowledge such as "this repo often needs Redis running before build/test commands pass" without exposing the raw writeback body.

### Review Copilot Memory

Agent writeback `User Corrections` now become review-copilot signals. Sivraj deterministically extracts:

- privacy/security corrections as `security_boundary`
- test-plan and verification corrections as `testing_practice`
- UI/copy/style corrections as `style_rule`
- agent behavior corrections as `agent_instruction`
- general review preferences as `coding_preference`

These are scoped as `agent_specific` by default because they guide future coding agents. They help Codex, Claude Code, Cursor, and MCP clients honor the user's review standards before the user has to repeat them.

## Repo Matching

Sivraj should match local coding sessions to the correct project profile.

Signals:

- git remote URL
- repo folder name
- package name
- workspace package names
- `AGENTS.md`, `CLAUDE.md`, Cursor rule paths
- project IDs stored in Sivraj

The MCP server detects current working directory metadata where possible, lets tool arguments override it, and asks the API for the best project context.

Current repo fingerprint inputs:

- project name or project ID
- repo folder/name
- package name
- git remote URL
- package manager
- frontend/runtime frameworks
- lockfiles and root marker files

The API uses these signals to rank matching engineering memories higher than generic memories, generate repo-specific context packets, and warn before export when candidate rules conflict with the current repo, for example pnpm vs npm or Vite vs Next.js. Context issues are returned as structured `contextPacket.issues` plus human-readable markdown warnings so Codex, Claude Code, Cursor, and MCP clients can avoid blindly applying stale or wrong instructions.

Before handoff, Sivraj also scores context quality. The score considers evidence coverage, approved/active memory count, repo match strength, candidate-heavy packets, unknown source metadata, and conflict severity. Clients can use `contextPacket.quality.readyForAgent` to decide whether to apply the packet directly or route it through user review first.

The stale instruction review queue is that review path. It lists conflicting or stale derived engineering instructions, lets the user keep, supersede, reject, or leave an instruction in review, then feeds that decision back into future agent context quality scoring.

Sivraj can also generate suggested repo instruction files from approved engineering memory. The current implementation returns preview-only exports with evidence IDs and quality scoring. It does not write to the repository automatically; the user reviews and copies the file content first.

Supported one-click presets:

- `codex`: generates `AGENTS.md` Markdown for Codex-style agents.
- `claude_code`: generates `CLAUDE.md` Markdown for Claude Code.
- `cursor`: generates `.cursor/rules/sivraj.mdc` with Cursor rule frontmatter.
- `generic_mcp`: generates `sivraj-context.json` for MCP clients and automation.

## Future Coding-Agent Features

- Suggested updates to `AGENTS.md`, `CLAUDE.md`, Cursor rules, and generic MCP context JSON.
- Conflict-aware context export before agent handoff.
- Stale instruction review queue.
- Context quality score before export.
- Per-agent permission UI.
- Agent session timeline showing what each agent read and wrote.
- Cross-agent coordination: one agent's decisions become context for the next.
- Agent eval harness: compare how Codex, Claude Code, Cursor, and custom agents perform with and without Sivraj context.

## Context Rendering

The API response is structured JSON. Each integration can render it differently.

### Markdown Renderer

Good for Codex and Claude Code:

```md
# Sivraj Engineering Context

## Security Boundaries
- [approved/project] Private memory plaintext must not be stored in Postgres.
  Evidence: candidateMemoryId=...

## Testing Practices
- [approved/project] Run focused package tests before final response.
  Evidence: candidateMemoryId=...
```

### Cursor Renderer

Good for `.cursorrules`-style use:

```text
Use the following Sivraj context as guidance.
Do not treat candidate items as final unless the user confirms them.

Security:
- Private memory plaintext must not be stored in Postgres.
```

### JSON Renderer

Good for SDKs and automated clients:

```json
{
  "purpose": "coding_agent_context",
  "sections": {
    "securityBoundaries": []
  }
}
```

## What Not To Build First

Do not start with:

- Automatic mutation of `CLAUDE.md`, `.cursorrules`, or `AGENTS.md`.
- Raw decrypted memory export to agents.
- Passive IDE surveillance.
- Agent writeback without user-visible review.
- One global context blob for every repo.

The first useful product is a reliable, scoped, source-backed context packet.

## First Build Tasks

1. Add a small TypeScript client/renderer package for coding-agent context packets.
2. Add a CLI command or demo script that fetches the engineering context endpoint.
3. Support `--format markdown`, `--format json`, and `--format cursor`.
4. Add tests proving rendered packets contain no plaintext statements beyond safe metadata.
5. Add fixture-based tests for Codex, Claude Code, and Cursor output.
6. Add an audit event for context packet generation.
7. Add future delegated `engineering:context:read` scope after client registration exists.

## Acceptance Criteria

- Codex, Claude Code, and Cursor all have a documented first integration path.
- The same API endpoint powers all three.
- Packets are scoped and source-backed.
- Raw private memories are not exposed.
- Candidate, temporary, and superseded rules are opt-in.
- Local agent instruction files remain user-controlled.
