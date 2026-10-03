/**
 * Configuration locations owned by other agent tools.
 *
 * Each source lists the files and directories this plugin reads for that tool.
 * Paths follow the tool's own documented discovery rules, including its
 * environment overrides, so a relocated configuration directory is honoured
 * instead of guessed. Nothing here writes.
 *
 * @module dsh-external-import/sources
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { listDirectory } from './parse/read.ts'
import type { ConfigScope, ExternalSourceId } from './types.ts'

/** Where one source keeps an MCP server table. */
export interface McpConfigFile {
  /** Absolute path of the configuration file. */
  readonly path: string
  /** Whether the file is user-level or project-level. */
  readonly scope: ConfigScope
  /** File syntax. */
  readonly format: 'json' | 'toml'
  /** Dotted path to the servers table inside the parsed document. */
  readonly keyPath: readonly string[]
}

/** A directory that may hold skill subdirectories. */
export interface SkillRoot {
  /** Absolute directory path. */
  readonly path: string
  /** Whether the directory is user-level or project-level. */
  readonly scope: ConfigScope
}

/** Inputs that decide which project-level files a scan includes. */
export interface DiscoveryContext {
  /** Working directory whose project-level files are scanned; `undefined` skips them. */
  readonly cwd: string | undefined
}

/** One external tool's configuration locations. */
export interface SourceDescriptor {
  /** Stable source identifier. */
  readonly id: ExternalSourceId
  /** Human-readable name used in reports. */
  readonly label: string
  /**
   * List this tool's MCP configuration files.
   * @param context - working directory and scope selection for this scan.
   * @returns files to read, in precedence order.
   */
  mcpFiles(context: DiscoveryContext): Promise<readonly McpConfigFile[]>
  /**
   * List this tool's skill roots.
   * @param context - working directory and scope selection for this scan.
   * @returns roots to walk, in precedence order.
   */
  skillRoots(context: DiscoveryContext): Promise<readonly SkillRoot[]>
}

/** Home directory of the signed-in user. */
function home(): string {
  return homedir()
}

/** Windows roaming application data, used by the VS Code and Trae desktop builds. */
function roamingAppData(): string {
  return process.env.APPDATA ?? join(home(), 'AppData', 'Roaming')
}

/** macOS `Application Support` directory. */
function macAppSupport(): string {
  return join(home(), 'Library', 'Application Support')
}

/** XDG configuration home. */
function xdgConfig(): string {
  return process.env.XDG_CONFIG_HOME ?? join(home(), '.config')
}

/** Per-platform desktop application directory for VS Code and Trae. */
function desktopUserDir(appName: string): string {
  switch (process.platform) {
    case 'win32': return join(roamingAppData(), appName, 'User')
    case 'darwin': return join(macAppSupport(), appName, 'User')
    default: return join(xdgConfig(), appName, 'User')
  }
}

/** Claude Code configuration directory, honouring `CLAUDE_CONFIG_DIR`. */
function claudeConfigDir(): string {
  const configured = process.env.CLAUDE_CONFIG_DIR
  return configured !== undefined && configured.trim().length > 0 ? configured : join(home(), '.claude')
}

/** Codex home directory, honouring `CODEX_HOME`. */
function codexHome(): string {
  const configured = process.env.CODEX_HOME
  return configured !== undefined && configured.trim().length > 0 ? configured : join(home(), '.codex')
}

/** Expand a user-level file into the file list, dropping it when no working directory applies. */
function projectFile(cwd: string | undefined, ...segments: readonly string[]): readonly McpConfigFile[] {
  if (cwd === undefined) return []
  return [{ path: join(cwd, ...segments), scope: 'project', format: 'json', keyPath: ['mcpServers'] }]
}

/** Claude Code: user MCP servers live beside its configuration, project ones in `.mcp.json`. */
const claudeCode: SourceDescriptor = {
  id: 'claude-code',
  label: 'Claude Code',
  mcpFiles: (context) => {
    const files: McpConfigFile[] = [
      { path: join(home(), '.claude.json'), scope: 'user', format: 'json', keyPath: ['mcpServers'] },
    ]
    if (context.cwd !== undefined) {
      files.push({ path: join(context.cwd, '.mcp.json'), scope: 'project', format: 'json', keyPath: ['mcpServers'] })
    }
    return Promise.resolve(files)
  },
  skillRoots: (context) => {
    const roots: SkillRoot[] = [{ path: join(claudeConfigDir(), 'skills'), scope: 'user' }]
    if (context.cwd !== undefined) roots.push({ path: join(context.cwd, '.claude', 'skills'), scope: 'project' })
    return Promise.resolve(roots)
  },
}

/** Codex: one TOML file per scope, with the servers table named `mcp_servers`. */
const codex: SourceDescriptor = {
  id: 'codex',
  label: 'Codex CLI',
  mcpFiles: (context) => {
    const files: McpConfigFile[] = [
      { path: join(codexHome(), 'config.toml'), scope: 'user', format: 'toml', keyPath: ['mcp_servers'] },
    ]
    if (context.cwd !== undefined) {
      files.push({ path: join(context.cwd, '.codex', 'config.toml'), scope: 'project', format: 'toml', keyPath: ['mcp_servers'] })
    }
    return Promise.resolve(files)
  },
  skillRoots: (context) => {
    const roots: SkillRoot[] = [{ path: join(codexHome(), 'skills'), scope: 'user' }]
    if (context.cwd !== undefined) roots.push({ path: join(context.cwd, '.codex', 'skills'), scope: 'project' })
    return Promise.resolve(roots)
  },
}

/** Cursor: `mcp.json` per scope and a skills directory next to its configuration. */
const cursor: SourceDescriptor = {
  id: 'cursor',
  label: 'Cursor',
  mcpFiles: (context) => Promise.resolve([
    { path: join(home(), '.cursor', 'mcp.json'), scope: 'user', format: 'json', keyPath: ['mcpServers'] },
    ...projectFile(context.cwd, '.cursor', 'mcp.json'),
  ]),
  skillRoots: (context) => {
    const roots: SkillRoot[] = [
      { path: join(home(), '.cursor', 'skills-cursor'), scope: 'user' },
      { path: join(home(), '.cursor', 'skills'), scope: 'user' },
    ]
    if (context.cwd !== undefined) roots.push({ path: join(context.cwd, '.cursor', 'skills'), scope: 'project' })
    return Promise.resolve(roots)
  },
}

/** Trae: the desktop application's user directory plus a dotfile directory. */
const trae: SourceDescriptor = {
  id: 'trae',
  label: 'Trae',
  mcpFiles: (context) => {
    const files: McpConfigFile[] = [
      { path: join(desktopUserDir('Trae'), 'mcp.json'), scope: 'user', format: 'json', keyPath: ['mcpServers'] },
      { path: join(home(), '.trae', 'mcp.json'), scope: 'user', format: 'json', keyPath: ['mcpServers'] },
    ]
    if (context.cwd !== undefined) {
      files.push({ path: join(context.cwd, '.trae', 'mcp.json'), scope: 'project', format: 'json', keyPath: ['mcpServers'] })
    }
    return Promise.resolve(files)
  },
  skillRoots: (context) => {
    const roots: SkillRoot[] = [
      { path: join(home(), '.trae', 'skills'), scope: 'user' },
      { path: join(home(), '.trae', 'builtin_skills'), scope: 'user' },
    ]
    if (context.cwd !== undefined) roots.push({ path: join(context.cwd, '.trae', 'skills'), scope: 'project' })
    return Promise.resolve(roots)
  },
}

/** VS Code: `servers` keys in `mcp.json`, one file per editor profile. */
const vscode: SourceDescriptor = {
  id: 'vscode',
  label: 'VS Code',
  mcpFiles: async (context) => {
    const userDir = desktopUserDir('Code')
    const files: McpConfigFile[] = [
      { path: join(userDir, 'mcp.json'), scope: 'user', format: 'json', keyPath: ['servers'] },
      { path: join(userDir, 'settings.json'), scope: 'user', format: 'json', keyPath: ['mcp', 'servers'] },
    ]
    const profiles = await listDirectory(join(userDir, 'profiles'))
    for (const profile of profiles) {
      if (!profile.isDirectory()) continue
      files.push({ path: join(userDir, 'profiles', profile.name, 'mcp.json'), scope: 'user', format: 'json', keyPath: ['servers'] })
    }
    if (context.cwd !== undefined) {
      files.push({ path: join(context.cwd, '.vscode', 'mcp.json'), scope: 'project', format: 'json', keyPath: ['servers'] })
    }
    return files
  },
  skillRoots: () => Promise.resolve([]),
}

/** The `.agents` convention shared by several tools. */
const agents: SourceDescriptor = {
  id: 'agents',
  label: 'Shared .agents convention',
  mcpFiles: () => Promise.resolve([]),
  skillRoots: (context) => {
    const roots: SkillRoot[] = [{ path: join(home(), '.agents', 'skills'), scope: 'user' }]
    if (context.cwd !== undefined) roots.push({ path: join(context.cwd, '.agents', 'skills'), scope: 'project' })
    return Promise.resolve(roots)
  },
}

/** Every supported source, in scan order. */
export const SOURCE_DESCRIPTORS: readonly SourceDescriptor[] = [
  agents,
  claudeCode,
  codex,
  cursor,
  trae,
  vscode,
]

/**
 * Select descriptors for the requested source identifiers.
 * @param ids - requested identifiers; an empty list selects every source.
 * @returns descriptors in canonical scan order.
 */
export function selectSources(ids: readonly ExternalSourceId[]): readonly SourceDescriptor[] {
  if (ids.length === 0) return SOURCE_DESCRIPTORS
  const wanted = new Set(ids)
  return SOURCE_DESCRIPTORS.filter(descriptor => wanted.has(descriptor.id))
}
