// @ts-check
/**
 * Memory operations — CRUD, semantic/FTS/hybrid search, linking, tags.
 */

import { embed, cosineSimilarity, vectorToBlob, blobToVector, getEmbeddingDim } from "./embeddings.js";

/**
 * @typedef {Object} MemoryInput
 * @property {'reflex' | 'episode' | 'fact' | 'preference' | 'decision' | 'session_summary'} type
 * @property {string} title
 * @property {string} content
 * @property {number} [importance]        - 0.0–1.0, default 0.5
 * @property {string[]} [tags]            - Tags to assign
 * @property {Array<{targetId: number, relation: string}>} [links] - Links to create
 * @property {string} [sourceConversationId]
 * @property {'manual' | 'auto' | 'migration'} [sourceType]
 */

/**
 * @typedef {Object} Memory
 * @property {number} id
 * @property {string} type
 * @property {string} title
 * @property {string} content
 * @property {number} importance
 * @property {number} strength
 * @property {number} access_count
 * @property {string | null} last_accessed_at
 * @property {string} created_at
 * @property {string} updated_at
 * @property {string | null} source_conversation_id
 * @property {string} source_type
 * @property {number} archived
 * @property {string[]} [tags]
 * @property {Array<{id: number, relation: string, direction: string}>} [links]
 * @property {number} [score]  - Search relevance score
 */

/**
 * Add a new memory with auto-embedding.
 * @param {import("@libsql/client").Client} client
 * @param {MemoryInput} input
 * @returns {Promise<number>} The ID of the created memory
 */
export async function addMemory(client, input) {
    const {
        type, title, content,
        importance = 0.5,
        tags = [],
        links = [],
        sourceConversationId = null,
        sourceType = "manual",
    } = input;

    // Generate embedding
    const embedding = await embed(`${title}\n${content}`);
    const embeddingBlob = vectorToBlob(embedding);

    // Insert memory
    const result = await client.execute({
        sql: `INSERT INTO memories (type, title, content, content_embedding, importance, source_conversation_id, source_type)
          VALUES (?, ?, ?, vector(?), ?, ?, ?)`,
        args: [type, title, content, embeddingBlob, importance, sourceConversationId, sourceType],
    });

    const memoryId = Number(result.lastInsertRowid);

    // Add tags
    if (tags.length > 0) {
        for (const tag of tags) {
            await addTag(client, memoryId, tag);
        }
    }

    // Create links
    if (links.length > 0) {
        for (const link of links) {
            await linkMemories(client, memoryId, link.targetId, link.relation);
        }
    }

    return memoryId;
}

/**
 * Get a single memory by ID with tags and links.
 * @param {import("@libsql/client").Client} client
 * @param {number} id
 * @returns {Promise<Memory | null>}
 */
export async function getMemory(client, id) {
    const result = await client.execute({
        sql: `SELECT id, type, title, content, importance, strength, access_count, 
          last_accessed_at, created_at, updated_at, source_conversation_id, source_type, archived
          FROM memories WHERE id = ? AND archived = 0`,
        args: [id],
    });

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const memory = /** @type {Memory} */ ({
        id: Number(row.id),
        type: String(row.type),
        title: String(row.title),
        content: String(row.content),
        importance: Number(row.importance),
        strength: Number(row.strength),
        access_count: Number(row.access_count),
        last_accessed_at: row.last_accessed_at ? String(row.last_accessed_at) : null,
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
        source_conversation_id: row.source_conversation_id ? String(row.source_conversation_id) : null,
        source_type: String(row.source_type),
        archived: Number(row.archived),
    });

    // Fetch tags
    const tagsResult = await client.execute({
        sql: `SELECT t.name FROM tags t JOIN memory_tags mt ON t.id = mt.tag_id WHERE mt.memory_id = ?`,
        args: [id],
    });
    memory.tags = tagsResult.rows.map((r) => String(r.name));

    // Fetch links
    const linksResult = await client.execute({
        sql: `SELECT 
            CASE WHEN source_id = ? THEN target_id ELSE source_id END as linked_id,
            relation,
            CASE WHEN source_id = ? THEN 'outgoing' ELSE 'incoming' END as direction
          FROM memory_links 
          WHERE source_id = ? OR target_id = ?`,
        args: [id, id, id, id],
    });
    memory.links = linksResult.rows.map((r) => ({
        id: Number(r.linked_id),
        relation: String(r.relation),
        direction: String(r.direction),
    }));

    return memory;
}

/**
 * Update a memory. Re-embeds if title or content changes.
 * @param {import("@libsql/client").Client} client
 * @param {number} id
 * @param {Partial<{title: string, content: string, importance: number, strength: number, type: string}>} updates
 * @returns {Promise<boolean>}
 */
export async function updateMemory(client, id, updates) {
    const existing = await getMemory(client, id);
    if (!existing) return false;

    const sets = [];
    const args = [];

    if (updates.title !== undefined) {
        sets.push("title = ?");
        args.push(updates.title);
    }
    if (updates.content !== undefined) {
        sets.push("content = ?");
        args.push(updates.content);
    }
    if (updates.importance !== undefined) {
        sets.push("importance = ?");
        args.push(updates.importance);
    }
    if (updates.strength !== undefined) {
        sets.push("strength = ?");
        args.push(updates.strength);
    }
    if (updates.type !== undefined) {
        sets.push("type = ?");
        args.push(updates.type);
    }

    // Re-embed if content or title changed
    if (updates.title !== undefined || updates.content !== undefined) {
        const newTitle = updates.title ?? existing.title;
        const newContent = updates.content ?? existing.content;
        const embedding = await embed(`${newTitle}\n${newContent}`);
        const embeddingBlob = vectorToBlob(embedding);
        sets.push("content_embedding = vector(?)");
        args.push(embeddingBlob);
    }

    sets.push("updated_at = datetime('now')");
    args.push(id);

    await client.execute({
        sql: `UPDATE memories SET ${sets.join(", ")} WHERE id = ?`,
        args,
    });

    return true;
}

/**
 * Delete a memory (cascades to tags, links, access_log via FK).
 * @param {import("@libsql/client").Client} client
 * @param {number} id
 * @returns {Promise<boolean>}
 */
export async function deleteMemory(client, id) {
    const result = await client.execute({
        sql: "DELETE FROM memories WHERE id = ?",
        args: [id],
    });
    return result.rowsAffected > 0;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Semantic search using vector_top_k (or brute-force fallback).
 * @param {import("@libsql/client").Client} client
 * @param {string} query
 * @param {object} [options]
 * @param {number} [options.k] - Number of results (default 10)
 * @param {string} [options.type] - Filter by memory type
 * @param {boolean} [options.includeArchived] - Include archived memories
 * @returns {Promise<Memory[]>}
 */
export async function searchSemantic(client, query, options = {}) {
    const { k = 10, type, includeArchived = false } = options;
    const queryEmbedding = await embed(query);
    const queryBlob = vectorToBlob(queryEmbedding);

    // Try vector_top_k first (uses DiskANN index)
    try {
        let sql = `SELECT m.id, m.type, m.title, m.content, m.importance, m.strength, 
               m.access_count, m.last_accessed_at, m.created_at, m.updated_at,
               m.source_conversation_id, m.source_type, m.archived,
               v.distance as score
               FROM vector_top_k('memories_vec_idx', vector(?), ?) v
               JOIN memories m ON m.rowid = v.id
               WHERE 1=1`;
        const args = [queryBlob, k * 2]; // Fetch extra to account for filters

        if (!includeArchived) {
            sql += " AND m.archived = 0";
        }
        if (type) {
            sql += " AND m.type = ?";
            args.push(type);
        }
        sql += " LIMIT ?";
        args.push(k);

        const result = await client.execute({ sql, args });
        return result.rows.map((r) => rowToMemory(r));
    } catch {
        // Fallback: brute-force cosine distance
        return await searchSemanticBruteForce(client, queryEmbedding, options);
    }
}

/**
 * Brute-force cosine distance search (fallback when no vector index).
 * @param {import("@libsql/client").Client} client
 * @param {Float32Array} queryEmbedding
 * @param {object} [options]
 * @param {number} [options.k]
 * @param {string} [options.type]
 * @param {boolean} [options.includeArchived]
 * @returns {Promise<Memory[]>}
 */
async function searchSemanticBruteForce(client, queryEmbedding, options = {}) {
    const { k = 10, type, includeArchived = false } = options;
    const queryBlob = vectorToBlob(queryEmbedding);

    let sql = `SELECT id, type, title, content, importance, strength,
             access_count, last_accessed_at, created_at, updated_at,
             source_conversation_id, source_type, archived,
             vector_distance_cos(content_embedding, vector(?)) as score
             FROM memories WHERE content_embedding IS NOT NULL`;
    const args = [queryBlob];

    if (!includeArchived) {
        sql += " AND archived = 0";
    }
    if (type) {
        sql += " AND type = ?";
        args.push(type);
    }

    sql += " ORDER BY score ASC LIMIT ?"; // Lower distance = more similar
    args.push(k);

    const result = await client.execute({ sql, args });
    return result.rows.map((r) => rowToMemory(r));
}

/**
 * Full-text search using FTS5 with BM25 ranking.
 * @param {import("@libsql/client").Client} client
 * @param {string} query
 * @param {object} [options]
 * @param {number} [options.k] - Number of results (default 10)
 * @param {string} [options.type] - Filter by memory type
 * @returns {Promise<Memory[]>}
 */
export async function searchFTS(client, query, options = {}) {
    const { k = 10, type } = options;

    let sql = `SELECT m.id, m.type, m.title, m.content, m.importance, m.strength, 
             m.access_count, m.last_accessed_at, m.created_at, m.updated_at,
             m.source_conversation_id, m.source_type, m.archived,
             bm25(memories_fts) as score
             FROM memories_fts fts
             JOIN memories m ON m.id = fts.rowid
             WHERE memories_fts MATCH ? AND m.archived = 0`;
    const args = [query];

    if (type) {
        sql += " AND m.type = ?";
        args.push(type);
    }

    sql += " ORDER BY bm25(memories_fts) LIMIT ?";
    args.push(k);

    const result = await client.execute({ sql, args });
    return result.rows.map((r) => rowToMemory(r));
}

/**
 * Hybrid search combining semantic + FTS via Reciprocal Rank Fusion.
 * @param {import("@libsql/client").Client} client
 * @param {string} query
 * @param {object} [options]
 * @param {number} [options.k] - Number of results (default 10)
 * @param {string} [options.type] - Filter by memory type
 * @param {number} [options.rrf_k] - RRF parameter (default 60)
 * @returns {Promise<Memory[]>}
 */
export async function searchHybrid(client, query, options = {}) {
    const { k = 10, type, rrf_k = 60 } = options;

    // Run both searches in parallel
    const [semanticResults, ftsResults] = await Promise.all([
        searchSemantic(client, query, { k: k * 2, type }),
        searchFTS(client, query, { k: k * 2, type }).catch(() => []),
    ]);

    // Build RRF scores
    /** @type {Map<number, {memory: Memory, score: number}>} */
    const combined = new Map();

    // Score from semantic search (rank by position)
    semanticResults.forEach((mem, rank) => {
        const rrfScore = 1 / (rrf_k + rank + 1);
        combined.set(mem.id, { memory: mem, score: rrfScore });
    });

    // Score from FTS (rank by position)
    ftsResults.forEach((mem, rank) => {
        const rrfScore = 1 / (rrf_k + rank + 1);
        const existing = combined.get(mem.id);
        if (existing) {
            existing.score += rrfScore;
        } else {
            combined.set(mem.id, { memory: mem, score: rrfScore });
        }
    });

    // Sort by combined RRF score (descending)
    const sorted = [...combined.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, k);

    return sorted.map((item) => {
        item.memory.score = item.score;
        return item.memory;
    });
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/**
 * Add a tag to a memory (creates tag if not exists).
 * @param {import("@libsql/client").Client} client
 * @param {number} memoryId
 * @param {string} tagName
 */
export async function addTag(client, memoryId, tagName) {
    const normalized = tagName.toLowerCase().trim();

    // Upsert tag
    await client.execute({
        sql: "INSERT OR IGNORE INTO tags (name) VALUES (?)",
        args: [normalized],
    });

    const tagResult = await client.execute({
        sql: "SELECT id FROM tags WHERE name = ?",
        args: [normalized],
    });

    const tagId = Number(tagResult.rows[0].id);

    // Link tag to memory
    await client.execute({
        sql: "INSERT OR IGNORE INTO memory_tags (memory_id, tag_id) VALUES (?, ?)",
        args: [memoryId, tagId],
    });
}

/**
 * Remove a tag from a memory.
 * @param {import("@libsql/client").Client} client
 * @param {number} memoryId
 * @param {string} tagName
 */
export async function removeTag(client, memoryId, tagName) {
    const normalized = tagName.toLowerCase().trim();
    await client.execute({
        sql: `DELETE FROM memory_tags WHERE memory_id = ? 
          AND tag_id = (SELECT id FROM tags WHERE name = ?)`,
        args: [memoryId, normalized],
    });
}

/**
 * Get all memories with a specific tag.
 * @param {import("@libsql/client").Client} client
 * @param {string} tagName
 * @returns {Promise<Memory[]>}
 */
export async function getMemoriesByTag(client, tagName) {
    const normalized = tagName.toLowerCase().trim();
    const result = await client.execute({
        sql: `SELECT m.id, m.type, m.title, m.content, m.importance, m.strength,
          m.access_count, m.last_accessed_at, m.created_at, m.updated_at,
          m.source_conversation_id, m.source_type, m.archived
          FROM memories m
          JOIN memory_tags mt ON m.id = mt.memory_id
          JOIN tags t ON t.id = mt.tag_id
          WHERE t.name = ? AND m.archived = 0`,
        args: [normalized],
    });
    return result.rows.map((r) => rowToMemory(r));
}

/**
 * Get all tags with their usage counts.
 * @param {import("@libsql/client").Client} client
 * @returns {Promise<Array<{name: string, count: number}>>}
 */
export async function getAllTags(client) {
    const result = await client.execute(
        `SELECT t.name, COUNT(mt.memory_id) as count
     FROM tags t
     LEFT JOIN memory_tags mt ON t.id = mt.tag_id
     GROUP BY t.id
     ORDER BY count DESC`
    );
    return result.rows.map((r) => ({
        name: String(r.name),
        count: Number(r.count),
    }));
}

// ---------------------------------------------------------------------------
// Knowledge Graph — Links
// ---------------------------------------------------------------------------

const VALID_RELATIONS = ["related_to", "caused_by", "evolved_from", "contradicts", "supersedes"];

/**
 * Create a link between two memories.
 * @param {import("@libsql/client").Client} client
 * @param {number} sourceId
 * @param {number} targetId
 * @param {string} relation
 * @param {number} [strength]
 */
export async function linkMemories(client, sourceId, targetId, relation, strength = 0.5) {
    if (!VALID_RELATIONS.includes(relation)) {
        throw new Error(`Invalid relation: ${relation}. Must be one of: ${VALID_RELATIONS.join(", ")}`);
    }
    await client.execute({
        sql: "INSERT OR REPLACE INTO memory_links (source_id, target_id, relation, strength) VALUES (?, ?, ?, ?)",
        args: [sourceId, targetId, relation, strength],
    });
}

/**
 * Get all links for a memory (both directions).
 * @param {import("@libsql/client").Client} client
 * @param {number} memoryId
 * @returns {Promise<Array<{id: number, relation: string, direction: string, title: string}>>}
 */
export async function getLinks(client, memoryId) {
    const result = await client.execute({
        sql: `SELECT 
            CASE WHEN ml.source_id = ? THEN ml.target_id ELSE ml.source_id END as linked_id,
            ml.relation,
            CASE WHEN ml.source_id = ? THEN 'outgoing' ELSE 'incoming' END as direction,
            m.title
          FROM memory_links ml
          JOIN memories m ON m.id = CASE WHEN ml.source_id = ? THEN ml.target_id ELSE ml.source_id END
          WHERE (ml.source_id = ? OR ml.target_id = ?) AND m.archived = 0`,
        args: [memoryId, memoryId, memoryId, memoryId, memoryId],
    });
    return result.rows.map((r) => ({
        id: Number(r.linked_id),
        relation: String(r.relation),
        direction: String(r.direction),
        title: String(r.title),
    }));
}

/**
 * Find related memories via graph + vector similarity.
 * @param {import("@libsql/client").Client} client
 * @param {number} memoryId
 * @param {number} [k] - Number of results
 * @returns {Promise<Memory[]>}
 */
export async function findRelated(client, memoryId, k = 5) {
    const memory = await getMemory(client, memoryId);
    if (!memory) return [];

    // 1) Get directly linked memories
    const directLinks = await getLinks(client, memoryId);
    const linkedIds = new Set(directLinks.map((l) => l.id));

    // 2) Find semantically similar (by searching with memory content)
    const semanticResults = await searchSemantic(client, `${memory.title}\n${memory.content}`, { k: k + linkedIds.size });

    // Combine: linked first, then semantic (excluding self and already-linked)
    /** @type {Memory[]} */
    const results = [];

    // Add linked memories
    for (const link of directLinks) {
        const linked = await getMemory(client, link.id);
        if (linked) results.push(linked);
    }

    // Add semantic (not self, not already linked)
    for (const mem of semanticResults) {
        if (mem.id !== memoryId && !linkedIds.has(mem.id) && results.length < k) {
            results.push(mem);
        }
    }

    return results.slice(0, k);
}

// ---------------------------------------------------------------------------
// Access Logging
// ---------------------------------------------------------------------------

/**
 * Log a memory access (for forgetting curves).
 * @param {import("@libsql/client").Client} client
 * @param {number} memoryId
 * @param {string} [sessionId]
 * @param {string} [query]
 * @param {number} [relevanceScore]
 */
export async function logAccess(client, memoryId, sessionId = null, query = null, relevanceScore = null) {
    await client.execute({
        sql: "INSERT INTO access_log (memory_id, session_id, query, relevance_score) VALUES (?, ?, ?, ?)",
        args: [memoryId, sessionId, query, relevanceScore],
    });

    // Update memory access stats
    await client.execute({
        sql: "UPDATE memories SET access_count = access_count + 1, last_accessed_at = datetime('now') WHERE id = ?",
        args: [memoryId],
    });
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

/**
 * Get memory statistics.
 * @param {import("@libsql/client").Client} client
 * @returns {Promise<object>}
 */
export async function getStats(client) {
    const [totalResult, typeResult, linksResult, avgStrengthResult] = await Promise.all([
        client.execute("SELECT COUNT(*) as total FROM memories WHERE archived = 0"),
        client.execute("SELECT type, COUNT(*) as count FROM memories WHERE archived = 0 GROUP BY type"),
        client.execute("SELECT COUNT(*) as total FROM memory_links"),
        client.execute("SELECT AVG(strength) as avg FROM memories WHERE archived = 0"),
    ]);

    return {
        totalMemories: Number(totalResult.rows[0].total),
        byType: Object.fromEntries(typeResult.rows.map((r) => [String(r.type), Number(r.count)])),
        totalLinks: Number(linksResult.rows[0].total),
        avgStrength: Number(avgStrengthResult.rows[0].avg) || 0,
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a DB row to a Memory object.
 * @param {any} row
 * @returns {Memory}
 */
function rowToMemory(row) {
    return {
        id: Number(row.id),
        type: String(row.type),
        title: String(row.title),
        content: String(row.content),
        importance: Number(row.importance),
        strength: Number(row.strength),
        access_count: Number(row.access_count),
        last_accessed_at: row.last_accessed_at ? String(row.last_accessed_at) : null,
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
        source_conversation_id: row.source_conversation_id ? String(row.source_conversation_id) : null,
        source_type: String(row.source_type),
        archived: Number(row.archived),
        score: row.score !== undefined ? Number(row.score) : undefined,
    };
}
