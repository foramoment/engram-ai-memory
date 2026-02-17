// @ts-check
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unlinkSync, existsSync } from "node:fs";
import { initDb, resetClient, setMeta, getMeta } from "../db.js";
import { addMemory, logAccess } from "../memory.js";
import { startSession, endSession, getSessionContext, listSessions } from "../session.js";
import { recall, formatRecallContext } from "../foa.js";
import { runConsolidation, shouldConsolidate, getConsolidationPreview } from "../consolidation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = resolve(__dirname, "..", "..", "data", "test_session.db");

/** @type {import("@libsql/client").Client} */
let client;
let dbReady = false;

async function ensureDb() {
    if (!dbReady) {
        resetClient();
        for (const suffix of ["", "-journal", "-wal", "-shm"]) {
            const p = TEST_DB_PATH + suffix;
            if (existsSync(p)) { try { unlinkSync(p); } catch { /* */ } }
        }
        const db = await initDb(TEST_DB_PATH);
        client = db.client;
        dbReady = true;
    }
}

async function clearTables() {
    await ensureDb();
    await client.execute("DELETE FROM access_log");
    await client.execute("DELETE FROM memory_tags");
    await client.execute("DELETE FROM memory_links");
    await client.execute("DELETE FROM memories");
    await client.execute("DELETE FROM tags");
    await client.execute("DELETE FROM sessions");
    try { await client.execute("DELETE FROM sqlite_sequence"); } catch { /* */ }
}

function cleanupAll() {
    resetClient();
    dbReady = false;
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
        const p = TEST_DB_PATH + suffix;
        if (existsSync(p)) { try { unlinkSync(p); } catch { /* */ } }
    }
}

// -- Session Tests --

describe("session.js — Session Management", () => {
    before(async function () {
        this.timeout = 300_000;
        await clearTables();
    });

    it("should start a session", async () => {
        await startSession(client, "sess-001", "Test Session");
        const sessions = await listSessions(client);
        assert.ok(sessions.length >= 1);
        assert.equal(sessions[0].id, "sess-001");
        assert.equal(sessions[0].title, "Test Session");
    });

    it("should end a session with summary", async () => {
        await startSession(client, "sess-002", "Summary Test");
        await endSession(client, "sess-002", "Discussed vectors and embeddings");
        const sessions = await listSessions(client);
        const s = sessions.find((s) => s.id === "sess-002");
        assert.ok(s);
        assert.equal(s.summary, "Discussed vectors and embeddings");
        assert.ok(s.ended_at, "ended_at should be set");
    });

    it("should get session context with accessed memories", async () => {
        await startSession(client, "sess-003", "Context Test");
        const memId = await addMemory(client, { type: "fact", title: "Session Fact", content: "Relevant to session" });
        await logAccess(client, memId, "sess-003", "context query", 0.9);

        const ctx = await getSessionContext(client, "sess-003");
        assert.ok(ctx);
        assert.equal(ctx.session.id, "sess-003");
        assert.ok(ctx.accessedMemories.length >= 1);
        assert.equal(ctx.accessedMemories[0].title, "Session Fact");
    });

    it("should return null for non-existent session", async () => {
        const ctx = await getSessionContext(client, "nonexistent");
        assert.equal(ctx, null);
    });

    it("should list sessions with limit", async () => {
        const sessions = await listSessions(client, { limit: 2 });
        assert.ok(sessions.length <= 2);
    });
});

// -- FoA Tests --

describe("foa.js — Focus of Attention", () => {
    before(async function () {
        this.timeout = 300_000;
        await clearTables();

        await addMemory(client, { type: "fact", title: "Neural Networks", content: "Deep learning uses layered neural architectures" });
        await addMemory(client, { type: "fact", title: "Database Indexing", content: "B-tree and hash indexes speed up queries" });
        await addMemory(client, { type: "reflex", title: "Git Best Practices", content: "Always commit frequently with descriptive messages" });
    });

    it("should recall relevant memories", async () => {
        const result = await recall(client, "machine learning architectures");
        assert.ok(result.memories.length > 0);
        assert.ok(result.totalTokensEstimate > 0);
    });

    it("should respect token budget", async () => {
        const result = await recall(client, "technology", { budget: 50 });
        assert.ok(result.totalTokensEstimate <= 200, "Should roughly respect budget"); // Soft limit
        assert.ok(result.memories.length >= 1, "Should return at least 1 memory");
    });

    it("should format recall context as text", async () => {
        const result = await recall(client, "database");
        const text = formatRecallContext(result);
        assert.ok(text.includes("## Relevant Memories"));
        assert.ok(text.includes("memories |"));
        assert.ok(text.includes("tokens"));
    });

    it("should include session context when provided", async () => {
        await startSession(client, "foa-sess", "FoA Test");
        await endSession(client, "foa-sess", "Working on database optimization");

        const result = await recall(client, "database", { sessionId: "foa-sess" });
        assert.equal(result.sessionContext, "Working on database optimization");
    });
});

// -- Consolidation Tests --

describe("consolidation.js — Sleep Consolidation", () => {
    before(async function () {
        this.timeout = 300_000;
        await clearTables();
    });

    it("should check if consolidation is needed", async () => {
        const { shouldRun, daysSinceLast } = await shouldConsolidate(client);
        assert.equal(shouldRun, true, "Should run if never consolidated");
        assert.equal(daysSinceLast, null);
    });

    it("should run consolidation with decay", async () => {
        await clearTables();
        // Create memories with different ages
        await addMemory(client, { type: "fact", title: "Old Fact", content: "Something old" });
        await addMemory(client, { type: "fact", title: "New Fact", content: "Something new" });

        // Simulate old access
        await client.execute({
            sql: "UPDATE memories SET last_accessed_at = datetime('now', '-30 days') WHERE title = 'Old Fact'",
            args: [],
        });

        const result = await runConsolidation(client, { decayRate: 0.95, pruneThreshold: 0.01 });
        assert.ok(result.decayed >= 0, "Should report decayed count");
        assert.ok(result.elapsed_ms > 0, "Should report elapsed time");
    });

    it("should prune weak memories", async () => {
        await clearTables();
        await addMemory(client, { type: "fact", title: "Strong", content: "Important" });
        await addMemory(client, { type: "fact", title: "Weak", content: "Not important" });

        // Make one memory very weak
        await client.execute("UPDATE memories SET strength = 0.01 WHERE title = 'Weak'");

        const result = await runConsolidation(client, { pruneThreshold: 0.05 });
        assert.equal(result.pruned, 1, "Should prune 1 weak memory");

        // Verify it's archived
        const archived = await client.execute("SELECT * FROM memories WHERE title = 'Weak'");
        assert.equal(Number(archived.rows[0].archived), 1);
    });

    it("should boost frequently accessed memories", async () => {
        await clearTables();
        await addMemory(client, { type: "fact", title: "Popular", content: "Accessed often" });
        await client.execute("UPDATE memories SET access_count = 10, strength = 0.5 WHERE title = 'Popular'");

        const result = await runConsolidation(client, { boostMinAccess: 3 });
        assert.ok(result.boosted >= 1, "Should boost popular memory");

        const mem = await client.execute("SELECT strength FROM memories WHERE title = 'Popular'");
        assert.ok(Number(mem.rows[0].strength) > 0.5, "Strength should increase");
    });

    it("should support dry run mode", async () => {
        await clearTables();
        await addMemory(client, { type: "fact", title: "Dry Run Test", content: "Should not change" });
        await client.execute("UPDATE memories SET strength = 0.01 WHERE title = 'Dry Run Test'");

        const result = await runConsolidation(client, { dryRun: true });
        // Verify nothing was actually changed
        const mem = await client.execute("SELECT strength, archived FROM memories WHERE title = 'Dry Run Test'");
        assert.equal(Number(mem.rows[0].strength), 0.01, "Strength should not change in dry run");
        assert.equal(Number(mem.rows[0].archived), 0, "Should not archive in dry run");
    });

    it("should get consolidation preview", async () => {
        await clearTables();
        await addMemory(client, { type: "fact", title: "Preview Test", content: "For preview" });

        const preview = await getConsolidationPreview(client);
        assert.ok(Array.isArray(preview.weakest));
        assert.ok(Array.isArray(preview.duplicateCandidates));
    });

    it("should update last_consolidation_at after run", async () => {
        await clearTables();
        await addMemory(client, { type: "fact", title: "Timestamp Test", content: "Check timestamp" });

        await runConsolidation(client);
        const lastRun = await getMeta(client, "last_consolidation_at");
        assert.ok(lastRun, "last_consolidation_at should be set");

        // Now shouldConsolidate should return false (just ran)
        const { shouldRun } = await shouldConsolidate(client, 3);
        assert.equal(shouldRun, false, "Should not need consolidation right after running");
    });
});
