# External Integrations

Sivraj is designed to make external AI tools more useful without giving them unrestricted access to private memory.

## Integration Principle

External tools should receive scoped context packets, not raw memory dumps. Every integration should be bounded by:

- User identity.
- Permission scope.
- Purpose.
- Source-backed evidence.
- Revocation and audit requirements.

## Current Integration Surfaces

### Web App

The web app is the primary first-party surface for onboarding, memory management, uploads, chat, provider settings, and permissions.

### API

The API is the primary integration contract for applications and agents that need permissioned context from a Twin.

See [API Usage](./API.md).

### CLI

The CLI is intended for developer workflows, local capture, scripting, and future agent handoff.

### MCP Server

The MCP server is the integration path for MCP-compatible tools. Its job is to expose bounded Sivraj capabilities to agents without bypassing user permission boundaries.

### Coding Agents

Coding agents should receive engineering context packets that are relevant to the current repository or task. They should not receive unrelated private memory by default.

## Planned Integrations

- SDKs for JavaScript and Python.
- Desktop capture and context review.
- Mobile companion capture.
- Additional document and productivity connectors.
- Agent writeback flows where user-reviewed outputs can become new memory.

## Integration Safety

An integration should be considered unsafe if it:

- Requests all user memory by default.
- Stores raw private context outside Sivraj without user approval.
- Cannot explain why each context item was included.
- Cannot be revoked.
- Cannot distinguish source evidence from inferred memory.
