# Engram 🧠

Cognitive memory system for AI agents — powered by LibSQL native vectors + BGE-M3 embeddings + sleep consolidation.

## Quick Start

```bash
npm install
node src/cli.js --help
```

## Features

- 🔍 **Hybrid Search** — Semantic (vector) + Full-text (FTS5) with Reciprocal Rank Fusion
- 🧬 **Knowledge Graph** — Zettelkasten-style linking between memories
- 💤 **Sleep Consolidation** — Biologically-inspired forgetting curves + memory merging
- 🎯 **Focus of Attention** — Dynamic context assembly within token budgets
- 🌍 **Multilingual** — BGE-M3 embeddings support 100+ languages
- ⚡ **GPU Accelerated** — WebGPU via Transformers.js v4 (WASM fallback)
- 📦 **Single File** — Everything in one LibSQL database

## Architecture

```
engram/
├── src/
│   ├── db.js              # LibSQL database + migrations
│   ├── embeddings.js       # BGE-M3 via Transformers.js
│   ├── memory.js           # CRUD + search operations
│   ├── foa.js              # Focus of Attention (context assembly)
│   ├── session.js          # Session management
│   ├── consolidation.js    # Sleep cycle (decay/prune/merge/extract/boost)
│   ├── cli.js              # Commander.js CLI
│   └── __tests__/          # Unit tests (node:test)
├── data/                   # Database files (gitignored)
├── skill/                  # Antigravity skill integration
└── app_spec.md             # Project specification
```

## License

MIT
