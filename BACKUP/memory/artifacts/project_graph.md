# Project Graph

## Rails 8 AI Chat (rails-8-websockets-chat)
- **Stack:** Ruby 3.4.8, Rails 8.1.2, SQLite, Solid Stack (Cable, Queue, Cache), Hotwire (Turbo + Stimulus), Tailwind CSS 4, Importmaps
- **Status:** Active — core features working (F001-F008, F011 done), LLM integration verified with LM Studio
- **Path:** `c:\Users\xthel\Desktop\dev\ai-dev\rails-8-websockets-chat`
- **Key decisions:**
  - Raw ActionCable broadcasts (not Turbo::StreamsChannel) due to SQLite unique index issue
  - :async job adapter for Windows development
  - Service-oriented architecture (thin models, service objects for business logic)
  - MarkdownRenderer module (renamed from Markdown to avoid Redcarpet conflict)
- **Remaining:** F009 (online users), F010 (reactions), F012 (PWA), F013 (search), F014 (cleanup job), F015 (tests)

## Whisper Edge (voice-to-text)
- **Stack:** Rust, Candle, Tauri
- **Status:** Completed v6.5 'Pure Incremental' architecture
- **Related:** Used daily for voice input; the user uses it to communicate in this IDE
- **Key decisions:** Multi-backend (CTranslate2, Sherpa-ONNX), word-level local agreement research

## Desktop Document Translator
- **Stack:** Electron, Vue 3, Bun
- **Status:** Active development
- **Related:** EPUB parsing, literary translation with LLM

## Local ML Playground (Thermal Feynman)
- **Stack:** Electron, Vue 3, Transformers.js, WebGPU
- **Status:** UI refactored to 'Thermal Pro' design system
- **Related:** Chat, TTS, STT, image generation with local models

## Haircut Booking System
- **Stack:** AdonisJS 6, Vue 3, Inertia.js
- **Status:** Premium Rose-Violet design
- **Related:** Admin component system, dual-theme entry strategy

## Voxtral PTT (voxtral-demo)
- **Stack:** Rust, Tauri 2, cpal (WASAPI), ringbuf, Groq API (Whisper)
- **Status:** Active — core PTT working, persistent settings, tray menu with Quit. CPU optimization unresolved (5%).
- **Path:** `c:\Users\xthel\Desktop\dev\ai-dev\voxtral-demo`
- **Key decisions:**
  - Lock-free ring buffer (`ringbuf::HeapRb`) for audio capture
  - `stream.pause()/play()` for cpal stream control
  - Dynamic overlay window creation per session
  - Targeted `window.emit()` for IPC, AtomicBool guard for key repeats
  - Dirty-flag canvas rendering (~31fps at 165Hz monitor)
  - Portable config: `config.json` next to exe via `std::env::current_exe()` (not %APPDATA%)
  - Tray: left-click toggles settings, right-click shows menu (Settings / Quit)
  - Tray icon: `include_bytes!` + `image-png` Tauri feature
  - Settings auto-save on change with fade-in/out "Saved ✓" toast indicator
- **Remaining:** CPU 5% root cause (needs profiling), theme switching (light/dark)
- **Related:** Whisper Edge (same domain — voice-to-text, but local inference)

## Long-Horizon Agent Harness
- **Stack:** Markdown prompts, JSON schema, shell scripts (bash + PowerShell)
- **Status:** v2 — enhanced with Anthropic autonomous-coding patterns _(2026-02-16)_
- **Path:** `c:\Users\xthel\Desktop\dev\harness` + `C:\Users\xthel\.gemini\antigravity\skills\long-horizon-harness`
- **Key decisions:**
  - IDE-native architecture (not standalone script like Anthropic's example)
  - 7-point commit gating reinforcement (primacy-recency effect)
  - Browser testing as optional with conditional HTML comment sections
  - `app_spec.md` (markdown, not .txt) as project specification source of truth
  - Same-session init→continue bridge in SKILL.md Step 6
  - IDE file reading tools instead of `cat` (avoids truncation)
- **Related:** Used as a meta-tool for all other projects

## Memories (Save.day analog)
- **Stack:** React, Next.js, Turso (SQLite + native vector search), Better Auth, Inngest, Vercel
- **Status:** Planning — architecture defined, 5-phase roadmap created _(2026-02-15)_
- **Related:** Chrome extension, Telegram bot, semantic search

## Engram (claude-memory)
- **Stack:** Node.js, LibSQL/SQLite, BGE-M3 (1024-dim embeddings), BGE-Reranker, Commander CLI, @huggingface/transformers
- **Status:** Active — 31/31 features passing. Portable skill in `SKILLS/engram/` _(2026-02-17)_
- **Path:** `c:\Users\xthel\Desktop\dev\ai-dev\claude-memory`
- **Key decisions:**
  - LibSQL over PostgreSQL — zero infra, portable, DiskANN vector index
  - BGE-M3 — fully local, multilingual, no API keys
  - Hybrid search (semantic + FTS5) with RRF fusion
  - Cross-encoder reranking for precision
  - Auto-linking (cosine > 0.7) builds knowledge graph organically
  - Sleep consolidation: idempotent decay + boost + merge + prune
  - Batch ingest (`engram ingest`) — one model load for N memories
  - Portable skill folder (copy → npm install → npm link → done)
- **Remaining:** Extract step (LLM-based pattern discovery), daemon mode for sub-second recall
- **Related:** Persistent Memory skill (markdown artifacts), Memories project (web-based analog)
