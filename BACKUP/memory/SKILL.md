---
name: Persistent Memory
description: Three-layer persistent memory system — reflexes, episodes, and user preferences. Read at session start, updated on /remember command.
---

# Persistent Memory Skill

## Purpose

This skill provides persistent memory across sessions. It compensates for the stateless nature of each conversation by maintaining structured knowledge files on disk.

## Auto-Load (Session Start)

**When this skill is referenced in user rules, you MUST silently read the following files at the very beginning of the conversation, before responding to the user's first message:**

1. `C:\Users\xthel\.gemini\antigravity\skills\memory\artifacts\reflexes.md` — instant pattern-matching rules (if X → do Y)
2. `C:\Users\xthel\.gemini\antigravity\skills\memory\artifacts\episodes.md` — solved problems with full context
3. `C:\Users\xthel\.gemini\antigravity\skills\memory\artifacts\preferences.md` — user preferences, communication style, environment details
4. `C:\Users\xthel\.gemini\antigravity\skills\memory\artifacts\project_graph.md` — relationships between projects, technologies, and concepts

**Do NOT announce that you are reading memory files. Just read them and use the context naturally.**

## /remember Workflow (Session End)

When the user says `/remember`, `запомни`, or similar:

1. **Analyze** the current conversation for:
   - New reflexes (bug patterns, gotchas, solutions that should be instant next time)
   - New episodes (significant problems solved, with root cause and solution)
   - Updated preferences (communication style, tools, environment changes)
   - New project relationships or technology connections

2. **Read** the existing memory files to avoid duplicates.

3. **Update** each file by:
   - **Appending** new entries (never delete existing ones without user approval)
   - **Merging** if a similar entry already exists (update, don't duplicate)
   - **Timestamping** each new entry with the current date

4. **Confirm** to the user what was saved, briefly.

## File Formats

### reflexes.md
Short, actionable rules. Max 80 entries. Format:
```
### [Category]
- **[Trigger]** → [Action]. _(date)_
```

### episodes.md
Detailed problem-solution pairs. Format:
```
### [Title] _(date)_
- **Trigger:** what happened
- **Root cause:** why it happened
- **Solution:** what fixed it
- **Prevention:** how to avoid next time
```

### preferences.md
Flat key-value pairs and notes. Format:
```
### [Category]
- **key:** value
```

### project_graph.md
Relationships in simple text format:
```
## [Project Name]
- **Stack:** ...
- **Status:** ...
- **Related:** [other projects]
- **Key decisions:** ...
```

## Maintenance Rules

- Reflexes: if a reflex hasn't been useful in 3+ months, mark it with `[stale]`
- Episodes: keep all, they are the most valuable asset
- Preferences: update in-place (don't accumulate history)
- Project graph: update status on each session that touches the project
