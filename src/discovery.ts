/**
 * Combined discovery pass over every selected external source.
 *
 * @module dsh-external-import/discovery
 */

import { discoverMcp } from './discover/mcp.ts'
import { discoverSkills } from './discover/skills.ts'
import { selectSources } from './sources.ts'
import type { DiscoveryContext } from './sources.ts'
import type { DiscoveryReport, ExternalSourceId } from './types.ts'

/** Bounds applied to one discovery pass. */
export interface DiscoveryOptions {
  /** Sources to scan; an empty list scans every supported source. */
  readonly sources: readonly ExternalSourceId[]
  /** Working directory whose project-level files are scanned. */
  readonly cwd: string | undefined
  /** Maximum bytes read from each skill file while scanning. */
  readonly frontmatterBytes: number
  /** Whether to look for servers and skills, or only one of the two. */
  readonly want: { readonly mcp: boolean; readonly skills: boolean }
}

/**
 * Read every selected source's MCP servers and skills.
 * @param options - sources, working directory, and scan bounds.
 * @returns the merged report of candidates, problems, and files read.
 */
export async function runDiscovery(options: DiscoveryOptions): Promise<DiscoveryReport> {
  const descriptors = selectSources(options.sources)
  const context: DiscoveryContext = { cwd: options.cwd }
  const mcp = options.want.mcp
    ? await discoverMcp(descriptors, context)
    : { servers: [], problems: [], scannedFiles: [] }
  const skills = options.want.skills
    ? await discoverSkills(descriptors, context, { frontmatterBytes: options.frontmatterBytes })
    : { skills: [], problems: [], scannedRoots: [] }
  return {
    servers: mcp.servers,
    problems: mcp.problems,
    skills: skills.skills,
    skillProblems: skills.problems,
    scannedFiles: [...mcp.scannedFiles, ...skills.scannedRoots],
  }
}
