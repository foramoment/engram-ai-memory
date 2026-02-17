// @ts-check
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unlinkSync, existsSync } from "node:fs";
import { initDb, resetClient } from "../db.js";
import {
    addMemory, getMemory, updateMemory, deleteMemory,
    searchSemantic, searchFTS, searchHybrid,
    addTag, removeTag, getMemoriesByTag, getAllTags,
    linkMemories, getLinks, findRelated,
    logAccess, getStats, exportMemories,
} from "../memory.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = resolve(__dirname, "..", "..", "data", "test_memory.db");

/** @type {import("@libsql/client").Client} */
let client;
let dbInitialized = false;

/** Initialize the DB once, then just clear tables between suites */
async function ensureDb() {
    if (!dbInitialized) {
        // Clean up leftover test DB files
        resetClient();
        for (const suffix of ["", "-journal", "-wal", "-shm"]) {
            const p = TEST_DB_PATH + suffix;
            if (existsSync(p)) {
                try { unlinkSync(p); } catch { /* ignore */ }
            }
        }
        const db = await initDb(TEST_DB_PATH);
        client = db.client;
        dbInitialized = true;
    }
}

/** Clear all data from tables (much faster than re-creating DB) */
async function clearTables() {
    await ensureDb();
    await client.execute("DELETE FROM access_log");
    await client.execute("DELETE FROM memory_tags");
    await client.execute("DELETE FROM memory_links");
    await client.execute("DELETE FROM memories");
    await client.execute("DELETE FROM tags");
    // Reset autoincrement counters
    await client.execute("DELETE FROM sqlite_sequence WHERE name IN ('memories', 'tags', 'access_log')");
}

function cleanupAll() {
    resetClient();
    dbInitialized = false;
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
        const p = TEST_DB_PATH + suffix;
        if (existsSync(p)) {
            try { unlinkSync(p); } catch { /* ignore */ }
        }
    }
}

describe("memory.js — CRUD operations", () => {
    before(async function () {
        this.timeout = 300_000;
        await clearTables();
    });

    it("should add a memory and return its ID", async () => {
        const result = await addMemory(client, {
            type: "fact",
            title: "Test Fact",
            content: "LibSQL supports native vector search",
        });
        assert.ok(typeof result.id === "number");
        assert.equal(result.status, "created");
        assert.equal(result.id, 1); // First memory in fresh table
    });

    it("should get a memory by ID", async () => {
        const { id } = await addMemory(client, {
            type: "reflex",
            title: "Rails Reflex",
            content: "Use bin/dev for Rails development",
            importance: 0.8,
        });

        const memory = await getMemory(client, id);
        assert.ok(memory);
        assert.equal(memory.title, "Rails Reflex");
        assert.equal(memory.content, "Use bin/dev for Rails development");
        assert.equal(memory.type, "reflex");
        assert.equal(memory.importance, 0.8);
        assert.equal(memory.strength, 1.0);
        assert.equal(memory.access_count, 0);
        assert.equal(memory.archived, 0);
    });

    it("should return null for non-existent memory", async () => {
        const memory = await getMemory(client, 99999);
        assert.equal(memory, null);
    });

    it("should add memory with tags", async () => {
        const { id } = await addMemory(client, {
            type: "episode",
            title: "Debugging Session",
            content: "Fixed CPU usage bug in Tauri app",
            tags: ["tauri", "debugging", "performance"],
        });

        const memory = await getMemory(client, id);
        assert.ok(memory);
        assert.ok(memory.tags);
        assert.equal(memory.tags.length, 3);
        assert.ok(memory.tags.includes("tauri"));
        assert.ok(memory.tags.includes("debugging"));
        assert.ok(memory.tags.includes("performance"));
    });

    it("should update memory content and re-embed", async () => {
        const { id } = await addMemory(client, {
            type: "fact",
            title: "Original",
            content: "Original content",
        });

        const updated = await updateMemory(client, id, {
            title: "Updated Title",
            content: "Completely new content about vectors",
        });
        assert.equal(updated, true);

        const memory = await getMemory(client, id);
        assert.ok(memory);
        assert.equal(memory.title, "Updated Title");
        assert.equal(memory.content, "Completely new content about vectors");
    });

    it("should update memory importance without re-embedding", async () => {
        const { id } = await addMemory(client, {
            type: "fact",
            title: "Importance Test",
            content: "Test importance update",
        });

        await updateMemory(client, id, { importance: 0.9 });
        const memory = await getMemory(client, id);
        assert.ok(memory);
        assert.equal(memory.importance, 0.9);
    });

    it("should return false when updating non-existent memory", async () => {
        const result = await updateMemory(client, 99999, { title: "Nope" });
        assert.equal(result, false);
    });

    it("should delete a memory", async () => {
        const { id } = await addMemory(client, {
            type: "fact",
            title: "To Delete",
            content: "This will be deleted",
        });

        const deleted = await deleteMemory(client, id);
        assert.equal(deleted, true);

        const memory = await getMemory(client, id);
        assert.equal(memory, null);
    });

    it("should return false when deleting non-existent memory", async () => {
        const result = await deleteMemory(client, 99999);
        assert.equal(result, false);
    });
});

describe("memory.js — FTS Search", () => {
    before(async function () {
        this.timeout = 300_000;
        await clearTables();

        await addMemory(client, { type: "fact", title: "Rust Programming", content: "Rust is a systems programming language focused on safety and performance" });
        await addMemory(client, { type: "fact", title: "Python AI", content: "Python is widely used for machine learning and artificial intelligence" });
        await addMemory(client, { type: "reflex", title: "Git Workflow", content: "Always commit after completing each feature in the development workflow" });
        await addMemory(client, { type: "episode", title: "Memory Architecture", content: "Designed a cognitive memory system using LibSQL native vectors" });
        await addMemory(client, { type: "preference", title: "Russian Communication", content: "User prefers Russian language for communication and planning artifacts" });
    });

    it("should find memories by FTS keyword", async () => {
        const results = await searchFTS(client, "programming");
        assert.ok(results.length >= 1);
        assert.ok(results.some((r) => r.title.includes("Rust")));
    });

    it("should filter FTS by type", async () => {
        const results = await searchFTS(client, "memory OR system OR architecture", { type: "episode" });
        assert.ok(results.length >= 1);
        assert.ok(results.every((r) => r.type === "episode"));
    });

    it("should return empty for no matches", async () => {
        const results = await searchFTS(client, "xyznonexistent");
        assert.equal(results.length, 0);
    });
});

describe("memory.js — Semantic Search", () => {
    before(async function () {
        this.timeout = 300_000;
        await clearTables();

        await addMemory(client, { type: "fact", title: "Vector Databases", content: "Vector databases store high-dimensional embeddings for semantic similarity search" });
        await addMemory(client, { type: "fact", title: "Cat Care", content: "Cats need regular veterinary checkups and proper nutrition" });
        await addMemory(client, { type: "fact", title: "Embedding Models", content: "BGE-M3 is a multilingual embedding model supporting 100+ languages" });
        await addMemory(client, { type: "reflex", title: "Kubernetes Pods", content: "Use kubectl get pods to check running containers in the cluster" });
    });

    it("should find semantically similar memories", async () => {
        const results = await searchSemantic(client, "neural network embeddings for search");
        assert.ok(results.length > 0);
        const titles = results.map((r) => r.title);
        assert.ok(
            titles.indexOf("Vector Databases") < titles.indexOf("Cat Care") ||
            !titles.includes("Cat Care"),
            "Vector-related should rank higher than cat care"
        );
    });

    it("should respect type filter", async () => {
        const results = await searchSemantic(client, "containers", { type: "reflex" });
        assert.ok(results.every((r) => r.type === "reflex"));
    });

    it("should respect k limit", async () => {
        const results = await searchSemantic(client, "technology", { k: 2 });
        assert.ok(results.length <= 2);
    });
});

describe("memory.js — Hybrid Search (RRF)", () => {
    before(async function () {
        this.timeout = 300_000;
        await clearTables();

        await addMemory(client, { type: "fact", title: "LibSQL Features", content: "LibSQL provides native vector search with DiskANN indexing and FTS5 full-text search" });
        await addMemory(client, { type: "fact", title: "SQLite History", content: "SQLite is the most widely deployed database engine in the world" });
        await addMemory(client, { type: "episode", title: "Database Migration", content: "Successfully migrated from PostgreSQL to LibSQL for better portability" });
    });

    it("should combine semantic and FTS results", async () => {
        const results = await searchHybrid(client, "LibSQL vector search");
        assert.ok(results.length > 0);
        // LibSQL Features should rank high (matches both semantic AND keyword)
        const libsqlResult = results.find(r => r.title.includes("LibSQL"));
        assert.ok(libsqlResult, "Should find a LibSQL-related result");
        // It should be in top 2 at least
        const libsqlIndex = results.findIndex(r => r.title.includes("LibSQL"));
        assert.ok(libsqlIndex <= 1, `LibSQL should be in top 2, got position ${libsqlIndex}`);
    });

    it("should include score in results", async () => {
        const results = await searchHybrid(client, "database technology");
        assert.ok(results.length > 0);
        for (const r of results) {
            assert.ok(r.score !== undefined, "Each result should have a score");
            assert.ok(r.score > 0, "Score should be positive");
        }
    });

    it("BUG: hops should work even with rerank=true", async () => {
        // Setup: create linked memories A → B, then search with rerank+hops
        await clearTables();
        const { id: idA } = await addMemory(client, {
            type: "fact", title: "Vector Indexing Algorithms",
            content: "DiskANN and HNSW are popular algorithms for approximate nearest neighbor vector search.",
        });
        const { id: idB } = await addMemory(client, {
            type: "fact", title: "DiskANN Performance",
            content: "DiskANN achieves state-of-the-art recall with low memory footprint by using disk-based graph traversal.",
        });
        // Link A → B
        await linkMemories(client, idA, idB, "related_to");

        // Search with rerank=true AND hops=1 — should return linked memories too
        const results = await searchHybrid(client, "vector search algorithms", {
            k: 5, hops: 1, rerank: true,
        });
        const resultIds = results.map(r => r.id);
        // At minimum, idA should match search. With hops=1, idB should also appear.
        assert.ok(resultIds.includes(idA), "Should find the directly matching memory");
        assert.ok(resultIds.includes(idB),
            `hops=1 with rerank=true should include linked memory (idB=${idB}), got ids: [${resultIds}]`);
    });
});

describe("memory.js — Tags", () => {
    before(async function () {
        this.timeout = 300_000;
        await clearTables();
    });

    it("should add and retrieve tags", async () => {
        const { id } = await addMemory(client, {
            type: "fact", title: "Tagged Memory", content: "This has tags",
        });
        await addTag(client, id, "test-tag");
        await addTag(client, id, "Another Tag"); // Should normalize to lowercase

        const memory = await getMemory(client, id);
        assert.ok(memory?.tags?.includes("test-tag"));
        assert.ok(memory?.tags?.includes("another tag"));
    });

    it("BUG: tags should be applied on exact duplicate add", async () => {
        // First add: no permanent tag
        const { id: id1 } = await addMemory(client, {
            type: "fact", title: "Duplicate Tag Test", content: "Test content for tag dedup",
            tags: ["original"],
        });

        // Second add: same type+title = exact duplicate, but with "permanent" tag
        const { id: id2, status } = await addMemory(client, {
            type: "fact", title: "Duplicate Tag Test", content: "Test content for tag dedup",
            tags: ["permanent"],
        });
        assert.equal(id2, id1, "Should return same ID for duplicate");
        assert.equal(status, "duplicate");

        // The "permanent" tag should still be applied to the existing memory
        const memory = await getMemory(client, id1);
        assert.ok(memory.tags.includes("original"), "Should keep original tag");
        assert.ok(memory.tags.includes("permanent"),
            `Duplicate add with tags should apply those tags, got: [${memory.tags}]`);
    });

    it("should remove a tag", async () => {
        const { id } = await addMemory(client, {
            type: "fact", title: "Tag Removal", content: "Test",
            tags: ["keep-me", "remove-me"],
        });

        await removeTag(client, id, "remove-me");
        const memory = await getMemory(client, id);
        assert.ok(memory?.tags?.includes("keep-me"));
        assert.ok(!memory?.tags?.includes("remove-me"));
    });

    it("should get memories by tag", async () => {
        await addMemory(client, { type: "fact", title: "A", content: "A", tags: ["shared"] });
        await addMemory(client, { type: "fact", title: "B", content: "B", tags: ["shared"] });
        await addMemory(client, { type: "fact", title: "C", content: "C", tags: ["other"] });

        const results = await getMemoriesByTag(client, "shared");
        assert.equal(results.length, 2);
    });

    it("should get all tags with counts", async () => {
        const tags = await getAllTags(client);
        assert.ok(tags.length > 0);
        assert.ok(tags[0].name);
        assert.ok(tags[0].count > 0);
    });
});

describe("memory.js — Knowledge Graph Links", () => {
    before(async function () {
        this.timeout = 300_000;
        await clearTables();
    });

    it("should create a link between memories", async () => {
        const { id: id1 } = await addMemory(client, { type: "fact", title: "Cause", content: "This caused something" });
        const { id: id2 } = await addMemory(client, { type: "episode", title: "Effect", content: "This was the effect" });

        await linkMemories(client, id1, id2, "caused_by");

        const links = await getLinks(client, id1);
        assert.equal(links.length, 1);
        assert.equal(links[0].id, id2);
        assert.equal(links[0].relation, "caused_by");
        assert.equal(links[0].direction, "outgoing");
    });

    it("should show reverse direction for target", async () => {
        const { id: id1 } = await addMemory(client, { type: "fact", title: "Source", content: "Source" });
        const { id: id2 } = await addMemory(client, { type: "fact", title: "Target", content: "Target" });

        await linkMemories(client, id1, id2, "related_to");

        const links = await getLinks(client, id2);
        assert.ok(links.some((l) => l.id === id1 && l.direction === "incoming"));
    });

    it("should reject invalid relation type", async () => {
        await assert.rejects(
            () => linkMemories(client, 1, 2, "invalid_relation"),
            /Invalid relation/
        );
    });

    it("should add links during addMemory", async () => {
        const { id: id1 } = await addMemory(client, { type: "fact", title: "First", content: "First memory" });
        const { id: id2 } = await addMemory(client, {
            type: "fact",
            title: "Second",
            content: "Links to first",
            links: [{ targetId: id1, relation: "related_to" }],
        });

        const memory = await getMemory(client, id2);
        assert.ok(memory?.links?.length === 1);
        assert.ok(memory.links[0].id === id1);
    });
});

describe("memory.js — Access Logging", () => {
    before(async function () {
        this.timeout = 300_000;
        await clearTables();
    });

    it("should log access and update memory stats", async () => {
        const { id } = await addMemory(client, {
            type: "fact", title: "Access Test", content: "Track access",
        });

        await logAccess(client, id, "session-1", "test query", 0.85);
        await logAccess(client, id, "session-1", "another query", 0.72);

        const memory = await getMemory(client, id);
        assert.ok(memory);
        assert.equal(memory.access_count, 2);
        assert.ok(memory.last_accessed_at, "last_accessed_at should be set");
    });
});

describe("memory.js — Stats", () => {
    before(async function () {
        this.timeout = 300_000;
        await clearTables();

        await addMemory(client, { type: "fact", title: "Fact 1", content: "Stats content A" });
        await addMemory(client, { type: "fact", title: "Fact 2", content: "Stats content B" });
        await addMemory(client, { type: "reflex", title: "Reflex 1", content: "Stats content C" });
    });

    it("should return correct statistics", async () => {
        // Link first two memories
        const allMems = await client.execute("SELECT id FROM memories ORDER BY id");
        const id1 = Number(allMems.rows[0].id);
        const id2 = Number(allMems.rows[1].id);
        await linkMemories(client, id1, id2, "related_to");

        const stats = await getStats(client);
        assert.equal(stats.totalMemories, 3);
        assert.equal(stats.byType.fact, 2);
        assert.equal(stats.byType.reflex, 1);
        assert.equal(stats.totalLinks, 1);
        assert.ok(stats.avgStrength > 0);
    });
});

describe("memory.js — Export", () => {
    before(async function () {
        this.timeout = 300_000;
        await clearTables();

        const { id: id1 } = await addMemory(client, {
            type: "fact", title: "Export Fact", content: "Content for export test",
            tags: ["test-export", "important"],
        });
        const { id: id2 } = await addMemory(client, {
            type: "reflex", title: "Export Reflex", content: "Reflex content for export",
            tags: ["test-export"],
        });
        await linkMemories(client, id1, id2, "related_to");
    });

    it("should export as JSON with tags and links", async () => {
        const output = await exportMemories(client, "json");
        const parsed = JSON.parse(output);
        assert.ok(Array.isArray(parsed));
        assert.equal(parsed.length, 2);

        const fact = parsed.find((m) => m.type === "fact");
        assert.ok(fact, "Should include fact");
        assert.equal(fact.title, "Export Fact");
        assert.ok(fact.tags.includes("test-export"));
        assert.ok(fact.tags.includes("important"));
        assert.ok(fact.links.length >= 1, "Should include links");
    });

    it("should export as Markdown", async () => {
        const output = await exportMemories(client, "md");
        assert.ok(output.includes("# Engram Memory Export"));
        assert.ok(output.includes("Export Fact"));
        assert.ok(output.includes("Export Reflex"));
        assert.ok(output.includes("Tags:"));
        assert.ok(output.includes("test-export"));
        assert.ok(output.includes("Links:"));
    });
});

describe("memory.js — findRelated", () => {
    before(async function () {
        this.timeout = 300_000;
        await clearTables();
    });

    it("should find related memories via links and semantic similarity", async () => {
        const { id: id1 } = await addMemory(client, {
            type: "fact", title: "Database Fundamentals",
            content: "Relational databases store data in tables with rows and columns",
        });
        const { id: id2 } = await addMemory(client, {
            type: "fact", title: "SQL Queries",
            content: "SQL is used to query relational databases with SELECT statements",
        });
        const { id: id3 } = await addMemory(client, {
            type: "fact", title: "Cooking Recipes",
            content: "Italian pasta requires al dente cooking technique",
        });

        // Link id1 → id2
        await linkMemories(client, id1, id2, "related_to");

        const related = await findRelated(client, id1, 5);
        assert.ok(related.length >= 1, "Should find at least the linked memory");

        // The linked memory (SQL Queries) should be in results
        const linkedResult = related.find((m) => m.id === id2);
        assert.ok(linkedResult, "Directly linked memory should appear in results");
    });

    it("should return empty for non-existent memory", async () => {
        const related = await findRelated(client, 99999);
        assert.equal(related.length, 0);
    });

    after(() => cleanupAll());
});
