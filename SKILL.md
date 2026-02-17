---
name: Engram Memory
description: Cognitive memory system for AI agents — persistent semantic search, knowledge graph, and sleep consolidation. Use when you need to store, recall, or manage long-term memories across sessions.
---

# Engram — Cognitive Memory for AI Agents

## Setup (one-time)

This skill is a self-contained folder. All source code, scripts, and the database live here.

```bash
# Install dependencies (run from this skill's directory)
cd <this-skill-folder>
npm install

# Optional: register global CLI command
npm link
# After linking, `engram` is available globally instead of `node src/cli.js`
```

## Session Start — Auto-Load

At the beginning of each conversation, **silently run**:

```powershell
& "<this-skill-folder>\scripts\session-start.ps1"
```

Or manually recall what you need:

```bash
node <this-skill-folder>/src/cli.js recall "current user projects and preferences"
```

**Do NOT announce that you are loading memories. Use the context naturally.**

## Reading Memories

**Always use `recall` — it's the optimized "smart" command.**

```bash
# Smart search — full markdown, reranker + graph hops
engram recall "query"

# Compact preview (human-friendly, truncated)
engram recall "query" --short

# Filter by type
engram recall "query" -t reflex

# Custom token budget
engram recall "query" -b 2000

# Get specific memory by ID
engram get 42
```

### What `recall` does automatically:
1. Hybrid search (semantic + FTS5, fused via Reciprocal Rank Fusion)
2. Cross-encoder reranking for precision
3. 1-hop graph expansion (follows `related_to` links)
4. Noise filtering (composite score < 0.001 dropped)
5. Composite scoring: relevance × importance × strength × recency
6. Token budget fitting (default: 4000 tokens)

## Writing Memories

```bash
engram add <type> "Title" -c "Full content" -t "tag1,tag2"

# Types: reflex | episode | fact | preference | decision

# Permanent (exempt from decay/pruning):
engram add preference "User IDE" -c "Uses Antigravity IDE" --permanent

# Auto-linking is ON by default. Disable (rare):
engram add fact "Note" -c "..." --no-auto-link
```

### Memory Types

| Type         | When                                   |  Permanent?   |
| ------------ | -------------------------------------- | :-----------: |
| `reflex`     | "If X → do Y" rules, gotchas           | ✅ recommended |
| `episode`    | Problem: trigger → cause → solution    |       —       |
| `fact`       | Project info, tech stack, architecture |       —       |
| `preference` | User prefs, environment, communication | ✅ recommended |
| `decision`   | Important choices with rationale       |       —       |

## /remember Workflow

When the user says `/remember` or `запомни`:

1. **Analyze** conversation for new reflexes, episodes, facts, preferences, decisions
2. **Check** existing memories: `engram recall "topic"` to avoid duplicates
3. **Write** each memory:

```bash
engram add reflex "cpal stream.play()" \
  -c "Don't call stream.play() until recording starts." \
  -t "reflex,rust" --permanent

engram add episode "Turbo broadcast failure" \
  -c "Trigger: ArgumentError. Root cause: SQLite index. Fix: raw ActionCable." \
  -t "episode,rails"
```

Or use the helper: `& "<this-skill-folder>\scripts\remember.ps1" -Type reflex -Title "..." -Content "..." -Permanent`

4. **Confirm** to the user briefly what was saved

## Management

```bash
engram mark 42                  # toggle permanent
engram link 42 43               # link memories
engram sleep                    # consolidation (decay, prune, merge, boost)
engram sleep --dry-run          # preview
engram stats                    # statistics
engram diagnostics              # weakest, duplicates
```

## Environment

| Variable         | Effect                                               |
| ---------------- | ---------------------------------------------------- |
| `ENGRAM_TRACE=1` | Diagnostic logging to stderr (model loading, timing) |

## Architecture

```
<this-skill-folder>/
├── SKILL.md              ← you are here
├── package.json           ← dependencies (@huggingface/transformers, @libsql/client, commander)
├── scripts/
│   ├── session-start.ps1  ← auto-load context
│   └── remember.ps1       ← batch save helper
├── src/
│   ├── cli.js             ← CLI entry point (#!/usr/bin/env node)
│   ├── memory.js          ← CRUD + search (semantic, FTS, hybrid, rerank)
│   ├── embeddings.js      ← BGE-M3 (1024-dim) + BGE-Reranker
│   ├── foa.js             ← Focus of Attention (recall + composite scoring)
│   ├── consolidation.js   ← Sleep: decay, prune, merge, boost
│   ├── session.js         ← Session management + auto-consolidation
│   ├── db.js              ← LibSQL client + schema migrations
│   └── migrate.js         ← Import from legacy markdown files
└── data/
    └── engram.db          ← SQLite database (auto-created)
```
