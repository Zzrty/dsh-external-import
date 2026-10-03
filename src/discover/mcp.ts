/**
 * Discovery of MCP servers declared by other agent tools.
 *
 * A discovered entry keeps the fields the owning tool wrote and gains a
 * transport classification. Entries that cannot become a working server —
 * disabled, missing a transport, or asking for interactive input — are kept as
 * problems so a report can explain the omission instead of dropping it.
 *
 * @module dsh-external-import/discover/mcp
 */

import { isRecord, readJsonObject, readTextFile } from '../parse/read.ts'
import { parseTomlSubset } from '../parse/toml.ts'
import type { McpConfigFile, SourceDescriptor, DiscoveryContext } from '../sources.ts'
import type { McpCandidate, McpProblem, McpServerSpec, ExternalSourceId } from '../types.ts'

/** Outcome of reading one configuration file. */
interface FileOutcome {
  readonly servers: McpCandidate[]
  readonly problems: McpProblem[]
  readonly read: boolean
}

/** Accumulated discovery result. */
export interface McpDiscovery {
  /** Servers that can be mounted. */
  readonly servers: readonly McpCandidate[]
  /** Entries that could not become servers. */
  readonly problems: readonly McpProblem[]
  /** Configuration files that existed and were read. */
  readonly scannedFiles: readonly string[]
}

/** Placeholder prefix VS Code writes where a user must supply a value at launch. */
const INPUT_PLACEHOLDER = '${input:'

/** Field names each tool uses for an HTTP endpoint. */
const URL_FIELDS = ['url', 'serverUrl', 'server_url', 'httpUrl', 'endpoint'] as const

/**
 * Read every selected source's MCP configuration.
 * @param descriptors - sources to scan.
 * @param context - working directory and scope selection for this scan.
 * @returns servers, problems, and the files that were read.
 */
export async function discoverMcp(
  descriptors: readonly SourceDescriptor[],
  context: DiscoveryContext,
): Promise<McpDiscovery> {
  const servers: McpCandidate[] = []
  const problems: McpProblem[] = []
  const scannedFiles: string[] = []
  const seen = new Map<string, McpCandidate>()
  for (const descriptor of descriptors) {
    for (const file of await descriptor.mcpFiles(context)) {
      const outcome = await readConfigFile(file, descriptor.id)
      if (!outcome.read) continue
      scannedFiles.push(file.path)
      problems.push(...outcome.problems)
      for (const candidate of outcome.servers) {
        const signature = signatureOf(candidate)
        if (seen.has(signature)) {
          problems.push({
            source: descriptor.id,
            scope: candidate.scope,
            origin: candidate.origin,
            rawName: candidate.spec.rawName,
            reason: 'duplicate',
            detail: `identical to the server already read from ${seen.get(signature)?.origin ?? 'another file'}`,
          })
          continue
        }
        seen.set(signature, candidate)
        servers.push(candidate)
      }
    }
  }
  return { servers, problems, scannedFiles }
}

/** Read one configuration file and normalize every entry it declares. */
async function readConfigFile(file: McpConfigFile, source: ExternalSourceId): Promise<FileOutcome> {
  const document = await readDocument(file)
  if (document === undefined) return { servers: [], problems: [], read: false }
  const table = descend(document, file.keyPath)
  if (table === undefined) return { servers: [], problems: [], read: true }
  if (!isRecord(table)) {
    return {
      servers: [],
      problems: [{
        source,
        scope: file.scope,
        origin: file.path,
        rawName: file.keyPath.join('.'),
        reason: 'invalid-entry',
        detail: `expected "${file.keyPath.join('.')}" to be an object of server entries`,
      }],
      read: true,
    }
  }
  const servers: McpCandidate[] = []
  const problems: McpProblem[] = []
  for (const [rawName, raw] of Object.entries(table)) {
    const normalized = normalizeEntry(rawName, raw)
    if ('reason' in normalized) {
      problems.push({ source, scope: file.scope, origin: file.path, rawName, ...normalized })
      continue
    }
    servers.push({ spec: normalized.spec, source, scope: file.scope, origin: file.path })
  }
  return { servers, problems, read: true }
}

/** Read and parse a configuration file, or `undefined` when it is absent or unparseable. */
async function readDocument(file: McpConfigFile): Promise<unknown> {
  if (file.format === 'toml') {
    const text = await readTextFile(file.path)
    return text === undefined ? undefined : parseTomlSubset(text)
  }
  return readJsonObject(file.path)
}

/** Walk a dotted key path inside a parsed document. */
function descend(document: unknown, keyPath: readonly string[]): unknown {
  let node: unknown = document
  for (const segment of keyPath) {
    if (!isRecord(node)) return undefined
    node = node[segment]
  }
  return node
}

/** Normalized entry or the reason it cannot be used. */
type Normalized = { readonly spec: McpServerSpec } | { readonly reason: McpProblem['reason']; readonly detail: string }

/**
 * Classify one raw entry as a stdio or HTTP server.
 * @param rawName - entry name as the file spells it.
 * @param raw - entry value as parsed from the file.
 * @returns the normalized spec, or a reason the entry was skipped.
 */
export function normalizeEntry(rawName: string, raw: unknown): Normalized {
  if (!isRecord(raw)) {
    return { reason: 'invalid-entry', detail: `entry "${rawName}" is not an object` }
  }
  if (raw.enabled === false || raw.disabled === true) {
    return { reason: 'disabled', detail: `entry "${rawName}" is disabled in its own configuration` }
  }
  const url = firstString(raw, URL_FIELDS)
  if (url !== undefined) return normalizeHttp(rawName, raw, url)
  const command = stringField(raw, 'command')
  if (command !== undefined && command.trim().length === 0) {
    return { reason: 'empty-command', detail: `entry "${rawName}" declares an empty command` }
  }
  if (command === undefined) {
    const declared = stringField(raw, 'type') ?? stringField(raw, 'transport')
    return {
      reason: declared === undefined ? 'missing-transport' : 'unsupported-transport',
      detail: `entry "${rawName}" declares neither a "url" nor a "command"${declared === undefined ? '' : ` (type "${declared}")`}`,
    }
  }
  return normalizeStdio(rawName, raw, command)
}

/** Build an HTTP spec, honouring VS Code's launch-time input placeholders. */
function normalizeHttp(rawName: string, raw: Record<string, unknown>, url: string): Normalized {
  if (url.includes(INPUT_PLACEHOLDER)) {
    return {
      reason: 'needs-user-input',
      detail: `entry "${rawName}" asks VS Code to prompt for its endpoint and cannot be imported without that value`,
    }
  }
  const headers = stringRecord(raw.headers)
  if (headers === undefined) {
    return { reason: 'invalid-field', detail: `entry "${rawName}" has a "headers" value that is not an object of strings` }
  }
  const placeholder = findPlaceholder(headers)
  if (placeholder !== undefined) {
    return {
      reason: 'needs-user-input',
      detail: `entry "${rawName}" asks VS Code to prompt for header "${placeholder}"`,
    }
  }
  return {
    spec: {
      rawName,
      transport: 'http',
      command: undefined,
      args: [],
      env: {},
      cwd: undefined,
      url,
      headers,
    },
  }
}

/** Build a stdio spec, honouring VS Code's launch-time input placeholders. */
function normalizeStdio(rawName: string, raw: Record<string, unknown>, command: string): Normalized {
  if (command.includes(INPUT_PLACEHOLDER)) {
    return { reason: 'needs-user-input', detail: `entry "${rawName}" asks VS Code to prompt for its command` }
  }
  const args = stringArray(raw.args)
  if (args === undefined) {
    return { reason: 'invalid-field', detail: `entry "${rawName}" has an "args" value that is not an array of strings` }
  }
  const env = stringRecord(raw.env)
  if (env === undefined) {
    return { reason: 'invalid-field', detail: `entry "${rawName}" has an "env" value that is not an object of strings` }
  }
  const cwd = stringField(raw, 'cwd') ?? stringField(raw, 'workingDirectory')
  const placeholder = findPlaceholder(args) ?? findPlaceholder(env) ?? (cwd?.includes(INPUT_PLACEHOLDER) === true ? 'cwd' : undefined)
  if (placeholder !== undefined) {
    return {
      reason: 'needs-user-input',
      detail: `entry "${rawName}" asks VS Code to prompt for "${placeholder}"`,
    }
  }
  return {
    spec: {
      rawName,
      transport: 'stdio',
      command,
      args,
      env,
      cwd,
      url: undefined,
      headers: {},
    },
  }
}

/** First present non-empty string among the candidate field names. */
function firstString(raw: Record<string, unknown>, fields: readonly string[]): string | undefined {
  for (const field of fields) {
    const value = stringField(raw, field)
    if (value !== undefined && value.trim().length > 0) return value
  }
  return undefined
}

/** Read one optional string field. */
function stringField(raw: Record<string, unknown>, field: string): string | undefined {
  const value = raw[field]
  return typeof value === 'string' ? value : undefined
}

/** Read an optional array of strings; `undefined` means the field is present but malformed. */
function stringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) return undefined
  const result: string[] = []
  for (const item of value) {
    if (typeof item === 'string') result.push(item)
    else if (typeof item === 'number' || typeof item === 'boolean') result.push(String(item))
    else return undefined
  }
  return result
}

/** Read an optional record of string values; scalars are stringified, nesting is rejected. */
function stringRecord(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null) return {}
  if (!isRecord(value)) return undefined
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') result[key] = item
    else if (typeof item === 'number' || typeof item === 'boolean') result[key] = String(item)
    else if (item === null) continue
    else return undefined
  }
  return result
}

/** Name of the first value that still contains an interactive placeholder. */
function findPlaceholder(values: readonly string[] | Readonly<Record<string, string>>): string | undefined {
  const entries: readonly (readonly [string, string])[] = Array.isArray(values)
    ? values.map((value, index) => [String(index), value] as const)
    : Object.entries(values)
  for (const [key, value] of entries) {
    if (typeof value === 'string' && value.includes(INPUT_PLACEHOLDER)) return key
  }
  return undefined
}

/** Stable identity used to collapse the same server repeated across files. */
function signatureOf(candidate: McpCandidate): string {
  const spec = candidate.spec
  if (spec.transport === 'http') return `http|${spec.rawName}|${spec.url ?? ''}`
  const env = Object.entries(spec.env).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `stdio|${spec.rawName}|${spec.command ?? ''}|${spec.args.join('\u0000')}|${JSON.stringify(env)}`
}
