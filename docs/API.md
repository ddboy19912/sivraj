# API Usage

The Sivraj API lets approved apps and agents request scoped context from a user's Twin. It is designed for permissioned memory access, source-backed retrieval, and integration workflows.

The API should not expose all memory by default. Clients request bounded context for a clear purpose, and Sivraj returns only the context the user has allowed.

## Core Concepts

- **Twin:** the user's persistent memory and context layer.
- **Context packet:** a bounded response containing relevant context and source references.
- **Source artifact:** a document, note, chat export, or other user-provided source.
- **Permission scope:** the access boundary that determines what an app or agent can request.

## Typical Flow

1. Authenticate the user.
2. Resolve the active Twin.
3. Request scoped context for a task.
4. Use citations or evidence references in the downstream answer.
5. Submit new memory only through approved writeback flows.

## Example Context Request

```http
POST /v1/twins/:twinId/context
Content-Type: application/json
Authorization: Bearer <token>
```

```json
{
  "purpose": "answer_user_question",
  "query": "What context should I remember before working on this project?",
  "scopes": ["memory:read", "documents:read"],
  "limit": 8
}
```

Example response shape:

```json
{
  "context": [
    {
      "id": "ctx_123",
      "summary": "Relevant source-backed context for the request.",
      "sourceRefs": ["src_456"],
      "confidence": "medium"
    }
  ],
  "next": null
}
```

Endpoint names and response fields may evolve while the API is early. Keep client integrations defensive: handle missing optional fields, empty context, permission errors, and retryable processing states.

## Integration Rules

- Request the narrowest scope that can satisfy the task.
- Show users when an integration is using memory.
- Preserve source references when generating downstream answers.
- Treat absence of context as a valid response.
- Do not store raw private context outside Sivraj unless the user explicitly approves it.

## Error Handling

Clients should expect:

- `401` when the session is missing or expired.
- `403` when the requested scope is not allowed.
- `404` when the Twin or source is unavailable to the caller.
- `409` when context is still processing or not ready.
- `429` when provider or API limits are reached.
- `5xx` for retryable service failures.

Use retries only for retryable states. Permission and scope errors require user action.
