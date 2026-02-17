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
engram recall "current user projects and preferences"
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

## Proactive Memory — Save As You Go

**Don't wait for `/remember`. Save important information proactively during the conversation.** This is the most effective way to build useful memory.

### When to save (do it immediately):

1. **User tells you something about themselves** → `preference` (permanent)
   ```bash
   engram add preference "User hardware" -c "i5-14600KF, DDR5 32GB 6400MHz, Windows 11" --permanent
   ```

2. **You solve a non-trivial bug** → `episode`
   ```bash
   engram add episode "Reranker 40s cold start" \
     -c "Trigger: fresh npm install. Cause: ONNX WASM JIT compilation on first run. Fix: one-time cost, subsequent runs 1.2s." \
     -t "episode,engram,performance"
   ```

3. **You discover a gotcha or pattern** → `reflex` (permanent)
   ```bash
   engram add reflex "Commander postAction hook ordering" \
     -c "Register program.hook('postAction', ...) BEFORE program.parse(), not after." \
     -t "reflex,nodejs,commander" --permanent
   ```

4. **Project architecture is established** → `fact`
   ```bash
   engram add fact "Engram architecture" \
     -c "Stack: Node.js, LibSQL/SQLite, BGE-M3, Commander CLI. Portable skill folder." \
     -t "fact,engram,architecture"
   ```

5. **Important decision is made** → `decision`
   ```bash
   engram add decision "Use LibSQL over PostgreSQL" \
     -c "Reason: zero infra, single-file DB, portable, DiskANN vector index built-in." \
     -t "decision,engram,database"
   ```

### Efficiency rules:

- **Use batch ingest** for 3+ memories — one model load instead of N
- **Title = searchable summary**: make titles that you'd want to find later
- **Content = full context**: include trigger, cause, solution, prevention
- **Tags = categories**: use consistent tags for filtering (`project-name`, `tech`, type)
- **Check before saving**: `engram recall "topic"` to avoid duplicates
- **Mark permanent** for reflexes and preferences — they must never decay

## Batch Ingest (preferred for 3+ memories)

Save multiple memories in **one call** — model loads once, 4x faster:

```bash
# From file (recommended for large batches):
engram ingest --file memories.json

# From stdin:
echo '[{"type":"reflex","title":"...","content":"..."}]' | engram ingest

# Direct argument (short batches):
engram ingest '[{"type":"fact","title":"Test","content":"..."}]'
```

JSON format:
```json
[
  {"type": "reflex", "title": "...", "content": "...", "tags": ["a","b"], "permanent": true},
  {"type": "episode", "title": "...", "content": "...", "tags": ["c"]}
]
```

Fields: `type` (required), `title` (required), `content`, `tags` (array or comma-string), `permanent` (bool), `importance` (0-1).

## /remember Workflow

When the user says `/remember` or `запомни`:

1. **Analyze** conversation for new reflexes, episodes, facts, preferences, decisions
2. **Check** existing memories: `engram recall "topic"` to avoid duplicates
3. **Write** memories via `engram ingest --file <tmp>.json` (batch) or individual `engram add`
4. **Confirm** to the user briefly what was saved

## Full CLI Reference

### CRUD

```bash
# Get memory by ID
engram get <id>

# Delete memory
engram delete <id>

# Export all memories
engram export                   # JSON to stdout
engram export -f md             # Markdown format
engram export -o backup.json    # Write to file
```

### Tags

```bash
engram tag add <memoryId> <tagName>
engram tag remove <memoryId> <tagName>
engram tag list                 # all tags with counts
```

### Management

```bash
engram mark <id>                # toggle permanent
engram mark <id> --remove       # remove permanent
engram link <sourceId> <targetId> [-r relation]  # link memories
engram stats                    # statistics
engram diagnostics              # weakest memories, duplicate candidates
engram diagnostics --dup-threshold 0.85  # custom similarity threshold
```

### Consolidation

```bash
engram sleep                    # full consolidation
engram sleep --dry-run          # preview without changes
engram sleep --decay-rate 0.90  # custom decay
engram sleep --prune 0.10       # custom prune threshold
```

### Sessions

```bash
engram session start <id> [-t title]  # start session
engram session end <id> [-s summary]  # end session
engram session list [-n limit]        # list sessions
```

### Consolidation Safety

Consolidation is **idempotent** — running it twice in a row is safe:
- **Decay** uses `last_consolidation_at` as reference, not absolute timestamps
- **Boost** has a ≥1 day cooldown guard
- **Merge** only acts on non-archived memories
- **Extract** *(not yet implemented)* — planned LLM-based pattern discovery

## Environment

| Variable         | Effect                                               |
| ---------------- | ---------------------------------------------------- |
| `ENGRAM_TRACE=1` | Diagnostic logging to stderr (model loading, timing) |
