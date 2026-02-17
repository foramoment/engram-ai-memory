// @ts-check
/**
 * Session management — track conversation sessions and generate summaries.
 */

import { embed, vectorToBlob } from "./embeddings.js";

/**
 * Start a new session.
 * @param {import("@libsql/client").Client} client
 * @param {string} sessionId
 * @param {string} [title]
 * @returns {Promise<void>}
 */
export async function startSession(client, sessionId, title = null) {
    await client.execute({
        sql: "INSERT OR REPLACE INTO sessions (id, title, started_at) VALUES (?, ?, datetime('now'))",
        args: [sessionId, title],
    });
}

/**
 * End a session with an optional summary (auto-embedded).
 * @param {import("@libsql/client").Client} client
 * @param {string} sessionId
 * @param {string} [summary]
 * @returns {Promise<void>}
 */
export async function endSession(client, sessionId, summary = null) {
    if (summary) {
        const embedding = await embed(summary);
        const embeddingBlob = vectorToBlob(embedding);
        await client.execute({
            sql: `UPDATE sessions SET 
            summary = ?, summary_embedding = vector(?), ended_at = datetime('now')
            WHERE id = ?`,
            args: [summary, embeddingBlob, sessionId],
        });
    } else {
        await client.execute({
            sql: "UPDATE sessions SET ended_at = datetime('now') WHERE id = ?",
            args: [sessionId],
        });
    }
}

/**
 * Get session context — session info + memories accessed during session.
 * @param {import("@libsql/client").Client} client
 * @param {string} sessionId
 * @returns {Promise<{session: object, accessedMemories: object[]} | null>}
 */
export async function getSessionContext(client, sessionId) {
    const sessionResult = await client.execute({
        sql: "SELECT * FROM sessions WHERE id = ?",
        args: [sessionId],
    });

    if (sessionResult.rows.length === 0) return null;

    const session = sessionResult.rows[0];

    // Get memories accessed during this session
    const accessResult = await client.execute({
        sql: `SELECT DISTINCT m.id, m.type, m.title, m.content, m.importance, m.strength,
          al.relevance_score, al.query, al.accessed_at
          FROM access_log al
          JOIN memories m ON m.id = al.memory_id
          WHERE al.session_id = ?
          ORDER BY al.accessed_at DESC`,
        args: [sessionId],
    });

    return {
        session: {
            id: session.id,
            title: session.title,
            summary: session.summary,
            started_at: session.started_at,
            ended_at: session.ended_at,
        },
        accessedMemories: accessResult.rows.map((r) => ({
            id: Number(r.id),
            type: String(r.type),
            title: String(r.title),
            content: String(r.content),
            importance: Number(r.importance),
            strength: Number(r.strength),
            relevance_score: r.relevance_score ? Number(r.relevance_score) : null,
            query: r.query ? String(r.query) : null,
            accessed_at: String(r.accessed_at),
        })),
    };
}

/**
 * List sessions with optional date range.
 * @param {import("@libsql/client").Client} client
 * @param {object} [options]
 * @param {string} [options.since] - ISO date string
 * @param {string} [options.until] - ISO date string
 * @param {number} [options.limit] - Max results
 * @returns {Promise<object[]>}
 */
export async function listSessions(client, options = {}) {
    const { since, until, limit = 20 } = options;

    let sql = "SELECT id, title, summary, started_at, ended_at FROM sessions WHERE 1=1";
    const args = [];

    if (since) {
        sql += " AND started_at >= ?";
        args.push(since);
    }
    if (until) {
        sql += " AND started_at <= ?";
        args.push(until);
    }

    sql += " ORDER BY started_at DESC LIMIT ?";
    args.push(limit);

    const result = await client.execute({ sql, args });
    return result.rows.map((r) => ({
        id: String(r.id),
        title: r.title ? String(r.title) : null,
        summary: r.summary ? String(r.summary) : null,
        started_at: String(r.started_at),
        ended_at: r.ended_at ? String(r.ended_at) : null,
    }));
}
