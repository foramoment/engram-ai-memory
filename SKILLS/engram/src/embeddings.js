// @ts-check
/**
 * Embeddings module — BGE-M3 via @huggingface/transformers.
 *
 * Uses WebGPU when available (RTX 5060 Ti → ~4x speedup),
 * falls back to WASM/CPU otherwise.
 *
 * BGE-M3: 100+ languages, 1024-dim vectors, 8192 token context.
 * Models quantized to INT8 for 75% less disk and ~2.5x faster inference.
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Write diagnostic output to stderr, only when ENGRAM_TRACE=1 */
const trace = (...args) => process.env.ENGRAM_TRACE === "1" && process.stderr.write(args.join(" ") + "\n");

/** Model cache dir — outside node_modules for persistence across npm installs */
const CACHE_DIR = join(__dirname, "..", "data", "models");

const MODEL_ID = "Xenova/bge-m3";
const EMBEDDING_DIM = 1024;

/** @type {any} */
let _pipeline = null;

/** @type {string} */
let _device = "cpu";

/** @type {boolean} */
let _initialized = false;

/**
 * Detect the best available device for inference.
 * @returns {Promise<string>} 'webgpu', 'wasm', or 'cpu'
 */
async function detectDevice() {
    // In Node.js, WebGPU is available via dawn bindings (experimental)
    // For now, default to cpu/wasm — user can override
    try {
        // Check if WebGPU is available in the current runtime
        if (typeof navigator !== "undefined" && navigator.gpu) {
            const adapter = await navigator.gpu.requestAdapter();
            if (adapter) {
                trace("[engram] WebGPU available:", (await adapter.requestAdapterInfo()).description);
                return "webgpu";
            }
        }
    } catch {
        // WebGPU not available
    }

    return "cpu";
}

/**
 * Initialize the embedding pipeline (lazy — called on first embed()).
 * @param {object} [options]
 * @param {string} [options.device] - Force device: 'webgpu' | 'cpu'
 * @param {string} [options.modelId] - Override model ID
 * @returns {Promise<void>}
 */
export async function initEmbeddings(options = {}) {
    if (_initialized && _pipeline) return;

    const { pipeline, env } = await import("@huggingface/transformers");
    env.cacheDir = CACHE_DIR;

    _device = options.device || await detectDevice();
    const modelId = options.modelId || MODEL_ID;

    trace(`[engram] Loading embedding model: ${modelId} (device: ${_device})`);
    const startTime = Date.now();

    _pipeline = await pipeline("feature-extraction", modelId, {
        dtype: "int8",
        device: _device,
    });

    const elapsed = Date.now() - startTime;
    trace(`[engram] Model loaded in ${elapsed}ms`);

    _initialized = true;
}

/**
 * Generate an embedding vector for the given text.
 *
 * @param {string} text - Text to embed (max ~8192 tokens)
 * @returns {Promise<Float32Array>} 1024-dimensional embedding vector
 */
export async function embed(text) {
    if (!_initialized || !_pipeline) {
        await initEmbeddings();
    }

    const output = await _pipeline(text, {
        pooling: "cls",
        normalize: true,
    });

    // output.data is a Float32Array
    return new Float32Array(output.data);
}

/**
 * Generate embeddings for multiple texts (batch).
 *
 * @param {string[]} texts - Array of texts to embed
 * @returns {Promise<Float32Array[]>} Array of 1024-dim vectors
 */
export async function embedBatch(texts) {
    const results = [];
    for (const text of texts) {
        results.push(await embed(text));
    }
    return results;
}

/**
 * Compute cosine similarity between two vectors.
 * Used as fallback when vector index is not available.
 *
 * @param {Float32Array | number[]} a
 * @param {Float32Array | number[]} b
 * @returns {number} Cosine similarity (-1 to 1)
 */
export function cosineSimilarity(a, b) {
    if (a.length !== b.length) {
        throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
}

/**
 * Get the embedding dimension.
 * @returns {number}
 */
export function getEmbeddingDim() {
    return EMBEDDING_DIM;
}

/**
 * Get current device being used.
 * @returns {string}
 */
export function getDevice() {
    return _device;
}

/**
 * Check if embeddings are initialized.
 * @returns {boolean}
 */
export function isInitialized() {
    return _initialized;
}

/**
 * Reset the embeddings pipeline (for testing).
 */
export function resetEmbeddings() {
    _pipeline = null;
    _initialized = false;
    _device = "cpu";
}

/**
 * Convert Float32Array to the format LibSQL expects for F32_BLOB.
 * LibSQL stores vectors as raw bytes — Float32Array buffer works directly.
 *
 * @param {Float32Array} vec
 * @returns {Uint8Array} Raw bytes for F32_BLOB
 */
export function vectorToBlob(vec) {
    return new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
}

/**
 * Convert F32_BLOB bytes back to Float32Array.
 *
 * @param {ArrayBuffer | Uint8Array} blob
 * @returns {Float32Array}
 */
export function blobToVector(blob) {
    if (blob instanceof Uint8Array) {
        return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
    }
    return new Float32Array(blob);
}

// ---------------------------------------------------------------------------
// Cross-encoder Reranker — BGE-reranker-base via Transformers.js
// ---------------------------------------------------------------------------

const RERANKER_MODEL_ID = "Xenova/bge-reranker-base";

/** @type {any} */
let _rerankerTokenizer = null;

/** @type {any} */
let _rerankerModel = null;

/** @type {boolean} */
let _rerankerInitialized = false;

/**
 * Initialize the cross-encoder reranker (lazy — called on first rerank()).
 * @returns {Promise<void>}
 */
export async function initReranker() {
    if (_rerankerInitialized && _rerankerModel) return;

    const { AutoTokenizer, AutoModelForSequenceClassification, env } = await import("@huggingface/transformers");
    env.cacheDir = CACHE_DIR;

    trace(`[engram] Loading reranker model: ${RERANKER_MODEL_ID}`);
    const startTime = Date.now();

    _rerankerTokenizer = await AutoTokenizer.from_pretrained(RERANKER_MODEL_ID);
    _rerankerModel = await AutoModelForSequenceClassification.from_pretrained(RERANKER_MODEL_ID, { dtype: "int8" });

    const elapsed = Date.now() - startTime;
    trace(`[engram] Reranker loaded in ${elapsed}ms`);
    _rerankerInitialized = true;
}

/**
 * @returns {boolean}
 */
export function isRerankerInitialized() {
    return _rerankerInitialized;
}

/**
 * Reset reranker (for testing).
 */
export function resetReranker() {
    _rerankerModel = null;
    _rerankerTokenizer = null;
    _rerankerInitialized = false;
}

/**
 * @typedef {Object} RerankResult
 * @property {number} index - Original index in the input array
 * @property {number} score - Relevance score (0-1, sigmoid-normalized logit)
 * @property {string} text  - The document text
 */

/**
 * Re-rank documents by cross-encoder relevance to a query.
 *
 * Cross-encoders process (query, document) pairs jointly via attention,
 * making them much more accurate than bi-encoders for relevance scoring.
 *
 * @param {string} query
 * @param {string[]} documents - Texts to re-rank
 * @param {object} [options]
 * @param {number} [options.topK] - Return only top-K results (default: all)
 * @returns {Promise<RerankResult[]>} Sorted by score descending
 */
export async function rerank(query, documents, options = {}) {
    if (!_rerankerInitialized || !_rerankerModel) {
        await initReranker();
    }

    const { topK } = options;

    /** @type {RerankResult[]} */
    const results = [];

    // Score each (query, document) pair
    for (let i = 0; i < documents.length; i++) {
        const inputs = _rerankerTokenizer([query], {
            text_pair: [documents[i]],
            padding: true,
            truncation: true,
        });

        const output = await _rerankerModel(inputs);

        // output.logits is a Tensor with shape [1, 1]
        // Apply sigmoid to get a 0-1 relevance score
        const logit = Number(output.logits.data[0]);
        const score = 1 / (1 + Math.exp(-logit)); // sigmoid

        results.push({ index: i, score, text: documents[i] });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    // Apply topK if specified
    if (topK && topK > 0) {
        return results.slice(0, topK);
    }

    return results;
}

