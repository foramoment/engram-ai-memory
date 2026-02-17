// @ts-check
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unlinkSync, existsSync } from "node:fs";
import { initDb, closeDb, resetClient, getMeta, setMeta } from "../db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = resolve(__dirname, "..", "..", "data", "test_db.db");

/**
 * Clean up test database file.
 */
function cleanupTestDb() {
    resetClient();
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
        const p = TEST_DB_PATH + suffix;
        if (existsSync(p)) {
            try { unlinkSync(p); } catch { /* ignore */ }
        }
    }
}

describe("db.js — Database initialization and schema", () => {
    before(() => cleanupTestDb());
    after(() => cleanupTestDb());

    it("should initialize database and create all tables", async () => {
        const { client, migrated, version } = await initDb(TEST_DB_PATH);

        assert.ok(client, "Client should be created");
        assert.equal(migrated, true, "First run should migrate");
        assert.equal(version, 1, "Schema version should be 1");

        // Verify all tables exist
        const tables = await client.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        );
        const tableNames = tables.rows.map((r) => r.name);

        assert.ok(tableNames.includes("memories"), "memories table should exist");
        assert.ok(tableNames.includes("tags"), "tags table should exist");
        assert.ok(tableNames.includes("memory_tags"), "memory_tags table should exist");
        assert.ok(tableNames.includes("memory_links"), "memory_links table should exist");
        assert.ok(tableNames.includes("sessions"), "sessions table should exist");
        assert.ok(tableNames.includes("access_log"), "access_log table should exist");
        assert.ok(tableNames.includes("system_meta"), "system_meta table should exist");
    });

    it("should create FTS5 virtual table", async () => {
        const { client } = await initDb(TEST_DB_PATH);
        const tables = await client.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'"
        );
        assert.equal(tables.rows.length, 1, "memories_fts should exist");
    });

    it("should create FTS5 sync triggers", async () => {
        const { client } = await initDb(TEST_DB_PATH);
        const triggers = await client.execute(
            "SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name"
        );
        const triggerNames = triggers.rows.map((r) => r.name);

        assert.ok(triggerNames.includes("memories_ai"), "INSERT trigger should exist");
        assert.ok(triggerNames.includes("memories_ad"), "DELETE trigger should exist");
        assert.ok(triggerNames.includes("memories_au"), "UPDATE trigger should exist");
    });

    it("should not re-migrate on second init", async () => {
        resetClient();
        const { migrated } = await initDb(TEST_DB_PATH);
        assert.equal(migrated, false, "Second init should not re-migrate");
    });

    it("should seed system_meta with defaults", async () => {
        const { client } = await initDb(TEST_DB_PATH);

        const schemaVersion = await getMeta(client, "schema_version");
        assert.equal(schemaVersion, "1", "schema_version should be '1'");

        const createdAt = await getMeta(client, "created_at");
        assert.ok(createdAt, "created_at should be set");
    });

    it("should set and get meta values", async () => {
        const { client } = await initDb(TEST_DB_PATH);

        await setMeta(client, "test_key", "test_value");
        const value = await getMeta(client, "test_key");
        assert.equal(value, "test_value");

        // Update existing
        await setMeta(client, "test_key", "updated_value");
        const updated = await getMeta(client, "test_key");
        assert.equal(updated, "updated_value");
    });

    it("should return null for non-existent meta keys", async () => {
        const { client } = await initDb(TEST_DB_PATH);
        const value = await getMeta(client, "nonexistent_key");
        assert.equal(value, null);
    });

    it("should enforce memory type constraint", async () => {
        const { client } = await initDb(TEST_DB_PATH);
        await assert.rejects(
            () =>
                client.execute({
                    sql: "INSERT INTO memories (type, title, content) VALUES (?, ?, ?)",
                    args: ["invalid_type", "Test", "Content"],
                }),
            /CHECK constraint/i,
            "Invalid type should be rejected"
        );
    });

    it("should enforce importance range constraint", async () => {
        const { client } = await initDb(TEST_DB_PATH);
        await assert.rejects(
            () =>
                client.execute({
                    sql: "INSERT INTO memories (type, title, content, importance) VALUES (?, ?, ?, ?)",
                    args: ["fact", "Test", "Content", 1.5],
                }),
            /CHECK constraint/i,
            "Importance > 1.0 should be rejected"
        );
    });

    it("should enforce link relation constraint", async () => {
        const { client } = await initDb(TEST_DB_PATH);

        // First insert two valid memories
        await client.execute({
            sql: "INSERT INTO memories (type, title, content) VALUES (?, ?, ?)",
            args: ["fact", "Memory A", "Content A"],
        });
        await client.execute({
            sql: "INSERT INTO memories (type, title, content) VALUES (?, ?, ?)",
            args: ["fact", "Memory B", "Content B"],
        });

        await assert.rejects(
            () =>
                client.execute({
                    sql: "INSERT INTO memory_links (source_id, target_id, relation) VALUES (?, ?, ?)",
                    args: [1, 2, "invalid_relation"],
                }),
            /CHECK constraint/i,
            "Invalid relation should be rejected"
        );
    });

    it("should auto-sync FTS5 on INSERT", async () => {
        const { client } = await initDb(TEST_DB_PATH);

        // Clear any previous test data
        await client.execute("DELETE FROM memories");

        await client.execute({
            sql: "INSERT INTO memories (type, title, content) VALUES (?, ?, ?)",
            args: ["fact", "Semantic Search Test", "BGE-M3 provides multilingual embeddings"],
        });

        const results = await client.execute(
            "SELECT * FROM memories_fts WHERE memories_fts MATCH 'multilingual'"
        );
        assert.equal(results.rows.length, 1, "FTS should find inserted memory");
    });

    it("should auto-sync FTS5 on DELETE", async () => {
        const { client } = await initDb(TEST_DB_PATH);

        await client.execute("DELETE FROM memories");

        const res = await client.execute({
            sql: "INSERT INTO memories (type, title, content) VALUES (?, ?, ?)",
            args: ["fact", "Deletable", "This will be deleted"],
        });
        const insertedId = res.lastInsertRowid;

        await client.execute({
            sql: "DELETE FROM memories WHERE id = ?",
            args: [insertedId],
        });

        const results = await client.execute(
            "SELECT * FROM memories_fts WHERE memories_fts MATCH 'Deletable'"
        );
        assert.equal(results.rows.length, 0, "FTS should not find deleted memory");
    });

    it("should auto-sync FTS5 on UPDATE", async () => {
        const { client } = await initDb(TEST_DB_PATH);

        await client.execute("DELETE FROM memories");

        const res = await client.execute({
            sql: "INSERT INTO memories (type, title, content) VALUES (?, ?, ?)",
            args: ["fact", "Original Title", "Original content"],
        });
        const insertedId = res.lastInsertRowid;

        await client.execute({
            sql: "UPDATE memories SET title = ?, content = ? WHERE id = ?",
            args: ["Updated Title", "Updated content with new keywords", insertedId],
        });

        const oldResults = await client.execute(
            "SELECT * FROM memories_fts WHERE memories_fts MATCH 'Original'"
        );
        assert.equal(oldResults.rows.length, 0, "FTS should not find old content");

        const newResults = await client.execute(
            "SELECT * FROM memories_fts WHERE memories_fts MATCH 'Updated'"
        );
        assert.equal(newResults.rows.length, 1, "FTS should find updated content");
    });

    it("should cascade delete from memories to tags and links", async () => {
        const { client } = await initDb(TEST_DB_PATH);

        await client.execute("DELETE FROM memories");
        await client.execute("DELETE FROM tags");

        // Create a memory
        const res = await client.execute({
            sql: "INSERT INTO memories (type, title, content) VALUES (?, ?, ?)",
            args: ["fact", "Cascading", "Test cascading delete"],
        });
        const memId = res.lastInsertRowid;

        // Add a tag
        await client.execute({ sql: "INSERT INTO tags (name) VALUES (?)", args: ["test-tag"] });
        const tagResult = await client.execute("SELECT id FROM tags WHERE name = 'test-tag'");
        const tagId = tagResult.rows[0].id;

        await client.execute({
            sql: "INSERT INTO memory_tags (memory_id, tag_id) VALUES (?, ?)",
            args: [memId, tagId],
        });

        // Add an access log
        await client.execute({
            sql: "INSERT INTO access_log (memory_id, query) VALUES (?, ?)",
            args: [memId, "test query"],
        });

        // Delete the memory — should cascade
        await client.execute({ sql: "DELETE FROM memories WHERE id = ?", args: [memId] });

        const tagsLeft = await client.execute({
            sql: "SELECT * FROM memory_tags WHERE memory_id = ?",
            args: [memId],
        });
        assert.equal(tagsLeft.rows.length, 0, "memory_tags should cascade delete");

        const logsLeft = await client.execute({
            sql: "SELECT * FROM access_log WHERE memory_id = ?",
            args: [memId],
        });
        assert.equal(logsLeft.rows.length, 0, "access_log should cascade delete");
    });

    it("should close and reset client", async () => {
        await closeDb();
        // Should be able to re-open
        const { client } = await initDb(TEST_DB_PATH);
        assert.ok(client, "Should be able to re-open after close");
    });
});
