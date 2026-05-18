# Build Scope

## Foundation Goal

Prove that Sivraj can turn fragmented personal and professional context into high-value strategic synthesis.

The first working product should make users feel:

> This system understands patterns across my life and work that no single AI app can see.

## Target User

High-leverage independent operator using multiple AI tools and managing valuable context across client work, product, engineering, research, writing, strategy, and personal planning.

The primary named persona is Tunde, an independent consultant whose expertise is scattered across documents, proposals, AI chats, email, notes, and drives. Founder OS remains an expansion path for founders and operators once synthesis, graph, and reporting capabilities mature.

## Product Promise

Upload or connect meaningful work context, then ask a real work question and receive specific, source-backed context or insight from the user's own history.

The activation event is:

> Sivraj returns something useful from the user's past that they forgot they knew.

## Foundation Must Have

### 1. User Identity and Workspace

- Create user account.
- Create one personal Twin.
- Store basic user profile.
- Store stated goals, preferences, and active projects.

### 2. Manual and Bulk Ingestion

Initial supported sources:

- Markdown notes.
- Plain text.
- PDFs.
- GitHub repository summaries or imported files.
- Chat exports as JSON or text.
- Manual memories.

Nice to have:

- Voice note transcription.
- Email import.
- Calendar import.

### 3. Memory Processing Pipeline

For each ingested artifact:

- Store raw source metadata.
- Encrypt private raw content.
- Store encrypted raw content through Walrus.
- Save raw storage references.
- Extract text.
- Chunk content.
- Generate embeddings.
- Classify artifact type.
- Extract entities.
- Extract candidate memories.
- Link to projects, goals, people, and decisions.

### 4. Cognitive Graph V1

Track:

- People.
- Projects.
- Goals.
- Decisions.
- Preferences.
- Recurring patterns.
- Source artifacts.

### 5. Retrieval and Context Selection

Given a user or agent query:

- Retrieve relevant memory fragments.
- Rank by semantic relevance, recency, authority, and permission scope.
- Compose a context packet.
- Return source citations.

### 6. Synthesis Queries

Support strategic questions like:

- What patterns consistently slow my progress?
- What am I avoiding?
- Which projects are strategically inconsistent?
- What should I focus on this week?
- What decisions have I already made about this product?
- What do my recent actions suggest about my real priorities?

### 7. Reflection Reports

Generate periodic reports:

- Weekly founder reflection.
- Active project summary.
- Behavioral pattern update.
- Goal drift report.
- Decision log summary.

### 8. Permission Scopes

Initial scopes:

- Private to user.
- Coding agent.
- Strategy agent.
- Research agent.
- Full access.

Each memory should have an access policy.

### 9. Demo-Ready Multi-Agent Context

Simulate or implement three agent clients:

- Coding agent.
- Research agent.
- Strategy agent.

Each receives different context based on scope.

## Foundation Should Not Include

- Full enterprise admin.
- Complex org graph.
- Full browser history ingestion.
- Perfect mobile app.
- Marketplace.
- Advanced payments.
- Complete Web3 decentralization for every object.
- Private beta usage while raw private memory is still stored only as plaintext Postgres content.

## Success Criteria

The foundation succeeds if:

- A user can ingest at least 50 meaningful artifacts.
- The system builds a usable graph of projects, people, goals, and decisions.
- Retrieval returns relevant context with citations.
- The synthesis engine produces at least one insight the user considers non-obvious and personally useful.
- Multiple agent contexts can be generated from the same underlying Twin.

## Demo Success Criteria

The demo should show:

1. Uploading meaningful life/work data.
2. Encrypting private raw memory and storing a Walrus-backed receipt.
3. Processing artifacts into retrievable memory.
4. Asking a real work question.
5. Receiving a specific, source-backed remembered insight.
6. Showing the target graph/synthesis/agent-routing path without implying those target surfaces are fully built.
