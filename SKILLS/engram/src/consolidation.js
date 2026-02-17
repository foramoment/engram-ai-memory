// @ts-check
/**
 * Sleep Consolidation — Biologically-inspired memory management.
 *
 * Implements the Ebbinghaus forgetting curve, duplicate merging,
 * pattern extraction, and active memory boosting.
 *
 * Designed to run periodically (e.g. every 3 days).
 */

import { embed, cosineSimilarity, vectorToBlob, blobToVector } from "./embeddings.js";

/** Write diagnostic output to stderr, only when ENGRAM_TRACE=1 */
const trace = (...args) => process.env.ENGRAM_TRACE === "1" && process.stderr.write(args.join(" ") + "\n");
import { getMeta, setMeta } from "./db.js";

/**
 * @typedef {Object} ConsolidationResult
 * @property {number} decayed      - Number of memories with reduced strength
 * @property {number} pruned       - Number of archived memories
 * @property {number} merged       - Number of merged duplicates
 * @property {number} boosted      - Number of boosted memories
 * @property {string[]} patterns   - Extracted patterns (if LLM available)
 * @property {number} elapsed_ms   - Total time
 */

/**
 * @typedef {Object} ConsolidationOptions
 * @property {number} [decayRate]         - Daily decay rate (default 0.95)
 * @property {number} [pruneThreshold]    - Strength below which to archive (default 0.05)
 * @property {number} [mergeThreshold]    - Cosine similarity for merging (default 0.92)
 * @property {number} [boostFactor]       - Multiplier for frequently accessed memories (default 1.1)
 * @property {number} [boostMinAccess]    - Min access count to qualify for boost (default 3)
 * @property {boolean} [dryRun]           - If true, don't modify data
 */

/**
 * Run the full sleep consolidation cycle.
 *
 * Steps:
 *  1. Decay — reduce strength based on time since last access
 *  2. Prune — archive memories below threshold
 *  3. Merge — find and merge near-duplicates
 *  4. Extract — identify patterns (optional, LLM)
 *  5. Boost — strengthen frequently accessed memories
 *
 * @param {import("@libsql/client").Client} client
 * @param {ConsolidationOptions} [options]
 * @returns {Promise<ConsolidationResult>}
 */
export async function runConsolidation(client, options = {}) {
    const startTime = Date.now();
    const {
        decayRate = 0.95,
        pruneThreshold = 0.05,
        mergeThreshold = 0.92,
        boostFactor = 1.1,
        boostMinAccess = 3,
        dryRun = false,
    } = options;

    trace("[engram] 💤 Starting sleep consolidation...");

    // Retrieve last consolidation timestamp for idempotent decay/boost
    const lastRunIso = await getMeta(client, "last_consolidation_at");
    const lastRunAt = lastRunIso || null;
    const daysSinceLast = lastRunAt
        ? (Date.now() - new Date(lastRunAt).getTime()) / (1000 * 60 * 60 * 24)
        : null;
    trace(`[engram]   Last run: ${lastRunAt ?? 'never'} (${daysSinceLast?.toFixed(1) ?? '∞'} days ago)`);

    // Step 1: Decay — only for the period since last consolidation
    const decayed = await stepDecay(client, decayRate, dryRun, lastRunAt);
    trace(`[engram]   Decay: ${decayed} memories affected`);

    // Step 2: Prune
    const pruned = await stepPrune(client, pruneThreshold, dryRun);
    trace(`[engram]   Prune: ${pruned} memories archived`);

    // Step 3: Merge
    const merged = await stepMerge(client, mergeThreshold, dryRun);
    trace(`[engram]   Merge: ${merged} duplicates merged`);

    // Step 4: Extract — placeholder for future LLM-based pattern extraction.
    // When implemented, this step will analyze clusters of related memories
    // and extract common patterns, generalizations, or meta-rules.
    // Requires access to a local LLM (e.g. via LM Studio API).
    /** @type {string[]} */
    const patterns = [];

    // Step 5: Boost — only if ≥1 day since last consolidation (idempotency guard)
    let boosted = 0;
    if (daysSinceLast === null || daysSinceLast >= 1.0) {
        boosted = await stepBoost(client, boostFactor, boostMinAccess, dryRun);
        trace(`[engram]   Boost: ${boosted} memories strengthened`);
    } else {
        trace(`[engram]   Boost: skipped (only ${daysSinceLast.toFixed(1)} days since last run, need ≥1)`);
    }

    // Update last consolidation timestamp
    if (!dryRun) {
        await setMeta(client, "last_consolidation_at", new Date().toISOString());
    }

    const elapsed_ms = Date.now() - startTime;
    trace(`[engram] 💤 Consolidation complete in ${elapsed_ms}ms`);

    return { decayed, pruned, merged, boosted, patterns, elapsed_ms };
}

/**
 * Step 1: Decay — Ebbinghaus forgetting curve (idempotent).
 *
 * Decays strength only for the period since last consolidation run,
 * not from the absolute last_accessed_at. This makes decay idempotent:
 * running consolidation twice in a row won't double-decay.
 *
 * Formula: strength *= decayRate ^ daysSinceLastConsolidation
 * First run (no history): uses days since last_accessed_at as fallback.
 *
 * @param {import("@libsql/client").Client} client
 * @param {number} decayRate
 * @param {boolean} dryRun
 * @param {string | null} lastRunAt - ISO timestamp of last consolidation
 * @returns {Promise<number>}
 */
async function stepDecay(client, decayRate, dryRun, lastRunAt) {
    // F026: Exclude memories tagged 'permanent' from decay
    const permanentExclude = `AND m.id NOT IN (
        SELECT mt.memory_id FROM memory_tags mt
        JOIN tags t ON t.id = mt.tag_id WHERE t.name = 'permanent'
    )`;

    if (dryRun) {
        const count = await client.execute(
            `SELECT COUNT(*) as n FROM memories m WHERE m.archived = 0 AND m.last_accessed_at IS NOT NULL ${permanentExclude}`
        );
        return Number(count.rows[0].n);
    }

    // Idempotent decay: only decay for the days SINCE the last consolidation run.
    // If no prior run, fall back to days since last access (first-time catch-up).
    const result = await client.execute({
        sql: `UPDATE memories SET 
          strength = strength * POWER(?, MAX(0, julianday('now') - julianday(COALESCE(?, last_accessed_at, created_at)))),
          updated_at = datetime('now')
          WHERE archived = 0 AND strength > 0
          AND id NOT IN (
              SELECT mt.memory_id FROM memory_tags mt
              JOIN tags t ON t.id = mt.tag_id WHERE t.name = 'permanent'
          )`,
        args: [decayRate, lastRunAt],
    });

    return result.rowsAffected;
}

/**
 * Step 2: Prune — archive memories below strength threshold.
 *
 * @param {import("@libsql/client").Client} client
 * @param {number} threshold
 * @param {boolean} dryRun
 * @returns {Promise<number>}
 */
async function stepPrune(client, threshold, dryRun) {
    // F026: Exclude memories tagged 'permanent' from pruning
    const permanentExclude = `AND id NOT IN (
        SELECT mt.memory_id FROM memory_tags mt
        JOIN tags t ON t.id = mt.tag_id WHERE t.name = 'permanent'
    )`;

    if (dryRun) {
        const count = await client.execute({
            sql: `SELECT COUNT(*) as n FROM memories WHERE archived = 0 AND strength < ? ${permanentExclude}`,
            args: [threshold],
        });
        return Number(count.rows[0].n);
    }

    const result = await client.execute({
        sql: `UPDATE memories SET archived = 1, updated_at = datetime('now') WHERE archived = 0 AND strength < ? ${permanentExclude}`,
        args: [threshold],
    });

    return result.rowsAffected;
}

/**
 * Step 3: Merge — find near-duplicates and merge them.
 *
 * Uses DiskANN vector_top_k for O(n × k) neighbor lookup instead of O(n²)
 * brute-force pairwise comparison. Falls back to brute-force when index
 * is unavailable.
 *
 * @param {import("@libsql/client").Client} client
 * @param {number} threshold - Cosine similarity threshold (0.92 = very similar)
 * @param {boolean} dryRun
 * @returns {Promise<number>}
 */
async function stepMerge(client, threshold, dryRun) {
    // Try DiskANN path first
    let duplicates;
    try {
        duplicates = await _findMergeCandidatesDiskANN(client, threshold);
    } catch (/** @type {any} */ err) {
        trace("[engram] DiskANN merge-scan failed, falling back to brute-force:", err?.message || String(err));
        duplicates = await _findMergeCandidatesBruteForce(client, threshold);
    }

    if (dryRun) return duplicates.length;

    // Execute merges
    for (const dup of duplicates) {
        // Merge content: append unique parts from removed memory
        const mergedContent = `${dup.keep.content}\n\n[Merged from: ${dup.remove.title}]\n${dup.remove.content}`;
        const mergedImportance = Math.max(dup.keep.importance, dup.remove.importance);
        const mergedStrength = Math.max(dup.keep.strength, dup.remove.strength);

        // Re-embed merged content
        const newEmbedding = await embed(`${dup.keep.title}\n${mergedContent}`);
        const embeddingBlob = vectorToBlob(newEmbedding);

        await client.execute({
            sql: `UPDATE memories SET 
            content = ?, content_embedding = vector(?), importance = ?, strength = ?,
            access_count = access_count + ?, updated_at = datetime('now')
            WHERE id = ?`,
            args: [mergedContent, embeddingBlob, mergedImportance, mergedStrength, dup.remove.accessCount, dup.keep.id],
        });

        // Archive the duplicate (don't delete — keep for audit)
        await client.execute({
            sql: "UPDATE memories SET archived = 1, updated_at = datetime('now') WHERE id = ?",
            args: [dup.remove.id],
        });

        // Transfer links from removed to kept
        await client.execute({
            sql: "UPDATE OR IGNORE memory_links SET source_id = ? WHERE source_id = ?",
            args: [dup.keep.id, dup.remove.id],
        });
        await client.execute({
            sql: "UPDATE OR IGNORE memory_links SET target_id = ? WHERE target_id = ?",
            args: [dup.keep.id, dup.remove.id],
        });
    }

    return duplicates.length;
}

/**
 * @typedef {Object} MergeCandidate
 * @property {{id: number, title: string, content: string, importance: number, strength: number, accessCount: number}} keep
 * @property {{id: number, title: string, content: string, importance: number, strength: number, accessCount: number}} remove
 * @property {number} similarity
 */

/**
 * DiskANN-accelerated merge candidate detection — O(n × k).
 * @param {import("@libsql/client").Client} client
 * @param {number} threshold
 * @returns {Promise<MergeCandidate[]>}
 */
async function _findMergeCandidatesDiskANN(client, threshold) {
    const memories = await client.execute(
        "SELECT id, type, title, content, content_embedding, importance, strength, access_count FROM memories WHERE archived = 0 AND content_embedding IS NOT NULL ORDER BY id"
    );

    if (memories.rows.length < 2) return [];

    // Build lookup map
    /** @type {Map<number, {id: number, type: string, title: string, content: string, importance: number, strength: number, accessCount: number, embedding: any}>} */
    const memMap = new Map();
    for (const r of memories.rows) {
        memMap.set(Number(r.id), {
            id: Number(r.id),
            type: String(r.type),
            title: String(r.title),
            content: String(r.content),
            importance: Number(r.importance),
            strength: Number(r.strength),
            accessCount: Number(r.access_count),
            embedding: r.content_embedding,
        });
    }

    const neighborsK = 4; // Fewer needed since threshold is higher (0.92)
    /** @type {MergeCandidate[]} */
    const duplicates = [];
    const toRemove = new Set();

    for (const [id, mem] of memMap) {
        if (toRemove.has(id)) continue;

        const neighbors = await client.execute({
            sql: `SELECT m.id, m.type, v.distance as dist
                  FROM vector_top_k('memories_vec_idx', vector(?), ?) v
                  JOIN memories m ON m.rowid = v.id
                  WHERE m.id != ? AND m.archived = 0 AND m.type = ?`,
            args: [mem.embedding, neighborsK, id, mem.type],
        });

        for (const neighbor of neighbors.rows) {
            const neighborId = Number(neighbor.id);
            if (toRemove.has(neighborId)) continue;

            const similarity = 1 - Number(neighbor.dist);
            if (similarity < threshold) continue;

            const other = memMap.get(neighborId);
            if (!other) continue;

            // Keep the one with higher importance or more accesses
            const scoreA = mem.importance + mem.accessCount * 0.1;
            const scoreB = other.importance + other.accessCount * 0.1;

            if (scoreA >= scoreB) {
                duplicates.push({ keep: mem, remove: other, similarity });
                toRemove.add(neighborId);
            } else {
                duplicates.push({ keep: other, remove: mem, similarity });
                toRemove.add(id);
                break; // This memory is being removed, skip to next
            }
        }
    }

    return duplicates;
}

/**
 * Brute-force O(n²) merge candidate detection — fallback.
 * @param {import("@libsql/client").Client} client
 * @param {number} threshold
 * @returns {Promise<MergeCandidate[]>}
 */
async function _findMergeCandidatesBruteForce(client, threshold) {
    const memories = await client.execute(
        "SELECT id, type, title, content, content_embedding, importance, strength, access_count FROM memories WHERE archived = 0 AND content_embedding IS NOT NULL ORDER BY id"
    );

    if (memories.rows.length < 2) return [];

    const parsedMemories = memories.rows.map((r) => ({
        id: Number(r.id),
        type: String(r.type),
        title: String(r.title),
        content: String(r.content),
        embedding: r.content_embedding ? blobToVector(/** @type {Uint8Array} */(/** @type {unknown} */(r.content_embedding))) : null,
        importance: Number(r.importance),
        strength: Number(r.strength),
        accessCount: Number(r.access_count),
    }));

    /** @type {MergeCandidate[]} */
    const duplicates = [];
    const toRemove = new Set();

    for (let i = 0; i < parsedMemories.length; i++) {
        if (toRemove.has(parsedMemories[i].id)) continue;
        if (!parsedMemories[i].embedding) continue;

        for (let j = i + 1; j < parsedMemories.length; j++) {
            if (toRemove.has(parsedMemories[j].id)) continue;
            if (!parsedMemories[j].embedding) continue;
            if (parsedMemories[i].type !== parsedMemories[j].type) continue;

            const sim = cosineSimilarity(
        /** @type {Float32Array} */(parsedMemories[i].embedding),
        /** @type {Float32Array} */(parsedMemories[j].embedding)
            );

            if (sim >= threshold) {
                const scoreI = parsedMemories[i].importance + parsedMemories[i].accessCount * 0.1;
                const scoreJ = parsedMemories[j].importance + parsedMemories[j].accessCount * 0.1;

                if (scoreI >= scoreJ) {
                    duplicates.push({ keep: parsedMemories[i], remove: parsedMemories[j], similarity: sim });
                    toRemove.add(parsedMemories[j].id);
                } else {
                    duplicates.push({ keep: parsedMemories[j], remove: parsedMemories[i], similarity: sim });
                    toRemove.add(parsedMemories[i].id);
                }
            }
        }
    }

    return duplicates;
}

/**
 * Step 5: Boost — strengthen frequently accessed memories.
 *
 * @param {import("@libsql/client").Client} client
 * @param {number} factor
 * @param {number} minAccess
 * @param {boolean} dryRun
 * @returns {Promise<number>}
 */
async function stepBoost(client, factor, minAccess, dryRun) {
    if (dryRun) {
        const count = await client.execute({
            sql: "SELECT COUNT(*) as n FROM memories WHERE archived = 0 AND access_count >= ?",
            args: [minAccess],
        });
        return Number(count.rows[0].n);
    }

    const result = await client.execute({
        sql: `UPDATE memories SET 
          strength = MIN(1.0, strength * ?),
          updated_at = datetime('now')
          WHERE archived = 0 AND access_count >= ?`,
        args: [factor, minAccess],
    });

    return result.rowsAffected;
}

/**
 * Check if consolidation should be triggered.
 * @param {import("@libsql/client").Client} client
 * @param {number} [intervalDays] - Days between consolidations (default 3)
 * @returns {Promise<{shouldRun: boolean, daysSinceLast: number | null}>}
 */
export async function shouldConsolidate(client, intervalDays = 3) {
    const lastRun = await getMeta(client, "last_consolidation_at");
    if (!lastRun) return { shouldRun: true, daysSinceLast: null };

    const daysSinceLast = (Date.now() - new Date(lastRun).getTime()) / (1000 * 60 * 60 * 24);
    return { shouldRun: daysSinceLast >= intervalDays, daysSinceLast };
}

/**
 * Get consolidation candidates for preview (dry run).
 * @param {import("@libsql/client").Client} client
 * @param {ConsolidationOptions} [options]
 * @returns {Promise<{weakest: object[], duplicateCandidates: object[]}>}
 */
export async function getConsolidationPreview(client, options = {}) {
    const { pruneThreshold = 0.05, mergeThreshold = 0.92 } = options;

    // Weakest memories (candidates for pruning)
    const weakest = await client.execute({
        sql: `SELECT id, type, title, strength, access_count, last_accessed_at
          FROM memories WHERE archived = 0
          ORDER BY strength ASC LIMIT 10`,
        args: [],
    });

    // Run merge in dry-run to count duplicates
    const mergeCount = await stepMerge(client, mergeThreshold, true);

    return {
        weakest: weakest.rows.map((r) => ({
            id: Number(r.id),
            type: String(r.type),
            title: String(r.title),
            strength: Number(r.strength),
            access_count: Number(r.access_count),
            last_accessed_at: r.last_accessed_at ? String(r.last_accessed_at) : null,
        })),
        duplicateCandidates: [{ count: mergeCount, threshold: mergeThreshold }],
    };
}
