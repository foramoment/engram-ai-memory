# Episodes — Significant Problems Solved

### Turbo 2.0 Broadcast Failure with SQLite _(2026-02-14)_
- **Trigger:** `ArgumentError: No unique index found for id` when sending chat messages
- **Root cause:** `Turbo::StreamsChannel.broadcast_append_to` calls `dom_id(model)` which inspects the model's table for a unique index on `id`. SQLite doesn't always create one the way Turbo expects.
- **Solution:** Bypass Turbo entirely — use `ActionCable.server.broadcast("chat_room", "<turbo-stream action=\"append\" target=\"messages\"><template>#{html}</template></turbo-stream>")` with manually rendered HTML via `ApplicationController.render`.
- **Prevention:** In any Rails 8 + SQLite + Turbo project, always use raw ActionCable broadcasts instead of Turbo::StreamsChannel helpers.

### Solid Cable Table Not Created _(2026-02-14)_
- **Trigger:** `ActiveRecord::StatementInvalid: Could not find table 'solid_cable_messages'`
- **Root cause:** `rails db:prepare` alone doesn't always load the cable schema. The `db/cable_schema.rb` existed but was empty (version 0, no tables defined).
- **Solution:** Run `rails solid_cable:install` (overwrites cable_schema.rb with proper table definitions), then `rails db:schema:load:cable` to load into the SQLite database.
- **Prevention:** After `solid_cable:install`, always verify cable_schema.rb contains `create_table "solid_cable_messages"` and run `db:schema:load:cable`.

### Solid Queue fork() Crash on Windows _(2026-02-14)_
- **Trigger:** `NotImplementedError: fork() function is unimplemented on this machine` when starting Rails server
- **Root cause:** Solid Queue Puma plugin uses `fork()` to spawn a supervisor process. Windows doesn't support `fork()`.
- **Solution:** Don't enable `SOLID_QUEUE_IN_PUMA` on Windows. Instead, set `config.active_job.queue_adapter = :async` in `development.rb`. This processes jobs in threads within the same Puma process.
- **Prevention:** Always check OS before enabling fork-based features. On Windows, use thread-based alternatives.

### Net::HTTP Not Loaded in Async Job Threads _(2026-02-14)_
- **Trigger:** `NameError: uninitialized constant LlmService::Net` when LlmResponseJob runs
- **Root cause:** The `:async` Active Job adapter runs jobs in a separate thread. Rails autoloading for stdlib modules like `Net::HTTP` doesn't work across thread boundaries the same way.
- **Solution:** Add explicit `require "net/http"` and `require "json"` at the top of `LlmService`.
- **Prevention:** Any service used in background jobs should explicitly require its stdlib dependencies.

### Typing Indicator Crashing LLM Job _(2026-02-14)_
- **Trigger:** LlmResponseJob silently fails — no assistant message created, `Performed` log shows but 0 assistant messages in DB.
- **Root cause:** The typing indicator used `Turbo::StreamsChannel.broadcast_replace_to`, which hit the same "No unique index" error. The `rescue StandardError` caught it silently, skipping the entire message creation.
- **Solution:** Replace all Turbo::StreamsChannel calls in the job with raw ActionCable broadcasts. Add backtrace to error logging.
- **Prevention:** Never use Turbo::StreamsChannel in background jobs with SQLite. Always log full backtrace in rescue blocks.

### Voxtral PTT — 5% CPU on Recording (WIP) _(2026-02-15)_
- **Trigger:** `voxtral-ptt.exe` uses 5% CPU (= 100% of one core) during recording when Ctrl+Space is held.
- **Investigated and EXCLUDED:**
  - H1: cpal `stream.play()` idle callback → fixed to pause/play, no CPU change
  - H2: `transparent: true` + `alwaysOnTop` DWM compositing → removed transparent → no change
  - H3: WebView2 processes → confirmed via System Informer: msedgewebview2 = 1%, voxtral-ptt.exe = 5%
  - H4: `app.emit()` broadcast to all windows → switched to targeted `window.emit()` → no change
  - H6: Key repeat flooding → added `AtomicBool` guard in shortcut handler → no change
- **Diagnostic:** Overlay + IPC forwarder disabled entirely → CPU still 5%. Not WebView2, not IPC, not overlay rendering.
- **Remaining suspects:** cpal WASAPI event loop, Tauri event loop, or tokio runtime. Need `cargo flamegraph` or ETW.
- **Prevention:** TBD — root cause not yet found.

### Long-Horizon Harness v2 — Anthropic Pattern Integration _(2026-02-16)_
- **Trigger:** Agent frequently forgets to commit after completing features, skipping directly to the next one. Also, `cat` commands produce truncated output in IDE environments.
- **Root cause:** Commit step was in the middle of the workflow (low salience). No gating mechanism. Prompts relied on `cat` for file reading which doesn't work in IDEs.
- **Solution:** Applied 7-point commit reinforcement using gating pattern (feature ≠ complete until committed) and primacy-recency effect (critical rules at start + end of prompt). Replaced `cat` with IDE file reading instructions. Added mandatory regression check (Step 3), conditional browser testing via HTML comments, `app_spec.md` as source of truth, and same-session init→continue bridge in SKILL.md.
- **Prevention:** When writing agent workflow prompts: (1) put critical rules at START and END, (2) use gating not checklists, (3) never assume bash tools work in IDE, (4) use HTML comments for conditional sections.

### Antigravity IDE — Terminal Output Truncation Deep Dive _(2026-02-17)_
- **Trigger:** `cargo build` output consistently truncated/mangled in `command_status`. Progress bar fragments overlap, lines break mid-word. Had to redirect to build.log and read via `view_file`.
- **Root cause:** Multiple overlapping issues: (1) Cargo uses `\r` carriage returns for progress bar updates — IDE parser concatenates them instead of overwriting. (2) ANSI color codes add noise. (3) ConPTY on Windows can hang `conhost.exe`, requiring manual kill. (4) `command_status` has a character limit that truncates long output.
- **Solution:** Set `CARGO_TERM_COLOR=never` and `CARGO_TERM_PROGRESS_WHEN=never` env vars (fixes at SOURCE, not receiver). For guaranteed output, redirect to file: `cargo build 2>&1 | Out-File build.log` then `view_file`.
- **Key insight — Shell Integration paradox:** VS Code Shell Integration (`OSC 633`) was suggested as a culprit, but research revealed it's REQUIRED by AI agents using VS Code Terminal API (Copilot, Roo Code, Kilo Code). Disabling it would make those agents blind. Antigravity may use a different mechanism (ConPTY direct), so the fix should be at the TOOL level (env vars), not the IDE level (shell integration toggle).
- **Prevention:** For any CLI tool with noisy output (progress bars, colors), set tool-specific env vars: `CARGO_TERM_COLOR=never`, `NO_COLOR=1` (cross-tool standard), `CARGO_TERM_PROGRESS_WHEN=never`. Redirect to file as backup.

### Engram — Restructure into Portable SKILLS/engram/ Folder _(2026-02-17)_
- **Trigger:** Need to package Engram as a self-contained skill that can be copied to any agent.
- **Solution:** `git mv` all source into `SKILLS/engram/`. DB path uses `__dirname`-relative (`../data/engram.db`) so move was transparent. `npm link` re-registered global CLI. Root `package.json` removed.
- **Key insight:** `.gitignore` doesn't belong inside skill folders — not a convention in other skills. DB files use `**/*.db` glob patterns.
- **Prevention:** When structuring portable packages, use `__dirname`-relative paths and never hardcode absolute paths.

### Engram — Consolidation Idempotency Fix _(2026-02-17)_
- **Trigger:** Running `engram sleep` twice would double-decay and double-boost memories.
- **Root cause:** Decay used absolute `last_accessed_at` — so each run recalculated from scratch. Boost had no cooldown.
- **Solution:** (1) Decay now uses `last_consolidation_at` as COALESCE base: `POWER(0.95, days_since_last_consolidation)`. (2) Boost has ≥1 day cooldown guard. Running twice in a row is now safe.
- **Prevention:** Any periodic maintenance operation must be idempotent — use timestamps of last run, not absolute dates.

### Engram — Batch Ingest for 4x Performance _(2026-02-17)_
- **Trigger:** Saving 8 memories = 8 × 3s = 24s with individual `engram add` calls. Each loads the model separately.
- **Solution:** Added `engram ingest` command accepting JSON array. Loads model once, processes all memories sequentially. 8 memories in ~5s instead of 24s. Supports stdin, `--file`, and direct argument.
- **Prevention:** When designing CLI tools with heavy initialization (ML models), always provide batch operations.
