// @ts-check
/**
 * Focus of Attention (FoA) — Dynamic context assembly for agent queries.
 *
 * Inspired by CogMem: reconstructs concise, task-relevant context at each turn.
 * Combines hybrid search with session context and ranks by composite score.
 */

import { searchHybrid } from "./memory.js";
import { getSessionContext } from "./session.js";

/**
 * @typedef {Object} RecallOptions
 * @property {number} [k]             - Number of results (default 10)
 * @property {number} [budget]        - Approximate token budget (default 4000)
 * @property {string} [type]          - Filter by memory type
 * @property {string} [sessionId]     - Include session context
 * @property {boolean} [includeGraph] - Include linked memories (default true)
 */

/**
 * @typedef {Object} RecallResult
 * @property {Array<{id: number, type: string, title: string, content: string, score: number}>} memories
 * @property {string | null} sessionContext
 * @property {number} totalTokensEstimate
 */

/**
 * Rough token count estimate (4 chars ≈ 1 token for English, ~2 chars for Russian/CJK).
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
    // Heuristic: average ~3.5 chars per token for mixed content
    return Math.ceil(text.length / 3.5);
}

/**
 * Recall relevant memories for a query, assembling a focused context.
 *
 * @param {import("@libsql/client").Client} client
 * @param {string} query
 * @param {RecallOptions} [options]
 * @returns {Promise<RecallResult>}
 */
export async function recall(client, query, options = {}) {
    const {
        k = 10,
        budget = 4000,
        type,
        sessionId,
    } = options;

    // 1. Hybrid search
    const searchResults = await searchHybrid(client, query, { k, type });

    // 2. Score and rank: relevance × importance × strength × recency
    const now = Date.now();
    const scored = searchResults.map((mem) => {
        const relevance = mem.score || 0;
        const importance = mem.importance || 0.5;
        const strength = mem.strength || 1.0;

        // Recency bonus: memories accessed recently get a boost
        let recencyBonus = 0.5;
        if (mem.last_accessed_at) {
            const daysSinceAccess = (now - new Date(mem.last_accessed_at).getTime()) / (1000 * 60 * 60 * 24);
            recencyBonus = Math.max(0.1, 1.0 - daysSinceAccess * 0.1); // Decay over 10 days
        }

        const compositeScore = relevance * importance * strength * recencyBonus;
        return { ...mem, score: compositeScore };
    });

    // Sort by composite score (descending)
    scored.sort((a, b) => b.score - a.score);

    // 3. Apply token budget
    let tokenCount = 0;
    const memories = [];

    for (const mem of scored) {
        const memTokens = estimateTokens(`[${mem.type}] ${mem.title}\n${mem.content}`);
        if (tokenCount + memTokens > budget && memories.length > 0) break;
        memories.push({
            id: mem.id,
            type: mem.type,
            title: mem.title,
            content: mem.content,
            score: mem.score,
        });
        tokenCount += memTokens;
    }

    // 4. Session context (if provided)
    let sessionContext = null;
    if (sessionId) {
        const ctx = await getSessionContext(client, sessionId);
        if (ctx?.session?.summary) {
            sessionContext = ctx.session.summary;
            tokenCount += estimateTokens(sessionContext);
        }
    }

    return {
        memories,
        sessionContext,
        totalTokensEstimate: tokenCount,
    };
}

/**
 * Format recall results as a text block for agent consumption.
 *
 * @param {RecallResult} result
 * @returns {string}
 */
export function formatRecallContext(result) {
    const lines = [];

    if (result.sessionContext) {
        lines.push("## Session Context");
        lines.push(result.sessionContext);
        lines.push("");
    }

    if (result.memories.length > 0) {
        lines.push("## Relevant Memories");
        for (const mem of result.memories) {
            lines.push(`### [${mem.type}] ${mem.title}`);
            lines.push(mem.content);
            lines.push("");
        }
    }

    lines.push(`---`);
    lines.push(`_${result.memories.length} memories | ~${result.totalTokensEstimate} tokens_`);

    return lines.join("\n");
}
