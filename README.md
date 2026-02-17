# Engram — Cognitive Memory System for AI Agents

## What It Does

Engram gives AI agents **persistent, searchable memory** that survives across sessions. It replaces flat-file memory (markdown notes) with a proper database-backed system featuring semantic search, knowledge graph, and biologically-inspired memory management.

### Core Capabilities

| Feature                     | Description                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------- |
| **Semantic Search**         | BGE-M3 multilingual embeddings (1024-dim) — understands meaning, not just keywords |
| **Full-Text Search**        | SQLite FTS5 — fast exact-match and prefix search                                   |
| **Hybrid Search**           | Reciprocal Rank Fusion (RRF) — combines semantic + FTS results for best of both    |
| **Cross-Encoder Reranking** | BGE-Reranker — re-scores top candidates for precision                              |
| **Knowledge Graph**         | Memory-to-memory links with N-hop graph traversal                                  |
| **Auto-Linking**            | New memories automatically link to related ones (cosine similarity > 0.7)          |
| **Focus of Attention**      | `recall` command assembles task-relevant context within a token budget             |
| **Sleep Consolidation**     | Decay, prune, merge, boost — keeps memory lean and relevant                        |
| **Permanent Memories**      | Critical knowledge exempt from decay/pruning                                       |
| **Batch Ingest**            | `ingest` command — save multiple memories in one call (JSON array)                 |
| **Session Management**      | Track work sessions with optional summaries                                        |

### Memory Types

- **reflex** — "If X → do Y" rules, bug patterns, gotchas (instant recall)
- **episode** — Problems solved: trigger → root cause → solution 
- **fact** — Project info, architecture, tech stack details
- **preference** — User preferences, environment, communication style
- **decision** — Important choices with rationale

## Architecture Decisions

### Why LibSQL/SQLite (not PostgreSQL/pgvector)?

- **Zero infrastructure** — single file, no server, no Docker
- **Portable** — the entire skill (code + database) lives in one folder
- **LibSQL extensions** — native `vector()` type, DiskANN indexing, FTS5 built-in
- **Suitable scale** — agent memory is ~100s to ~10,000s of entries, not millions

### Why BGE-M3 (not OpenAI/Cohere embeddings)?

- **Fully local** — no API keys, no network, no cost
- **Multilingual** — works across Russian, English, and other languages
- **1024-dim** — good balance of quality and performance on CPU
- **@huggingface/transformers** — pure JS/WASM, no native compilation needed

### Why Cross-Encoder Reranking?

Bi-encoder (embedding) search is fast but approximate. The cross-encoder (`bge-reranker-base`) sees query + document **together**, giving much better relevance ranking — critical for a system where agents need the *right* context, not just *similar* context.

### Why Hybrid Search + RRF?

Semantic search misses exact names/identifiers. FTS misses semantic similarity. RRF fusion combines both with `score = Σ 1/(k + rank)`, naturally balancing precision and recall without tuning.

### Why Sleep Consolidation?

Without maintenance, memory grows unbounded and search quality degrades. Biological memory consolidation during sleep inspired four steps:

1. **Decay** — Ebbinghaus forgetting curve (`strength *= 0.95^days`). Idempotent: uses `last_consolidation_at` to prevent double-decay.
2. **Prune** — Archive memories below strength threshold (0.05). Permanent memories exempt.
3. **Merge** — Find near-duplicates (cosine > 0.92), merge content, archive duplicate.
4. **Boost** — Strengthen frequently accessed memories. Cooldown guard (≥1 day) prevents runaway boosting.
5. **Extract** *(planned)* — LLM-based pattern extraction to discover meta-rules from clusters.

### Why Auto-Link?

Agents add memories one at a time. Auto-linking discovers relationships post-hoc: on each `add`, top-3 similar existing memories are found by cosine similarity and linked if above 0.7 threshold. This builds a knowledge graph organically, enabling graph-hop expansion during recall.

### Why Token Budget in Recall?

Agents have finite context windows. `recall` returns memories sorted by composite score (`relevance × importance × strength × recency`) until the token budget is filled (default: 4000). A noise gate (score < 0.001) prevents irrelevant results from wasting budget.

## Performance

On i5-14600KF + DDR5 32GB:

| Operation                     | Time                                 |
| ----------------------------- | ------------------------------------ |
| First run after `npm install` | ~40s (one-time WASM JIT compilation) |
| Embedding model load          | ~1.4s                                |
| Reranker model load           | ~1.2s                                |
| Recall (full pipeline)        | ~3s total                            |
| Subsequent runs               | ~3s (model loading dominates)        |

**Model loading is the bottleneck**, not inference. For sub-second responses, a daemon mode (keeping models in memory) is the path forward.

## Project Structure

```
SKILLS/engram/          ← portable skill folder
├── SKILL.md            ← agent instructions
├── package.json        ← dependencies (3: @huggingface/transformers, @libsql/client, commander)
├── scripts/
│   ├── session-start.ps1
│   └── remember.ps1
├── src/
│   ├── cli.js          ← CLI entry (#!/usr/bin/env node)
│   ├── memory.js       ← CRUD + search (semantic, FTS, hybrid, rerank)
│   ├── embeddings.js   ← BGE-M3 + BGE-Reranker (via @huggingface/transformers)
│   ├── foa.js          ← Focus of Attention (recall + composite scoring)
│   ├── consolidation.js ← Sleep: decay, prune, merge, boost (idempotent)
│   ├── session.js      ← Session management + auto-consolidation
│   ├── db.js           ← LibSQL client + schema migrations
│   ├── migrate.js      ← Import from legacy markdown files
│   └── __tests__/      ← node:test and vitest tests
└── data/
    └── engram.db       ← SQLite database (auto-created, gitignored)
```

## Quick Start

```bash
cd SKILLS/engram
npm install
npm link   # registers `engram` globally
```

## CLI Reference

### Memory CRUD

```bash
engram add <type> "Title" -c "Content" -t "tag1,tag2" [--permanent]
engram get <id>
engram delete <id>
```

### Search & Recall

```bash
engram recall "query"             # Focus of Attention (recommended)
engram recall "query" --short     # compact preview
engram recall "query" -t reflex   # filter by type
engram recall "query" -b 2000     # custom token budget

engram search "query"             # hybrid search
engram search "query" -m semantic # semantic only
engram search "query" --rerank    # with cross-encoder
```

### Batch Ingest

```bash
engram ingest --file memories.json               # from file (keep)
engram ingest --file memories.json --remove-file  # from file (auto-delete after success)
echo '[{"type":"fact",...}]' | engram ingest      # from stdin
engram ingest '[{"type":"fact",...}]'             # from argument
```

### Management

```bash
engram stats                      # statistics
engram diagnostics                # weakest, duplicates
engram mark <id>                  # toggle permanent
engram link <src> <dst>           # link memories
engram tag add <id> <name>        # add tag
engram tag remove <id> <name>     # remove tag
engram tag list                   # all tags
engram export [-f json|md] [-o file]  # export
```

### Consolidation & Sessions

```bash
engram sleep                      # full consolidation
engram sleep --dry-run            # preview
engram session start <id>         # start session
engram session end <id> -s "..."  # end with summary
engram session list               # list sessions
```

## License

MIT
