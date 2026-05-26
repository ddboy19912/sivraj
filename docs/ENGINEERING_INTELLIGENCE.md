# Engineering Intelligence

## Purpose

Engineering Intelligence is the Sivraj layer that remembers how a user builds software and turns that memory into scoped context for coding agents.

Sivraj should not replace Codex, Claude Code, Cursor, or future coding agents. Sivraj should make them better by giving them the right durable context before they act.

In this split:

- Sivraj remembers, classifies, consolidates, and routes engineering context.
- Coding agents inspect code, edit files, run tests, debug, refactor, and open pull requests.

The product promise is:

> Your AI coding agents should not relearn how you build software every time you open a new repo.

## Agent Instruction Sources

Agent instruction files are first-class engineering memory sources because users currently carry them manually across tools and repos.

Initial files to detect:

- `CLAUDE.md`
- `AGENTS.md`
- `AGENT.md`
- `SKILL.md`
- `.cursorrules`
- `.cursor/rules/*`
- `.github/copilot-instructions.md`
- `README.md`
- `CONTRIBUTING.md`
- `CODEOWNERS`
- architecture docs
- deployment docs
- package and tooling config files where they reveal conventions

Sivraj should ingest these as engineering instruction sources, not generic notes.

## What To Extract

Engineering intelligence should extract:

- coding preferences
- framework and stack preferences
- repo architecture decisions
- project conventions and style rules
- testing expectations
- deployment and environment knowledge
- recurring bugs and failure patterns
- security and privacy boundaries
- agent behavior instructions
- tool preferences
- source-backed constraints that should guide future code work

Example extracted memories:

- The user prefers Vite React over Next.js when the API is standalone.
- This repo separates web, API, worker, and packages in a pnpm workspace.
- Private memory plaintext must not be stored in Postgres.
- Use `rg` first when searching the repo.
- Do not revert user changes unless explicitly requested.

## Scope Classification

Sivraj must not blindly merge every repo instruction into the user's permanent global preferences.

Each extracted engineering rule needs a scope:

- `global_user`: applies across most coding work for this user.
- `project`: applies only to one repo or project.
- `organization`: applies to an org or team.
- `agent_specific`: applies only to Codex, Claude Code, Cursor, or another named agent.
- `temporary`: applies to a short-lived task or phase.

Each rule also needs lifecycle state:

- `candidate`
- `approved`
- `active`
- `superseded`
- `rejected`

This lets Sivraj preserve useful instructions while avoiding stale or conflicting guidance.

## Conflict And Staleness

Conflicts are expected.

Examples:

- One repo says use pnpm; another says use bun.
- One project uses Next.js; another explicitly avoids it.
- An old repo uses Node 18; a current repo requires Node 24.

Sivraj should keep evidence and scope, then avoid turning local rules into global truth unless the pattern appears repeatedly or the user approves it.

The first deterministic detector flags:

- package-manager conflicts such as pnpm vs npm/yarn/bun
- frontend-framework conflicts such as Vite vs Next.js
- runtime version drift such as Node 18 vs Node 24
- direct use/avoid contradictions
- expired temporary instructions
- explicit `validUntil` expiration metadata

These issues should not automatically delete memory. They should mark rules for review, downgrade confidence, or prevent unsafe promotion into active global context.

## Context Packets

The main output of Engineering Intelligence is an agent-ready context packet.

A coding context packet should include:

- user coding preferences relevant to the task
- repo/project profile
- active engineering rules
- architecture decisions
- security boundaries
- testing and verification expectations
- known pitfalls or recurring bugs
- source-backed evidence refs
- permission and audit metadata

The first implementation produces a private-safe packet from the repo/project profile. It includes grouped context items with subjects, scopes, confidence, statuses, safe metadata, and evidence refs. It does not decrypt or include raw private memory statements. Candidate memories are excluded by default; they can be included only when a caller explicitly asks for review/testing context.

The same endpoint also returns `contextMarkdown`, a concise copyable agent handoff format for Codex, Claude Code, Cursor, or custom coding agents. This is the current manual connector path: Sivraj remembers and scopes the engineering context, while the coding agent executes the actual code task. The markdown intentionally avoids the verbose review table and exports only deduped rules plus evidence IDs.

For usability, engineering extraction stores a short sanitized `agentContextLine` for each engineering memory. This is not the raw private document body. It is the intentionally exportable instruction/decision/convention line used in coding-agent packets, and it is still gated by `memory:read`.

The first API surface is:

```http
GET /v1/twins/:twinId/engineering/context
GET /v1/twins/:twinId/engineering/sources
```

It requires `memory:read`, enforces the token's `twinId` unless the caller is a service token, and returns only the bounded `coding_agent_context` packet plus summary counts. The endpoint is intended for Codex/Claude Code/Cursor-style integrations and testing clients; it is not a raw memory export.

The source registry endpoint shows users which engineering instruction files or artifacts Sivraj has consumed and what derived engineering memories came from each source. This gives users an audit view for trust and control without exposing raw private file bodies.

The integration plan for Codex, Claude Code, and Cursor lives in [Coding Agent Integrations](./CODING_AGENT_INTEGRATIONS.md).

Example:

```json
{
  "purpose": "coding_agent_context",
  "project": "sivraj",
  "userPreferences": [
    "Prefers Vite React over Next.js when API is standalone",
    "Wants production-grade implementation, not MVP shortcuts"
  ],
  "architectureRules": [
    "Keep API separate from web",
    "Private memory plaintext must not be stored in Postgres",
    "Walrus stores encrypted durable memory; Postgres stores refs and metadata"
  ],
  "agentInstructions": [
    "Use rg first for repo search",
    "Run focused tests before final response"
  ],
  "evidence": [
    {
      "sourceArtifactId": "...",
      "memoryFragmentId": "...",
      "storageRef": "walrus://blob/..."
    }
  ]
}
```

## Repo/Project Profile

Before Sivraj builds an agent-ready context packet, it first consolidates extracted engineering memories into a repo/project profile.

The profile groups private-safe records into:

- architecture decisions
- project conventions
- style rules
- deployment and environment knowledge
- security and privacy boundaries
- recurring bugs and failure patterns
- coding and tool preferences
- agent instructions
- testing practices

The profile must not contain raw private statements. It carries candidate memory IDs, source artifact IDs, memory fragment IDs, evidence hashes, scopes, subjects, confidence, status, and safe metadata. This gives later context-packet generation a structured source-backed view without forcing decrypted memory into Postgres or API payloads.

## First Implementation Slice

The first slice should be deterministic and source-faithful:

1. Detect known agent instruction files in GitHub/repo imports.
2. Mark uploaded/imported files with `metadata.engineeringSourceKind`.
3. Extract candidate engineering memories from instruction files.
4. Classify extracted rules by scope.
5. Store extracted rules as encrypted candidate memories with safe metadata.
6. Expose them through the candidate review and graph/testing console.

The LLM can help classify and extract rules, but deterministic detection decides that the file is an engineering instruction source.

The worker also runs engineering-memory extraction over broader engineering sources such as repo imports, technical docs, PR/chat exports, manual notes, and voice conversations when the source type or content is engineering-shaped. These candidates use the same encrypted candidate-memory archive path as regular memories, so Postgres stores hashes, refs, scope, source kind, and safe classifier metadata rather than plaintext instructions.

Plain text can become engineering memory without a special "engineering instruction" field when the content is explicit enough. For example, "When coding with me, always use pnpm and run focused tests before final response" is accepted as engineering guidance. Normal work history such as "I worked with Polytope Labs on Hyperbridge" remains regular memory, and skill facts such as "I used TypeScript and React" are not promoted into coding preferences unless the evidence explicitly says the user prefers them.

## Verification

Tests should prove:

- instruction files are detected by path/name
- extracted rules are scoped correctly
- repo-local rules are not treated as global by default
- conflicting instructions can coexist with evidence
- plaintext instruction text is not stored in Postgres
- coding-agent context packets include only scoped, authorized context
- plain written engineering instructions are detected without requiring `CLAUDE.md` / `AGENTS.md`
- normal work history and skill facts are not promoted into engineering instructions
