/**
 * Combined discovery pass over every selected external source.
 *
 * @module dsh-external-import/discovery
 */
import { discoverMcp } from "./discover/mcp.js";
import { discoverSkills } from "./discover/skills.js";
import { selectSources } from "./sources.js";
/**
 * Read every selected source's MCP servers and skills.
 * @param options - sources, working directory, and scan bounds.
 * @returns the merged report of candidates, problems, and files read.
 */
export async function runDiscovery(options) {
    const descriptors = selectSources(options.sources);
    const context = { cwd: options.cwd };
    const mcp = options.want.mcp
        ? await discoverMcp(descriptors, context)
        : { servers: [], problems: [], scannedFiles: [] };
    const skills = options.want.skills
        ? await discoverSkills(descriptors, context, { frontmatterBytes: options.frontmatterBytes })
        : { skills: [], problems: [], scannedRoots: [] };
    return {
        servers: mcp.servers,
        problems: mcp.problems,
        skills: skills.skills,
        skillProblems: skills.problems,
        scannedFiles: [...mcp.scannedFiles, ...skills.scannedRoots],
    };
}
