// @ts-check
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
    rerank,
    initReranker,
    isRerankerInitialized,
    resetReranker,
} from "../embeddings.js";
import { initDb, closeDb } from "../db.js";
import { addMemory, searchHybrid } from "../memory.js";

// ---------------------------------------------------------------------------
// Reranker unit tests — cross-encoder scoring
// ---------------------------------------------------------------------------

describe("reranker — cross-encoder scoring", () => {
    before(async () => {
        resetReranker();
    });

    it("should initialize the reranker model", async () => {
        assert.equal(isRerankerInitialized(), false);
        await initReranker();
        assert.equal(isRerankerInitialized(), true);
    });

    it("should score query-document pairs with relevance", async () => {
        const query = "Ruby on Rails web framework";
        const documents = [
            "Rails 8 AI Chat — Ruby 3.4.8, Rails 8.1.2, SQLite, Solid Stack",
            "How to cook pasta with tomato sauce at home",
            "Python machine learning with TensorFlow and PyTorch",
        ];

        const results = await rerank(query, documents);

        assert.equal(results.length, 3);
        // Scores should be 0-1 (sigmoid-normalized)
        for (const r of results) {
            assert.ok(r.score >= 0 && r.score <= 1, `Score ${r.score} should be in [0, 1]`);
        }
        // Tech results should score significantly higher than cooking
        const cookingResult = results.find((r) => r.text.includes("pasta"));
        const railsResult = results.find((r) => r.text.includes("Rails"));
        assert.ok(cookingResult, "Should find cooking result");
        assert.ok(railsResult, "Should find rails result");
        assert.ok(
            railsResult.score > cookingResult.score * 10,
            `Rails score (${railsResult.score}) should be >> cooking score (${cookingResult.score})`
        );
    });

    it("should handle topK parameter", async () => {
        const query = "database migration";
        const documents = [
            "SQL database migration scripts for PostgreSQL",
            "Bird migration patterns across Europe",
            "Data migration from MongoDB to PostgreSQL",
            "Political migration policies in the EU",
        ];

        const results = await rerank(query, documents, { topK: 2 });

        assert.equal(results.length, 2, "Should return only topK results");
        // Top 2 should be about database migration (higher scores than bird/politics)
        const topTexts = results.map((r) => r.text);
        assert.ok(
            topTexts.some((t) => t.includes("SQL") || t.includes("Data migration")),
            "At least one top result should be about databases"
        );
    });

    it("should handle cross-lingual queries (Russian → English)", async () => {
        const query = "на рельсах какой-то проект";
        const documents = [
            "Rails 8 AI Chat — Ruby 3.4.8, Rails 8.1.2, SQLite",
            "Whisper Edge — Rust, Candle, Tauri voice-to-text",
            "Chrome Extension for translation with OpenAI API",
        ];

        const results = await rerank(query, documents);

        // Cross-encoder should understand рельсы ≈ Rails
        assert.equal(
            results[0].text,
            documents[0],
            "Rails doc should be ranked first even with Russian query"
        );
    });

    it("should preserve original indices in results", async () => {
        const results = await rerank("test query", ["doc A", "doc B", "doc C"]);

        assert.equal(results.length, 3);
        // Each result should have a valid original index
        for (const r of results) {
            assert.ok(r.index >= 0 && r.index <= 2, `Index ${r.index} should be 0-2`);
            assert.ok(typeof r.score === "number", "Score should be a number");
            assert.ok(typeof r.text === "string", "Text should be a string");
        }
    });
});

// ---------------------------------------------------------------------------
// Integration: searchHybrid with reranking
// ---------------------------------------------------------------------------

describe("reranker — searchHybrid integration", () => {
    /** @type {import("@libsql/client").Client} */
    let client;

    before(async () => {
        const db = await initDb("file:test_reranker.db");
        client = db.client;

        // Insert test memories
        await addMemory(client, {
            type: "fact",
            title: "Rails 8 AI Chat",
            content: "Ruby 3.4.8, Rails 8.1.2, SQLite, Solid Stack, Hotwire, Tailwind CSS",
            importance: 0.8,
            tags: ["rails", "ruby", "project"],
        });

        await addMemory(client, {
            type: "episode",
            title: "Solid Queue fork() Crash on Windows",
            content: "NotImplementedError: fork() function is unimplemented. Use :async adapter instead of :fork.",
            importance: 0.7,
            tags: ["rails", "windows", "bug"],
        });

        await addMemory(client, {
            type: "fact",
            title: "Whisper Edge",
            content: "Rust, Candle, Tauri voice-to-text desktop application for real-time transcription",
            importance: 0.8,
            tags: ["rust", "ml", "project"],
        });
    });

    after(async () => {
        await closeDb();
        // Clean up test database
        const fs = await import("node:fs");
        try { fs.unlinkSync("test_reranker.db"); } catch { }
    });

    it("should rerank hybrid results for better relevance", async () => {
        // With rerank — Rails should definitely be top for a Russian "рельсы" query
        const withRerank = await searchHybrid(client, "на рельсах какой-то проект был", {
            k: 3,
            rerank: true,
        });

        assert.ok(withRerank.length > 0, "With rerank should return results");

        // With rerank, Rails should be the top result
        assert.equal(
            withRerank[0].title,
            "Rails 8 AI Chat",
            "Reranked results should have Rails at top"
        );
    });

    it("should preserve backward compatibility when rerank=false", async () => {
        const results = await searchHybrid(client, "Rails", { k: 3, rerank: false });

        assert.ok(results.length > 0, "Should still return results without rerank");
        assert.ok(results[0].score !== undefined, "Should have RRF score");
    });

    it("should have reranker scores between 0 and 1", async () => {
        const results = await searchHybrid(client, "Ruby web framework", {
            k: 3,
            rerank: true,
        });

        for (const mem of results) {
            assert.ok(
                mem.score !== undefined && mem.score >= 0 && mem.score <= 1,
                `Score ${mem.score} should be in [0, 1]`
            );
        }
    });
});
