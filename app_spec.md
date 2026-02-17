# Engram — Application Specification

## Overview

Engram is a cognitive memory system for AI agents, inspired by neuroscience (CogMem, A-MEM, claude-engram) and modern retrieval architectures (claude-mem, Memori). It replaces simple markdown-based memory with a scalable LibSQL-backed system featuring native vector search, FTS5, Zettelkasten-style knowledge graphs, and biologically-inspired sleep consolidation.

**Target user:** AI agent (via CLI) operating within the Antigravity IDE environment.

## Technology Stack

- **Runtime:** Node.js 20+
- **Database:** LibSQL (`@libsql/client`) — native vectors (DiskANN), FTS5, SQL
- **Embeddings:** BGE-M3 (`Xenova/bge-m3`) via `@huggingface/transformers` v4 (WebGPU + WASM fallback)
- **CLI:** Commander.js
- **Testing:** Node.js built-in test runner (`node:test` + `node:assert`)
- **LLM (optional):** LM Studio API at localhost:1234 (for Extract step in consolidation)

## Core Features

### Memory Storage (LibSQL)
- Store memories with types: reflex, episode, fact, preference, decision, session_summary
- Each memory has: title, content, embedding (1024-dim), importance, strength (decay), tags
- FTS5 full-text search index synced with main table
- DiskANN vector index for semantic search

### Knowledge Graph (Zettelkasten)
- Link memories with typed relations: related_to, caused_by, evolved_from, contradicts, supersedes
- Traverse graph to find related clusters
- Tags system for categorization

### Hybrid Search (RRF)
- Semantic search via vector_top_k() + cosine distance
- Full-text search via FTS5
- Hybrid mode: Reciprocal Rank Fusion combining both

### Focus of Attention (FoA)
- Dynamic context assembly for each query
- Rank by: relevance × importance × strength × recency
- Token budget control
- Session context integration

### Sleep Consolidation
- Ebbinghaus-inspired forgetting curves (strength decay)
- Dead memory pruning (strength < 5%)
- Semantic duplicate merging (cosine > 0.92)
- Pattern extraction via LLM (optional, LM Studio)
- Active memory boosting

### Session Management
- Track conversation sessions
- Auto-generate session summaries with embeddings
- Access logging for decay calculations

### CLI Interface
- `engram add`, `search`, `recall`, `link`, `stats`, `session`, `sleep`, `migrate`, `export`

### Migration
- Import existing markdown memories (reflexes.md, episodes.md, preferences.md, project_graph.md)
- Auto-embed and auto-tag

### Skill Integration
- SKILL.md for Antigravity integration
- Auto-load context at session start
- Semantic search during session
- Save workflow on /remember

## Non-Functional Requirements

- **Performance:** Embedding generation < 500ms per text on GPU, < 2s on CPU. Search < 100ms
- **Storage:** Single .db file, < 100MB for typical usage
- **Testing:** Unit tests for every module using node:test
- **Portability:** Windows-first (RTX 5060 Ti), works on macOS/Linux
- **Privacy:** Fully local, no cloud dependencies
