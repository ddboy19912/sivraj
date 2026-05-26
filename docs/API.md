# API Design

## API Thesis

The Sivraj API is not only an internal app backend. It is one of the core products.

Sivraj should expose a secure, external cognitive infrastructure API that lets approved apps, agents, and AI systems request scoped context from a user's Twin.

The API exists so Sivraj can become the persistent intelligence layer beneath:

- ChatGPT-style assistants.
- Coding agents.
- Research agents.
- Personal productivity tools.
- Founder dashboards.
- Custom user-owned agents.
- Future AI systems.

## API Goal

External clients should be able to:

- Request relevant context.
- Submit new memories or artifacts.
- Query the cognitive graph.
- Retrieve synthesized insights.
- Coordinate with other agents through permissioned shared state.
- Respect user ownership, encryption, and access policies.

The API should never expose everything by default. It should return bounded, auditable context packets filtered by identity, consent, purpose, and permission scope.

## API Consumers

### First-Party App

The Sivraj web app and native clients.

Can:

- Manage the Twin.
- Upload artifacts.
- Inspect graph state.
- Configure permissions.
- Review audit logs.

### External AI Agents

Examples:

- Coding agent.
- Research agent.
- Strategy agent.
- Finance agent.
- Reflection agent.

Can:

- Request context packets.
- Write back agent observations.
- Request user-approved memory creation.
- Subscribe to scoped events.

Cannot:

- Access all memory by default.
- Retrieve raw private archives without explicit permission.
- Bypass Seal, Sui identity, or Sivraj policies.

### Third-Party Apps

Examples:

- Productivity apps.
- Knowledge tools.
- Developer tools.
- AI-native workspaces.

Can:

- Register as clients.
- Request delegated permissions.
- Read or write scoped memory.
- Use Sivraj as an identity and context layer.

### Enterprise Clients

Future clients that need:

- Organization memory.
- Team-level context.
- Employee-owned memory boundaries.
- Institutional continuity.
- Admin policies and audit trails.

## API Surfaces

Sivraj should expose multiple API surfaces, each optimized for a different class of client.

### REST API

Best for:

- CRUD operations.
- Source artifact uploads.
- Permission management.
- Audit log access.
- Simple external integrations.

### Streaming API

Best for:

- Long-running synthesis.
- Agent coordination.
- Progressive context assembly.
- Reflection generation.

### SDKs

Official SDKs should wrap auth, permissions, context requests, retries, and citations.

Priority SDKs:

- TypeScript.
- Python.

### Webhooks

Best for notifying external systems when:

- Ingestion completes.
- A new insight is generated.
- A permission grant changes.
- A context packet is created.
- A graph node changes.
- An agent writeback is approved.

## Authentication and Authorization

### Client Registration

External clients must register and receive:

- `client_id`
- public metadata
- redirect URLs, when applicable
- requested scopes
- signing keys or API credentials

### User Consent

External clients must receive explicit user consent before accessing Twin context.

Consent should include:

- Client identity.
- Requested scopes.
- Memory domains.
- Duration.
- Write permissions.
- Whether raw artifacts can be accessed.

### Token Types

#### User Token

Used by first-party clients acting directly on behalf of the user. User tokens are issued after the user proves control of a Sui wallet.

#### Delegated Client Token

Used by external apps after user consent.

#### Agent Token

Used by AI agents with a constrained purpose and permission scope.

#### Service Token

Used by backend infrastructure. Must never be exposed to clients.

### Authorization Requirements

Every external request must evaluate:

- Caller identity.
- User consent.
- Requested scope.
- Memory domain.
- Purpose.
- Expiration.
- Encryption access.
- Rate limits.
- Audit requirements.

### Wallet Sign-In

Sivraj uses Sui wallet ownership as root user identity.

Endpoints:

```http
POST /v1/auth/challenge
POST /v1/auth/verify
POST /v1/auth/refresh
```

Challenge request:

```json
{
  "walletAddress": "0x..."
}
```

Verify request:

```json
{
  "walletAddress": "0x...",
  "message": "Sign in to Sivraj...",
  "signature": "...",
  "challengeToken": "..."
}
```

Verify response:

```json
{
  "token": "...",
  "refreshToken": "...",
  "expiresAt": "2026-05-18T12:00:00.000Z",
  "userId": "...",
  "twinId": "...",
  "walletAddress": "0x..."
}
```

Refresh request:

```json
{
  "refreshToken": "...",
  "walletAddress": "0x..."
}
```

Refresh response has the same shape as verify response and rotates the refresh token.

The JWT is a short-lived API session token. It is not the source of ownership. First-party wallet sessions use a short access token plus a 30-day refresh session, so normal uploads/retrieval can refresh without asking the wallet to sign again.

Current first-party wallet sessions include:

- `artifact:upload`
- `memory:read`

Existing browser sessions minted before this scope change must sign in again to receive `memory:read`.

Existing browser sessions minted before refresh tokens existed must sign in once to receive `refreshToken`.

## Permission Scopes

Example scopes:

- `twin:read_profile`
- `memory:read`
- `memory:write`
- `memory:read_coding`
- `memory:read_strategy`
- `memory:read_research`
- `memory:read_finance`
- `memory:read_reflection`
- `graph:read`
- `graph:write`
- `insight:read`
- `insight:write`
- `context:create`
- `artifact:upload`
- `artifact:read_raw`
- `audit:read`
- `agent:context:read`
- `agent:sources:read`
- `agent:project_profile:read`
- `agent:memory:search`
- `agent:writeback:create`

Raw artifact access should be rare and separately approved.

### Delegated Coding-Agent Token

```http
POST /v1/twins/:twinId/agents/tokens
Authorization: Bearer <user-token>
```

Requires `memory:read` on a user or service token. It creates an `api_clients` row with `type = coding_agent`, a `permission_grants` row scoped to the Twin, and returns a short-lived agent JWT.

Example request:

```json
{
  "agentName": "Codex",
  "scopes": [
    "agent:context:read",
    "agent:sources:read",
    "agent:project_profile:read",
    "agent:memory:search",
    "agent:writeback:create"
  ],
  "expiresInMinutes": 1440
}
```

Example response:

```json
{
  "token": "...",
  "tokenType": "Bearer",
  "subjectType": "agent",
  "clientId": "...",
  "grantId": "...",
  "twinId": "...",
  "scopes": ["agent:context:read"],
  "expiresAt": "2026-05-26T00:00:00.000Z"
}
```

Writes audit event `agent_token.created`.

## Core Resources

### Client

Represents an external app, integration, or agent runtime.

Endpoints:

```http
POST /v1/clients
GET /v1/clients/:clientId
PATCH /v1/clients/:clientId
DELETE /v1/clients/:clientId
```

### Permission Grant

Represents user-approved delegated access.

Endpoints:

```http
POST /v1/twins/:twinId/grants
GET /v1/twins/:twinId/grants
GET /v1/twins/:twinId/grants/:grantId
DELETE /v1/twins/:twinId/grants/:grantId
```

### Twin

Represents the user's persistent intelligence layer.

Endpoints:

```http
POST /v1/twins
GET /v1/twins/:twinId
PATCH /v1/twins/:twinId
```

External clients should usually receive a limited Twin profile, not the full internal state.

### Source Artifact

Represents uploaded or connected source material.

Endpoints:

```http
POST /v1/twins/:twinId/artifacts
GET /v1/twins/:twinId/artifacts
GET /v1/twins/:twinId/artifacts/:artifactId
GET /v1/twins/:twinId/artifacts/:artifactId/events
POST /v1/twins/:twinId/artifacts/:artifactId/retry
DELETE /v1/twins/:twinId/artifacts/:artifactId
```

External clients can upload artifacts only when granted `artifact:upload`.

Raw artifact reads require `artifact:read_raw` and should be separately consented.

Retry failed ingestion:

```http
POST /v1/twins/:twinId/artifacts/:artifactId/retry
Authorization: Bearer <token>
```

The route requires `artifact:upload`, only accepts artifacts currently in `failed` state, resets `source_artifacts.ingestion_status` to `queued`, writes `artifact.retry_requested`, and republishes a processing job.

Live processing status:

```http
GET /v1/twins/:twinId/artifacts/:artifactId/events
Authorization: Bearer <token>
Accept: text/event-stream
```

The route returns Server-Sent Events for the artifact after upload. It writes the current database state first, then streams Redis-backed worker status updates until the artifact reaches a terminal state.

Event name:

```text
artifact.status
```

Event payload:

```json
{
  "artifactId": "...",
  "twinId": "...",
  "sourceType": "note",
  "status": "processing",
  "reason": "encrypted_decryption_failed",
  "occurredAt": "2026-05-20T19:01:24.846Z"
}
```

Clients should treat the upload response as a storage receipt only. The final ingestion result comes from this event stream or a later artifact status read.

First write endpoint:

```http
POST /v1/twins/:twinId/artifacts
Authorization: Bearer <token>
```

Preferred first-party JSON body:

```json
{
  "sourceType": "note",
  "encryptedPayload": {
    "ciphertextBase64": "...",
    "ciphertextSha256": "...",
    "seal": {
      "packageId": "0x...",
      "policyId": "0x...",
      "threshold": 1,
      "keyServerObjectIds": ["0x..."]
    }
  }
}
```

The first-party web app encrypts the complete source payload in the browser before calling the API. The encrypted payload contains the original title, content, and private metadata inside the ciphertext envelope, not as plaintext request fields.

Trusted server-side ingestion paths can still submit a plaintext source envelope for API-side encryption:

```json
{
  "sourceType": "note",
  "title": "Founder note",
  "content": "Raw text memory",
  "metadata": {}
}
```

Use this compatibility shape only when the API is the component fetching or constructing the private source material. Browser/mobile clients should use `encryptedPayload`.

Supported first-slice source types:

- `note` for manual text entry.
- `markdown` for `.md` / `.markdown` file content.
- `upload` for plain text file content.
- `pdf` for extracted PDF text.
- `ocr_pdf` for base64 PDF payloads that need worker-side OCR after encrypted storage.
- `image` for base64 screenshot/image payloads that need worker-side OCR after encrypted storage.
- `voice_note` for base64 audio file uploads. Supported first-slice formats are `.mp3`, `.m4a`, `.wav`, and `.webm`.
- `voice_conversation` for browser-recorded audio conversations. The web client records audio locally, base64-encodes the blob, and sends it through the same encrypted artifact route.
- `onboarding_self_description` for the user's open-ended "tell Sivraj about yourself" onboarding context. This is encrypted as private memory and enters the same background Twin learning pipeline.
- `browser_history` for explicit browser history export uploads.
- `docx` for extracted DOCX text today, and base64 DOCX content once binary upload support lands.
- `csv` for CSV file content.
- `email` for RFC822 `.eml` text content.
- `chat_export` for JSON or text chat exports.
- `slack_export` for Slack JSON exports.
- `whatsapp_export` for WhatsApp text exports.
- `github` for imported public GitHub repository context.

The route requires `artifact:upload`, requires token `twinId` to match path `twinId` unless the token is a service token, verifies client ciphertext hashes, stores ciphertext on Walrus, creates a queued source artifact, writes an audit event, and publishes a Redis/BullMQ processing job. It does not create a plaintext memory fragment for private memory.

Twin identity profile:

```http
GET /v1/twins/:twinId/identity-profile
PUT /v1/twins/:twinId/identity-profile
Authorization: Bearer <token>
```

Request:

```json
{
  "displayName": "Fortune Ogunsusi",
  "aliases": ["Fortune", "DDBoy"],
  "emails": ["ddboy19912@gmail.com"],
  "phones": ["+2348169342193"],
  "handles": {
    "github": ["ddboy19912"],
    "slack": ["@fortune"],
    "x": ["@fortune"]
  }
}
```

The identity profile is attribution infrastructure, not the user's private life story. It stores speaker-matching hints so future chat, email, Slack, WhatsApp, and voice imports can classify messages as `self`, `other`, `system`, or `unknown`. Open-ended onboarding context should still be submitted as encrypted `onboarding_self_description` memory.

Source-specific speaker mappings:

```http
GET /v1/twins/:twinId/artifacts/:artifactId/speaker-mappings
PUT /v1/twins/:twinId/artifacts/:artifactId/speaker-mappings
Authorization: Bearer <token>
```

Request:

```json
{
  "mappings": [
    {
      "sourceSpeaker": "Fortune",
      "sourceSpeakerId": "U123",
      "role": "self",
      "mappedName": "Fortune Ogunsusi"
    },
    {
      "sourceSpeaker": "Ada",
      "role": "other",
      "mappedName": "Ada Lovelace"
    }
  ]
}
```

Chat, Slack, and WhatsApp parsers record detected speaker labels in parser metadata when available. Speaker mappings let Sivraj resolve source-local labels such as `U123`, `Fortune`, or `Admin` before later speaker attribution and user-vs-other-party classification. Explicit source mappings override profile-based inference.

During worker processing, conversation imports are rewritten into attribution-aware memory text:

```text
self/Fortune: I want to lead with compliance.
other/Ada: That reduces procurement friction.
unknown/Client: Ship it.
```

The worker also records attribution counts under `metadata.processing.conversation`, including message count, speaker labels, role counts, unknown speakers, and mapped speaker count. Unknown speakers remain processable but should be treated cautiously by later memory extraction.

Memory extraction applies a user-vs-other-party boundary on attribution-aware conversation text. First-person claims from `self/*` can become user identity, preference, goal, or experience memories. First-person claims from `other/*` are rejected as user memories, `unknown/*` personal claims are downgraded, and `system/*` lines are ignored for candidate memories. Candidate memory metadata records the safe attribution role and policy only; raw evidence text remains outside Postgres.

Voice conversation review:

```http
GET /v1/twins/:twinId/conversations/:artifactId/review
POST /v1/twins/:twinId/conversations/:artifactId/summary
POST /v1/twins/:twinId/conversations/:artifactId/memories/review
Authorization: Bearer <token>
```

The review route returns a privacy-safe conversation review packet for a processed `voice_conversation` artifact. It includes artifact status, a deterministic safe summary, and candidate-memory review metadata. It does not decrypt or return raw transcript text, raw candidate statements, or private source content.

Summary generation encrypts the generated conversation summary through the private memory storage path and writes only `summaryStorageRef`, `summarySha256`, summary length, summary policy metadata, and audit records to Postgres.

Memory review accepts approve/reject actions:

```json
{
  "actions": [
    {
      "candidateId": "...",
      "action": "approve",
      "editedStatement": "Optional user-edited statement to store as the canonical memory"
    }
  ]
}
```

Approving or rejecting candidate memories writes `user_feedback_events` entries. If an approved action includes an edited statement, the API stores that edited voice-derived memory as a new encrypted artifact, queues normal artifact processing, and writes `conversation.approved_memory.stored`. The original voice transcript and candidate statement remain outside plaintext Postgres fields. Rejections are recorded as feedback and do not update the Twin.

GitHub public repository import:

```http
POST /v1/twins/:twinId/imports/github
Authorization: Bearer <token>
```

Request:

```json
{
  "repoUrl": "https://github.com/owner/repo"
}
```

The first version imports public repository context only. It fetches repository metadata plus selected text files such as README, docs, package metadata, and root config files, then encrypts the deterministic bundle before Walrus storage. Private repositories, GitHub OAuth, issues, pull requests, commit history, and recurring sync are later connector tasks.

Current PDF behavior: the web client extracts PDF text locally, encrypts the extracted source envelope in the browser, and submits only ciphertext through the artifact path. The original PDF binary is not yet stored as a separate encrypted raw file object.

Initial response:

```json
{
  "artifactId": "...",
  "memoryFragmentId": null,
  "status": "queued",
  "storageMode": "encrypted_walrus",
  "sensitivity": "private",
  "rawStorageRef": "walrus://blob/...",
  "processingJobId": "...",
  "warning": null
}
```

Current implementation note:

The manual note endpoint now fails closed unless Seal, Sui, and Walrus config is present. First-party writes encrypt private raw memory in the browser, store Seal-encrypted Walrus ciphertext, and persist `source_artifacts.raw_storage_ref` plus safe metadata in Postgres. Retrieval/decryption must apply permission policy before returning memory content.

Worker behavior:

- New encrypted private artifacts start as `queued`.
- The API publishes a `process-artifact` job to the Redis-backed `sivraj-artifact-processing` queue.
- The worker consumes queue jobs immediately and claims the corresponding artifact.
- On boot, the worker drains existing queued/pending/processing artifacts once so recoverable rows are not stranded after a restart.
- If Seal/Walrus decrypt config is unavailable, encrypted private artifacts are marked `pending` with `metadata.processing.reason = encrypted_decryption_required`.
- If Walrus read or Seal decrypt hits a retryable infrastructure error such as `fetch failed`, timeout, connection reset, 429, or 5xx, the worker keeps the artifact `pending` with `metadata.processing.reason = encrypted_decryption_retrying`, emits stage-aware logs, and throws to BullMQ so queue backoff can retry the job.
- If decrypt config is available, the worker reads ciphertext from Walrus, requests Seal key shares through the `owner_policy::seal_approve` Move policy, decrypts locally, creates a `memory_fragments` row, marks the artifact `completed`, and writes `artifact.processed`.
- Voice note and voice conversation artifacts are encrypted and stored first. After decrypt, the worker transcribes them when `SPEECH_TO_TEXT_API_KEY` or `LLM_API_KEY` is configured, creates a transcript-backed memory fragment, and records `metadata.processing.transcription`. If transcription is not configured, the worker marks them `pending` with `metadata.processing.reason = speech_to_text_required`.
- Voice conversation transcripts use conversation-aware memory extraction during background Twin learning. The extractor prefers durable goals, decisions, preferences, commitments, follow-ups, relationships, and project updates; ordinary transcript filler is ignored. Candidate memories are stored through the encrypted candidate-memory batch path and tagged with `sourceKind = conversation`, `conversationSourceType = voice_conversation`, `voiceDerived = true`, and safe count metadata under `conversationUnderstanding`.
- Project clustering runs during background Twin learning. The worker creates or updates `project` graph nodes from deterministic project signals such as extracted project/product entities and project-like candidate-memory subjects, then links the source artifact and related entities to that project context. The cluster metadata records counts, method, and signal names; it does not store decrypted private memory text.
- Decision extraction also runs during background Twin learning. Candidate memories with `memoryType = decision` create private-safe `decision` graph nodes named by statement hash, not plaintext. The worker links the source artifact to the decision with `records_decision`, links project context with `project_decision` where a subject is available, and stores only hashes, subject, confidence, evidence length, candidate memory ID, and safe metadata in Postgres.
- Goal inference runs through the same private-safe graph path. Candidate memories with `memoryType = goal` create `goal` graph nodes named by statement hash, then link the source artifact with `states_goal` and project context with `project_goal` when a subject is available. Goal statement text remains only in encrypted candidate-memory storage.
- Pattern detection is implemented as a versioned intelligence engine under `@sivraj/intelligence/patterns`. The worker provides current and recent historical candidate-memory signals, and detectors return private-safe pattern instructions. The first detector creates repeated-subject patterns for goals, decisions, preferences, and project activity. Pattern graph nodes use `nodeType = other`, `properties.kind = pattern`, hash-based names, evidence counts, source/candidate IDs, and safe signal metadata; plaintext pattern narratives are not stored in Postgres.
- User feedback is captured through `POST /v1/twins/:twinId/feedback` with `memory:read` scope. Feedback can target candidate memories, graph nodes, patterns, insights, reflections, or source artifacts. Candidate-memory `approved` / `rejected` feedback updates candidate status. Freeform plaintext correction notes are intentionally rejected on this endpoint; richer corrections should use a future encrypted feedback artifact path.
- Weekly reflection generation is on-demand, not cron-first. `POST /v1/twins/:twinId/reflections/weekly` creates or reuses a weekly `reflection_runs` row, enqueues the `sivraj-weekly-reflection` worker job, and returns `202` with `reflectionRunId` and `jobId`. `GET /v1/twins/:twinId/reflections` lists reflection run status and storage refs. The reflection body is encrypted through the private fragment storage path and stored by ref in `reflection_runs.summary_storage_ref`; Postgres keeps status, period, refs, hashes, timing, provider/model, and counts only.
- Audit metadata records storage refs and fragment IDs, but not decrypted content.

Live upload acceptance is not complete on UI success alone. Confirm:

- `source_artifacts.id` matches response `artifactId`.
- `source_artifacts.raw_storage_ref` matches response `rawStorageRef`.
- `source_artifacts.metadata.storageMode = encrypted_walrus`.
- `source_artifacts.metadata.sensitivity = private`.
- `source_artifacts.metadata.ciphertextSha256` exists.
- `source_artifacts` has no plaintext title column for private artifact names.
- `audit_events` has `event_type = artifact.created` for the artifact.
- `memory_fragments` has exactly one row for this artifact after worker processing completes.
- plaintext note content does not appear in `source_artifacts.metadata`.

See [Seal policy smoke test](./SEAL_POLICY.md#live-manual-memory-smoke-test).

### Intelligence Testing Console

The current web UI can include a temporary testing console before final product redesign. This console is not the canonical consumer UX; it exists so local testing can verify the intelligence track without constantly switching to Beekeeper.

Recommended POC pages:

- **Ingestion Test:** manual note, file upload, voice note, and voice conversation submission against `POST /v1/twins/:twinId/artifacts`.
- **Artifact Status:** live artifact status, processing state, intelligence state, worker timing metadata, and retry action.
- **Retrieval Test:** query box for `POST /v1/twins/:twinId/memories/search` with citations.
- **Candidate Review:** list candidate memories by safe metadata, show storage refs/hashes, approve/reject with `POST /v1/twins/:twinId/feedback`.
- **Graph Inspector:** list graph nodes and edges for projects, goals, decisions, concepts, and patterns.
- **Weekly Reflection:** call `POST /v1/twins/:twinId/reflections/weekly`, then list runs with `GET /v1/twins/:twinId/reflections`.
- **Privacy Check:** show storage refs, ciphertext hashes, processing metadata, and a checklist that private content is stored by encrypted refs rather than plaintext DB columns.

API verification remains part of the test plan. The UI proves end-to-end usability; direct API/DB checks prove contracts, privacy boundaries, and failure modes.

### Memory Fragment

Represents a retrievable unit of memory.

Endpoints:

```http
GET /v1/twins/:twinId/memories
GET /v1/twins/:twinId/memories/:memoryId
POST /v1/twins/:twinId/memories
PATCH /v1/twins/:twinId/memories/:memoryId
POST /v1/twins/:twinId/memories/search
```

External clients should prefer context packets over direct memory reads.

First retrieval endpoint:

```http
POST /v1/twins/:twinId/memories/search
Authorization: Bearer <token>
```

Request:

```json
{
  "query": "launch UI polish",
  "limit": 5
}
```

Rules:

- Requires `memory:read`.
- Requires token `twinId` to match path `twinId` unless token type is `service`.
- Searches processed `memory_fragments`. Private fragments are stored as encrypted Walrus refs and decrypted only inside this authenticated route before ranking.
- Returns ranked memory fragments with citations.
- Does not return raw Walrus artifacts.
- Writes `memory.search` audit event.

Current ranking is local lexical-semantic scoring over terms, summaries, confidence, importance, and recency. MemWal/vector ranking can replace the scorer behind the same API contract later.

### Cognitive Graph

Represents the user's identity graph.

Endpoints:

```http
GET /v1/twins/:twinId/graph
GET /v1/twins/:twinId/graph/nodes/:nodeId
GET /v1/twins/:twinId/graph/edges
POST /v1/twins/:twinId/graph/query
```

Graph output must be scoped by permission and may omit private nodes or edges.

### Context Packet

Represents scoped context returned to an AI system.

Endpoints:

```http
GET /v1/twins/:twinId/engineering/context
POST /v1/twins/:twinId/context
GET /v1/twins/:twinId/context/:contextPacketId
POST /v1/twins/:twinId/context/:contextPacketId/feedback
```

First implemented coding-agent endpoint:

```http
GET /v1/twins/:twinId/engineering/context
GET /v1/twins/:twinId/engineering/sources
GET /v1/twins/:twinId/engineering/review-queue
POST /v1/twins/:twinId/engineering/review-queue/:candidateId/action
POST /v1/twins/:twinId/engineering/instruction-patch
Authorization: Bearer <token>
```

Query options:

- `projectId`, `projectName`: optional labels for the returned packet.
- `repoName`, `packageName`, `gitRemote`: optional current-repo identity signals.
- `packageManager`: optional current package manager, such as `pnpm`, `npm`, `yarn`, or `bun`.
- `frameworks`, `lockfiles`, `rootMarkers`: optional comma-separated current-repo fingerprints.
- `artifactId`: optional artifact-scoped engineering context.
- `includeCandidate=true`: include candidate engineering memories for testing/review context.
- `includeSuperseded=true`: include superseded rules.
- `includeTemporary=true`: include short-lived task rules.
- `preset`: optional export renderer. Allowed values: `codex`, `claude_code`, `cursor`, `generic_mcp`.
- `maxItemsPerSection`: bounded section size.

Rules:

- Requires `memory:read`.
- Requires token `twinId` to match path `twinId` unless token type is `service`.
- Returns an agent-ready `coding_agent_context` packet.
- Returns `contextMarkdown` for backward compatibility.
- Returns `contextExport`, a preset-aware one-click export with `preset`, `format`, `targetFile`, and `content`.
- Ranks repo-matching context above generic or unrelated context.
- Returns context conflict issues when exported rules disagree, such as pnpm vs npm or Vite vs Next.js.
- Returns context quality scoring so clients can distinguish strong, usable, weak, and risky packets before handoff.
- Does not decrypt or return raw memory statements.
- May return short derived engineering context lines that were intentionally extracted for coding-agent use.
- Returns evidence refs, hashes, scopes, subjects, confidence, status, and safe metadata only.

Instruction source registry:

```http
GET /v1/twins/:twinId/engineering/sources
Authorization: Bearer <token>
```

Returns the private-safe engineering sources Sivraj has consumed, such as `AGENTS.md`, `CLAUDE.md`, Cursor rules, repo docs, and coding preference notes. It does not return raw file bodies. It returns source artifact IDs, file names, ingestion/intelligence status, encrypted storage refs, extracted engineering-memory counts, derived context lines, and evidence IDs.

Engineering review queue:

```http
GET /v1/twins/:twinId/engineering/review-queue
Authorization: Bearer <token>
```

Returns stale or conflicting engineering instructions that should be reviewed before agent handoff. It uses the same repo fingerprint query options as `/engineering/context` and returns only derived context lines, evidence IDs, safe metadata, issue reasons, and quality impact.

Review action:

```http
POST /v1/twins/:twinId/engineering/review-queue/:candidateId/action
Authorization: Bearer <token>
Content-Type: application/json

{ "action": "keep_active" }
```

Allowed actions:

- `keep_active`: marks the candidate memory `approved`.
- `supersede`: marks it `superseded`.
- `reject`: marks it `rejected`.
- `needs_review`: keeps it as `candidate` and records review feedback.

Instruction patch generation:

```http
POST /v1/twins/:twinId/engineering/instruction-patch
Authorization: Bearer <token>
Content-Type: application/json

{
  "preset": "codex",
  "targetFile": "AGENTS.md",
  "projectName": "Sivraj",
  "repoName": "sivraj",
  "packageManager": "pnpm",
  "frameworks": ["vite", "react"],
  "includeCandidate": false
}
```

Returns a suggested export body generated from source-backed engineering context. Supported presets:

- `codex`: `AGENTS.md` Markdown.
- `claude_code`: `CLAUDE.md` Markdown.
- `cursor`: `.cursor/rules/sivraj.mdc` rule file.
- `generic_mcp`: `sivraj-context.json` structured JSON.

It never writes to the repo automatically, never includes raw private memory, and omits candidate rules by default.

Example request:

```bash
curl "$API_URL/v1/twins/$TWIN_ID/engineering/context?projectName=Sivraj&repoName=sivraj&packageName=sivraj&packageManager=pnpm&frameworks=vite,react&includeCandidate=true" \
  -H "authorization: Bearer $TOKEN"
```

Example response:

```json
{
  "policy": {
    "rawArtifactsIncluded": false,
    "decryptedMemoryIncluded": false,
    "plaintextStatementsIncluded": false,
    "derivedEngineeringContextIncluded": true,
    "scope": "memory:read",
    "agentScopesAccepted": ["agent:context:read", "agent:project_profile:read"]
  },
  "relationship": {
    "sivraj": "Remembers encrypted engineering context, synthesizes durable preferences, and exports source-backed packets.",
    "codingAgents": "Execute coding tasks inside tools such as Codex, Claude Code, Cursor, or custom agents.",
    "handoff": "Use contextMarkdown or contextPacket as portable agent context. Future connectors can automate this handoff."
  },
  "contextPacket": {
    "purpose": "coding_agent_context",
    "project": {
      "id": null,
      "name": "Sivraj",
      "repoFingerprint": {
        "projectId": null,
        "projectName": "Sivraj",
        "repoName": "sivraj",
        "packageName": "sivraj",
        "gitRemote": null,
        "packageManager": "pnpm",
        "frameworks": ["vite", "react"],
        "lockfiles": [],
        "rootMarkers": []
      }
    },
    "sections": {
      "agentInstructions": [
        {
          "id": "candidate-memory-id",
          "type": "agent_instruction",
          "scope": "agent_specific",
          "subject": "git safety",
          "status": "candidate",
          "evidence": {
            "candidateMemoryId": "candidate-memory-id",
            "sourceArtifactId": "artifact-id"
          }
        }
      ]
    },
    "issues": [],
    "quality": {
      "score": 0.76,
      "label": "good",
      "readyForAgent": true,
      "strengths": ["Context is source-backed with evidence references."],
      "risks": [],
      "recommendations": ["Packet is suitable for coding-agent handoff; keep reviewing new candidate memories as they arrive."],
      "metrics": {
        "totalItems": 1,
        "approvedOrActiveItems": 0,
        "candidateItems": 1,
        "evidenceRefs": 1,
        "issueCount": 0,
        "highSeverityIssueCount": 0,
        "repoMatchedItems": 1,
        "weakUnknownSourceItems": 0,
        "sectionCoverage": 0.11
      }
    }
  },
  "contextMarkdown": "# Sivraj Coding Agent Context\n\nUse this as persistent engineering context from Sivraj...",
  "profileSummary": {
    "totalEngineeringMemories": 1,
    "includedContextItems": 1,
    "evidenceRefs": 1,
    "warnings": []
  }
}
```

### Insight

Represents synthesized intelligence.

Endpoints:

```http
POST /v1/twins/:twinId/insights
GET /v1/twins/:twinId/insights
GET /v1/twins/:twinId/insights/:insightId
POST /v1/twins/:twinId/insights/:insightId/feedback
```

### Agent Writeback

Represents observations or generated context that an agent wants to add to the Twin.

Endpoints:

```http
POST /v1/twins/:twinId/agents/writebacks
POST /v1/twins/:twinId/agents/writebacks/imports/pr
POST /v1/twins/:twinId/agents/writebacks/imports/commit
GET /v1/twins/:twinId/agents/writebacks
POST /v1/twins/:twinId/agents/writebacks/:writebackId/approve
POST /v1/twins/:twinId/agents/writebacks/:writebackId/reject
```

`POST /agents/writebacks` requires `agent:writeback:create` or `artifact:upload`. It encrypts the writeback and stores only a pending review record. The raw writeback body is not stored in Postgres.

Approval requires the user/service `memory:read` scope. Approval creates the encrypted private `note` artifact, queues normal processing, and writes `agent.writeback.approved`. Rejection writes `agent.writeback.rejected` and does not enter ingestion.

Example request:

```json
{
  "agentName": "Codex",
  "repo": "sivraj",
  "branch": "main",
  "taskSummary": "Implemented MCP server tools for coding-agent context.",
  "filesTouched": ["apps/mcp-server/src/index.ts"],
  "commandsRun": ["pnpm --filter @sivraj/mcp-server test"],
  "testsRun": ["pnpm --filter @sivraj/mcp-server test"],
  "decisions": ["MCP calls Sivraj API instead of reading Postgres directly."],
  "followUps": ["Add delegated token revocation UI."]
}
```

Agent writebacks become encrypted artifacts only after approval. They then become candidate engineering memories through the normal intelligence pipeline, so coding-agent output does not silently pollute the Twin.

PR/commit import requests use the same pending-review boundary:

```json
{
  "agentName": "Codex",
  "repo": "sivraj",
  "number": 42,
  "title": "Fix memory search",
  "summary": "Stopped retrieval from decrypting too many fragments.",
  "filesChanged": ["apps/api/src/routes/memories.ts"],
  "reviewComments": ["Avoid fallback-only fixes."],
  "testsRun": ["pnpm --filter @sivraj/api test"]
}
```

The response includes `writebackId`, `kind`, `status`, `rawStorageRef`, and `warning: "agent_writeback_pending_review"`. The imported body is encrypted before durable storage; Postgres keeps only safe metadata, hashes, counts, and storage refs.

### Agent Clients

```http
GET /v1/twins/:twinId/agents/clients
POST /v1/twins/:twinId/agents/clients/:grantId/revoke
```

These endpoints require `memory:read`. They expose scoped coding-agent grants, expiry/revocation state, and safe client metadata. Revocation is audited with `agent_client.revoked`.

Agent-scoped reads and writebacks check that the delegated grant is still active before serving context, search, sources, or writeback submission. For context assembly and search, the API checks both the JWT scope and the persisted grant scopes so a narrowed/revoked grant blocks stale tokens.

### Audit Event

Represents access, context creation, permission changes, and writebacks.

Endpoints:

```http
GET /v1/twins/:twinId/audit-events
GET /v1/twins/:twinId/audit-events/:eventId
```

## External Context Contract

Every external context response should include:

- Context packet ID.
- Requester identity.
- Scope.
- Purpose.
- Summary.
- Selected memories.
- Selected graph nodes and edges.
- Citations.
- Confidence.
- Expiration.
- Policy metadata.

Every external context response should exclude:

- Memories outside scope.
- Raw private archives unless explicitly approved.
- Unrelated private graph nodes.
- Decryption material.
- Unbounded Walrus object access.

## Webhooks

Events:

- `artifact.ingested`
- `memory.created`
- `graph.updated`
- `insight.created`
- `context.created`
- `grant.created`
- `grant.revoked`
- `agent_writeback.created`
- `agent_writeback.approved`
- `agent_writeback.rejected`

Webhook deliveries should be signed.

## Rate Limits

Rate limits should consider:

- Client.
- User.
- Scope.
- Endpoint.
- Cost of retrieval or synthesis.
- Abuse risk.

High-trust clients can receive higher limits, but no client should bypass permission checks.

## Versioning

Use explicit API versioning:

```http
/v1/...
```

Breaking changes require a new version.

SDKs should pin API versions.

## API Principles

- The external API is a product surface, not implementation plumbing.
- Permissions are evaluated before retrieval output is assembled.
- Context packets are auditable and expire by default.
- Every memory and insight should preserve citations.
- Agents must identify themselves and declare purpose.
- The server should downscope requests when scope is too broad.
- Raw artifact access requires explicit consent.
- Walrus references are sensitive when they point to private memory.
- Seal-protected content must only be decrypted after policy approval.
- External clients should receive least-privilege context, never the whole Twin.
