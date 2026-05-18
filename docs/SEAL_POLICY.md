# Seal Policy Package

Sivraj uses Mysten Seal for threshold encryption. The Move package in `contracts/sivraj_seal_policy` defines Sivraj's app-specific access policy for decryption approval.

## Current Testnet Policy

The first policy is intentionally narrow:

- one shared `OwnerPolicy` object,
- one owner wallet address,
- decryption approval only when transaction sender is the owner,
- Seal identity must be namespaced under the policy object ID.

This supports first live manual-memory smoke testing. It is not the final multi-user permission model.

## Why Shared Object

Seal key servers verify approval by dry-running transaction bytes that call `seal_approve`. A shared policy object lets the wallet/session that requests decryption reference the same policy object without owning it directly.

## Environment Mapping

After testnet deployment:

```env
SEAL_PACKAGE_ID=<published Move package ID>
SEAL_POLICY_ID=<shared OwnerPolicy object ID>
SEAL_KEY_SERVERS=<comma-separated Seal key server object IDs or JSON configs>
SUI_RPC_URL=https://fullnode.testnet.sui.io:443
SUI_PRIVATE_KEY=<funded server-side Sui private key for Walrus writes>
WALRUS_UPLOAD_RELAY_URL=https://upload-relay.testnet.walrus.space
WALRUS_UPLOAD_RELAY_TIP_MAX_MIST=1000
```

## Current Testnet Deployment

Package:

```env
SEAL_PACKAGE_ID=0x8a5490f87e7d8be38af59390beebf50d512b3cb4a509d84dc0e50d99a6465b37
```

Owner policy object:

```env
SEAL_POLICY_ID=0xe612bfa28620970c89eaadc9c68668784f6c8a5380f8ab98bd94e59e4f7d69df
```

Owner wallet:

```text
0x4de7f2a04ffb363c8a4f4591a77167cc1bf28fba3c8cf81ea333ddce342f6d26
```

Publish transaction:

```text
GPh8PEXarAMoSgNaTzFvP9qodmo3ccyVZUQdqmk5d5wk
```

Policy creation transaction:

```text
CApEs5ivsFbYB3mFc5LkJ4VHJiSRBHKJ2dBoi9Zyx5ea
```

## Important Boundary

`SEAL_PACKAGE_ID` is the published Move package. `SEAL_POLICY_ID` is the policy object ID used as the Seal inner identity.

Current API encryption uses `SEAL_POLICY_ID` directly. Future per-artifact identities should derive IDs like:

```text
policy_object_id || artifact_id
```

and keep `seal_approve` checking the policy namespace prefix.

## Remaining Work

- deploy package to Sui testnet,
- create first policy object for the Slush test wallet,
- configure real Seal key servers,
- run first encrypted Walrus upload,
- add decryption/retrieval path with approval transaction bytes,
- extend policy to support Twin-scoped and agent-scoped grants.

## Live Manual Memory Smoke Test

Success in the UI is not the final proof. Confirm each layer.

1. Save a private memory in the web UI and copy the returned `artifactId` and `rawStorageRef`.

2. Confirm the source artifact row exists and points at Walrus:

```bash
docker exec -it sivraj-postgres-1 psql -U sivraj -d sivraj
```

```sql
select
  id,
  twin_id,
  source_type,
  raw_storage_ref,
  ingestion_status,
  metadata->>'storageMode' as storage_mode,
  metadata->>'sensitivity' as sensitivity,
  metadata->>'ciphertextSha256' as ciphertext_sha256,
  metadata->'seal' as seal,
  metadata->'walrus' as walrus,
  created_at
from source_artifacts
order by created_at desc
limit 1;
```

Expected:

- `id` matches UI `artifactId`.
- `source_type = note`.
- `raw_storage_ref` starts with `walrus://blob/`.
- `ingestion_status = queued`.
- `storage_mode = encrypted_walrus`.
- `sensitivity = private`.
- `ciphertext_sha256` is present.
- `seal.packageId` and `seal.policyId` match `.env`.
- `walrus.blobId` is present.

3. Confirm audit row exists:

```sql
select
  event_type,
  resource_type,
  resource_id,
  metadata->>'rawStorageRef' as raw_storage_ref,
  created_at
from audit_events
where resource_id = '<ARTIFACT_ID>'
order by created_at desc
limit 1;
```

Expected:

- `event_type = artifact.created`.
- `resource_type = source_artifact`.
- `resource_id` matches UI `artifactId`.
- `raw_storage_ref` matches UI `rawStorageRef`.

4. Confirm no plaintext memory fragment was created:

```sql
select count(*) as fragment_count
from memory_fragments
where source_artifact_id = '<ARTIFACT_ID>';
```

Expected:

- `fragment_count = 0`.

5. Confirm plaintext did not land in artifact metadata:

```sql
select metadata::text
from source_artifacts
where id = '<ARTIFACT_ID>';
```

Expected:

- no raw note content appears.
- only storage/encryption metadata appears.

6. Optional Walrus check:

Use the `walrus.blobId` from metadata with the Walrus CLI or SDK to confirm the blob exists. The retrieved bytes should be ciphertext, not readable note text.

If upload fails with `NotEnoughBlobConfirmationsError`, direct storage-node writes did not reach enough nodes. On testnet, prefer the official upload relay by setting:

```env
WALRUS_UPLOAD_RELAY_URL=https://upload-relay.testnet.walrus.space
WALRUS_UPLOAD_RELAY_TIP_MAX_MIST=1000
```

Only after these checks pass should `Run first live encrypted memory upload` and `Live encrypted manual memory smoke test` be marked complete.

## Live Worker Decrypt Smoke Test

After an encrypted artifact exists:

```bash
pnpm dev:worker
```

Confirm the artifact completed:

```sql
select
  id,
  ingestion_status,
  metadata->'processing' as processing
from source_artifacts
where id = '<artifactId>';
```

Expected:

- `ingestion_status = completed`
- `metadata.processing.decryptPath = seal_walrus`
- `metadata.processing.memoryFragmentId` exists

Confirm the derived fragment exists:

```sql
select
  id,
  source_artifact_id,
  summary
from memory_fragments
where source_artifact_id = '<artifactId>';
```

Confirm audit:

```sql
select event_type, metadata
from audit_events
where resource_id = '<artifactId>'
order by created_at desc;
```

Expected latest event:

- `event_type = artifact.processed`
- metadata includes `decryptPath = seal_walrus`
- metadata includes `memoryFragmentId`
