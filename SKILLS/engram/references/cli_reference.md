# Engram CLI — Full Command Reference

> This file is the comprehensive reference for all Engram CLI commands.
> For quick-start usage and agent workflows, see [SKILL.md](../SKILL.md).

## Commands Overview

| Command       | Purpose                                     | Agent Priority |
| ------------- | ------------------------------------------- | :------------: |
| `recall`      | Smart context retrieval (FoA)               |   🔴 Primary    |
| `add`         | Store a single memory                       |   🔴 Primary    |
| `ingest`      | Batch-store multiple memories               |   🔴 Primary    |
| `search`      | Raw search (semantic/FTS/hybrid)            |  🟡 Secondary   |
| `get`         | Retrieve memory by ID                       |  🟡 Secondary   |
| `update`      | Edit an existing memory                     |  🟡 Secondary   |
| `delete`      | Remove a memory                             |  🟡 Secondary   |
| `tag`         | Add/remove/list tags                        |  🟡 Secondary   |
| `link`        | Create explicit graph links                 |  🟡 Secondary   |
| `mark`        | Toggle permanent flag                       |  🟡 Secondary   |
| `session`     | Session lifecycle management                | 🟢 Maintenance  |
| `stats`       | View statistics                             | 🟢 Maintenance  |
| `diagnostics` | Find weak/duplicate memories                | 🟢 Maintenance  |
| `sleep`       | Run consolidation (decay/prune/merge/boost) | 🟢 Maintenance  |
| `export`      | Export memories to JSON/Markdown            | 🟢 Maintenance  |
| `migrate`     | Import from old Persistent Memory skill     |   ⚪ One-time   |

---

## 🔴 Primary Commands

### `recall` — Smart Context Retrieval

The **primary read command**. Always prefer `recall` over `search`.

```bash
engram recall <query> [options]
```

| Option               | Description                 | Default |
| -------------------- | --------------------------- | ------- |
| `-b, --budget <n>`   | Token budget for output     | 4000    |
| `-t, --type <type>`  | Filter by memory type       | all     |
| `-s, --session <id>` | Include session context     | none    |
| `--short`            | Compact preview (truncated) | off     |

**What it does automatically:**
1. Hybrid search (semantic + FTS5, RRF fusion)
2. Cross-encoder reranking for precision
3. 1-hop graph expansion (follows links)
4. Noise gate (drops composite score < 0.001)
5. Composite scoring: `relevance × importance × strength × recency`
6. Token budget fitting
7. Access logging (updates access_count and last_accessed_at)

**When to use which options:**
- `--short` — when you need a quick overview, not full content
- `-t reflex` — when looking for rules/gotchas specifically
- `-b 2000` — when you have limited context budget
- `-s <sessionId>` — when you need memories in the context of a specific conversation

**Examples:**
```bash
engram recall "error handling patterns"              # General recall
engram recall "user environment setup" -t preference # Specific type
engram recall "current project status" --short       # Quick overview
engram recall "debugging tips" -b 2000               # Budget-limited
```

---

### `add` — Store a Single Memory

```bash
engram add <type> <title> [options]
```

| Option                 | Description                    | Default |
| ---------------------- | ------------------------------ | ------- |
| `-c, --content <text>` | Memory content (or pipe stdin) | title   |
| `-t, --tags <tags>`    | Comma-separated tags           | none    |
| `-i, --importance <n>` | Importance 0.0–1.0             | 0.5     |
| `--no-auto-link`       | Disable auto-linking           | on      |
| `--permanent`          | Exempt from decay/prune        | off     |

**Types:** `reflex`, `episode`, `fact`, `preference`, `decision`

**Built-in deduplication:**
- **Exact match** (same type + title) → bumps access_count, returns `♻️ duplicate`
- **Semantic near-match** (cosine ≥ 0.92) → merges content, returns `🔀 merged`
- **New memory** → creates entry, auto-links to similar, returns `✅ created`

**Auto-link:** By default, Engram discovers up to 3 semantically similar memories and creates `related_to` links automatically. Override threshold with code-level `autoLinkThreshold` parameter.

**Examples:**
```bash
# Reflex (permanent recommended)
engram add reflex "Commander postAction hook ordering" \
  -c "Register program.hook('postAction', ...) BEFORE program.parse(), not after." \
  -t "reflex,nodejs,commander" --permanent

# Episode
engram add episode "Reranker 40s cold start" \
  -c "Trigger: fresh npm install. Cause: ONNX WASM JIT compilation on first run. Fix: one-time cost, subsequent runs 1.2s." \
  -t "episode,engram,performance"

# Fact
engram add fact "Engram architecture" \
  -c "Stack: Node.js, LibSQL/SQLite, BGE-M3, Commander CLI." \
  -t "fact,engram,architecture"

# Preference (permanent recommended)
engram add preference "User hardware" \
  -c "i5-14600KF, DDR5 32GB, Windows 11" --permanent

# Decision
engram add decision "Use LibSQL over PostgreSQL" \
  -c "Reason: zero infra, portable, DiskANN vector index." \
  -t "decision,engram,database"
```

---

### `ingest` — Batch Store (Preferred for 3+ Memories)

Model loads once for the entire batch — **4x faster** than individual `add` calls.

```bash
engram ingest [json]                  # From argument
engram ingest --file memories.json    # From file (recommended)
cat memories.json | engram ingest     # From stdin
```

| Option              | Description                                                   |
| ------------------- | ------------------------------------------------------------- |
| `-f, --file <path>` | Read JSON from file                                           |
| `--remove-file`     | Delete source file after successful ingest (only with --file) |

**JSON format:**
```json
[
  {
    "type": "reflex",
    "title": "Descriptive search-friendly title",
    "content": "Full context with trigger, cause, solution",
    "tags": ["tag1", "tag2"],
    "permanent": true,
    "importance": 0.8
  }
]
```

Fields: `type` (required), `title` (required), `content`, `tags` (array or comma-string), `permanent` (bool), `importance` (0–1).

**`--remove-file` behavior:**
- ✅ Deletes file only when **all** memories ingest successfully
- ⚠️ Preserves file if any memory fails (safe for retry)
- ⚠️ Ignored when input comes from stdin or argument (not a file)

**Best practice:** Always use `--remove-file` with `--file` to prevent temp files from being accidentally committed.

```bash
engram ingest --file memories.json --remove-file
```

---

## 🟡 Secondary Commands

### `search` — Raw Search

Lower-level than `recall`. Use when you need specific search modes or parameters.

```bash
engram search <query> [options]
```

| Option              | Description                          | Default  |
| ------------------- | ------------------------------------ | -------- |
| `-m, --mode <mode>` | `hybrid`, `semantic`, or `fts`       | hybrid   |
| `-t, --type <type>` | Filter by memory type                | all      |
| `-k, --limit <n>`   | Number of results                    | 10       |
| `--rerank`          | Re-score with cross-encoder          | off      |
| `--since <period>`  | Time filter: `1h`, `1d`, `7d`, `30d` | no limit |
| `--hops <n>`        | Follow graph links N hops deep       | 0        |

**When to use `search` instead of `recall`:**
- Need more than 10 results (`-k 50`)
- Need specific search mode (`-m fts` for exact keyword match)
- Need time filtering (`--since 1d` for today's memories only)
- Need multi-hop graph traversal (`--hops 2`)
- Need raw reranking without FoA composite scoring (`--rerank`)

### `get` — Retrieve by ID

```bash
engram get <id>
```

Returns full memory with tags, links, and metadata. Use after `recall` or `search` to get complete details.

### `update` — Edit Existing Memory

```bash
engram update <id> [options]
```

| Option                 | Description            |
| ---------------------- | ---------------------- |
| `-t, --title <title>`  | New title              |
| `-c, --content <text>` | New content            |
| `-i, --importance <n>` | New importance 0.0–1.0 |
| `--type <type>`        | Change memory type     |

Re-embeds automatically when title or content changes.

### `delete` — Remove Memory

```bash
engram delete <id>
```

Hard-deletes the memory and cascades to tags, links, and access log.

### `tag` — Tag Management

```bash
engram tag add <memoryId> <tagName>      # Add tag to memory
engram tag remove <memoryId> <tagName>   # Remove tag from memory
engram tag list                          # List all tags with counts
```

Tags are normalized to lowercase. Duplicate tag assignments are silently ignored.

### `link` — Graph Links

```bash
engram link <sourceId> <targetId> [-r relation]
```

Valid relations: `related_to` (default), `caused_by`, `evolved_from`, `contradicts`, `supersedes`.

### `mark` — Permanent Toggle

```bash
engram mark <id>             # Add 'permanent' tag
engram mark <id> --remove    # Remove 'permanent' tag
```

Permanent memories are **exempt from decay and pruning** during consolidation.

---

## 🟢 Maintenance Commands

### `session` — Session Lifecycle

```bash
engram session start <id> [-t title]      # Start session
engram session end <id> [-s summary]      # End session with summary
engram session list [-n limit]            # List recent sessions
```

**What sessions do:**
- Sessions group memory access patterns within a conversation
- `recall` automatically logs which session accessed which memories
- Session summaries provide searchable conversation history
- `session start` checks if consolidation is overdue (warns if needed)

**Best practice:** Use conversation/thread IDs as session IDs for automatic correlation.

### `stats` — Statistics

```bash
engram stats
```

Shows: total memories, breakdown by type, link count, avg strength, vector index status, device info, last consolidation, top tags.

### `diagnostics` — Memory Health

```bash
engram diagnostics                      # Default settings
engram diagnostics --dup-threshold 0.85 # More aggressive dup detection
engram diagnostics -n 20                # Show 20 weakest (default: 10)
```

Shows weakest memories (lowest strength × importance) and potential duplicate candidates.

### `sleep` — Consolidation

```bash
engram sleep                    # Full consolidation
engram sleep --dry-run          # Preview without changes
engram sleep --decay-rate 0.90  # More aggressive decay
engram sleep --prune 0.10       # Higher prune threshold
```

| Option             | Description             | Default |
| ------------------ | ----------------------- | ------- |
| `--dry-run`        | Preview, no changes     | off     |
| `--decay-rate <n>` | Daily decay multiplier  | 0.95    |
| `--prune <n>`      | Archive below threshold | 0.05    |
| `--merge <n>`      | Merge similarity cutoff | 0.92    |

**Consolidation steps:**
1. **Decay** — strength × decay_rate^days_since_last_access (permanent exempt)
2. **Prune** — archive memories with strength < threshold (permanent exempt)
3. **Boost** — increase strength for frequently accessed memories (1/day cooldown)
4. **Merge** — combine semantically near-duplicate memories

**Safety:** Consolidation is idempotent. Running twice in a row is safe.

### `export` — Export Memories

```bash
engram export                   # JSON to stdout
engram export -f md             # Markdown format
engram export -o backup.json    # Write to file
```

### `migrate` — Import from Legacy Skill

```bash
engram migrate <sourceDir>          # Full migration
engram migrate <sourceDir> --dry-run # Preview only
```

One-time import from the old Persistent Memory skill (reflexes.md, episodes.md, etc.).
