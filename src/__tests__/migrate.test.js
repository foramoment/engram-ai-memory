// @ts-check
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, unlinkSync } from "node:fs";
import { parseReflexes, parseEpisodes, parsePreferences, parseProjectGraph, migrateFromSkill } from "../migrate.js";
import { initDb, resetClient } from "../db.js";
import { getMemory, getStats, getAllTags, getLinks } from "../memory.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = resolve(__dirname, "..", "..", "data", "test_migrate.db");
const SKILL_ARTIFACTS = resolve("C:\\Users\\xthel\\.gemini\\antigravity\\skills\\memory\\artifacts");

// -- Parser Tests (pure functions, no DB needed) --

describe("migrate.js — parseReflexes", () => {
    it("should parse reflex entries with categories", () => {
        const text = `# Reflexes — Instant Pattern-Matching Rules
> If you encounter X, immediately do Y.

### Windows / Ruby
- **\`fork()\` not implemented on Windows** → Use \`:async\` Active Job adapter in development. _(2026-02-14)_
- **VIPS warnings on Windows** → Remove \`image_processing\` gem or set \`VIPS_WARNING=0\`. _(2026-02-14)_

### Git / Workflow
- **One feature = one commit** → Never combine multiple features. _(2026-02-14)_`;

        const entries = parseReflexes(text);
        assert.equal(entries.length, 3);

        assert.equal(entries[0].type, "reflex");
        assert.ok(entries[0].title.includes("fork()"));
        assert.ok(entries[0].content.includes("→"));
        assert.ok(entries[0].tags.includes("windows-ruby"));
        assert.ok(entries[0].tags.includes("migrated"));
        assert.equal(entries[0].date, "2026-02-14");

        assert.equal(entries[2].type, "reflex");
        assert.ok(entries[2].tags.includes("git-workflow"));
    });

    it("should handle empty file", () => {
        const entries = parseReflexes("# Empty\n");
        assert.equal(entries.length, 0);
    });
});

describe("migrate.js — parseEpisodes", () => {
    it("should parse episode entries", () => {
        const text = `# Episodes

### Turbo 2.0 Broadcast Failure _(2026-02-14)_
- **Trigger:** ArgumentError on chat messages
- **Root cause:** SQLite unique index incompatibility
- **Solution:** Use raw ActionCable broadcasts
- **Prevention:** Always use raw ActionCable with SQLite

### CPU Bug _(2026-02-15)_
- **Trigger:** 5% CPU usage
- **Investigated:** cpal, DWM, WebView2
- **Prevention:** TBD`;

        const entries = parseEpisodes(text);
        assert.equal(entries.length, 2);

        assert.equal(entries[0].type, "episode");
        assert.equal(entries[0].title, "Turbo 2.0 Broadcast Failure");
        assert.ok(entries[0].content.includes("Trigger:"));
        assert.ok(entries[0].content.includes("Solution:"));
        assert.equal(entries[0].date, "2026-02-14");
        assert.ok(entries[0].tags.includes("episode"));

        assert.equal(entries[1].title, "CPU Bug");
        assert.equal(entries[1].date, "2026-02-15");
    });
});

describe("migrate.js — parsePreferences", () => {
    it("should parse preference categories", () => {
        const text = `# User Preferences

### Communication
- **Language:** Russian (primary), English for code
- **Tone:** Friendly, curious

### Development Environment
- **OS:** Windows
- **Shell:** PowerShell`;

        const entries = parsePreferences(text);
        assert.equal(entries.length, 2);

        assert.equal(entries[0].type, "preference");
        assert.equal(entries[0].title, "Communication");
        assert.ok(entries[0].content.includes("Language:"));
        assert.ok(entries[0].tags.includes("communication"));

        assert.equal(entries[1].title, "Development Environment");
        assert.ok(entries[1].tags.includes("development-environment"));
    });
});

describe("migrate.js — parseProjectGraph", () => {
    it("should parse project entries", () => {
        const text = `# Project Graph

## Rails 8 AI Chat
- **Stack:** Ruby 3.4.8, Rails 8.1.2
- **Status:** Active
- **Related:** Whisper Edge

## Whisper Edge
- **Stack:** Rust, Candle, Tauri
- **Status:** Completed`;

        const entries = parseProjectGraph(text);
        assert.equal(entries.length, 2);

        assert.equal(entries[0].type, "fact");
        assert.equal(entries[0].title, "Rails 8 AI Chat");
        assert.ok(entries[0].content.includes("Stack:"));
        assert.ok(entries[0].tags.includes("project"));
    });
});

// -- Integration Test (full migration with real DB) --

describe("migrate.js — full migration (integration)", { concurrency: false }, () => {
    /** @type {import("@libsql/client").Client} */
    let client;

    before(async function () {
        this.timeout = 300_000;
        resetClient();
        for (const suffix of ["", "-journal", "-wal", "-shm"]) {
            const p = TEST_DB_PATH + suffix;
            if (existsSync(p)) { try { unlinkSync(p); } catch { /* */ } }
        }
        const db = await initDb(TEST_DB_PATH);
        client = db.client;
    });

    after(() => {
        resetClient();
        for (const suffix of ["", "-journal", "-wal", "-shm"]) {
            const p = TEST_DB_PATH + suffix;
            if (existsSync(p)) { try { unlinkSync(p); } catch { /* */ } }
        }
    });

    it("should run dry-run migration from real skill artifacts", async () => {
        const result = await migrateFromSkill(client, SKILL_ARTIFACTS, { dryRun: true });
        assert.ok(result.reflexes > 0, "Should find reflexes");
        assert.ok(result.episodes > 0, "Should find episodes");
        assert.ok(result.preferences > 0, "Should find preferences");
        assert.ok(result.projects > 0, "Should find projects");
        assert.ok(result.total > 10, "Should find 10+ total entries");
        assert.equal(result.errors.length, 0, "No errors expected");
    });

    it("should run real migration and create memories", async () => {
        const result = await migrateFromSkill(client, SKILL_ARTIFACTS, { dryRun: false });
        assert.ok(result.total > 10, "Should import 10+ memories");

        // Verify memories exist in DB
        const stats = await getStats(client);
        assert.equal(stats.totalMemories, result.total);

        // Verify tags were created
        const tags = await getAllTags(client);
        const tagNames = tags.map((t) => t.name);
        assert.ok(tagNames.includes("migrated"), "Should have 'migrated' tag");
        assert.ok(tagNames.includes("reflex"), "Should have 'reflex' tag");
        assert.ok(tagNames.includes("episode"), "Should have 'episode' tag");

        // Verify some links were created between projects
        if (result.links > 0) {
            assert.ok(result.links >= 1, "Should create project links");
        }
    });
});
