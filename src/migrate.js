// @ts-check
/**
 * Migration module — imports memories from the Persistent Memory skill's
 * markdown artifacts (reflexes.md, episodes.md, preferences.md, project_graph.md).
 *
 * Parses each file format and creates typed Engram memories with auto-embedding,
 * tags, and inferred links.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { addMemory, linkMemories, addTag } from "./memory.js";

/**
 * @typedef {Object} ParsedEntry
 * @property {string} type - Memory type
 * @property {string} title
 * @property {string} content
 * @property {number} importance
 * @property {string[]} tags
 * @property {string} [date]
 */

/**
 * Parse reflexes.md — short actionable rules in format:
 *   ### [Category]
 *   - **[Trigger]** → [Action]. _(date)_
 *
 * @param {string} text
 * @returns {ParsedEntry[]}
 */
export function parseReflexes(text) {
    /** @type {ParsedEntry[]} */
    const entries = [];
    let currentCategory = "";

    for (const line of text.split("\n")) {
        const trimmed = line.trim();

        // Category header
        const catMatch = trimmed.match(/^###\s+(.+)$/);
        if (catMatch && !trimmed.includes("→")) {
            currentCategory = catMatch[1].trim();
            continue;
        }

        // Reflex entry: - **Trigger** → Action. _(date)_
        const reflexMatch = trimmed.match(/^-\s+\*\*(.+?)\*\*\s*→\s*(.+?)(?:\s*_\((.+?)\)_)?$/);
        if (reflexMatch) {
            const [, trigger, action, date] = reflexMatch;
            const categoryTag = currentCategory.toLowerCase().replace(/[\s/]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
            entries.push({
                type: "reflex",
                title: trigger,
                content: `${trigger} → ${action}`,
                importance: 0.7,
                tags: ["migrated", "reflex", categoryTag].filter(Boolean),
                date,
            });
        }
    }
    return entries;
}

/**
 * Parse episodes.md — problem-solution pairs in format:
 *   ### [Title] _(date)_
 *   - **Trigger:** what happened
 *   - **Root cause:** why
 *   - **Solution:** fix
 *   - **Prevention:** how to avoid
 *
 * @param {string} text
 * @returns {ParsedEntry[]}
 */
export function parseEpisodes(text) {
    /** @type {ParsedEntry[]} */
    const entries = [];
    /** @type {string | null} */
    let currentTitle = null;
    let currentDate = "";
    /** @type {string[]} */
    let currentLines = [];

    const flushEpisode = () => {
        if (currentTitle && currentLines.length > 0) {
            entries.push({
                type: "episode",
                title: currentTitle,
                content: currentLines.join("\n"),
                importance: 0.8,
                tags: ["migrated", "episode"],
                date: currentDate,
            });
        }
        currentTitle = null;
        currentLines = [];
        currentDate = "";
    };

    for (const line of text.split("\n")) {
        const trimmed = line.trim();

        // Episode header: ### Title _(date)_
        const headerMatch = trimmed.match(/^###\s+(.+?)\s*(?:_\((.+?)\)_)?$/);
        if (headerMatch) {
            flushEpisode();
            currentTitle = headerMatch[1].trim();
            currentDate = headerMatch[2] || "";
            continue;
        }

        if (currentTitle) {
            if (trimmed.length > 0) {
                currentLines.push(trimmed);
            }
        }
    }
    flushEpisode();

    return entries;
}

/**
 * Parse preferences.md — key-value pairs in format:
 *   ### [Category]
 *   - **key:** value
 *
 * @param {string} text
 * @returns {ParsedEntry[]}
 */
export function parsePreferences(text) {
    /** @type {ParsedEntry[]} */
    const entries = [];
    let currentCategory = "";
    /** @type {string[]} */
    let currentLines = [];

    const flushCategory = () => {
        if (currentCategory && currentLines.length > 0) {
            entries.push({
                type: "preference",
                title: currentCategory,
                content: currentLines.join("\n"),
                importance: 0.6,
                tags: ["migrated", "preference", currentCategory.toLowerCase().replace(/\s+/g, "-")],
            });
        }
        currentLines = [];
    };

    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) continue; // Skip title

        const catMatch = trimmed.match(/^###\s+(.+)$/);
        if (catMatch) {
            flushCategory();
            currentCategory = catMatch[1].trim();
            continue;
        }

        if (currentCategory && trimmed.startsWith("- ")) {
            currentLines.push(trimmed);
        }
    }
    flushCategory();

    return entries;
}

/**
 * Parse project_graph.md — project descriptions with relationships.
 *   ## [Project Name]
 *   - **Stack:** ...
 *   - **Status:** ...
 *   - **Related:** ...
 *
 * @param {string} text
 * @returns {ParsedEntry[]}
 */
export function parseProjectGraph(text) {
    /** @type {ParsedEntry[]} */
    const entries = [];
    /** @type {string | null} */
    let currentProject = null;
    /** @type {string[]} */
    let currentLines = [];

    const flushProject = () => {
        if (currentProject && currentLines.length > 0) {
            const content = currentLines.join("\n");
            // Extract related projects for tag creation
            const relatedMatch = content.match(/\*\*Related:\*\*\s*(.+)/);
            const relatedTags = relatedMatch
                ? relatedMatch[1].split(/[,;]/).map((r) => r.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean)
                : [];
            entries.push({
                type: "fact",
                title: currentProject,
                content: content,
                importance: 0.6,
                tags: ["migrated", "project", ...relatedTags],
            });
        }
        currentProject = null;
        currentLines = [];
    };

    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) continue;

        const projMatch = trimmed.match(/^##\s+(.+?)(?:\s*\(.+\))?$/);
        if (projMatch) {
            flushProject();
            currentProject = projMatch[1].trim();
            continue;
        }

        if (currentProject && trimmed.length > 0) {
            currentLines.push(trimmed);
        }
    }
    flushProject();

    return entries;
}

/**
 * Run the full migration from a memory skill artifacts directory.
 *
 * @param {import("@libsql/client").Client} client
 * @param {string} sourceDir - Path to the artifacts directory
 * @param {object} [options]
 * @param {boolean} [options.dryRun] - If true, parse only, don't insert
 * @param {boolean} [options.linkProjects] - If true, try to create links between project memories
 * @returns {Promise<{reflexes: number, episodes: number, preferences: number, projects: number, total: number, links: number, errors: string[]}>}
 */
export async function migrateFromSkill(client, sourceDir, options = {}) {
    const { dryRun = false, linkProjects = true } = options;
    /** @type {string[]} */
    const errors = [];
    const stats = { reflexes: 0, episodes: 0, preferences: 0, projects: 0, total: 0, links: 0 };

    /** @type {Map<string, number>} */
    const projectIdMap = new Map(); // project title -> memory ID for linking

    const files = [
        { name: "reflexes.md", parser: parseReflexes, stat: /** @type {'reflexes'} */ ("reflexes") },
        { name: "episodes.md", parser: parseEpisodes, stat: /** @type {'episodes'} */ ("episodes") },
        { name: "preferences.md", parser: parsePreferences, stat: /** @type {'preferences'} */ ("preferences") },
        { name: "project_graph.md", parser: parseProjectGraph, stat: /** @type {'projects'} */ ("projects") },
    ];

    for (const { name, parser, stat } of files) {
        const filePath = resolve(sourceDir, name);
        if (!existsSync(filePath)) {
            console.log(`  ⏭️  ${name} not found, skipping`);
            continue;
        }

        const text = readFileSync(filePath, "utf-8");
        const entries = parser(text);
        console.log(`  📄 ${name}: ${entries.length} entries found`);

        if (dryRun) {
            stats[stat] = entries.length;
            stats.total += entries.length;
            continue;
        }

        for (const entry of entries) {
            try {
                const id = await addMemory(client, {
                    type: /** @type {any} */ (entry.type),
                    title: entry.title,
                    content: entry.content,
                    importance: entry.importance,
                    tags: entry.tags,
                    sourceType: "migration",
                });
                stats[stat]++;
                stats.total++;

                // Track project IDs for linking
                if (stat === "projects") {
                    projectIdMap.set(entry.title, id);
                }
            } catch (err) {
                const msg = `Failed to import "${entry.title}": ${err instanceof Error ? err.message : String(err)}`;
                errors.push(msg);
                console.error(`  ❌ ${msg}`);
            }
        }
    }

    // Link related projects
    if (linkProjects && !dryRun && projectIdMap.size > 1) {
        console.log("  🔗 Linking related projects...");
        for (const [title, id] of projectIdMap) {
            // Find related projects by checking if any other project is mentioned in this one's content
            for (const [otherTitle, otherId] of projectIdMap) {
                if (id === otherId) continue;
                // Check if other project name appears in this project's tags or content
                const mem = await client.execute({ sql: "SELECT content FROM memories WHERE id = ?", args: [id] });
                if (mem.rows.length > 0) {
                    const content = String(mem.rows[0].content);
                    if (content.includes(otherTitle) || content.toLowerCase().includes(otherTitle.toLowerCase())) {
                        try {
                            await linkMemories(client, id, otherId, "related_to");
                            stats.links++;
                        } catch {
                            // Link may already exist, that's fine
                        }
                    }
                }
            }
        }
    }

    return { ...stats, errors };
}
