# API Design

## API Goal

The Sivraj API lets apps and agents request scoped, relevant context from a user's Twin.

The API should never expose everything by default. It should return bounded context packets filtered by permissions.

## Core Resources

### Twin

Represents the user's persistent intelligence layer.

Endpoints:

```http
POST /twins
GET /twins/:twinId
PATCH /twins/:twinId
```

### Source Artifact

Represents uploaded or connected source material.

Endpoints:

```http
POST /twins/:twinId/artifacts
GET /twins/:twinId/artifacts
GET /twins/:twinId/artifacts/:artifactId
DELETE /twins/:twinId/artifacts/:artifactId
```

### Memory Fragment

Represents a retrievable memory unit extracted from source material.

Endpoints:

```http
GET /twins/:twinId/memories
GET /twins/:twinId/memories/:memoryId
PATCH /twins/:twinId/memories/:memoryId
```

### Graph

Represents the user's cognitive graph.

Endpoints:

```http
GET /twins/:twinId/graph
GET /twins/:twinId/graph/nodes/:nodeId
GET /twins/:twinId/graph/edges
```

### Context Packet

Represents scoped context returned to an AI system.

Endpoints:

```http
POST /twins/:twinId/context
GET /twins/:twinId/context/:contextPacketId
```

Example request:

```json
{
  "query": "What architecture decisions should the coding agent know before editing the app?",
  "requester": {
    "type": "agent",
    "id": "coding-agent-demo"
  },
  "scope": "coding_agent",
  "maxTokens": 4000
}
```

Example response:

```json
{
  "id": "ctx_123",
  "scope": "coding_agent",
  "summary": "Relevant roadmap, architecture preferences, and prior implementation decisions.",
  "memories": [
    {
      "id": "mem_123",
      "content": "The user prefers a TypeScript-first stack and small provider adapters.",
      "citation": {
        "sourceArtifactId": "src_123",
        "title": "Development Setup"
      }
    }
  ],
  "expiresAt": "2026-05-15T00:00:00Z"
}
```

### Insight

Represents synthesized intelligence.

Endpoints:

```http
POST /twins/:twinId/insights
GET /twins/:twinId/insights
GET /twins/:twinId/insights/:insightId
POST /twins/:twinId/insights/:insightId/feedback
```

## API Principles

- Permissions are evaluated before retrieval output is assembled.
- Context packets are auditable and expire by default.
- Every memory and insight should preserve citations.
- Agents should identify themselves and declare requested scope.
- The server should downscope requests when scope is too broad.

