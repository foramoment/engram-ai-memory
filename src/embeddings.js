// @ts-check
/**
 * Embeddings module — BGE-M3 via @huggingface/transformers.
 *
 * Uses WebGPU when available (RTX 5060 Ti → ~4x speedup),
 * falls back to WASM/CPU otherwise.
 *
 * BGE-M3: 100+ languages, 1024-dim vectors, 8192 token context.
 */

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
                console.log("[engram] WebGPU available:", (await adapter.requestAdapterInfo()).description);
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

    const { pipeline } = await import("@huggingface/transformers");

    _device = options.device || await detectDevice();
    const modelId = options.modelId || MODEL_ID;

    console.log(`[engram] Loading embedding model: ${modelId} (device: ${_device})`);
    const startTime = Date.now();

    _pipeline = await pipeline("feature-extraction", modelId, {
        dtype: "fp32",
        device: _device,
    });

    const elapsed = Date.now() - startTime;
    console.log(`[engram] Model loaded in ${elapsed}ms`);

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
