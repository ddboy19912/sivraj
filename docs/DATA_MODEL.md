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
- `description`
- `properties`
- `confidence_score`
- `created_at`
- `updated_at`

Node types:

- `person`
- `project`
- `goal`
- `decision`
- `belief`
- `workflow`
- `habit`
- `expertise`
- `emotional_pattern`
- `preference`

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

- `works_on`
- `depends_on`
- `influences`
- `contradicts`
- `supports`
- `delays`
- `prefers`
- `decided`

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
- `user_feedback`
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
