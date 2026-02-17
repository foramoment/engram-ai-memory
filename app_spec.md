# Engram — Application Specification

## Overview

Engram is a cognitive memory system for AI agents, inspired by neuroscience (CogMem, A-MEM, claude-engram) and modern retrieval architectures (claude-mem, Memori). It replaces simple markdown-based memory with a scalable LibSQL-backed system featuring native vector search, FTS5, Zettelkasten-style knowledge graphs, and biologically-inspired sleep consolidation.

**Target user:** AI agent (via CLI) operating within the Antigravity IDE environment.

## Technology Stack

- **Runtime:** Node.js 20+
- **Database:** LibSQL (`@libsql/client`) — native vectors (DiskANN), FTS5, SQL
- **Embeddings:** BGE-M3 (`Xenova/bge-m3`) via `@huggingface/transformers` v4 (WASM; WebGPU N/A in Node.js)
- **Reranker:** BGE-reranker-base (`Xenova/bge-reranker-base`) — cross-encoder for precision scoring
- **CLI:** Commander.js
- **Testing:** Node.js built-in test runner (`node:test` + `node:assert`)
- **LLM (optional):** LM Studio API at localhost:1234 (for Extract step in consolidation — not yet implemented)

## Core Features

### Memory Storage (LibSQL)
- Store memories with types: reflex, episode, fact, preference, decision, session_summary
- Each memory has: title, content, embedding (1024-dim), importance, strength (decay), tags
- FTS5 full-text search index synced with main table via triggers
- DiskANN vector index for semantic search

### Insert-Time Deduplication & Merge-on-Write
- **Exact dedup:** same type + title → skip insert, bump access count (0ms, SQL check)
- **Semantic merge:** cosine > 0.92 with same type → append content to existing memory, re-embed, bump strength
- **Auto-link:** cosine > 0.70 → create `related_to` link (configurable threshold)
- Eliminates most need for sleep-merge; the "think slower, never sleep" approach

### Knowledge Graph (Zettelkasten)
- Link memories with typed relations: related_to, caused_by, evolved_from, contradicts, supersedes
- Traverse graph to find related clusters (multi-hop expansion)
- Tags system for categorization

### Hybrid Search (RRF)
- Semantic search via vector_top_k() + cosine distance
- Full-text search via FTS5 + BM25 ranking
- Hybrid mode: Reciprocal Rank Fusion combining both
- Optional cross-encoder reranking (BGE-reranker-base) for higher precision
- Multi-hop retrieval: follow graph links N hops from search results
- Temporal filter: `--since 1h/1d/7d/30d` for time-bounded queries

### Focus of Attention (FoA)
- Dynamic context assembly for each query
- Rank by: relevance × importance × strength × recency (composite score)
- Noise gate: composite score < 0.001 dropped; fallback to top-K if gate kills all results
- Token budget control (default 4000 tokens)
- Session context integration

### Permanent Memories
- Memories tagged `permanent` are exempt from decay and pruning
- `--permanent` flag in `add` command auto-adds the tag
- Recommended for reflexes and user preferences

### Sleep Consolidation
- Ebbinghaus-inspired forgetting curves (strength decay based on `last_consolidation_at`)
- Dead memory pruning (strength < 5%, excludes permanent)
- Semantic duplicate merging (cosine > 0.92)
- Pattern extraction via LLM (planned, not yet implemented)
- Active memory boosting (frequently accessed, ≥1 day cooldown)
- Idempotent: safe to run multiple times (decay uses relative timestamps, boost has cooldown)

### Session Management
- Track conversation sessions
- Auto-generate session summaries with embeddings
- Access logging for decay calculations

### CLI Interface
- `engram add` — add memory (with dedup/merge)
- `engram get` — get memory by ID
- `engram delete` — delete memory
- `engram search` — semantic/FTS/hybrid search (with --rerank, --hops, --since)
- `engram recall` — Focus of Attention (smart context assembly)
- `engram ingest` — batch-add from JSON (stdin, file, or argument)
- `engram link` — link two memories
- `engram mark` — toggle permanent flag
- `engram tag` — add/remove/list tags
- `engram stats` — memory statistics
- `engram diagnostics` — weakest memories, duplicate candidates
- `engram session` — start/end/list sessions
- `engram sleep` — run consolidation (with --dry-run)
- `engram export` — export to JSON or Markdown
- `engram migrate` — import from markdown skill artifacts

### Migration
- Import existing markdown memories (reflexes.md, episodes.md, preferences.md, project_graph.md)
- Auto-embed and auto-tag

### Skill Integration
- SKILL.md for Antigravity integration
- Auto-load context at session start (session-start.ps1)
- Semantic search during session
- Save workflow on /remember (remember.ps1)
- Batch ingest for efficient multi-memory writes

## Non-Functional Requirements

- **Performance:** Embedding generation ~500ms per text on CPU. Search < 100ms. Reranker ~35ms per pair
- **Storage:** Single .db file, < 100MB for typical usage
- **Testing:** Unit tests for every module using node:test
- **Portability:** Windows-first (i5-14600KF, DDR5 32GB), works on macOS/Linux
- **Privacy:** Fully local, no cloud dependencies
