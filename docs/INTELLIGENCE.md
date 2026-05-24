# Intelligence Layer

## Purpose

The intelligence layer turns encrypted processed memory into the Twin's structured understanding.

Ingestion answers:

> Can Sivraj safely store and process the user's source material?

Intelligence answers:

> What does this material mean in the user's life and work?

## Entity Extraction

Entity extraction is the first intelligence task. After the worker decrypts an artifact, parses it, and stores an encrypted memory fragment, Sivraj uses structured LLM extraction to identify important source-backed entities.

Extracted entity categories:

- `person`
- `organization`
- `project`
- `product`
- `place`
- `role`
- `technology`
- `topic`
- `document`
- `event`
- `unknown`

The worker stores entities in the graph as nodes and links the source artifact node to each entity using `mentions` edges. Edges reference `memory_fragments.id` in `evidence_memory_ids`.

## Graph Canonicalization

Graph nodes are merged by canonical identity:

`(twin_id, node_type, normalized_name)`

This prevents repeated extractions from creating duplicate nodes for casing or spacing variants. For example, `Polytope Labs` and `polytope labs` resolve to the same organization node.

When an existing node is seen again, Sivraj:

- preserves the original display name
- merges aliases and source types
- increments `properties.mentionCount`
- keeps the highest confidence score
- updates `properties.lastSeenAt`
- keeps edges source-backed through `evidence_memory_ids`

This makes the graph a compact identity layer instead of a raw list of every extracted mention.

## Memory Extraction

Memory extraction is the second intelligence task. After the worker creates the encrypted memory fragment, Sivraj can extract source-backed candidate memories:

- facts
- preferences
- goals
- decisions
- commitments
- experiences
- project updates
- relationships

Candidate memories are intentionally not the same thing as polished insights. They are atomic claims from one source, stored with confidence and provenance, and prepared for future approval/editing flows.

The extracted candidate statement is private content. Sivraj encrypts the candidate-memory batch before it enters any durable archive path. Postgres stores only:

- encrypted statement ref, initially `pending://candidate-memory-archive/...` until the low-priority archive job writes the encrypted batch to Walrus
- ciphertext hash
- memory type
- candidate status
- confidence
- evidence hash and length
- source artifact and memory fragment ids
- extractor provider/model metadata

This lets the Twin begin accumulating structured personal knowledge without reintroducing plaintext memory into the database.

Candidate memory statement storage is batched per artifact/chunk. If one artifact produces multiple candidate memories, Sivraj encrypts one candidate-memory batch, inserts candidate rows with `metadata.statementIndex`, and queues a low-priority archive job to write that encrypted batch to Walrus. The intelligence job does not wait for the Walrus archive write, so "Twin learning completed" is not blocked by the second durable-storage round trip. When archival finishes, the archive worker replaces the pending ref with the shared `walrus://blob/...` ref and marks `metadata.archiveStatus = "completed"`.

## Memory Consolidation

Candidate memories preserve source-level evidence. Canonical memories represent the Twin's consolidated understanding.

When the same memory is extracted repeatedly, Sivraj links the new candidate memory to an existing canonical memory and increments its evidence count instead of treating the repeat as totally new knowledge.

The first pass uses deterministic canonical keys:

- memory type
- normalized subject
- safe memory category when available
- normalized statement hash as fallback

The second pass uses an LLM semantic merge judge over a bounded shortlist of existing canonical memories with the same memory type. The judge classifies the candidate as:

- `same` - merge into the existing canonical memory
- `related` - keep separate but record that it is connected
- `conflicting` - keep separate for future conflict handling
- `separate` - create a new canonical memory

This prevents semantically duplicated memories from dominating review and retrieval. It also keeps evidence provenance intact: repeated uploads still add source evidence, but retrieval can show the underlying memory once. The current semantic shortlist is type/subject/recentness based; embedding similarity can replace or augment that shortlist as the corpus grows.

## Background Processing

Ingestion and intelligence run as separate worker phases:

1. Artifact processing decrypts the source artifact, parses it, creates the encrypted `memory_fragments` row, marks the artifact `completed`, and enqueues a Twin learning job.
2. Intelligence processing decrypts the encrypted memory fragment later, extracts entities and candidate memories, writes graph/candidate rows, encrypts candidate-memory batches, queues archive jobs, and updates `source_artifacts.metadata.processing.intelligence`.
3. Candidate-memory archive processing writes encrypted candidate-memory batches to Walrus and patches the candidate rows with the durable encrypted ref.

This means upload UX is complete once memory is safely encrypted, stored, and retrievable. Entity extraction and memory extraction are downstream Twin learning steps. A failed intelligence job must not make the upload look failed.

For active processing, Sivraj may pass short-lived encrypted ciphertext through Redis/BullMQ to avoid immediately reading the same blob back from Walrus. This transient handoff is bounded by `TRANSIENT_CIPHERTEXT_MAX_BYTES`, contains ciphertext only, and falls back to Walrus reads for retries, large payloads, or missing transient data. Walrus remains the durable source of truth.

Large decrypted fragments are chunked before intelligence extraction. `INTELLIGENCE_CHUNK_CHARS` controls the target chunk size and `INTELLIGENCE_CHUNK_CONCURRENCY` controls bounded in-job parallelism. This keeps extraction below model context limits and lets long documents move through the Twin learning pipeline without becoming one giant LLM request.

Retrieval uses a configurable encrypted-evidence budget. The API shortlists indexed fragments first, then decrypts only a bounded number of unique evidence fragments before ranking. `MEMORY_SEARCH_DECRYPT_EVIDENCE_LIMIT` controls that evidence budget, while `MEMORY_SEARCH_DECRYPT_CONCURRENCY`, `MEMORY_SEARCH_SHORTLIST_LIMIT`, and `MEMORY_SEARCH_FALLBACK_LIMIT` tune search fan-out. This keeps live Seal/Walrus decrypt latency predictable while the retrieval layer matures.

Status is tracked under `metadata.processing.intelligence`:

- `status`: `queued`, `processing`, `completed`, `failed`, or `skipped`
- `entityExtraction.durationMs`
- `memoryExtraction.durationMs`
- `timing.totalIntelligenceMs`
- provider/model/count metadata
- failure details when an extraction stage fails

## Privacy Boundary

Entity extraction must not store raw private source text or plaintext evidence snippets in Postgres.

The current entity implementation stores:

- entity display name
- normalized name
- entity type
- aliases
- confidence
- source artifact id
- memory fragment id
- extraction provider/model metadata

It does not store:

- raw artifact text
- memory fragment plaintext
- evidence snippets

Evidence snippets from the model are converted into hashes and lengths inside the intelligence package. The worker does not persist snippet text to graph metadata.

The current memory extraction implementation also avoids plaintext statement storage in Postgres. Candidate memory statements are encrypted before durable storage and referenced from Postgres by storage ref.

## Failure Semantics

Entity extraction is a downstream intelligence step. If it fails, ingestion should still complete once the encrypted memory fragment has been created.

Failure behavior:

- artifact remains `completed`
- `metadata.processing.intelligence.entityExtraction.status = "failed"`
- `metadata.processing.intelligence.memoryExtraction.status = "failed"`
- audit event `artifact.entity_extraction_failed` is written
- audit event `artifact.memory_extraction_failed` is written
- graph writes are skipped

This keeps secure ingestion reliable while allowing intelligence work to be retried or reprocessed later.

## Reprocessing

Entity extraction is designed to be rerunnable. As models and prompts improve, Sivraj can reprocess existing encrypted fragments, rebuild graph nodes/edges, and preserve source-backed provenance without requiring users to upload the same data again.
