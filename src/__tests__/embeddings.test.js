// @ts-check
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
    embed,
    embedBatch,
    cosineSimilarity,
    getEmbeddingDim,
    isInitialized,
    resetEmbeddings,
    vectorToBlob,
    blobToVector,
} from "../embeddings.js";

describe("embeddings.js — Utility functions (no model needed)", () => {
    it("should return correct embedding dimension", () => {
        assert.equal(getEmbeddingDim(), 1024);
    });

    it("should compute cosine similarity of identical vectors", () => {
        const a = new Float32Array([1, 0, 0, 0]);
        const b = new Float32Array([1, 0, 0, 0]);
        assert.equal(cosineSimilarity(a, b), 1.0);
    });

    it("should compute cosine similarity of orthogonal vectors", () => {
        const a = new Float32Array([1, 0, 0, 0]);
        const b = new Float32Array([0, 1, 0, 0]);
        assert.equal(cosineSimilarity(a, b), 0.0);
    });

    it("should compute cosine similarity of opposite vectors", () => {
        const a = new Float32Array([1, 0, 0, 0]);
        const b = new Float32Array([-1, 0, 0, 0]);
        assert.equal(cosineSimilarity(a, b), -1.0);
    });

    it("should throw on dimension mismatch", () => {
        const a = new Float32Array([1, 0]);
        const b = new Float32Array([1, 0, 0]);
        assert.throws(() => cosineSimilarity(a, b), /dimension mismatch/i);
    });

    it("should handle zero vectors gracefully", () => {
        const a = new Float32Array([0, 0, 0]);
        const b = new Float32Array([1, 0, 0]);
        assert.equal(cosineSimilarity(a, b), 0);
    });

    it("should convert Float32Array to blob and back", () => {
        const original = new Float32Array([0.1, 0.2, 0.3, 0.4]);
        const blob = vectorToBlob(original);
        assert.ok(blob instanceof Uint8Array);
        assert.equal(blob.byteLength, original.byteLength);

        const restored = blobToVector(blob);
        assert.equal(restored.length, original.length);
        for (let i = 0; i < original.length; i++) {
            assert.ok(Math.abs(restored[i] - original[i]) < 1e-6, `Index ${i} should match`);
        }
    });

    it("should convert 1024-dim vector to blob and back", () => {
        const original = new Float32Array(1024);
        for (let i = 0; i < 1024; i++) original[i] = Math.random() * 2 - 1;

        const blob = vectorToBlob(original);
        assert.equal(blob.byteLength, 1024 * 4); // 4 bytes per float32

        const restored = blobToVector(blob);
        assert.equal(restored.length, 1024);
        for (let i = 0; i < 1024; i++) {
            assert.ok(Math.abs(restored[i] - original[i]) < 1e-6);
        }
    });

    it("should report not initialized before first embed call", () => {
        resetEmbeddings();
        assert.equal(isInitialized(), false);
    });
});

describe("embeddings.js — Model integration (requires BGE-M3 download)", () => {
    before(async function () {
        // Give model download time — up to 5 minutes on first run
        this.timeout = 300_000;
        console.log("[test] Initializing BGE-M3 model (may download ~680MB on first run)...");
        await embed("warmup");
        console.log("[test] Model ready");
    });

    after(() => {
        resetEmbeddings();
    });

    it("should generate 1024-dimensional embeddings", async () => {
        const vec = await embed("Hello world");
        assert.equal(vec.length, 1024, "Embedding should be 1024-dimensional");
        assert.ok(vec instanceof Float32Array, "Should be Float32Array");
    });

    it("should generate normalized embeddings (unit length)", async () => {
        const vec = await embed("Normalized test");
        let norm = 0;
        for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
        norm = Math.sqrt(norm);
        assert.ok(Math.abs(norm - 1.0) < 0.01, `Norm should be ~1.0, got ${norm}`);
    });

    it("should produce similar embeddings for similar texts", async () => {
        const a = await embed("The cat sat on the mat");
        const b = await embed("A cat is sitting on a mat");
        const c = await embed("Quantum physics describes subatomic particles");

        const simAB = cosineSimilarity(a, b);
        const simAC = cosineSimilarity(a, c);

        assert.ok(simAB > 0.7, `Similar texts should have high similarity: ${simAB}`);
        assert.ok(simAC < simAB, `Unrelated text should have lower similarity: AC=${simAC} < AB=${simAB}`);
    });

    it("should handle Russian text", async () => {
        const a = await embed("Кот сидел на коврике");
        const b = await embed("Кошка сидит на ковре");

        const sim = cosineSimilarity(a, b);
        assert.ok(sim > 0.6, `Russian similar texts should have decent similarity: ${sim}`);
        assert.equal(a.length, 1024, "Russian text should produce 1024-dim vector");
    });

    it("should handle mixed language text", async () => {
        const vec = await embed("Привет, this is mixed language текст");
        assert.equal(vec.length, 1024);
    });

    it("should batch embed multiple texts", async () => {
        const texts = ["First text", "Second text", "Third text"];
        const vectors = await embedBatch(texts);
        assert.equal(vectors.length, 3);
        for (const vec of vectors) {
            assert.equal(vec.length, 1024);
            assert.ok(vec instanceof Float32Array);
        }
    });

    it("should be idempotent — same text → same vector", async () => {
        const a = await embed("Deterministic output test");
        const b = await embed("Deterministic output test");
        const sim = cosineSimilarity(a, b);
        assert.ok(sim > 0.99, `Same text should produce near-identical vectors: ${sim}`);
    });

    it("should report initialized after first embed call", () => {
        assert.equal(isInitialized(), true);
    });
});
