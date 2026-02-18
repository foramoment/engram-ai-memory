// @ts-check
/**
 * Benchmark: fp32 vs int8 quantization for Engram models.
 *
 * Compares:
 *   - Xenova/bge-m3       (embeddings, 1024-dim)
 *   - Xenova/bge-reranker-base (cross-encoder)
 *
 * Metrics:
 *   - Model load time
 *   - Per-text inference latency
 *   - Cosine similarity between fp32 and int8 embeddings (quality proxy)
 *   - Reranker ranking agreement
 *
 * Usage:
 *   node src/__tests__/benchmark_quantization.js
 */

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Test corpus
// ---------------------------------------------------------------------------

const EMBEDDING_TEXTS = [
    // English
    "Rails 8 AI Chat — Ruby 3.4.8, Rails 8.1.2, SQLite, Solid Stack",
    "Quantum physics describes subatomic particles",
    "The cat sat on the mat",
    "A cat is sitting on a mat",
    // Russian
    "Кот сидел на коврике",
    "Кошка сидит на ковре",
    "Ruby on Rails — фреймворк для веб-разработки",
    // Mixed
    "Привет, this is mixed language текст",
];

const RERANKER_QUERY = "Ruby on Rails web framework";
const RERANKER_DOCS = [
    "Rails 8 AI Chat — Ruby 3.4.8, Rails 8.1.2, SQLite, Solid Stack",
    "How to cook pasta with tomato sauce at home",
    "Python machine learning with TensorFlow and PyTorch",
    "Quantum physics describes subatomic particles",
];

const RERANKER_RU_QUERY = "на рельсах какой-то проект";
const RERANKER_RU_DOCS = [
    "Rails 8 AI Chat — Ruby 3.4.8, Rails 8.1.2, SQLite",
    "Whisper Edge — Rust, Candle, Tauri voice-to-text",
    "Chrome Extension for translation with OpenAI API",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cosineSim(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}

function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
}

function median(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function fmt(ms) {
    return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

// ---------------------------------------------------------------------------
// Embedding benchmark
// ---------------------------------------------------------------------------

async function benchmarkEmbeddings(dtype) {
    const { pipeline } = await import("@huggingface/transformers");

    console.log(`\n  [embed] Loading Xenova/bge-m3 (dtype: ${dtype})...`);
    const loadStart = performance.now();
    const pipe = await pipeline("feature-extraction", "Xenova/bge-m3", {
        dtype,
        device: "cpu",
    });
    const loadTime = performance.now() - loadStart;
    console.log(`  [embed] Loaded in ${fmt(loadTime)}`);

    // Warmup
    await pipe("warmup", { pooling: "cls", normalize: true });

    const latencies = [];
    const vectors = [];

    for (const text of EMBEDDING_TEXTS) {
        const t0 = performance.now();
        const output = await pipe(text, { pooling: "cls", normalize: true });
        latencies.push(performance.now() - t0);
        vectors.push(new Float32Array(output.data));
    }

    // Dispose pipeline to free memory before loading the next one
    await pipe.dispose();

    return { loadTime, latencies, vectors };
}

async function runEmbeddingBenchmark() {
    console.log("\n═══════════════════════════════════════════════");
    console.log("  EMBEDDING BENCHMARK: Xenova/bge-m3");
    console.log("═══════════════════════════════════════════════");

    const fp32 = await benchmarkEmbeddings("fp32");

    // Force GC if available
    if (global.gc) global.gc();

    const int8 = await benchmarkEmbeddings("int8");

    // Compare quality: cosine similarity between fp32 and int8 vectors
    const similarities = [];
    for (let i = 0; i < EMBEDDING_TEXTS.length; i++) {
        similarities.push(cosineSim(fp32.vectors[i], int8.vectors[i]));
    }

    // Cross-similarity check: do similar texts still rank close?
    const catEN_fp32 = cosineSim(fp32.vectors[2], fp32.vectors[3]); // "cat sat" vs "cat sitting"
    const catEN_int8 = cosineSim(int8.vectors[2], int8.vectors[3]);
    const catRU_fp32 = cosineSim(fp32.vectors[4], fp32.vectors[5]); // "Кот" vs "Кошка"
    const catRU_int8 = cosineSim(int8.vectors[4], int8.vectors[5]);

    return {
        model: "Xenova/bge-m3",
        fp32: {
            loadTimeMs: fp32.loadTime,
            medianLatencyMs: median(fp32.latencies),
            latencies: fp32.latencies,
        },
        int8: {
            loadTimeMs: int8.loadTime,
            medianLatencyMs: median(int8.latencies),
            latencies: int8.latencies,
        },
        quality: {
            fp32_vs_int8_cosine: similarities,
            avgCosine: similarities.reduce((a, b) => a + b) / similarities.length,
            minCosine: Math.min(...similarities),
            similarPair_EN: { fp32: catEN_fp32, int8: catEN_int8 },
            similarPair_RU: { fp32: catRU_fp32, int8: catRU_int8 },
        },
        texts: EMBEDDING_TEXTS,
    };
}

// ---------------------------------------------------------------------------
// Reranker benchmark
// ---------------------------------------------------------------------------

async function benchmarkReranker(dtype) {
    const { AutoTokenizer, AutoModelForSequenceClassification } = await import("@huggingface/transformers");

    console.log(`\n  [rerank] Loading Xenova/bge-reranker-base (dtype: ${dtype})...`);
    const loadStart = performance.now();
    const tokenizer = await AutoTokenizer.from_pretrained("Xenova/bge-reranker-base");
    const model = await AutoModelForSequenceClassification.from_pretrained("Xenova/bge-reranker-base", { dtype });
    const loadTime = performance.now() - loadStart;
    console.log(`  [rerank] Loaded in ${fmt(loadTime)}`);

    // Score function
    async function scoreAll(query, docs) {
        const latencies = [];
        const scores = [];
        for (const doc of docs) {
            const t0 = performance.now();
            const inputs = tokenizer([query], { text_pair: [doc], padding: true, truncation: true });
            const output = await model(inputs);
            latencies.push(performance.now() - t0);
            scores.push(sigmoid(Number(output.logits.data[0])));
        }
        return { latencies, scores };
    }

    // Warmup
    await scoreAll("warmup", ["warmup doc"]);

    // English query
    const en = await scoreAll(RERANKER_QUERY, RERANKER_DOCS);

    // Russian query
    const ru = await scoreAll(RERANKER_RU_QUERY, RERANKER_RU_DOCS);

    // Dispose model to free memory
    await model.dispose();

    return { loadTime, en, ru };
}

async function runRerankerBenchmark() {
    console.log("\n═══════════════════════════════════════════════");
    console.log("  RERANKER BENCHMARK: Xenova/bge-reranker-base");
    console.log("═══════════════════════════════════════════════");

    const fp32 = await benchmarkReranker("fp32");

    if (global.gc) global.gc();

    const int8 = await benchmarkReranker("int8");

    // Check ranking agreement
    const fp32EnRank = fp32.en.scores.map((s, i) => ({ i, s })).sort((a, b) => b.s - a.s).map(r => r.i);
    const int8EnRank = int8.en.scores.map((s, i) => ({ i, s })).sort((a, b) => b.s - a.s).map(r => r.i);
    const fp32RuRank = fp32.ru.scores.map((s, i) => ({ i, s })).sort((a, b) => b.s - a.s).map(r => r.i);
    const int8RuRank = int8.ru.scores.map((s, i) => ({ i, s })).sort((a, b) => b.s - a.s).map(r => r.i);

    return {
        model: "Xenova/bge-reranker-base",
        fp32: {
            loadTimeMs: fp32.loadTime,
            medianLatencyMs: median([...fp32.en.latencies, ...fp32.ru.latencies]),
        },
        int8: {
            loadTimeMs: int8.loadTime,
            medianLatencyMs: median([...int8.en.latencies, ...int8.ru.latencies]),
        },
        ranking: {
            en: {
                fp32: { ranking: fp32EnRank, scores: fp32.en.scores },
                int8: { ranking: int8EnRank, scores: int8.en.scores },
                topMatch: fp32EnRank[0] === int8EnRank[0],
                fullMatch: JSON.stringify(fp32EnRank) === JSON.stringify(int8EnRank),
            },
            ru: {
                fp32: { ranking: fp32RuRank, scores: fp32.ru.scores },
                int8: { ranking: int8RuRank, scores: int8.ru.scores },
                topMatch: fp32RuRank[0] === int8RuRank[0],
                fullMatch: JSON.stringify(fp32RuRank) === JSON.stringify(int8RuRank),
            },
        },
        queries: {
            en: { query: RERANKER_QUERY, docs: RERANKER_DOCS },
            ru: { query: RERANKER_RU_QUERY, docs: RERANKER_RU_DOCS },
        },
    };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    console.log("╔═══════════════════════════════════════════════╗");
    console.log("║  Engram Quantization Benchmark: fp32 vs int8  ║");
    console.log("╚═══════════════════════════════════════════════╝");
    console.log(`  Date: ${new Date().toISOString()}`);
    console.log(`  Node: ${process.version}`);
    console.log(`  Platform: ${process.platform} ${process.arch}`);

    const embedResult = await runEmbeddingBenchmark();
    const rerankResult = await runRerankerBenchmark();

    // -----------------------------------------------------------------------
    // Print summary table
    // -----------------------------------------------------------------------
    console.log("\n\n╔═══════════════════════════════════════════════════════════════╗");
    console.log("║                      RESULTS SUMMARY                         ║");
    console.log("╠═══════════════════════════════════════════════════════════════╣");

    console.log("\n  📦 EMBEDDINGS (Xenova/bge-m3)");
    console.log("  ─────────────────────────────────────────────");
    console.log(`  Load time     fp32: ${fmt(embedResult.fp32.loadTimeMs).padStart(8)}  │  int8: ${fmt(embedResult.int8.loadTimeMs).padStart(8)}`);
    console.log(`  Median lat.   fp32: ${fmt(embedResult.fp32.medianLatencyMs).padStart(8)}  │  int8: ${fmt(embedResult.int8.medianLatencyMs).padStart(8)}`);
    console.log(`  Speedup load: ${(embedResult.fp32.loadTimeMs / embedResult.int8.loadTimeMs).toFixed(2)}x`);
    console.log(`  Speedup inf:  ${(embedResult.fp32.medianLatencyMs / embedResult.int8.medianLatencyMs).toFixed(2)}x`);
    console.log(`  Quality (fp32↔int8 cosine): avg=${embedResult.quality.avgCosine.toFixed(4)}, min=${embedResult.quality.minCosine.toFixed(4)}`);
    console.log(`  Similar pair EN:  fp32=${embedResult.quality.similarPair_EN.fp32.toFixed(4)}  int8=${embedResult.quality.similarPair_EN.int8.toFixed(4)}`);
    console.log(`  Similar pair RU:  fp32=${embedResult.quality.similarPair_RU.fp32.toFixed(4)}  int8=${embedResult.quality.similarPair_RU.int8.toFixed(4)}`);

    console.log("\n  🔄 RERANKER (Xenova/bge-reranker-base)");
    console.log("  ─────────────────────────────────────────────");
    console.log(`  Load time     fp32: ${fmt(rerankResult.fp32.loadTimeMs).padStart(8)}  │  int8: ${fmt(rerankResult.int8.loadTimeMs).padStart(8)}`);
    console.log(`  Median lat.   fp32: ${fmt(rerankResult.fp32.medianLatencyMs).padStart(8)}  │  int8: ${fmt(rerankResult.int8.medianLatencyMs).padStart(8)}`);
    console.log(`  Speedup load: ${(rerankResult.fp32.loadTimeMs / rerankResult.int8.loadTimeMs).toFixed(2)}x`);
    console.log(`  Speedup inf:  ${(rerankResult.fp32.medianLatencyMs / rerankResult.int8.medianLatencyMs).toFixed(2)}x`);
    console.log(`  EN ranking:   top1 match=${rerankResult.ranking.en.topMatch}  full match=${rerankResult.ranking.en.fullMatch}`);
    console.log(`    fp32 scores: [${rerankResult.ranking.en.fp32.scores.map(s => s.toFixed(4)).join(", ")}]`);
    console.log(`    int8 scores: [${rerankResult.ranking.en.int8.scores.map(s => s.toFixed(4)).join(", ")}]`);
    console.log(`  RU ranking:   top1 match=${rerankResult.ranking.ru.topMatch}  full match=${rerankResult.ranking.ru.fullMatch}`);
    console.log(`    fp32 scores: [${rerankResult.ranking.ru.fp32.scores.map(s => s.toFixed(4)).join(", ")}]`);
    console.log(`    int8 scores: [${rerankResult.ranking.ru.int8.scores.map(s => s.toFixed(4)).join(", ")}]`);

    // Per-text cosine details
    console.log("\n  📊 PER-TEXT COSINE SIMILARITY (fp32 ↔ int8)");
    console.log("  ─────────────────────────────────────────────");
    for (let i = 0; i < EMBEDDING_TEXTS.length; i++) {
        const label = EMBEDDING_TEXTS[i].substring(0, 50).padEnd(52);
        console.log(`  ${label} ${embedResult.quality.fp32_vs_int8_cosine[i].toFixed(6)}`);
    }

    console.log("\n╚═══════════════════════════════════════════════════════════════╝");

    // -----------------------------------------------------------------------
    // Save results JSON
    // -----------------------------------------------------------------------
    const report = {
        timestamp: new Date().toISOString(),
        node: process.version,
        platform: `${process.platform} ${process.arch}`,
        embeddings: embedResult,
        reranker: rerankResult,
    };

    const outPath = join(__dirname, "..", "..", "benchmark_results.json");
    writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`\n  Results saved to: ${outPath}`);
}

main().catch((err) => {
    console.error("Benchmark failed:", err);
    process.exit(1);
});
