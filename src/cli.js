#!/usr/bin/env node
// @ts-check
/**
 * Engram CLI — Cognitive memory system for AI agents.
 */

import { Command } from "commander";
import { initDb, closeDb, getMeta } from "./db.js";
import {
    addMemory, getMemory, deleteMemory,
    searchSemantic, searchFTS, searchHybrid,
    addTag, removeTag, getAllTags,
    linkMemories, getLinks,
    getStats, getWeakest, getDuplicateCandidates,
    exportMemories,
} from "./memory.js";
import { startSession, endSession, listSessions, startSessionWithConsolidationCheck } from "./session.js";
import { recall, formatRecallContext } from "./foa.js";
import { runConsolidation, shouldConsolidate, getConsolidationPreview } from "./consolidation.js";
import { getDevice, isInitialized } from "./embeddings.js";
import { migrateFromSkill } from "./migrate.js";

const program = new Command();

program
    .name("engram")
    .description("🧠 Cognitive memory system for AI agents")
    .version("0.1.0");

// -- add --
program
    .command("add")
    .description("Add a new memory")
    .argument("<type>", "Memory type: reflex | episode | fact | preference | decision")
    .argument("<title>", "Memory title")
    .option("-c, --content <text>", "Memory content (or pipe via stdin)")
    .option("-t, --tags <tags>", "Comma-separated tags")
    .option("-i, --importance <n>", "Importance 0.0-1.0", "0.5")
    .action(async (type, title, opts) => {
        const { client } = await initDb();
        const content = opts.content || title;
        const tags = opts.tags ? opts.tags.split(",").map((t) => t.trim()) : [];
        const importance = parseFloat(opts.importance);

        const id = await addMemory(client, { type, title, content, tags, importance });
        console.log(`✅ Memory #${id} created [${type}] "${title}"`);
        if (tags.length) console.log(`   Tags: ${tags.join(", ")}`);
        await closeDb();
    });

// -- search --
program
    .command("search")
    .description("Search memories (semantic, FTS, or hybrid)")
    .argument("<query>", "Search query")
    .option("-m, --mode <mode>", "Search mode: hybrid | semantic | fts", "hybrid")
    .option("-t, --type <type>", "Filter by memory type")
    .option("-k, --limit <n>", "Number of results", "10")
    .option("--rerank", "Re-score results with cross-encoder reranker")
    .action(async (query, opts) => {
        const { client } = await initDb();
        const k = parseInt(opts.limit);
        const type = opts.type;
        let results;

        switch (opts.mode) {
            case "semantic":
                results = await searchSemantic(client, query, { k, type });
                break;
            case "fts":
                results = await searchFTS(client, query, { k, type });
                break;
            default:
                results = await searchHybrid(client, query, { k, type, rerank: opts.rerank || false });
        }

        if (results.length === 0) {
            console.log("No results found.");
        } else {
            console.log(`\n🔍 ${results.length} results (${opts.mode} search):\n`);
            for (const mem of results) {
                const score = mem.score !== undefined ? ` (score: ${mem.score.toFixed(4)})` : "";
                console.log(`  #${mem.id} [${mem.type}] ${mem.title}${score}`);
                console.log(`    ${mem.content.substring(0, 120)}${mem.content.length > 120 ? "..." : ""}`);
                console.log();
            }
        }
        await closeDb();
    });

// -- recall --
program
    .command("recall")
    .description("Recall context for a query (Focus of Attention)")
    .argument("<query>", "Context query")
    .option("-b, --budget <n>", "Token budget", "4000")
    .option("-t, --type <type>", "Filter by memory type")
    .option("-s, --session <id>", "Include session context")
    .option("--raw", "Output raw text block for agent consumption")
    .action(async (query, opts) => {
        const { client } = await initDb();
        const result = await recall(client, query, {
            budget: parseInt(opts.budget),
            type: opts.type,
            sessionId: opts.session,
        });

        if (opts.raw) {
            console.log(formatRecallContext(result));
        } else {
            console.log(`\n🎯 Focus of Attention (~${result.totalTokensEstimate} tokens):\n`);
            if (result.sessionContext) {
                console.log(`📋 Session: ${result.sessionContext.substring(0, 200)}`);
                console.log();
            }
            for (const mem of result.memories) {
                console.log(`  #${mem.id} [${mem.type}] ${mem.title}`);
                console.log(`    ${mem.content.substring(0, 120)}${mem.content.length > 120 ? "..." : ""}`);
                console.log();
            }
        }
        await closeDb();
    });

// -- link --
program
    .command("link")
    .description("Link two memories")
    .argument("<sourceId>", "Source memory ID")
    .argument("<targetId>", "Target memory ID")
    .option("-r, --relation <type>", "Relation: related_to | caused_by | evolved_from | contradicts | supersedes", "related_to")
    .action(async (sourceId, targetId, opts) => {
        const { client } = await initDb();
        await linkMemories(client, parseInt(sourceId), parseInt(targetId), opts.relation);
        console.log(`🔗 Linked #${sourceId} → #${targetId} (${opts.relation})`);
        await closeDb();
    });

// -- session --
const sessionCmd = program
    .command("session")
    .description("Session management");

sessionCmd
    .command("start")
    .argument("<id>", "Session ID")
    .option("-t, --title <title>", "Session title")
    .option("--auto-consolidate", "Auto-run sleep consolidation if overdue")
    .action(async (id, opts) => {
        const { client } = await initDb();
        const result = await startSessionWithConsolidationCheck(client, id, {
            title: opts.title,
            autoConsolidate: opts.autoConsolidate || false,
        });
        console.log(`📎 Session "${id}" started`);
        if (result.autoRan) {
            console.log(`💤 Auto-consolidation completed`);
        }
        await closeDb();
    });

sessionCmd
    .command("end")
    .argument("<id>", "Session ID")
    .option("-s, --summary <text>", "Session summary")
    .action(async (id, opts) => {
        const { client } = await initDb();
        await endSession(client, id, opts.summary);
        console.log(`📎 Session "${id}" ended`);
        await closeDb();
    });

sessionCmd
    .command("list")
    .option("-n, --limit <n>", "Number of sessions", "10")
    .action(async (opts) => {
        const { client } = await initDb();
        const sessions = await listSessions(client, { limit: parseInt(opts.limit) });
        if (sessions.length === 0) {
            console.log("No sessions found.");
        } else {
            console.log(`\n📋 ${sessions.length} sessions:\n`);
            for (const s of sessions) {
                const status = s.ended_at ? "✅" : "🔵";
                console.log(`  ${status} ${s.id} — ${s.title || "(untitled)"}`);
                console.log(`    Started: ${s.started_at}${s.ended_at ? ` | Ended: ${s.ended_at}` : ""}`);
                if (s.summary) console.log(`    Summary: ${s.summary.substring(0, 100)}`);
                console.log();
            }
        }
        await closeDb();
    });

// -- stats --
program
    .command("stats")
    .description("Show memory statistics")
    .action(async () => {
        const { client, vectorIndex } = await initDb();
        const stats = await getStats(client);
        const lastConsolidation = await getMeta(client, "last_consolidation_at");
        const tags = await getAllTags(client);

        console.log("\n📊 Engram Statistics\n");
        console.log(`  Total memories: ${stats.totalMemories}`);
        console.log(`  By type:`);
        for (const [type, count] of Object.entries(stats.byType)) {
            console.log(`    ${type}: ${count}`);
        }
        console.log(`  Total links:    ${stats.totalLinks}`);
        console.log(`  Avg strength:   ${stats.avgStrength.toFixed(3)}`);
        console.log(`  Vector index:   ${vectorIndex ? "✅ DiskANN" : "⚠️ brute-force"}`);
        console.log(`  Device:         ${isInitialized() ? getDevice() : "not loaded"}`);
        console.log(`  Last sleep:     ${lastConsolidation || "never"}`);
        if (tags.length > 0) {
            console.log(`  Top tags:       ${tags.slice(0, 5).map((t) => `${t.name}(${t.count})`).join(", ")}`);
        }
        console.log();
        await closeDb();
    });

// -- sleep --
program
    .command("sleep")
    .description("Run sleep consolidation (decay, prune, merge, boost)")
    .option("--dry-run", "Preview without making changes")
    .option("--decay-rate <n>", "Daily decay rate", "0.95")
    .option("--prune <n>", "Prune threshold", "0.05")
    .option("--merge <n>", "Merge similarity threshold", "0.92")
    .action(async (opts) => {
        const { client } = await initDb();

        if (opts.dryRun) {
            const preview = await getConsolidationPreview(client, {
                pruneThreshold: parseFloat(opts.prune),
                mergeThreshold: parseFloat(opts.merge),
            });
            console.log("\n💤 Sleep Consolidation Preview (dry run)\n");
            console.log("Weakest memories:");
            for (const m of preview.weakest) {
                console.log(`  #${m.id} [${m.type}] ${m.title} — strength: ${m.strength.toFixed(3)}, accesses: ${m.access_count}`);
            }
            console.log(`\nDuplicate candidates: ${preview.duplicateCandidates[0]?.count || 0}`);
        } else {
            const result = await runConsolidation(client, {
                decayRate: parseFloat(opts.decayRate),
                pruneThreshold: parseFloat(opts.prune),
                mergeThreshold: parseFloat(opts.merge),
                dryRun: false,
            });
            console.log(`\n💤 Consolidation complete in ${result.elapsed_ms}ms`);
            console.log(`  Decayed:  ${result.decayed}`);
            console.log(`  Pruned:   ${result.pruned}`);
            console.log(`  Merged:   ${result.merged}`);
            console.log(`  Boosted:  ${result.boosted}`);
        }
        await closeDb();
    });

// -- export --
program
    .command("export")
    .description("Export memories to file (with tags and links)")
    .option("-f, --format <fmt>", "Format: json | md", "json")
    .option("-o, --output <path>", "Output file path")
    .action(async (opts) => {
        const { client } = await initDb();
        const output = await exportMemories(client, opts.format);

        if (opts.output) {
            const { writeFileSync } = await import("node:fs");
            writeFileSync(opts.output, output);
            console.log(`📦 Exported memories to ${opts.output}`);
        } else {
            console.log(output);
        }
        await closeDb();
    });

// -- get --
program
    .command("get")
    .description("Get a memory by ID")
    .argument("<id>", "Memory ID")
    .action(async (id) => {
        const { client } = await initDb();
        const mem = await getMemory(client, parseInt(id));
        if (!mem) {
            console.log(`Memory #${id} not found.`);
        } else {
            console.log(`\n📝 Memory #${mem.id}\n`);
            console.log(`  Type:       ${mem.type}`);
            console.log(`  Title:      ${mem.title}`);
            console.log(`  Content:    ${mem.content}`);
            console.log(`  Importance: ${mem.importance}`);
            console.log(`  Strength:   ${mem.strength.toFixed(3)}`);
            console.log(`  Accesses:   ${mem.access_count}`);
            console.log(`  Created:    ${mem.created_at}`);
            if (mem.tags?.length) console.log(`  Tags:       ${mem.tags.join(", ")}`);
            if (mem.links?.length) {
                console.log("  Links:");
                for (const l of mem.links) {
                    console.log(`    ${l.direction === "outgoing" ? "→" : "←"} #${l.id} (${l.relation})`);
                }
            }
        }
        await closeDb();
    });

// -- delete --
program
    .command("delete")
    .description("Delete a memory")
    .argument("<id>", "Memory ID")
    .action(async (id) => {
        const { client } = await initDb();
        const deleted = await deleteMemory(client, parseInt(id));
        if (deleted) {
            console.log(`🗑️ Memory #${id} deleted`);
        } else {
            console.log(`Memory #${id} not found.`);
        }
        await closeDb();
    });

// -- tag --
const tagCmd = program
    .command("tag")
    .description("Tag management");

tagCmd
    .command("add")
    .argument("<memoryId>", "Memory ID")
    .argument("<tagName>", "Tag name")
    .action(async (memoryId, tagName) => {
        const { client } = await initDb();
        await addTag(client, parseInt(memoryId), tagName);
        console.log(`🏷️ Tagged #${memoryId} with "${tagName}"`);
        await closeDb();
    });

tagCmd
    .command("remove")
    .argument("<memoryId>", "Memory ID")
    .argument("<tagName>", "Tag name")
    .action(async (memoryId, tagName) => {
        const { client } = await initDb();
        await removeTag(client, parseInt(memoryId), tagName);
        console.log(`🏷️ Removed tag "${tagName}" from #${memoryId}`);
        await closeDb();
    });

tagCmd
    .command("list")
    .action(async () => {
        const { client } = await initDb();
        const tags = await getAllTags(client);
        if (tags.length === 0) {
            console.log("No tags found.");
        } else {
            console.log("\n🏷️ Tags:\n");
            for (const t of tags) {
                console.log(`  ${t.name} (${t.count})`);
            }
        }
        await closeDb();
    });
// -- diagnostics --
program
    .command("diagnostics")
    .description("Show memory diagnostics (weakest, duplicates)")
    .option("-n, --limit <n>", "Number of weakest to show", "10")
    .option("--dup-threshold <n>", "Duplicate similarity threshold", "0.90")
    .action(async (opts) => {
        const { client } = await initDb();
        const weakest = await getWeakest(client, parseInt(opts.limit));
        const duplicates = await getDuplicateCandidates(client, parseFloat(opts.dupThreshold));

        console.log("\n🔬 Memory Diagnostics\n");

        console.log(`  Weakest memories (${weakest.length}):`);
        for (const m of weakest) {
            console.log(`    #${m.id} [${m.type}] ${m.title} — strength: ${m.strength.toFixed(3)}, accesses: ${m.access_count}`);
        }

        console.log(`\n  Duplicate candidates (threshold ≥ ${opts.dupThreshold}):`);
        if (duplicates.length === 0) {
            console.log("    No near-duplicates found.");
        } else {
            for (const d of duplicates) {
                console.log(`    #${d.a.id} ↔ #${d.b.id} (${(d.similarity * 100).toFixed(1)}%) — "${d.a.title}" / "${d.b.title}"`);
            }
        }
        console.log();
        await closeDb();
    });
// -- migrate --
program
    .command("migrate")
    .description("Import memories from Persistent Memory skill artifacts")
    .argument("<sourceDir>", "Path to artifacts directory (reflexes.md, episodes.md, etc.)")
    .option("--dry-run", "Parse and count without inserting")
    .option("--no-link", "Skip automatic project linking")
    .action(async (sourceDir, opts) => {
        const { client } = await initDb();
        console.log(`\n📥 Migrating from ${sourceDir}...\n`);

        const result = await migrateFromSkill(client, sourceDir, {
            dryRun: opts.dryRun,
            linkProjects: opts.link !== false,
        });

        console.log(`\n📥 Migration ${opts.dryRun ? "preview" : "complete"}:`);
        console.log(`  Reflexes:    ${result.reflexes}`);
        console.log(`  Episodes:    ${result.episodes}`);
        console.log(`  Preferences: ${result.preferences}`);
        console.log(`  Projects:    ${result.projects}`);
        console.log(`  Total:       ${result.total}`);
        console.log(`  Links:       ${result.links}`);
        if (result.errors.length > 0) {
            console.log(`  Errors:      ${result.errors.length}`);
        }
        console.log();
        await closeDb();
    });

program.parse();
