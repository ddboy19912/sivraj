# Sivraj Brain Architecture

Sivraj brain is the backend-owned knowledge system behind chat, voice, uploads, and connectors. UI surfaces do not decide what something means. They send user input to the brain; the brain plans, retrieves, inspects, reconciles, writes, and returns evidence-grounded answers.

## Principles

- LLMs decide semantic intent and retrieval strategy.
- Code owns durable contracts, lifecycle state, permissions, storage, retries, and evidence boundaries.
- Code must not route document or memory meaning with user-text regexes. String normalization is allowed for stable IDs, labels, hashes, and parsed tool arguments only.
- Document tool scopes are documented in `docs/DOCUMENT_TOOLS.md`.
- Raw sources stay available through private storage references.
- Derived knowledge is persisted as explicit state, not inferred from chat history.
- Memory writes reconcile with existing knowledge instead of appending duplicates.
- Missing indexes trigger on-demand extraction when useful, then persist the result.

## Layers

1. Raw Source Vault
   - `source_artifacts` owns uploaded/connected sources, storage refs, hashes, duplicate fingerprints, ingestion lifecycle, and safe metadata.
   - `memory_fragments` owns durable private content references and storage health.

2. Document Intelligence
   - `document_pages` stores page boundaries.
   - `document_chunks` stores searchable passages and embeddings.
   - `document_structure_items` stores LLM-extracted chapters, headings, sections, parts, and TOC-like entries.
   - Document questions first receive inventory, structure, subjects, page/chunk counts, and focus state.

3. Semantic Memory
   - `canonical_memories` stores current durable facts/preferences/goals/decisions.
   - `candidate_memories` stores evidence and extraction provenance.
   - Memory intake must classify, reconcile, supersede, or ignore; it must not blindly append.

4. Knowledge Graph
   - `graph_nodes` and `graph_edges` connect user, assistant, projects, documents, people, tools, decisions, and concepts.
   - Graph is supporting structure for broad questions like "what do you know about my project?"

5. Brain Planner
   - One LLM planner chooses actions using typed JSON.
   - Planner inputs include current message, recent conversation, core identity, memory hints, document inventory, and available tools.
   - Planner output names tool calls, not route branches.
   - If the planner is unavailable, the backend should preserve the user query and fail/answer cautiously; it must not use keyword fallbacks that pretend to understand document or memory intent.

6. Brain Tools
   - `get_core_profile`
   - `search_memory`
   - `list_documents`
   - `get_document_metadata`
   - `get_document_structure`
   - `exact_search_document`
   - `count_document_matches`
   - `search_document_chunks`
   - `scan_document`
   - `read_document_pages`
   - `extract_document_structure`
   - `reconcile_memory`
   - `write_memory`
   - `supersede_memory`

7. Answer Composer
   - Final response model receives tool results and evidence only.
   - It must distinguish saved user memory from public knowledge.
   - It must not invent facts absent from selected evidence.

## Required Behaviors

- "What is my name?" uses core profile and canonical memories.
- "What do you know about me?" uses semantic memory plus graph summary.
- "Do you remember the PDF?" uses source inventory.
- "How many pages?" uses document metadata if present.
- "How many chapters?" uses `document_structure_items` if present; otherwise triggers full-document structure extraction/scan.
- "How many times is Fagin mentioned?" uses `count_document_matches` over the stored extracted document/pages, with the LLM choosing the literal term and match mode.
- "Summarize chapter 4" resolves chapter structure to page/char range, then reads/scans that range.
- Chat and voice must call the same brain path.
- Duplicate document uploads reuse existing artifacts.
- Duplicate memories merge or supersede existing canonical memories.

## Implementation Milestones

1. Persist document structure during ingestion.
2. Expose document structure in retrieval inventory and planner prompts.
3. Move chat and voice retrieval behind a shared `brain` service module.
4. Add on-demand document structure extraction for old artifacts without structure rows. *(Implemented for chat document retrieval: global whole-document structure/count plans can read stored pages, ask the configured LLM for structure, persist `document_structure_items`, and answer from the refreshed inventory in the same turn.)*
5. Add memory reconciliation planner/tool for all memory writes.
6. Add brain inspection API/UI for known facts, sources, structure, duplicates, contradictions, and failed extractions.
