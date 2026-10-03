/**
 * Plugin configuration.
 *
 * Every deployment-varying choice is a field here, so a profile can change it
 * from `cordis.patch.yml` without editing this package. The config is
 * validated at activation and fails loud: a mistyped field rejects the plugin
 * instead of silently falling back to a default the operator did not choose.
 *
 * @module dsh-external-import/config
 */

import { isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { EXTERNAL_SOURCE_IDS } from './types.ts'
import { defaultStatePath } from './state.ts'
import type { ExternalSourceId } from './types.ts'

/** Default byte budget for reading a skill's frontmatter during discovery. */
const DEFAULT_FRONTMATTER_BYTES = 16_384

/** Default lifetime of one discovery result. */
const DEFAULT_SCAN_CACHE_TTL_MS = 3_000

/**
 * Rank assigned to imported skills. Lower ranks win a duplicate name, so this
 * rank keeps every skill DeepSeek Harness itself provides ahead of an import.
 */
const DEFAULT_SKILL_RANK = 900

/** Package name of the MCP client bridge this plugin mounts. */
const DEFAULT_MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client'

/** Resolved, fully defaulted plugin configuration. */
export interface ExternalImportConfig {
  /** External tools to scan; an empty list scans every supported tool. */
  readonly sources: readonly ExternalSourceId[]
  /** Whether project-level configuration under the working directory is scanned. */
  readonly includeProjectScope: boolean
  /** Working directory whose project-level configuration is scanned. */
  readonly projectCwd: string
  /** Module specifier of the MCP client bridge mounted for each imported server. */
  readonly mcpClientModule: string
  /** Prefix applied to every generated MCP server namespace. */
  readonly serverNamePrefix: string
  /** Whether an imported server must connect and list its tools before the import reports success. */
  readonly verifyOnMount: boolean
  /** Per-call timeout handed to every mounted MCP server; `undefined` uses the bridge default. */
  readonly toolCallTimeoutMs: number | undefined
  /** Imported servers mounted during activate: external names, or `*` for every discovered server. */
  readonly autoMount: readonly string[]
  /** Whether imported skills are registered with the skill registry. */
  readonly importSkills: boolean
  /** Precedence rank of imported skills; lower ranks win duplicate names. */
  readonly skillRank: number
  /** Maximum bytes read from each skill file while scanning. */
  readonly frontmatterBytes: number
  /** Lifetime of one discovery result in milliseconds. */
  readonly scanCacheTtlMs: number
  /** Whether the model-facing tools are registered. */
  readonly registerTools: boolean
  /** Absolute path of the durable management-state document. */
  readonly statePath: string
  /** Whether the settings page's management route is registered on the host web server. */
  readonly managementApi: boolean
}

/** Raw configuration as written in `cordis.patch.yml`. */
export interface ExternalImportConfigInput {
  /** External tools to scan. */
  readonly sources?: readonly string[]
  /** Whether project-level configuration is scanned. */
  readonly includeProjectScope?: boolean
  /** Working directory for project-level configuration. */
  readonly projectCwd?: string
  /** Module specifier of the MCP client bridge. */
  readonly mcpClientModule?: string
  /** Prefix for generated MCP server namespaces. */
  readonly serverNamePrefix?: string
  /** Whether an imported server must connect before the import reports success. */
  readonly verifyOnMount?: boolean
  /** Per-call timeout for mounted MCP servers. */
  readonly toolCallTimeoutMs?: number
  /** Servers to mount during activate. */
  readonly autoMount?: readonly string[]
  /** Whether imported skills are registered. */
  readonly importSkills?: boolean
  /** Precedence rank of imported skills. */
  readonly skillRank?: number
  /** Maximum bytes read from each skill file while scanning. */
  readonly frontmatterBytes?: number
  /** Lifetime of one discovery result in milliseconds. */
  readonly scanCacheTtlMs?: number
  /** Whether the model-facing tools are registered. */
  readonly registerTools?: boolean
  /** Absolute path of the durable management-state document. */
  readonly statePath?: string
  /** Whether the settings page's management route is registered. */
  readonly managementApi?: boolean
}

/**
 * Validate raw plugin configuration and apply defaults.
 * @param raw - configuration object from the plugin entry, or `undefined`.
 * @returns the fully defaulted configuration.
 * @throws Error naming the first field that is present with a wrong value.
 */
export function resolveConfig(raw: ExternalImportConfigInput | undefined): ExternalImportConfig {
  const input = raw ?? {}
  const sources = resolveSources(input.sources)
  return {
    sources,
    includeProjectScope: booleanField(input.includeProjectScope, 'includeProjectScope', true),
    projectCwd: resolve(absolutePathField(input.projectCwd, 'projectCwd') ?? process.cwd()),
    mcpClientModule: stringField(input.mcpClientModule, 'mcpClientModule') ?? DEFAULT_MCP_CLIENT_MODULE,
    serverNamePrefix: stringField(input.serverNamePrefix, 'serverNamePrefix') ?? '',
    verifyOnMount: booleanField(input.verifyOnMount, 'verifyOnMount', true),
    toolCallTimeoutMs: positiveField(input.toolCallTimeoutMs, 'toolCallTimeoutMs'),
    autoMount: stringArrayField(input.autoMount, 'autoMount'),
    importSkills: booleanField(input.importSkills, 'importSkills', true),
    skillRank: numberField(input.skillRank, 'skillRank') ?? DEFAULT_SKILL_RANK,
    frontmatterBytes: positiveField(input.frontmatterBytes, 'frontmatterBytes') ?? DEFAULT_FRONTMATTER_BYTES,
    scanCacheTtlMs: positiveField(input.scanCacheTtlMs, 'scanCacheTtlMs') ?? DEFAULT_SCAN_CACHE_TTL_MS,
    registerTools: booleanField(input.registerTools, 'registerTools', true),
    statePath: resolve(absolutePathField(input.statePath, 'statePath') ?? defaultStatePath(resolveDshHome())),
    managementApi: booleanField(input.managementApi, 'managementApi', true),
  }
}

/** Harness home directory, honouring `DSH_HOME` the way the launcher does. */
function resolveDshHome(): string {
  const configured = process.env.DSH_HOME
  return configured !== undefined && configured.trim().length > 0 ? configured.trim() : join(homedir(), '.dsh')
}

/** Validate the requested source list against the supported identifiers. */
function resolveSources(value: readonly string[] | undefined): readonly ExternalSourceId[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('external-import: config.sources must be an array of source identifiers')
  const supported = new Set<string>(EXTERNAL_SOURCE_IDS)
  const selected: ExternalSourceId[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string' || !supported.has(entry)) {
      throw new Error(`external-import: config.sources contains "${String(entry)}"; supported values are ${EXTERNAL_SOURCE_IDS.join(', ')}`)
    }
    if (seen.has(entry)) continue
    seen.add(entry)
    selected.push(entry as ExternalSourceId)
  }
  return selected
}

/** Read an optional string field, rejecting other types. */
function stringField(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`external-import: config.${field} must be a string`)
  return value
}

/** Read an optional path field that must be absolute when present. */
function absolutePathField(value: unknown, field: string): string | undefined {
  const text = stringField(value, field)
  if (text === undefined) return undefined
  if (!isAbsolute(text)) throw new Error(`external-import: config.${field} must be an absolute path`)
  return text
}

/** Read an optional boolean field, rejecting other types. */
function booleanField(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new Error(`external-import: config.${field} must be a boolean`)
  return value
}

/** Read an optional finite number field. */
function numberField(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`external-import: config.${field} must be a finite number`)
  return value
}

/** Read an optional positive number field. */
function positiveField(value: unknown, field: string): number | undefined {
  const parsed = numberField(value, field)
  if (parsed === undefined) return undefined
  if (parsed <= 0) throw new Error(`external-import: config.${field} must be greater than zero`)
  return parsed
}

/** Read an optional array of strings. */
function stringArrayField(value: unknown, field: string): readonly string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`external-import: config.${field} must be an array of strings`)
  for (const entry of value) {
    if (typeof entry !== 'string') throw new Error(`external-import: config.${field} must be an array of strings`)
  }
  return value as readonly string[]
}
