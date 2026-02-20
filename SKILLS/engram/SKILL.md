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

## Session Start — Adaptive Context Loading

At the beginning of each conversation, **silently load relevant context** using your own judgment. Do NOT run the legacy script. Instead:

1. **Read the environment** — workspace path, open files, file extensions, the user's first message.
2. **Determine what you need** — which projects, languages, patterns, preferences are relevant right now.
3. **Make 1–3 targeted `recall` calls** with precise queries and tight budgets:

```bash
# Examples of GOOD targeted recalls:
engram recall "auth API rate limiting nodejs" -b 1500                # project-specific
engram recall "user preferences communication" -t preference -b 600  # always small
engram recall "react state management gotchas" -t reflex -b 800      # stack-specific

# BAD — never do this:
engram recall "reflexes gotchas bug patterns rules" -b 4000    # too vague, wastes budget
```

4. **Iterate if needed** — if the first recall reveals you need more context on a specific topic, do another targeted recall. This is better than loading everything upfront.
5. **If a structured task file is detected** (e.g. a task list, feature tracker, or project spec in the workspace) — read the current task and recall context relevant to it.

**Budget guideline:** aim for ~2000–3000 total tokens of memory context. Less is better if it's precise.

**Do NOT announce that you are loading memories. Use the context naturally.**

> **Fallback for weaker models:** the legacy script `scripts/session-start.ps1` still works but loads static, non-adaptive context.

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

# Episode linked to related memories
engram add episode "Boost test failure in Engram" \
  -c "Trigger: test isolation. Cause: clearTables didn't reset system_meta. Fix: DELETE last_consolidation_at." \
  -t "episode,engram,testing" --link-to 42:caused_by

# Preference (permanent)
engram add preference "User development environment" \
  -c "OS: macOS, IDE: Cursor, Shell: zsh, prefers TypeScript" --permanent
```

### Batch Ingest (3+ memories → use this)

One model load for the entire batch — **4x faster** than individual adds.

```bash
engram ingest --file memories.json               # keep file
engram ingest --file memories.json --remove-file  # delete file after success
```

`--remove-file` auto-deletes the JSON file after **all** memories are ingested successfully. If any fail, the file is preserved for retry. **Always use `--remove-file`** to avoid accidentally committing temporary JSON files.

```json
[
  {"type": "reflex", "title": "...", "content": "...", "tags": ["a","b"], "permanent": true,
   "links": [{"target": 133, "relation": "related_to"}]},
  {"type": "episode", "title": "...", "content": "...", "tags": ["c"]}
]
```

You can also link ALL batch memories to shared targets with the `--link-to` flag:
```bash
engram ingest --file memories.json --remove-file --link-to 133:related_to,42:evolved_from
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
engram link <sourceId> <targetIds> -r <relation>
# Multiple targets:
engram link 138 133,134,135 -r related_to
```

Relations: `related_to` | `caused_by` | `evolved_from` | `contradicts` | `supersedes`

Graph links power multi-hop retrieval in `recall` and `search --hops N`.

> **Deep dive:** See [Effective Usage Guide → Knowledge Graph Patterns](references/effective_usage.md#knowledge-graph-patterns)

## /remember Workflow

When the user says `/remember` or `запомни`:

1. **Analyze** conversation for new reflexes, episodes, facts, preferences, decisions
2. **Check** existing memories: `engram recall "topic" --short` for each area
3. **Write** via `engram ingest --file <tmp>.json --remove-file` (batch preferred, auto-cleanup)
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
engram import --file backup.json                   # Restore from export (dedup + metadata)
```

## Environment

| Variable         | Effect                                               |
| ---------------- | ---------------------------------------------------- |
| `ENGRAM_TRACE=1` | Diagnostic logging to stderr (model loading, timing) |

## Essential Best Practices

> These patterns are critical for effective Engram usage. **Read them before your first use.**

### Search: `recall` vs `search`

- **`recall`** — always your first choice. It does hybrid search + reranking + graph expansion + scoring + budget fitting automatically.
- **`search`** — only when you need: specific mode (`-m fts`), time filtering (`--since 1d`), multi-hop (`--hops 2`), or more than 10 results.

### Anti-Patterns

| ❌ Don't                            | ✅ Do Instead                                       |
| ---------------------------------- | -------------------------------------------------- |
| Announce "Loading memories..."     | Read silently, use context naturally               |
| Save every small detail            | Save only what's worth finding later               |
| Write vague titles like "Bug fix"  | Write searchable titles: "LibSQL vector index NPE" |
| Use `search` for everyday context  | Use `recall` (it does more automatically)          |
| Save 10 memories one at a time     | Batch with `ingest --file ... --remove-file`       |
| Forget to tag with project name    | Always include project tag for filtering           |
| Leave temp JSON files after ingest | Always use `--remove-file` with `ingest --file`    |
| Leave reflexes non-permanent       | Mark reflexes and preferences as `--permanent`     |
| Run `link` separately after `add`  | Use `--link-to` on `add`/`ingest` instead          |

## Full Reference

For complete command syntax, all options, and deeper patterns:

- 📖 **[CLI Reference](references/cli_reference.md)** — every command with all options and examples
- 🧠 **[Effective Usage Guide](references/effective_usage.md)** — session lifecycle, search strategy, graph patterns, consolidation, decision trees
