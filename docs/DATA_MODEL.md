# Data Model

## Core Entities

### User

Represents the human owner of the Twin.

Fields:

- `id`
- `email`
- `display_name`
- `created_at`
- `updated_at`

### Twin

Represents the persistent intelligence layer for a user.

Fields:

- `id`
- `user_id`
- `name`
- `summary`
- `current_goals`
- `created_at`
- `updated_at`

### SourceArtifact

Represents an imported or manually created source.

Fields:

- `id`
- `twin_id`
- `source_type`
- `uri`
- `raw_storage_ref`
- `hash`
- `metadata`
- `ingestion_status`
- `created_at`
- `updated_at`

Source types:

- `manual`
- `browser_history`
- `markdown`
- `text`
- `pdf`
- `ocr_pdf`
- `image`
- `docx`
- `csv`
- `github`
- `chat_export`
- `slack_export`
- `whatsapp_export`
- `email`
- `calendar`
- `voice_note`
- `voice_conversation`
- `screenshot`

### MemoryFragment

Represents a retrievable unit of memory.

Fields:

- `id`
- `twin_id`
- `source_artifact_id`
- `content_storage_ref`
- `content_sha256`
- `metadata`
- `embedding_ref`
- `importance_score`
- `confidence_score`
- `occurred_at`
- `created_at`
- `updated_at`

### GraphNode

Represents an identity graph object.

Fields:

- `id`
- `twin_id`
- `node_type`
- `name`
- `normalized_name`
- `description`
- `properties`
- `confidence_score`
- `created_at`
- `updated_at`

Graph node identity is canonical per Twin by `(twin_id, node_type, normalized_name)`. The display `name` remains user-facing, while `normalized_name` is used to merge repeated mentions such as `Polytope Labs`, `polytope labs`, and whitespace/casing variants into the same node.

Node types:

- `person`
- `organization`
- `project`
- `concept`
- `event`
- `artifact`
- `goal`
- `decision`
- `topic`
- `other`

Entity extraction may classify richer source entities such as `product`, `place`, `role`, `technology`, or `document`. These are mapped into the graph node enum and stored with the original entity type in `properties.entityType`.

### GraphEdge

Represents a relationship between graph nodes.

Fields:

- `id`
- `twin_id`
- `from_node_id`
- `to_node_id`
- `edge_type`
- `description`
- `evidence_memory_ids`
- `confidence_score`
- `created_at`
- `updated_at`

Edge examples:

- `mentions`
- `works_on`
- `depends_on`
- `influences`
- `contradicts`
- `supports`
- `delays`
- `prefers`
- `decided`

### CandidateMemory

Represents a source-backed extracted memory candidate.

Candidate memories are not final approved Twin memory yet. They are extracted from one processed memory fragment, stored with provenance, linked to a canonical memory record when possible, and can later be approved, rejected, edited, or superseded by the user.

Fields:

- `id`
- `twin_id`
- `canonical_memory_id`
- `source_artifact_id`
- `memory_fragment_id`
- `memory_type`
- `status`
- `statement_storage_ref`
- `statement_sha256`
- `evidence_hash`
- `evidence_length`
- `confidence_score`
- `metadata`
- `created_at`
- `updated_at`

The extracted statement is private content. It is encrypted before archive processing. Postgres stores only the encrypted statement reference, hashes, status, confidence, and provenance metadata. During fast Twin learning, `statement_storage_ref` may briefly be a `pending://candidate-memory-archive/...` ref; the archive worker later replaces it with the durable encrypted `walrus://blob/...` ref.

### CanonicalMemory

Represents the Twin's consolidated understanding of repeated candidate memories.

Sivraj may ingest the same underlying memory many times from repeated uploads, imports, or reworded notes. Candidate memories preserve source-level evidence. Canonical memories merge repeated evidence into one durable knowledge record so the Twin does not behave like a pile of duplicate fragments.

Fields:

- `id`
- `twin_id`
- `memory_type`
- `canonical_key`
- `subject`
- `status`
- `evidence_count`
- `confidence_score`
- `metadata`
- `first_seen_at`
- `last_seen_at`
- `created_at`
- `updated_at`

Canonicalization starts with deterministic keys: extracted memory type, normalized subject, safe memory category when available, and normalized statement hash as fallback. When that does not find a match, the worker can ask the configured structured LLM to judge whether the new candidate has the same meaning as an existing canonical memory of the same type. The LLM may merge `same` memories, mark `related` or `conflicting` memories for later handling, or create a separate canonical memory. Plaintext candidate statements are used only during background processing and are not stored in Postgres.

Memory types:

- `fact`
- `preference`
- `goal`
- `decision`
- `commitment`
- `experience`
- `project_update`
- `relationship`
- `other`

Statuses:

- `candidate`
- `approved`
- `rejected`
- `superseded`

### Insight

Represents synthesized intelligence.

Fields:

- `id`
- `twin_id`
- `insight_type`
- `title`
- `body`
- `evidence_memory_ids`
- `related_node_ids`
- `confidence_score`
- `user_feedback_events`
- `created_at`
- `updated_at`

Insight types:

- `pattern`
- `blind_spot`
- `opportunity`
- `risk`
- `drift`
- `reflection`
- `recommendation`

### AccessPolicy

Represents a rule governing access to memories and graph data.

Fields:

- `id`
- `twin_id`
- `subject_type`
- `subject_id`
- `scope`
- `allowed_node_types`
- `allowed_source_types`
- `denied_tags`
- `expires_at`
- `created_at`
- `updated_at`

Subject types:

- `user`
- `agent`
- `app`
- `api_key`

Scopes:

- `private`
- `coding_agent`
- `research_agent`
- `strategy_agent`
- `finance_agent`
- `therapy_agent`
- `full_access`

### ContextPacket

Represents the context returned to an AI system.

Fields:

- `id`
- `twin_id`
- `requester_id`
- `query`
- `scope`
- `memory_fragment_ids`
- `graph_node_ids`
- `summary`
- `citations`
- `expires_at`
- `created_at`

## Design Principles

- Raw artifacts, memory fragments, graph nodes, and insights should be separate.
- Every synthesized claim should cite evidence.
- The graph should allow uncertainty, revision, and contradiction.
- Access policies must be evaluated before retrieval output is sent to any agent.
- Context packets should be bounded, auditable, and disposable.
