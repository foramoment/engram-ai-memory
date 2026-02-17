# Reflexes — Instant Pattern-Matching Rules
> If you encounter X, immediately do Y. No research needed.

### Windows / Ruby
- **`fork()` not implemented on Windows** → Use `:async` Active Job adapter in development, never `SOLID_QUEUE_IN_PUMA`. _(2026-02-14)_
- **VIPS warnings on Windows** → Remove `image_processing` gem or set `VIPS_WARNING=0`. _(2026-02-14)_
- **PowerShell escaping** → Use `%q{}` for strings with quotes in `rails runner`. _(2026-02-14)_

### Rails 8 / Solid Stack
- **`No unique index found for id` in Turbo broadcasts** → Never use `Turbo::StreamsChannel.broadcast_*_to` with SQLite models. Use `ActionCable.server.broadcast` with raw `<turbo-stream>` HTML instead. _(2026-02-14)_
- **`solid_cable_messages` table missing** → Run `rails solid_cable:install` (answer Y to overwrite), then `rails db:schema:load:cable`. _(2026-02-14)_
- **Solid Queue tables missing** → Run `rails solid_queue:install`, then `rails db:schema:load:queue`. _(2026-02-14)_
- **Tailwind CSS 4 input path** → CSS file goes in `app/assets/tailwind/application.css`, NOT `app/assets/stylesheets/`. _(2026-02-14)_
- **Redcarpet conflicts with `Markdown` module name** → Name your module `MarkdownRenderer`, not `Markdown`. _(2026-02-14)_

### Net::HTTP in Background Jobs
- **`uninitialized constant Net` in async jobs** → Add `require "net/http"` and `require "json"` at the top of service files that use them. Rails autoload doesn't work in async threads. _(2026-02-14)_

### Git / Workflow
- **One feature = one commit** → Never combine multiple features (F-IDs) in a single commit. Format: `feat(FXXX): description`. _(2026-02-14)_

### Tauri / Windows
- **Global shortcut key repeat flood** → `ShortcutState::Pressed` fires repeatedly when key is held. Guard with `AtomicBool::swap()`. _(2026-02-15)_
- **cpal `stream.play()` at construction** → Don't call `stream.play()` until recording starts. Use `stream.pause()` to stop WASAPI callback. _(2026-02-15)_
- **`app.emit()` broadcasts to ALL windows** → Use `window.emit()` for targeted IPC to a specific window. _(2026-02-15)_
- **Tauri CPU debugging** → Check `voxtral-ptt.exe` vs `msedgewebview2.exe` separately in System Informer. _(2026-02-15)_
- **Tauri 2 tray icon from PNG** → `tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))`. Requires `image-png` feature in Cargo.toml: `tauri = { features = ["tray-icon", "image-png"] }`. No `from_path` method exists. _(2026-02-17)_
- **Tauri 2 tray context menu** → Use `tauri::menu::MenuItem::with_id()` + `tauri::menu::Menu::with_items()` + `.on_menu_event()`. Set `.show_menu_on_left_click(false)` to keep left-click for custom behavior. _(2026-02-17)_
- **Tauri portable config** → Save config next to exe: `std::env::current_exe().parent().join("config.json")`. Avoid `dirs::config_dir()` for portable apps. _(2026-02-17)_

### Cargo / Rust Build
- **Cargo output truncated in IDE** → Set `CARGO_TERM_COLOR=never` and `CARGO_TERM_PROGRESS_WHEN=never` before `cargo build`. Progress bars use `\r` (carriage return) which IDE parsers can't handle. ANSI colors add noise. This fixes the source, not the receiver. _(2026-02-17)_
- **General CLI output cleanup** → Use `NO_COLOR=1` env var (cross-tool standard) for any CLI tool producing ANSI. _(2026-02-17)_

### Antigravity IDE / Terminal
- **VS Code Shell Integration (`terminal.integrated.shellIntegration`)** → Do NOT disable it blindly. Copilot/Roo Code/Kilo Code NEED it enabled (they use VS Code Terminal API which relies on OSC 633 markers). Antigravity's `run_command` may use a different mechanism. Fix output issues at the SOURCE (env vars like `CARGO_TERM_COLOR=never`) rather than the RECEIVER (shell integration). _(2026-02-17)_
- **Redirect to file for reliable output** → When `command_status` truncates, use `command 2>&1 | Out-File build.log`, then `view_file` on the log. 100% reliable. _(2026-02-17)_

### Data Integrity / Fact-Checking
- **Quantitative claims are NEVER trustworthy from training data** → Before citing ANY numbers (pricing tiers, rate limits, context windows, model parameters, version features, free tier quotas, benchmarks), ALWAYS `search_web` first. Training data is ~1 year stale — prices change, tiers change, features change. Citing wrong numbers erodes trust and can cause architectural mistakes (e.g., planning for 9GB storage when the real limit is 5GB). The cost of a web search is zero; the cost of a wrong number is high. _(2026-02-16)_
- **Technology recommendations require live research** → When recommending or comparing technologies (auth libraries, databases, frameworks), search for current community consensus (`"X vs Y 2025"`, official docs, changelogs) BEFORE making a recommendation. Do not rely solely on training data for tech selection — ecosystems shift fast. _(2026-02-16)_

### Prompt Engineering / Agent Harness
- **Agent skips commits after features** → Use gating: "A feature is NOT complete until committed". Place reminders at step boundary, in DON'T list, AND at end of prompt (primacy-recency effect). _(2026-02-16)_
- **`cat` truncates in IDE** → Never use `cat` in IDE agent workflows. Always instruct to use IDE's built-in file reading tool. _(2026-02-16)_
- **Conditional prompt sections** → Wrap optional content in `<!-- MARKER_START -->` / `<!-- MARKER_END -->` HTML comments for removal during init. _(2026-02-16)_
- **Primacy-recency effect** → Critical rules belong at the START and END of prompts. Middle gets forgotten during long context. _(2026-02-16)_

### Node.js / Transformers.js
- **Process hangs after ML inference** → Transformers.js creates Worker Threads for WASM that keep the event loop alive. Fix: `program.hook('postAction', () => setTimeout(() => process.exit(0), 50))`. Register BEFORE `program.parse()`. _(2026-02-17)_
- **ONNX WASM cold start after npm install** → First run after fresh `npm install` takes ~40s for reranker (WASM JIT compilation). Subsequent runs: ~1.2s. One-time cost, not a bug — OS caches compiled WASM. _(2026-02-17)_
- **npm link for global CLI** → 1) Shebang `#!/usr/bin/env node`, 2) `"bin"` in package.json, 3) `npm link`. Standard pattern (eslint, prettier, vitest). _(2026-02-17)_
- **Commander postAction hook ordering** → Register `program.hook('postAction', ...)` BEFORE `program.parse()`, not after. Commander's parse() is synchronous for hook registration. _(2026-02-17)_
- **Transformers.js dtype warning** → Pass explicit `dtype: 'fp32'` to suppress "no dtype specified" warning. _(2026-02-17)_

