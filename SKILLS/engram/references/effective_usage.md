# Engram — Effective Usage Patterns

> This guide teaches an agent HOW and WHEN to use Engram's capabilities
> for maximum effectiveness. For CLI syntax, see [cli_reference.md](cli_reference.md).

## Core Philosophy

Engram is a **cognitive memory system** inspired by neuroscience. It works best when
the agent treats it like a brain — not a database:

1. **Write proactively** — don't wait for `/remember`. Save as you learn.
2. **Read before you act** — always `recall` before starting a task.
3. **Let consolidation work** — `sleep` naturally strengthens useful memories and prunes noise.
4. **Build the graph** — links between memories are where the real power is.

---

## Session Lifecycle

Every conversation should follow this pattern:

```
┌─── Session Start ───────────────────────────────────────┐
│  1. Run session-start.ps1 (auto-loads context)          │
│  2. OR: engram recall "<relevant query>"                │
│     (DO NOT announce memory loading to the user)        │
├─── Work Phase ──────────────────────────────────────────┤
│  3. Save memories PROACTIVELY as you work               │
│  4. Use recall before making decisions                  │
│  5. Link related discoveries together                   │
├─── Session End ─────────────────────────────────────────┤
│  6. On /remember — analyze and save remaining insights  │
│  7. End session with summary                            │
└─────────────────────────────────────────────────────────┘
```

### Session Start

**Option A: Script (fastest)**
```powershell
& "<skill-folder>\scripts\session-start.ps1"
```
This runs 3 targeted recalls (reflexes, preferences, active projects) with separate
type filters and token budgets. Total: ~4000 tokens of context.

**Option B: Manual recall**
```bash
engram recall "relevant topic for current conversation"
```
Use when you know the conversation topic upfront.

**Critical rule:** NEVER announce "I'm loading memories" or "Let me check my memory."
Read silently, use the context naturally.

### During the Conversation

**Save immediately when you encounter:**

| Trigger                             | Type         | Permanent? | Example                                 |
| ----------------------------------- | ------------ | :--------: | --------------------------------------- |
| User reveals a preference           | `preference` |     ✅      | IDE choice, language, hardware          |
| You solve a non-trivial bug         | `episode`    |     —      | Trigger → cause → solution → prevention |
| You discover a gotcha/pattern       | `reflex`     |     ✅      | "If X happens → do Y"                   |
| Project architecture is established | `fact`       |     —      | Stack, structure, key files             |
| Important decision with rationale   | `decision`   |     —      | "Chose X over Y because Z"              |

**Efficiency rules:**
- For 3+ memories → use `ingest --file ... --remove-file` (one model load, auto-cleanup)
- Always check for duplicates before saving: `engram recall "topic" --short`
- Title = searchable summary (write titles you'd want to find later)
- Content = full context (include ALL relevant details)
- Tags = consistent categories (`project-name`, tech name, type)

### Session End

When the user says `/remember` or `запомни`:

1. **Analyze** conversation for new reflexes, episodes, facts, preferences, decisions
2. **Check** existing memories: `engram recall "topic" --short` for each area
3. **Write** via `engram ingest --file <tmp>.json --remove-file` (batch + auto-cleanup)
4. **Confirm** to user briefly what was saved

---

## Search Strategy

### Decision Tree: recall vs search

```
Do you need context for a task?
├── YES → engram recall "query"           (FoA, composite scoring, budget)
│   ├── Need specific type? → -t reflex
│   ├── Limited budget? → -b 2000
│   └── Need session context? → -s <id>
└── NO, need raw results?
    └── engram search "query"             (raw, more control)
        ├── Exact keywords? → -m fts
        ├── Concept match? → -m semantic
        ├── Need graph context? → --hops 2
        ├── Recent only? → --since 1d
        └── High precision? → --rerank
```

### When to Use Multi-Hop

Use `--hops 1` or `--hops 2` when:
- Exploring a topic area (e.g., "What do I know about project X and everything related?")
- Building full context before a complex task
- The initial results reference linked concepts

```bash
engram search "authentication patterns" --hops 1 --rerank
```

### When to Use Temporal Filters

Use `--since` when you know the information is recent:
```bash
engram search "today's discussion" --since 1d
engram search "this week's decisions" --since 7d
```

---

## Knowledge Graph Patterns

### Auto-Linking (Passive)

Every `add` and `ingest` automatically discovers and links related memories
(cosine similarity ≥ 0.7). This builds the graph organically.

### Explicit Linking (Active)

Create explicit links when relationships are semantically meaningful:

```bash
# Bug led to a decision
engram link 42 58 -r caused_by

# New approach replaces old
engram link 65 42 -r supersedes

# Two facts contradict each other
engram link 12 34 -r contradicts

# Pattern evolved into a rule
engram link 58 61 -r evolved_from
```

**Link types and when to use them:**

| Relation       | Meaning                 | Example                           |
| -------------- | ----------------------- | --------------------------------- |
| `related_to`   | General association     | Two facts about same project      |
| `caused_by`    | Causal chain            | Bug caused an architecture change |
| `evolved_from` | Refinement over time    | Reflex updated with new info      |
| `contradicts`  | Conflicting information | Old approach vs new approach      |
| `supersedes`   | Replacement             | New decision replaces old one     |

### Graph-Powered Recall

When you use `recall` or `search --hops N`, the graph is traversed automatically.
A well-linked graph means better context assembly:

```
Memory A (found by search)
├── related_to → Memory B (pulled in via 1-hop)
│   └── caused_by → Memory C (pulled in via 2-hop)
└── evolved_from → Memory D (pulled in via 1-hop)
```

---

## Consolidation Strategy

### When to Run

- Engram checks automatically on `session start` — if it's been ≥ 1 day, it warns
- Run manually when memory count is high or quality feels low
- Always `--dry-run` first on an unfamiliar database

### Understanding Consolidation Steps

```
sleep
├── Decay: strength *= 0.95^days_since_access    (weaker over time)
├── Prune: archive if strength < 0.05            (remove noise)
├── Boost: +10% strength for popular memories     (reward usefulness)
└── Merge: combine near-duplicates (cos ≥ 0.92)  (reduce clutter)
```

**Permanent memories** (tagged `permanent`) are exempt from decay and prune.
This is why reflexes and preferences should almost always be permanent.

### Best Practice

```bash
# 1. Preview first
engram sleep --dry-run

# 2. Run if it looks right
engram sleep

# 3. Check health after
engram diagnostics
```

---

## Memory Type Decision Guide

```
Is this a rule/pattern?
├── YES → "If X, then Y" format?
│   ├── YES → reflex (permanent)
│   └── NO, more like a preference? → preference (permanent)
└── NO
    ├── Was there a problem-solution?
    │   └── YES → episode
    │       Include: trigger, root cause, solution, prevention
    ├── Is this a factual observation?
    │   └── YES → fact
    │       Include: project name, stack, architecture, relationships
    └── Was a choice made with rationale?
        └── YES → decision
            Include: what, alternatives, why this one, tradeoffs
```

---

## Anti-Patterns to Avoid

| ❌ Don't                            | ✅ Do Instead                                       |
| ---------------------------------- | -------------------------------------------------- |
| Announce "Loading memories..."     | Read silently, use context naturally               |
| Save every small detail            | Save only what's worth finding later               |
| Write vague titles like "Bug fix"  | Write searchable titles: "LibSQL vector index NPE" |
| Use `search` for everyday context  | Use `recall` (it does more automatically)          |
| Save 10 memories one at a time     | Batch with `ingest --file ... --remove-file`       |
| Forget to tag with project name    | Always include project tag for filtering           |
| Leave temp JSON files after ingest | Always use `--remove-file` with `ingest --file`    |
| Let memory grow unbounded          | Run `sleep` periodically, check `diagnostics`      |
| Skip duplicate check before saving | Always `recall "topic" --short` first              |
| Create memories without content    | Always add full context in `-c`                    |
| Leave reflexes non-permanent       | Mark reflexes and preferences as `--permanent`     |

---

## Environment

| Variable         | Effect                                               |
| ---------------- | ---------------------------------------------------- |
| `ENGRAM_TRACE=1` | Diagnostic logging to stderr (model loading, timing) |
