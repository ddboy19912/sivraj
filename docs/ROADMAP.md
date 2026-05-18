# Roadmap

## Phase 0: Product Foundation

Goal: Align thesis, scope, and technical direction.

- Finalize PRD.
- Define first target user and demo path.
- Lock Sivraj/Twin brand language.
- Choose initial stack.
- Create architecture plan.
- Define data model.
- Define permission model.

Exit criteria:

- Team can start implementation without re-litigating product identity.

## Phase 1: Memory Ingestion Foundation

Goal: Users can import meaningful context.

- Implement account and Twin creation.
- Implement Sui wallet auth.
- Define private-memory storage boundary. (done)
- Integrate Seal encryption for raw private memory.
- Integrate Walrus storage for encrypted raw memory blobs.
- Build manual memory entry.
- Test wallet authentication and manual memory UI against the local API.
- Deploy Sivraj Seal access-control policy on Sui testnet.
- Configure live Sui, Walrus, and Seal testnet environment.
- Run first live encrypted manual memory upload.
- Add markdown/text upload.
- Add PDF text extraction ingestion. (done)
- Add chat export ingestion.
- Add GitHub source import.
- Store raw source metadata and encrypted raw storage refs.
- Build Redis/BullMQ processing queue. (done)

Exit criteria:

- User can import at least 50 artifacts into a Twin without relying on plaintext raw memory storage.

## Phase 2: Cognitive Graph V1

Goal: Convert raw data into structured identity context.

- Extract entities.
- Create project nodes.
- Create goal nodes.
- Create people nodes.
- Create decision nodes.
- Link memories to graph nodes.
- Add confidence and source citations.
- Build graph inspection UI.

Exit criteria:

- User can see a useful graph of projects, people, goals, and decisions.

## Phase 3: Retrieval and Context Routing

Goal: Retrieve the right memories for the right AI system.

- Build semantic search.
- Add recency and authority ranking.
- Add permission-scoped retrieval.
- Generate context packets.
- Add API endpoint for agent context.
- Add source citations.

Exit criteria:

- Coding, research, and strategy agents receive different context from the same Twin.

## Phase 4: Synthesis Engine

Goal: Turn memory into strategic intelligence.

- Build pattern detection prompts.
- Generate recurring bottleneck analysis.
- Generate project drift analysis.
- Generate weekly founder reflection.
- Track insight evidence.
- Add user feedback on insight quality.

Exit criteria:

- User receives at least one non-obvious, high-value personal insight.

## Phase 5: Sovereign Access Control

Goal: Users own and control memory access.

- Define access scopes.
- Add per-memory policies.
- Add agent authorization.
- Add audit log.
- Add permission management UI.

Exit criteria:

- User can grant and revoke scoped memory access for agent classes.

## Phase 6: Web3 Persistence

Goal: Make Sivraj portable, verifiable, and sovereign.

- Add identity state snapshots.
- Add portable export.
- Add verifiable memory references.

Exit criteria:

- User can prove and port long-term identity state across systems.

## Phase 7: Operator Intelligence Product

Goal: Package the strongest wedge into paid workflows for high-leverage independent operators.

- Build independent-operator dashboard.
- Add recovered expertise and reusable-framework flows.
- Add client/project context tracking.
- Add founder-specific dashboard views.
- Add investor conversation tracking.
- Add roadmap and execution bottleneck synthesis.
- Add weekly chief-of-staff report.
- Add decision memory.
- Add strategic focus recommendations.

Exit criteria:

- Independent operators convert to Pro after reaching the activation moment, and founder/operator users show willingness to pay for premium intelligence workflows.
