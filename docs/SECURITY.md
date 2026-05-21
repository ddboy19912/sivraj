# Security and Permissions

## Security Thesis

Sivraj stores a user's most sensitive long-term context. Trust is not a feature. It is the foundation of the product.

The user's Sui wallet is the root identity. API sessions are temporary access tokens, not the ownership source.

The user must own:

- Memory.
- Permissions.
- Encryption keys.
- AI access rights.

## Permission Principles

- Default private.
- Wallet ownership first.
- Short-lived API sessions.
- Least privilege for every agent.
- User-visible access grants.
- Revocable access.
- Auditable context sharing.
- No agent receives everything by default.

## Access Scopes

### Private

Only the user can access this memory.

### Coding Agent

Can access:

- GitHub context.
- Architecture decisions.
- Coding preferences.
- Product roadmap.
- Engineering constraints.

Cannot access:

- Therapy notes.
- Tax documents.
- Private journals unless explicitly allowed.

### Research Agent

Can access:

- Research notes.
- Reading history.
- Product questions.
- Prior conclusions.

### Strategy Agent

Can access:

- Goals.
- Projects.
- Investor notes.
- Founder reflections.
- Roadmap and prioritization context.

### Finance Agent

Can access:

- Finance documents.
- Tax records.
- Budget notes.

### Therapy or Reflection Agent

Can access:

- Emotional journals.
- Reflection notes.
- Personal patterns.

## Encryption

Seal should be used for:

- Encrypted private memory.
- Scoped decryption.
- Agent-specific access.
- Confidential coordination.

## Walrus Persistence Security

Walrus is a core part of Sivraj's security architecture, not a passive storage bucket.

Sivraj relies on Walrus for:

- Persistent memory blobs.
- Uploaded archives.
- Long-term identity state snapshots.
- Agent histories.
- Reasoning traces.
- Verifiable references to user-owned context.

Security rule:

> Walrus stores durable cognitive state, but access to that state is governed by Sivraj permissions, Seal encryption, and user-owned identity.

### Walrus Storage Boundary

Data written to Walrus should be treated as long-lived and portable. Therefore:

- Sensitive blobs must be encrypted before they are written to Walrus.
- The app database should store Walrus references, metadata, hashes, and access policies.
- Raw plaintext private memory should not be written to Walrus.
- Agents should receive scoped context packets, not direct unrestricted Walrus blob access.
- Walrus object references should be considered sensitive when they point to private memory.

### Current Implementation Status

The current manual note endpoint is a development foundation. Private raw artifacts and derived memory fragments now use encrypted Walrus storage.

This is not the final private-memory storage model.

Legacy dev-only labels:

- `storageMode: "dev_plaintext"`
- `sensitivity: "private"` by default
- `source_artifacts.raw_storage_ref: null`

That path may create `source_artifacts`, `memory_fragments`, and `audit_events` only for local testing. It is unsafe for real user data.

Current private manual memory writes:

- Encrypt raw content with Seal before durable storage.
- Store ciphertext on Walrus.
- Store `source_artifacts.raw_storage_ref` and encryption/storage metadata in Postgres.
- Do not persist private artifact titles as plaintext columns.
- Do not persist private upload names or user-supplied metadata as plaintext Postgres metadata.
- Do not create plaintext memory fragment content or summary columns.
- Store derived memory fragments as encrypted Walrus refs via `memory_fragments.content_storage_ref`.
- Fail closed when Seal, Sui, or Walrus config is missing.

Current implementation note: first-party web uploads are encrypted in the browser before they are sent to the API. The API accepts a client-encrypted payload, verifies the ciphertext hash, stores ciphertext on Walrus, and persists only storage references plus safe processing metadata. API-side encryption remains available for trusted server-side ingestion paths such as public GitHub import, where the API itself fetches the source material before durable storage.

Native mobile clients must follow the same boundary: encrypt in the app runtime before sending private memory to Sivraj APIs. Mobile does not need browser crypto specifically; it needs equivalent app-side Seal encryption.

### Private Memory Storage Boundary

Dev path:

- Manual note ingestion may store plaintext in Postgres for local testing only.
- The route must return and persist dev labels so clients cannot mistake it for production-safe storage.
- Manual memory UI should wait for encrypted storage or display a clear dev-only warning.

Production path:

- Raw private memory must be encrypted before durable storage.
- Ciphertext must be persisted through Walrus.
- `source_artifacts.raw_storage_ref` must point to the encrypted Walrus blob or reference metadata.
- Postgres stores metadata, references, audit, processing state, graph records, and index records.
- Postgres is not the primary private raw-memory vault.

Retrieval rule:

- No memory content leaves Sivraj without authentication and permission policy checks.
- Agents receive scoped context packets, not unrestricted memory blob access.

Before any real user/private beta:

- Raw manual memory content must be encrypted before durable storage.
- Encrypted raw content must be stored through the Walrus adapter.
- Postgres should store metadata, processing state, memory fragments, audit records, and Walrus references.
- Sensitive memory fragments must be encrypted before persistence; summaries/previews must not be stored as plaintext unless a future policy explicitly classifies them as non-sensitive.
- Retrieval must apply permission policy before returning any memory content.

### Walrus and Seal

Walrus and Seal work together:

- Walrus provides durable, portable memory persistence.
- Seal provides encryption and scoped decryption.
- Sivraj policies decide who may request access.

Example:

1. User uploads a private founder journal.
2. Sivraj encrypts the blob with Seal.
3. Encrypted blob is persisted on Walrus.
4. Sivraj stores the Walrus reference, ciphertext hash, safe system metadata, and access policy.
5. A strategy agent requests relevant context.
6. Sivraj checks policy before retrieving and decrypting only approved fragments.
7. The agent receives a bounded context packet, not blanket access to the Walrus object.

### Walrus Verification

Walrus should be used to strengthen provenance and integrity:

- Store content hashes for uploaded archives and processed memory blobs.
- Preserve source artifact references.
- Link memory fragments and insights back to durable evidence.
- Detect tampering or mismatches between metadata and stored blobs.
- Support future portability of a user's Twin across apps and agents.

### Walrus Deletion and Revocation

Because Walrus is designed for persistence, deletion semantics must be explicit.

Sivraj should support:

- Revoking app and agent access immediately.
- Deleting local metadata, indexes, and graph links.
- Destroying or rotating encryption keys for encrypted blobs when full erasure is required.
- Marking Walrus-backed memories as revoked or inaccessible.
- Explaining to users when decentralized persistence changes deletion guarantees.

For private memory, effective deletion should rely on metadata removal plus cryptographic access removal when underlying persistence cannot be physically reversed.

## Audit Log

Every context access should record:

- Requester.
- Scope.
- Query.
- Memory IDs accessed.
- Graph nodes accessed.
- Walrus references accessed, when applicable.
- Time.
- Expiration.
- Whether user explicitly approved.

## Data Rights

Users must be able to:

- Export their data.
- Delete their data.
- Revoke agent access.
- Inspect memory provenance.
- Inspect which agents accessed what.

## Threats to Consider

- Prompt injection from uploaded documents.
- Over-broad context sharing.
- Agent impersonation.
- Unauthorized memory export.
- Leakage of private Walrus object references.
- Unencrypted sensitive data written to Walrus.
- Confusion between revoking access and physically deleting persistent blobs.
- Sensitive memories appearing in unrelated contexts.
- Model provider data retention.
- Compromised API keys.

## Baseline Security Requirements

- Require authentication.
- Verify Sui wallet ownership before issuing user sessions.
- Store secrets outside source control.
- Add per-memory access scope.
- Apply permission filters before retrieval.
- Log every context packet.
- Treat the current plaintext manual-memory path as development-only.
- Encrypt sensitive blobs before Walrus persistence.
- Store Walrus references separately from decrypted memory text.
- Never give agents unrestricted direct access to private Walrus objects.
- Never expose raw private archives to agents by default.
