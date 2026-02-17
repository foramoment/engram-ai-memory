// @ts-check
import { createClient } from "@libsql/client";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = resolve(__dirname, "..", "data", "engram.db");

/** Write diagnostic output to stderr, only when ENGRAM_TRACE=1 */
const trace = (...args) => process.env.ENGRAM_TRACE === "1" && process.stderr.write(args.join(" ") + "\n");

/** @type {import("@libsql/client").Client | null} */
let _client = null;

/**
 * Get or create the LibSQL client singleton.
 * @param {string} [dbPath] - Path to the database file. Defaults to data/engram.db
 * @returns {import("@libsql/client").Client}
 */
export function getClient(dbPath) {
  if (_client) return _client;

  const resolvedPath = dbPath || DEFAULT_DB_PATH;
  const dir = dirname(resolvedPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  _client = createClient({
    url: `file:${resolvedPath}`,
  });

  return _client;
}

/**
 * Close the database connection and reset the singleton.
 */
export async function closeDb() {
  if (_client) {
    _client.close();
    _client = null;
  }
}

/**
 * Reset the singleton (for testing with different DB paths).
 */
export function resetClient() {
  if (_client) {
    _client.close();
  }
  _client = null;
}

// ---------------------------------------------------------------------------
// Schema & Migrations
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 1;

const MIGRATIONS = [
  {
    version: 1,
    description: "Initial schema: memories, FTS5, tags, links, sessions, access_log, system_meta",
    statements: [
      // Main memories table
      `CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK(type IN ('reflex', 'episode', 'fact', 'preference', 'decision', 'session_summary')),
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        content_embedding F32_BLOB(1024),
        importance REAL DEFAULT 0.5 CHECK(importance >= 0.0 AND importance <= 1.0),
        strength REAL DEFAULT 1.0 CHECK(strength >= 0.0 AND strength <= 1.0),
        access_count INTEGER DEFAULT 0,
        last_accessed_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        source_conversation_id TEXT,
        source_type TEXT DEFAULT 'manual' CHECK(source_type IN ('manual', 'auto', 'migration')),
        archived INTEGER DEFAULT 0
      )`,

      // FTS5 virtual table for full-text search
      `CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        title, content, type,
        content='memories', content_rowid='id'
      )`,

      // FTS5 sync triggers — keep FTS in sync with main table
      `CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, title, content, type)
        VALUES (new.id, new.title, new.content, new.type);
      END`,

      `CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, content, type)
        VALUES ('delete', old.id, old.title, old.content, old.type);
      END`,

      `CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, content, type)
        VALUES ('delete', old.id, old.title, old.content, old.type);
        INSERT INTO memories_fts(rowid, title, content, type)
        VALUES (new.id, new.title, new.content, new.type);
      END`,

      // Tags
      `CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS memory_tags (
        memory_id INTEGER REFERENCES memories(id) ON DELETE CASCADE,
        tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (memory_id, tag_id)
      )`,

      // Knowledge graph links
      `CREATE TABLE IF NOT EXISTS memory_links (
        source_id INTEGER REFERENCES memories(id) ON DELETE CASCADE,
        target_id INTEGER REFERENCES memories(id) ON DELETE CASCADE,
        relation TEXT NOT NULL CHECK(relation IN ('related_to', 'caused_by', 'evolved_from', 'contradicts', 'supersedes')),
        strength REAL DEFAULT 0.5,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (source_id, target_id)
      )`,

      // Sessions (working memory)
      `CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT,
        summary TEXT,
        summary_embedding F32_BLOB(1024),
        started_at TEXT DEFAULT (datetime('now')),
        ended_at TEXT,
        memory_ids_accessed TEXT DEFAULT '[]'
      )`,

      // Access log (for forgetting curves)
      `CREATE TABLE IF NOT EXISTS access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id INTEGER REFERENCES memories(id) ON DELETE CASCADE,
        session_id TEXT,
        query TEXT,
        relevance_score REAL,
        accessed_at TEXT DEFAULT (datetime('now'))
      )`,

      // System metadata
      `CREATE TABLE IF NOT EXISTS system_meta (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )`,

      // Seed system meta
      `INSERT OR IGNORE INTO system_meta (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}')`,
      `INSERT OR IGNORE INTO system_meta (key, value) VALUES ('last_consolidation_at', NULL)`,
      `INSERT OR IGNORE INTO system_meta (key, value) VALUES ('created_at', datetime('now'))`,

      // Indexes for common queries
      `CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type)`,
      `CREATE INDEX IF NOT EXISTS idx_memories_strength ON memories(strength)`,
      `CREATE INDEX IF NOT EXISTS idx_memories_archived ON memories(archived)`,
      `CREATE INDEX IF NOT EXISTS idx_memory_tags_memory ON memory_tags(memory_id)`,
      `CREATE INDEX IF NOT EXISTS idx_memory_tags_tag ON memory_tags(tag_id)`,
      `CREATE INDEX IF NOT EXISTS idx_memory_links_source ON memory_links(source_id)`,
      `CREATE INDEX IF NOT EXISTS idx_memory_links_target ON memory_links(target_id)`,
      `CREATE INDEX IF NOT EXISTS idx_access_log_memory ON access_log(memory_id)`,
      `CREATE INDEX IF NOT EXISTS idx_access_log_session ON access_log(session_id)`,
    ],
  },
];

/**
 * Try to create a vector index. May fail on some platforms — that's okay,
 * we fall back to brute-force cosine distance queries.
 * @param {import("@libsql/client").Client} client
 * @returns {Promise<boolean>} true if vector index was created
 */
async function tryCreateVectorIndex(client) {
  try {
    await client.execute(
      `CREATE INDEX IF NOT EXISTS memories_vec_idx ON memories (
        libsql_vector_idx(content_embedding, 'metric=cosine', 'compress_neighbors=float8', 'max_neighbors=20')
      )`
    );
    return true;
  } catch (err) {
    trace("[engram] Vector index creation failed (brute-force fallback will be used):", err.message);
    return false;
  }
}

/**
 * Run all pending migrations.
 * @param {import("@libsql/client").Client} client
 * @returns {Promise<{migrated: boolean, version: number, vectorIndex: boolean}>}
 */
export async function runMigrations(client) {
  // Check current schema version
  let currentVersion = 0;
  try {
    const result = await client.execute("SELECT value FROM system_meta WHERE key = 'schema_version'");
    if (result.rows.length > 0) {
      currentVersion = parseInt(/** @type {string} */(result.rows[0].value), 10);
    }
  } catch {
    // Table doesn't exist yet — version 0
  }

  let migrated = false;
  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      trace(`[engram] Running migration v${migration.version}: ${migration.description}`);
      for (const sql of migration.statements) {
        await client.execute(sql);
      }
      migrated = true;
    }
  }

  // Try vector index (separate from main migration — may fail on some platforms)
  const vectorIndex = await tryCreateVectorIndex(client);

  return { migrated, version: SCHEMA_VERSION, vectorIndex };
}

/**
 * Initialize the database: get client + run migrations.
 * @param {string} [dbPath]
 * @returns {Promise<{client: import("@libsql/client").Client, migrated: boolean, version: number, vectorIndex: boolean}>}
 */
export async function initDb(dbPath) {
  const client = getClient(dbPath);
  const result = await runMigrations(client);
  return { client, ...result };
}

/**
 * Get a system meta value.
 * @param {import("@libsql/client").Client} client
 * @param {string} key
 * @returns {Promise<string | null>}
 */
export async function getMeta(client, key) {
  const result = await client.execute({
    sql: "SELECT value FROM system_meta WHERE key = ?",
    args: [key],
  });
  return result.rows.length > 0 ? /** @type {string | null} */ (result.rows[0].value) : null;
}

/**
 * Set a system meta value.
 * @param {import("@libsql/client").Client} client
 * @param {string} key
 * @param {string | null} value
 */
export async function setMeta(client, key, value) {
  await client.execute({
    sql: `INSERT INTO system_meta (key, value, updated_at) 
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    args: [key, value],
  });
}
