# Security And Permissions

Sivraj stores sensitive long-term context. Security and user control are core product requirements, not optional add-ons.

## Principles

- Memory is private by default.
- Integrations use least-privilege access.
- Users should know when memory is being used.
- Access should be revocable.
- External tools should receive scoped context, not unrestricted memory.
- Source references should be preserved where possible.

## Identity

Sivraj uses wallet-backed identity as the ownership root. API sessions are access mechanisms, not the source of ownership.

## Permission Model

Permission checks should happen before private context is retrieved or returned. A client should only receive context that matches its allowed scopes and stated purpose.

## Sensitive Data

Do not publish:

- Real environment values.
- Private keys or wallet seeds.
- Provider tokens.
- Private deployment identifiers.
- Raw user memory.
- Internal incident notes.
- Unreviewed product decision logs.

## Integration Safety

Approved integrations should be able to explain:

- What context they requested.
- Why it was needed.
- Which permission allowed it.
- How the user can revoke access.
