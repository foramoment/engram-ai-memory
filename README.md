<p align="center">
  <h1 align="center">🧠 Engram</h1>
  <p align="center">
    <strong>Cognitive Memory System for AI Agents</strong>
  </p>
  <p align="center">
    Persistent semantic search · Knowledge graph · Sleep consolidation · Zero external APIs
  </p>
  <p align="center">
    <a href="#quick-start">Quick Start</a> ·
    <a href="#architecture">Architecture</a> ·
    <a href="#features">Features</a> ·
    <a href="#research-foundations">Research</a> ·
    <a href="#cli-reference">CLI</a> ·
    <a href="SKILLS/engram/SKILL.md">Agent Integration</a>
  </p>
</p>

<br/>

> **Engram** gives AI agents a brain — not a database.
> It remembers what matters, forgets what doesn't, and builds connections between ideas.
> All inference runs **locally** — no API keys, no cloud, no token cost per memory operation.

<br/>

## Why Engram?

Most AI memory solutions (like [Mem0](https://github.com/mem0ai/mem0)) use LLM calls for every `add()` — extracting facts, classifying operations, resolving conflicts. That's powerful, but **expensive** and **opaque**.

Engram takes a different approach:

|                              | **Mem0**                       | **Engram**                                |
| ---------------------------- | ------------------------------ | ----------------------------------------- |
| **Who decides what to save** | LLM automatically              | Agent explicitly                          |
| **Cost per memory write**    | LLM call (extraction + update) | Local embedding only                      |
| **Cost per memory read**     | Vector search + LLM            | Hybrid search + local reranker            |
| **External dependencies**    | OpenAI API / vector DB service | **None** — fully local                    |
| **Memory unit**              | Atomic fact ("User prefers X") | Typed record with full context            |
| **Forgetting**               | No built-in mechanism          | Ebbinghaus-inspired decay + consolidation |
| **Knowledge graph**          | Neo4j (separate service)       | SQLite-embedded links                     |

**Engram is designed for coding agents** — where context is precious, decisions have high stakes, and the agent itself is smart enough to know what's worth remembering.

---

## Quick Start

### Prerequisites

- **Node.js** ≥ 20.0.0

### Installation

```bash
git clone https://github.com/foramoment/engram-ai-memory.git
cd engram-ai-memory/SKILLS/engram
npm install

# Register the CLI globally (optional)
npm link
```

### First Memory

```bash
# Add a memory
engram add reflex "Always wrap vector_top_k in try/catch" \
  -c "LibSQL's DiskANN index may not be ready during cold start. Fallback to brute-force cosine." \
  -t "libsql,vector-search" --permanent

# Recall it
engram recall "vector search error handling"

# Check your memory stats
engram stats
```

### Agent Integration

Engram ships as a **Skill** for AI coding assistants (Antigravity, Claude Code, Cursor, etc.):

```
your-agent-config/
└── skills/engram/        # copy or symlink SKILLS/engram here
    ├── SKILL.md          # Agent instructions (the agent reads this)
    ├── src/              # Core modules
    ├── scripts/          # Session automation
    └── references/       # Deep docs
```

See [`SKILLS/engram/SKILL.md`](SKILLS/engram/SKILL.md) for the full agent integration guide.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          CLI Layer                              │
│   engram recall · add · search · sleep · link · export · ...   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │  Focus of    │  │    Memory    │  │    Sleep              │ │
│  │  Attention   │  │    CRUD +    │  │    Consolidation      │ │
│  │  (FoA)       │  │    Search    │  │                       │ │
│  │              │  │              │  │  • Ebbinghaus Decay   │ │
│  │ • Composite  │  │ • Semantic   │  │  • Prune (archive)    │ │
│  │   scoring    │  │ • FTS (BM25) │  │  • Merge (dedup)      │ │
│  │ • Token      │  │ • Hybrid     │  │  • Boost (reinforce)  │ │
│  │   budget     │  │   (RRF)      │  │                       │ │
│  │ • Session    │  │ • Reranking  │  │                       │ │
│  │   context    │  │ • Graph hops │  │                       │ │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬───────────┘ │
│         │                 │                      │              │
├─────────┴─────────────────┴──────────────────────┴──────────────┤
│                       Embedding Layer                           │
│         BGE-M3 (1024-dim, 100+ langs, 8192 tokens)             │
│         BGE-reranker-base (cross-encoder)                      │
│         Hugging Face Transformers.js — runs on CPU/WebGPU      │
├─────────────────────────────────────────────────────────────────┤
│                       Storage Layer                             │
│         LibSQL/SQLite — single file, zero infrastructure       │
│         DiskANN vector index · FTS5 full-text · WAL mode       │
│         Typed memories · Tags · Links · Sessions · Access log  │
└─────────────────────────────────────────────────────────────────┘
```

### Core Modules

| Module            | File                   | Purpose                                         |
| ----------------- | ---------------------- | ----------------------------------------------- |
| **CLI**           | `src/cli.js`           | Commander-based command interface               |
| **Database**      | `src/db.js`            | Schema, migrations, LibSQL client               |
| **Memory**        | `src/memory.js`        | CRUD, search (semantic/FTS/hybrid), graph links |
| **Embeddings**    | `src/embeddings.js`    | BGE-M3 embedding + BGE-reranker cross-encoder   |
| **FoA**           | `src/foa.js`           | Focus of Attention — smart context assembly     |
| **Consolidation** | `src/consolidation.js` | Sleep cycle — decay, prune, merge, boost        |
| **Session**       | `src/session.js`       | Conversation session tracking                   |
| **Migration**     | `src/migrate.js`       | Import from legacy memory formats               |

---

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

---

## Features

### 🔍 Hybrid Search with Reciprocal Rank Fusion

Every `recall` query runs **two parallel search paths** and fuses results:

```
Query: "authentication error handling"
         │
    ┌────┴────┐
    ▼         ▼
 Semantic    FTS5
 (BGE-M3)  (BM25)
    │         │
    └────┬────┘
         ▼
   Reciprocal Rank Fusion (k=60)
         │
         ▼
   Cross-Encoder Reranking (optional)
         │
         ▼
   Graph Expansion (multi-hop)
         │
         ▼
   Composite Scoring
   relevance × importance × strength × recency
         │
         ▼
   Token Budget Fitting
```

- **Semantic search** catches conceptual matches ("auth patterns" → "OAuth2 token refresh")
- **FTS5/BM25** catches exact keyword matches ("LibSQL" → memories containing "LibSQL")
- **RRF fusion** combines both without score normalization
- **Cross-encoder reranking** with BGE-reranker-base for precision-critical queries
- **Multi-hop graph traversal** follows links to pull in related context

### 📝 Typed Memory System

Five memory types modeled after cognitive science:

| Type         | Analogy             | Use Case                           | Permanent?    |
| ------------ | ------------------- | ---------------------------------- | ------------- |
| `reflex`     | Procedural memory   | "If X happens → do Y"              | ✅ Recommended |
| `episode`    | Episodic memory     | Bug reports: trigger → cause → fix | —             |
| `fact`       | Semantic memory     | Architecture decisions, stack info | —             |
| `preference` | Implicit memory     | User preferences, environment      | ✅ Recommended |
| `decision`   | Deliberative memory | "Chose X over Y because Z"         | —             |

### 🕸️ Knowledge Graph

Memories form a linked graph with **automatic** and **explicit** connections:

- **Auto-linking**: every `add` finds the top 3 semantically similar memories (cosine ≥ 0.7) and creates `related_to` links
- **Explicit links**: `caused_by`, `evolved_from`, `contradicts`, `supersedes`
- **Multi-hop retrieval**: `recall` follows graph links to pull in related context

```
[reflex] Always wrap vector_top_k
    ├── related_to → [episode] Vector index NPE in production
    │   └── caused_by → [decision] Use DiskANN over brute-force
    └── evolved_from → [fact] LibSQL vector search capabilities
```

### 💤 Sleep Consolidation

Biologically-inspired memory maintenance, designed to run periodically:

```bash
engram sleep              # Run full cycle
engram sleep --dry-run    # Preview changes
```

| Step      | What it does                                     | Biological analogy   |
| --------- | ------------------------------------------------ | -------------------- |
| **Decay** | `strength *= 0.95^days`                          | Synaptic depression  |
| **Prune** | Archive if strength < 0.05                       | Synaptic elimination |
| **Merge** | Combine near-duplicates (cosine ≥ 0.92)          | Memory consolidation |
| **Boost** | +10% strength for frequently accessed (≥3 times) | Repetition priming   |

Permanent memories (reflexes, preferences) are **exempt** from decay and pruning.

### 🛡️ Intelligent Deduplication

Every `add` does merge-on-write:

1. **Exact match** (same type + title) → skip, bump access count
2. **Semantic near-match** (cosine ≥ 0.92, same type) → merge content into existing memory
3. **New** → create, auto-embed, auto-link

No LLM needed — pure embedding similarity.

### 📦 Zero Infrastructure

- **Single SQLite file** — `data/engram.db`
- **No external vector DB** — LibSQL DiskANN built-in, brute-force fallback
- **No API keys** — all inference via Transformers.js (CPU/WebGPU)
- **No Docker** — just `npm install`
- **Portable** — copy one file to migrate

---

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

---

## Research Foundations

Engram is an **applied cognitive architecture** — not a single research paper, but an engineering synthesis of ideas from cognitive psychology, information retrieval, and modern AI memory research.

### Primary Influences

#### 🧠 CogMem — Cognitive Memory Architecture
> *"CogMem: A Cognitive Memory Architecture for Sustained Multi-Turn Reasoning in Large Language Models"*
> — [arXiv:2504.01441](https://arxiv.org/abs/2504.01441)

CogMem's three-layer model directly inspired Engram's architecture:

| CogMem Layer                                            | Engram Component                                      |
| ------------------------------------------------------- | ----------------------------------------------------- |
| **Long-Term Memory (LTM)** — persistent knowledge store | SQLite + DiskANN vector index                         |
| **Direct Access (DA)** — session working memory         | `session` — conversation context tracking             |
| **Focus of Attention (FoA)** — dynamic context assembly | `recall()` — composite scoring + token budget fitting |

The key insight from CogMem: **don't stuff the entire history into the prompt** — reconstruct concise, task-relevant context at each turn.

#### 📉 Ebbinghaus Forgetting Curve (1885)
> *"Über das Gedächtnis"* (On Memory)
> — Hermann Ebbinghaus, 1885

The foundational law of memory decay: retention decreases exponentially over time unless reinforced. Engram's `sleep` consolidation implements this directly:

```
strength *= decayRate ^ daysSinceLastAccess
         (default: 0.95 ^ days)
```

Memories that are accessed frequently resist decay. Memories that are never recalled eventually fall below the prune threshold and are archived.

#### 🏦 MemoryBank
> *"MemoryBank: Enhancing Large Language Models with Long-Term Memory"*
> — Zhong et al., 2023 — [arXiv:2305.10250](https://arxiv.org/abs/2305.10250)

MemoryBank was the first AI memory system to systematically apply Ebbinghaus-inspired forgetting to LLM agents. Their "human-like forgetting mechanism where memories strengthen when recalled and naturally decay over time if unused" directly influenced Engram's consolidation pipeline.

### Search & Retrieval Stack

#### 🔀 Reciprocal Rank Fusion (SIGIR 2009)
> *"Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods"*
> — Cormack, Clarke, Buettcher — [ACM SIGIR '09](https://dl.acm.org/doi/10.1145/1571941.1572114)

The standard method for combining ranked lists from multiple retrieval systems without score normalization:

```
RRF_score(doc) = Σ 1 / (k + rank_i)    where k = 60
```

Engram fuses semantic search (BGE-M3 embeddings) and lexical search (FTS5/BM25) through RRF.

#### 🎯 BGE-M3 & BGE-Reranker (BAAI, 2023)
> *"C-Pack: Packaged Resources To Advance General Chinese Embedding"*
> — Xiao et al. — [arXiv:2309.07597](https://arxiv.org/abs/2309.07597)

- **BGE-M3**: Multilingual embedding model (1024-dim, 100+ languages, 8192 token context). Runs locally via Transformers.js.
- **BGE-reranker-base**: Cross-encoder for precision reranking. Processes (query, document) pairs jointly through attention — much more accurate than bi-encoder similarity for relevance scoring.

#### 🔗 DiskANN Vector Index
> *"DiskANN: Fast Accurate Billion-point Nearest Neighbor Search on a Single Node"*
> — Subramanya et al., NeurIPS 2019 — [arXiv:1907.05024](https://arxiv.org/abs/1907.05024)

LibSQL's built-in vector index is based on the Vamana graph algorithm from DiskANN, providing sub-linear approximate nearest neighbor search without an external vector database.

### Memory Typology

#### 📚 Tulving's Memory Systems (1972)
> *"Episodic and semantic memory"*
> — Endel Tulving, in *Organization of Memory*, 1972

The distinction between **episodic memory** (specific events with context) and **semantic memory** (general knowledge and facts) is the foundation for Engram's type system:

| Engram Type  | Cognitive Model                                          |
| ------------ | -------------------------------------------------------- |
| `reflex`     | Procedural memory — automated "if X then Y"              |
| `episode`    | Episodic memory — specific events with trigger/cause/fix |
| `fact`       | Semantic memory — declarative knowledge                  |
| `preference` | Implicit memory — stable preferences                     |
| `decision`   | Deliberative memory — choices with rationale             |

### Summary of Sources

| Engram Component                | Source                             | Year |
| ------------------------------- | ---------------------------------- | ---- |
| Focus of Attention (FoA)        | CogMem (arXiv:2504.01441)          | 2025 |
| Forgetting curve (decay)        | Ebbinghaus, *Über das Gedächtnis*  | 1885 |
| Sleep consolidation             | MemoryBank (arXiv:2305.10250)      | 2023 |
| Hybrid search (RRF)             | Cormack, Clarke, Buettcher — SIGIR | 2009 |
| Embeddings (BGE-M3)             | C-Pack (arXiv:2309.07597)          | 2023 |
| Reranker (cross-encoder)        | C-Pack (arXiv:2309.07597)          | 2023 |
| Memory type taxonomy            | Tulving (episodic/semantic)        | 1972 |
| Vector index (DiskANN)          | Subramanya et al. — NeurIPS        | 2019 |
| Semantic dedup (merge-on-write) | Standard IR cosine gating          | —    |

---

## CLI Reference

### Primary Commands

```bash
# Read
engram recall "query"                      # Smart context assembly (FoA)
engram recall "query" --short              # Compact preview
engram recall "query" -t reflex            # Filter by type
engram recall "query" -b 2000              # Custom token budget

# Write
engram add <type> "Title" -c "Content" -t "tags" [--permanent]
engram ingest --file memories.json --remove-file    # Batch (4x faster)
```

### Search Commands

```bash
engram search "query"                      # Hybrid (semantic + FTS)
engram search "query" -m semantic          # Semantic only
engram search "query" -m fts              # Exact keyword (BM25)
engram search "query" --rerank            # Cross-encoder precision
engram search "query" --hops 2            # Multi-hop graph expansion
engram search "query" --since 1d          # Time filter
```

### Knowledge Graph

```bash
engram link <sourceId> <targetId> -r <relation>
# Relations: related_to | caused_by | evolved_from | contradicts | supersedes
```

### Maintenance

```bash
engram sleep --dry-run                     # Preview consolidation
engram sleep                               # Run decay/prune/merge/boost
engram stats                               # Overview
engram diagnostics                         # Find weak/duplicate memories
engram export -o backup.json              # Export all
engram import --file backup.json          # Restore from backup
```

### CRUD

```bash
engram get <id>                            # View full memory
engram update <id> --title "New" --content "..."
engram delete <id>                         # Remove (cascades)
engram tag add <id> <tag>                  # Manage tags
engram mark <id>                           # Toggle permanent
```

### Backup & Restore

```bash
# Full backup
engram export -o backup.json

# Restore to same or different machine (dedup handles overlaps)
engram import --file backup.json

# Merge two databases
engram export -o db_a.json            # on machine A
engram import --file db_a.json        # on machine B
```

> 📖 Full command reference with all options: [`SKILLS/engram/references/cli_reference.md`](SKILLS/engram/references/cli_reference.md)
> 🧠 Advanced usage patterns: [`SKILLS/engram/references/effective_usage.md`](SKILLS/engram/references/effective_usage.md)

---

## Testing

Engram has comprehensive test coverage across all modules:

```bash
cd SKILLS/engram
npm test
```

| Test Suite                          | Coverage                                               |
| ----------------------------------- | ------------------------------------------------------ |
| `db.test.js`                        | Schema, migrations, vector index                       |
| `embeddings.test.js`                | BGE-M3 embedding + cosine similarity                   |
| `memory.test.js`                    | CRUD, dedup, search (semantic/FTS/hybrid), graph links |
| `reranker.test.js`                  | Cross-encoder scoring + ranking                        |
| `session_foa_consolidation.test.js` | Sessions, FoA recall, sleep cycle                      |
| `enhancements.test.js`              | Edge cases, N+1 optimizations                          |
| `migrate.test.js`                   | Legacy format migration                                |

---

## Tech Stack

| Component        | Technology                                                         | Role                                     |
| ---------------- | ------------------------------------------------------------------ | ---------------------------------------- |
| Runtime          | Node.js ≥ 20                                                       | ESM modules, native test runner          |
| Database         | [LibSQL](https://github.com/tursodatabase/libsql)                  | SQLite-compatible with vector extensions |
| Embeddings       | [BGE-M3](https://huggingface.co/BAAI/bge-m3) via Transformers.js   | 1024-dim, 100+ languages                 |
| Reranker         | [BGE-reranker-base](https://huggingface.co/BAAI/bge-reranker-base) | Cross-encoder precision scoring          |
| Full-Text Search | SQLite FTS5                                                        | BM25 lexical ranking                     |
| Vector Index     | DiskANN (LibSQL built-in)                                          | Approximate nearest neighbors            |
| CLI              | [Commander.js](https://github.com/tj/commander.js)                 | Command parsing + help generation        |

---

## How It Compares

| Feature                 | Engram                   | Mem0                  | Zep                 | MemGPT/Letta          |
| ----------------------- | ------------------------ | --------------------- | ------------------- | --------------------- |
| LLM required for writes | ❌ No                     | ✅ Yes                 | ✅ Yes               | ✅ Yes                 |
| External services       | ❌ None                   | Vector DB + LLM API   | Cloud service       | LLM API               |
| Knowledge graph         | ✅ SQLite-embedded        | ✅ Neo4j               | ❌ No                | ❌ No                  |
| Forgetting/decay        | ✅ Ebbinghaus-based       | ❌ No                  | ❌ No                | ❌ No                  |
| Cross-encoder reranking | ✅ Local                  | ❌ No                  | ❌ No                | ❌ No                  |
| Hybrid search (RRF)     | ✅ Semantic + FTS5        | ✅ Vector only         | ✅ Vector + metadata | ❌ No                  |
| Memory types            | ✅ 5 cognitive types      | ❌ Untyped facts       | ❌ Untyped           | ❌ Untyped             |
| Portable (single file)  | ✅ SQLite                 | ❌ No                  | ❌ No                | ❌ No                  |
| Cost per operation      | **$0** (local inference) | **$** (LLM API calls) | **$$** (cloud)      | **$** (LLM API calls) |

---

## Project Structure

```
engram-ai-memory/
├── README.md                            # This file
├── SKILLS/
│   └── engram/                          # ← portable skill folder
│       ├── SKILL.md                     # Agent integration guide
│       ├── package.json                 # Dependencies (3 packages)
│       ├── src/
│       │   ├── cli.js                   # CLI entry point (Commander)
│       │   ├── db.js                    # Schema, migrations, LibSQL client
│       │   ├── memory.js                # CRUD, search, graph links
│       │   ├── embeddings.js            # BGE-M3 + BGE-reranker
│       │   ├── foa.js                   # Focus of Attention (recall)
│       │   ├── consolidation.js         # Sleep: decay, prune, merge, boost
│       │   ├── session.js               # Session management
│       │   ├── migrate.js               # Legacy import
│       │   └── __tests__/               # Test suites (node:test)
│       ├── references/
│       │   ├── cli_reference.md         # Complete CLI documentation
│       │   └── effective_usage.md       # Advanced patterns & best practices
│       ├── scripts/
│       │   ├── session-start.ps1        # Auto-load context on session start
│       │   └── remember.ps1             # Batch memory ingestion helper
│       └── data/
│           └── engram.db                # SQLite database (auto-created)
└── ...
```

---

## Contributing

Contributions are welcome! Here are some areas that could use help:

- [ ] **Step 4: Pattern Extraction** — LLM-based pattern extraction during `sleep` (currently a placeholder)
- [ ] **Cross-platform scripts** — Bash equivalents for `session-start.ps1` / `remember.ps1`
- [ ] **WebGPU acceleration** — Currently CPU-only; WebGPU support is stubbed but untested
- [ ] **Turso cloud sync** — LibSQL supports cloud sync; could enable multi-device memory
- [ ] **More memory types** — Domain-specific types beyond the cognitive five
- [ ] **Visualization** — Graph visualization of the knowledge network
- [ ] **Daemon mode** — Keep models in memory for sub-second responses

### Development

```bash
cd SKILLS/engram

# Install dependencies
npm install

# Run tests
npm test

# Run CLI in dev mode
npm run cli -- recall "test query"

# Enable diagnostic logging
ENGRAM_TRACE=1 engram recall "test query"
```

---

## License

[MIT](LICENSE) — use it however you want.

---

<p align="center">
  <sub>Built with neuroscience, information retrieval theory, and a healthy distrust of API bills.</sub>
</p>
