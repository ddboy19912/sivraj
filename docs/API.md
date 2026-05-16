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
  "userId": "...",
  "twinId": "...",
  "walletAddress": "0x..."
}
```

The JWT is a short-lived API session token. It is not the source of ownership.

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

Raw artifact access should be rare and separately approved.

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
DELETE /v1/twins/:twinId/artifacts/:artifactId
```

External clients can upload artifacts only when granted `artifact:upload`.

Raw artifact reads require `artifact:read_raw` and should be separately consented.

First write endpoint:

```http
POST /v1/twins/:twinId/artifacts
Authorization: Bearer <token>
```

Initial JSON body:

```json
{
  "sourceType": "note",
  "title": "Founder note",
  "content": "Raw text memory",
  "metadata": {}
}
```

The route requires `artifact:upload`, requires token `twinId` to match path `twinId` unless the token is a service token, encrypts private note content with Seal, stores ciphertext on Walrus, creates a queued source artifact, and writes an audit event. It does not create a plaintext memory fragment for private manual memory.

Initial response:

```json
{
  "artifactId": "...",
  "memoryFragmentId": null,
  "status": "queued",
  "storageMode": "encrypted_walrus",
  "sensitivity": "private",
  "rawStorageRef": "walrus://blob/...",
  "warning": null
}
```

Current implementation note:

The manual note endpoint now fails closed unless Seal, Sui, and Walrus config is present. The current write path stores private raw memory as Seal-encrypted Walrus ciphertext and persists `source_artifacts.raw_storage_ref` plus metadata in Postgres. Retrieval/decryption is a separate future path and must apply permission policy before returning memory content.

### Memory Fragment

Represents a retrievable unit of memory.

Endpoints:

```http
GET /v1/twins/:twinId/memories
GET /v1/twins/:twinId/memories/:memoryId
POST /v1/twins/:twinId/memories
PATCH /v1/twins/:twinId/memories/:memoryId
```

External clients should prefer context packets over direct memory reads.

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
POST /v1/twins/:twinId/context
GET /v1/twins/:twinId/context/:contextPacketId
POST /v1/twins/:twinId/context/:contextPacketId/feedback
```

Example request:

```json
{
  "query": "What architecture decisions should the coding agent know before editing the app?",
  "requester": {
    "type": "agent",
    "id": "coding-agent"
  },
  "purpose": "code_generation",
  "scope": "memory:read_coding",
  "maxTokens": 4000,
  "includeCitations": true
}
```

Example response:

```json
{
  "id": "ctx_123",
  "scope": "memory:read_coding",
  "purpose": "code_generation",
  "summary": "Relevant roadmap, architecture preferences, and prior implementation decisions.",
  "memories": [
    {
      "id": "mem_123",
      "content": "The user prefers a TypeScript-first stack and small provider adapters.",
      "citation": {
        "sourceArtifactId": "src_123",
        "title": "Development Setup",
        "walrusRef": "walrus://encrypted/blob/ref"
      },
      "confidence": 0.91
    }
  ],
  "graph": {
    "nodes": ["project_sivraj", "goal_agent_context_layer"],
    "edges": ["project_sivraj->depends_on->goal_agent_context_layer"]
  },
  "policy": {
    "rawArtifactsIncluded": false,
    "expiresAt": "2026-05-15T00:00:00Z"
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
POST /v1/twins/:twinId/agent-writebacks
GET /v1/twins/:twinId/agent-writebacks
POST /v1/twins/:twinId/agent-writebacks/:writebackId/approve
POST /v1/twins/:twinId/agent-writebacks/:writebackId/reject
```

Agent writebacks should be reviewable before becoming durable memory unless the user has explicitly granted trusted write access.

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
