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
 * @property {string} [llmEndpoint]       - LM Studio API URL (default localhost:1234)
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

    console.log("[engram] 💤 Starting sleep consolidation...");

    // Step 1: Decay
    const decayed = await stepDecay(client, decayRate, dryRun);
    console.log(`[engram]   Decay: ${decayed} memories affected`);

    // Step 2: Prune
    const pruned = await stepPrune(client, pruneThreshold, dryRun);
    console.log(`[engram]   Prune: ${pruned} memories archived`);

    // Step 3: Merge
    const merged = await stepMerge(client, mergeThreshold, dryRun);
    console.log(`[engram]   Merge: ${merged} duplicates merged`);

    // Step 4: Extract (placeholder — requires LLM)
    const patterns = [];
    // TODO: Implement LLM-based pattern extraction via LM Studio

    // Step 5: Boost
    const boosted = await stepBoost(client, boostFactor, boostMinAccess, dryRun);
    console.log(`[engram]   Boost: ${boosted} memories strengthened`);

    // Update last consolidation timestamp
    if (!dryRun) {
        await setMeta(client, "last_consolidation_at", new Date().toISOString());
    }

    const elapsed_ms = Date.now() - startTime;
    console.log(`[engram] 💤 Consolidation complete in ${elapsed_ms}ms`);

    return { decayed, pruned, merged, boosted, patterns, elapsed_ms };
}

/**
 * Step 1: Decay — Ebbinghaus forgetting curve.
 * strength *= decayRate ^ daysSinceLastAccess
 *
 * @param {import("@libsql/client").Client} client
 * @param {number} decayRate
 * @param {boolean} dryRun
 * @returns {Promise<number>}
 */
async function stepDecay(client, decayRate, dryRun) {
    if (dryRun) {
        const count = await client.execute(
            "SELECT COUNT(*) as n FROM memories WHERE archived = 0 AND last_accessed_at IS NOT NULL"
        );
        return Number(count.rows[0].n);
    }

    // Calculate days since last access and apply decay
    const result = await client.execute({
        sql: `UPDATE memories SET 
          strength = strength * POWER(?, MAX(1, julianday('now') - julianday(COALESCE(last_accessed_at, created_at)))),
          updated_at = datetime('now')
          WHERE archived = 0 AND strength > 0`,
        args: [decayRate],
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
    if (dryRun) {
        const count = await client.execute({
            sql: "SELECT COUNT(*) as n FROM memories WHERE archived = 0 AND strength < ?",
            args: [threshold],
        });
        return Number(count.rows[0].n);
    }

    const result = await client.execute({
        sql: "UPDATE memories SET archived = 1, updated_at = datetime('now') WHERE archived = 0 AND strength < ?",
        args: [threshold],
    });

    return result.rowsAffected;
}

/**
 * Step 3: Merge — find near-duplicates by cosine similarity and merge them.
 *
 * @param {import("@libsql/client").Client} client
 * @param {number} threshold - Cosine similarity threshold (0.92 = very similar)
 * @param {boolean} dryRun
 * @returns {Promise<number>}
 */
async function stepMerge(client, threshold, dryRun) {
    // Get all active memories with embeddings
    const memories = await client.execute(
        "SELECT id, type, title, content, content_embedding, importance, strength, access_count FROM memories WHERE archived = 0 AND content_embedding IS NOT NULL ORDER BY id"
    );

    if (memories.rows.length < 2) return 0;

    // Parse embeddings
    const parsedMemories = memories.rows.map((r) => ({
        id: Number(r.id),
        type: String(r.type),
        title: String(r.title),
        content: String(r.content),
        embedding: r.content_embedding ? blobToVector(/** @type {Uint8Array} */(r.content_embedding)) : null,
        importance: Number(r.importance),
        strength: Number(r.strength),
        accessCount: Number(r.access_count),
    }));

    // Find duplicate pairs (O(n²) but acceptable for typical memory sizes <1000)
    /** @type {Array<{keep: typeof parsedMemories[0], remove: typeof parsedMemories[0], similarity: number}>} */
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
                // Keep the one with higher importance or more accesses
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

    if (dryRun) return duplicates.length;

    // Merge duplicates
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
