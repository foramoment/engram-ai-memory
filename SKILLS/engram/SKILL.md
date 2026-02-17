---
name: Engram Memory
description: Cognitive memory system for AI agents — persistent semantic search, knowledge graph, and sleep consolidation. Use when you need to store, recall, or manage long-term memories across sessions.
---

# Engram — Cognitive Memory for AI Agents

> **Deep reference docs:** [CLI Reference](references/cli_reference.md) · [Effective Usage Guide](references/effective_usage.md)

## Setup (one-time)

```bash
cd <this-skill-folder>
npm install
# Optional: register global CLI
npm link
```

## Session Start — Auto-Load

At the beginning of each conversation, **silently run**:

```powershell
& "<this-skill-folder>\scripts\session-start.ps1"
```

Or manually recall what you need:

```bash
engram recall "current user projects and preferences"
```

**Do NOT announce that you are loading memories. Use the context naturally.**

## Reading Memories — Always Use `recall`

`recall` is the **primary read command**. It combines hybrid search, reranking, graph expansion, noise filtering, composite scoring, and token budget fitting in one call.

```bash
engram recall "query"                    # Full context (4000 tokens)
engram recall "query" --short            # Compact preview
engram recall "query" -t reflex          # Filter by type
engram recall "query" -b 2000            # Custom budget
```

For advanced search, use `search` directly (see [CLI Reference](references/cli_reference.md)):
```bash
engram search "query" --rerank --hops 2  # Graph-aware + reranked
engram search "query" --since 1d -m fts  # Today, exact keywords
```

## Writing Memories — Save Proactively

**Don't wait for `/remember`. Save important information immediately during the conversation.**

```bash
engram add <type> "Title" -c "Content" -t "tags" [--permanent]
```

### When to Save

| Trigger                           | Type         | Permanent? |
| --------------------------------- | ------------ | :--------: |
| User reveals a preference         | `preference` |     ✅      |
| You solve a non-trivial bug       | `episode`    |     —      |
| You discover a gotcha or pattern  | `reflex`     |     ✅      |
| Project architecture established  | `fact`       |     —      |
| Important decision with rationale | `decision`   |     —      |

### Examples

```bash
# Reflex (permanent)
engram add reflex "NPE in LibSQL vector index" \
  -c "If vector index not ready, vector_top_k throws. Always wrap in try/catch with fallback." \
  -t "reflex,libsql,sqlite" --permanent

# Episode
engram add episode "Boost test failure in Engram" \
  -c "Trigger: test isolation. Cause: clearTables didn't reset system_meta. Fix: DELETE last_consolidation_at." \
  -t "episode,engram,testing"

# Preference (permanent)
engram add preference "User hardware" \
  -c "i5-14600KF, DDR5 32GB 6400MHz, Windows 11" --permanent
```

### Batch Ingest (3+ memories → use this)

One model load for the entire batch — **4x faster** than individual adds.

```bash
engram ingest --file memories.json
```

```json
[
  {"type": "reflex", "title": "...", "content": "...", "tags": ["a","b"], "permanent": true},
  {"type": "episode", "title": "...", "content": "...", "tags": ["c"]}
]
```

### Efficiency Rules

- **Title = searchable summary** — write titles you'd want to find later
- **Content = full context** — include trigger, cause, solution, prevention
- **Tags = consistent categories** — project name, technology, type
- **Check before saving:** `engram recall "topic" --short` to avoid duplicates
- **Mark permanent** for reflexes and preferences — they must never decay

## Knowledge Graph

Auto-linking is ON by default — every `add` discovers and links related memories via cosine similarity. To build richer graph manually:

```bash
engram link <sourceId> <targetId> -r <relation>
```

Relations: `related_to` | `caused_by` | `evolved_from` | `contradicts` | `supersedes`

Graph links power multi-hop retrieval in `recall` and `search --hops N`.

> **Deep dive:** See [Effective Usage Guide → Knowledge Graph Patterns](references/effective_usage.md#knowledge-graph-patterns)

## /remember Workflow

When the user says `/remember` or `запомни`:

1. **Analyze** conversation for new reflexes, episodes, facts, preferences, decisions
2. **Check** existing memories: `engram recall "topic" --short` for each area
3. **Write** via `engram ingest --file <tmp>.json` (batch preferred)
4. **Confirm** to the user briefly what was saved

## Session Management

Sessions track which memories were accessed during a conversation. They power access-based analytics and consolidation boost.

```bash
engram session start <id> [-t title]     # Start (also checks if sleep needed)
engram session end <id> [-s summary]     # End with summary
engram session list [-n limit]           # List recent sessions
```

> **Deep dive:** See [Effective Usage Guide → Session Lifecycle](references/effective_usage.md#session-lifecycle)

## Maintenance

### Consolidation (Sleep)
```bash
engram sleep --dry-run    # Preview
engram sleep              # Execute: decay, prune, merge, boost
```

Consolidation is **idempotent** — safe to run multiple times. Permanent memories are exempt from decay and pruning.

### Health Checks
```bash
engram stats              # Overview
engram diagnostics        # Weakest memories + duplicate candidates
```

### CRUD
```bash
engram get <id>                                    # View full memory
engram update <id> --title "New" --content "..."   # Edit memory
engram delete <id>                                 # Remove memory
engram tag add <id> <tag>                          # Add tag
engram tag remove <id> <tag>                       # Remove tag
engram mark <id>                                   # Toggle permanent
engram export [-f md] [-o file.json]               # Export all
```

## Environment

| Variable         | Effect                                               |
| ---------------- | ---------------------------------------------------- |
| `ENGRAM_TRACE=1` | Diagnostic logging to stderr (model loading, timing) |

## Full Reference

For complete command syntax, all options, usage patterns, and anti-patterns:

- 📖 **[CLI Reference](references/cli_reference.md)** — every command with all options and examples
- 🧠 **[Effective Usage Guide](references/effective_usage.md)** — session lifecycle, search strategy, graph patterns, consolidation, decision trees
