/**
 * Management HTTP interface for the settings page.
 *
 * The browser half reads and writes through this route instead of the typed
 * Remote layer: an out-of-tree package cannot generate the Remote descriptors,
 * and these are plain JSON reads and writes of state this plugin already owns.
 * The route accepts loopback peers only, so it adds no surface beyond the local
 * user who is already using the GUI.
 *
 * @module dsh-external-import/api
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { ExternalImportConfig } from './config.ts'
import { runDiscovery } from './discovery.ts'
import { maskUrl } from './mcp/mask.ts'
import { toServerName } from './mcp/naming.ts'
import type { McpMountRegistry } from './mcp/manager.ts'
import type { ExternalSkillProvider } from './skills/provider.ts'
import type { StateStore } from './state.ts'
import { EXTERNAL_SOURCE_IDS } from './types.ts'
import type { ExternalSourceId } from './types.ts'

/** Absolute prefix claimed on the host web server. */
export const API_PREFIX = '/external-import/api'

/** Maximum accepted request body, in bytes. */
const MAX_BODY_BYTES = 256 * 1024

/** Collaborators the management interface reads and mutates. */
export interface ApiDeps {
  /** Host context owning the route registration. */
  readonly ctx: Context
  /** Resolved plugin configuration. */
  readonly config: ExternalImportConfig
  /** Durable management state. */
  readonly store: StateStore
  /** Live MCP mounts. */
  readonly mounts: McpMountRegistry
  /** Imported skill provider, when skill import is enabled. */
  readonly skills: ExternalSkillProvider | undefined
}

/** Minimal shape of the host web server service this module uses. */
interface WebServerLike {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/**
 * Claim the management route once the host web server is available.
 * @param deps - context, configuration, and live import state.
 */
export function installManagementApi(deps: ApiDeps): void {
  deps.ctx.inject(['webServer'], (scope) => {
    const server = scope.get('webServer') as unknown as WebServerLike | undefined
    if (server === undefined) return
    scope.effect(
      () => server.register({ kind: 'prefix', path: API_PREFIX, handler: (req, res) => handle(deps, req, res) }),
      'external-import.api',
    )
  })
}

/** Dispatch one request to a management endpoint. */
async function handle(deps: ApiDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isLoopback(req)) return send(res, 403, { error: 'the management interface accepts loopback requests only' })
  const path = (req.url ?? '').split('?')[0]?.slice(API_PREFIX.length) ?? ''
  const method = req.method ?? 'GET'
  try {
    if (method === 'GET' && path === '/overview') return send(res, 200, await overview(deps))
    if (method === 'POST' && path === '/state') return send(res, 200, await updateState(deps, await readJson(req)))
    if (method === 'POST' && path === '/mcp/mount') return send(res, 200, await mount(deps, await readJson(req)))
    if (method === 'POST' && path === '/mcp/unmount') return send(res, 200, await unmount(deps, await readJson(req)))
    if (method === 'GET' && path === '/sessions') return send(res, 200, await sessions(deps))
    if (method === 'POST' && path === '/session-prompt') return send(res, 200, await setSessionPrompt(deps, await readJson(req)))
    return send(res, 404, { error: `no management endpoint at ${path}` })
  } catch (error) {
    return send(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

/** Everything the settings page shows in one response. */
async function overview(deps: ApiDeps): Promise<unknown> {
  const state = deps.store.current()
  const report = await runDiscovery({
    sources: [],
    cwd: deps.config.includeProjectScope ? deps.config.projectCwd : undefined,
    frontmatterBytes: deps.config.frontmatterBytes,
    want: { mcp: true, skills: true },
  })
  const mounted = new Map(deps.mounts.list().map(entry => [entry.rawName, entry]))
  const reserved = new Set(deps.mounts.list().map(entry => entry.serverName))
  return {
    sources: EXTERNAL_SOURCE_IDS.map(id => ({
      id,
      enabled: !state.disabledSources.includes(id),
      skills: report.skills.filter(skill => skill.source === id).length,
      servers: report.servers.filter(server => server.source === id).length,
    })),
    skills: report.skills.map(skill => ({
      name: skill.name,
      description: skill.description,
      source: skill.source,
      scope: skill.scope,
      dir: skill.dir,
      modelInvocable: skill.invocation.modelInvocable,
      disabled: state.disabledSkills.includes(skill.name),
    })),
    servers: report.servers.map(server => ({
      rawName: server.spec.rawName,
      serverName: toServerName(server.spec.rawName, deps.config.serverNamePrefix, reserved),
      source: server.source,
      scope: server.scope,
      origin: server.origin,
      transport: server.spec.transport,
      summary: server.spec.transport === 'http'
        ? maskUrl(server.spec.url ?? '')
        : `${server.spec.command ?? ''} ${server.spec.args.join(' ')}`.trim(),
      mounted: mounted.has(server.spec.rawName),
    })),
    problems: report.problems.map(problem => ({
      rawName: problem.rawName,
      source: problem.source,
      origin: problem.origin,
      reason: problem.reason,
      detail: problem.detail,
    })),
    sessionPrompts: state.sessionPrompts,
    disabledSources: state.disabledSources,
  }
}

/** Update source and skill switches. */
async function updateState(deps: ApiDeps, body: Record<string, unknown>): Promise<unknown> {
  const disabledSources = stringListField(body.disabledSources, 'disabledSources')
  const disabledSkills = stringListField(body.disabledSkills, 'disabledSkills')
  const next = await deps.store.mutate(state => ({
    ...state,
    ...disabledSources === undefined ? {} : { disabledSources: normalizeSources(disabledSources) },
    ...disabledSkills === undefined ? {} : { disabledSkills },
  }))
  deps.skills?.invalidate()
  return { disabledSources: next.disabledSources, disabledSkills: next.disabledSkills }
}

/** Connect the named servers. */
async function mount(deps: ApiDeps, body: Record<string, unknown>): Promise<unknown> {
  const wanted = stringListField(body.servers, 'servers') ?? []
  const report = await runDiscovery({
    sources: [],
    cwd: deps.config.includeProjectScope ? deps.config.projectCwd : undefined,
    frontmatterBytes: deps.config.frontmatterBytes,
    want: { mcp: true, skills: false },
  })
  const reserved = new Set(deps.mounts.list().map(entry => entry.serverName))
  const outcomes: unknown[] = []
  for (const rawName of wanted) {
    const candidate = report.servers.find(server => server.spec.rawName === rawName)
    if (candidate === undefined) {
      outcomes.push({ rawName, mounted: false, detail: 'not found in any scanned configuration' })
      continue
    }
    if (deps.mounts.list().some(entry => entry.rawName === rawName)) {
      outcomes.push({ rawName, mounted: true, detail: 'already connected' })
      continue
    }
    const serverName = toServerName(rawName, deps.config.serverNamePrefix, reserved)
    const outcome = await deps.mounts.mount(candidate, serverName)
    if (!outcome.mounted) deps.mounts.releaseName(serverName)
    outcomes.push({ rawName, serverName, mounted: outcome.mounted, detail: outcome.detail ?? '' })
  }
  return { outcomes }
}

/** Disconnect one server, or every server. */
async function unmount(deps: ApiDeps, body: Record<string, unknown>): Promise<unknown> {
  if (body.all === true) {
    const removed = deps.mounts.list().map(entry => entry.serverName)
    await deps.mounts.disposeAll()
    return { removed, remaining: [] }
  }
  const rawName = typeof body.rawName === 'string' ? body.rawName : ''
  const entry = deps.mounts.list().find(candidate => candidate.rawName === rawName)
  if (entry === undefined) return { removed: [], remaining: deps.mounts.list().map(item => item.serverName) }
  await deps.mounts.unmount(entry.serverName)
  return { removed: [entry.serverName], remaining: deps.mounts.list().map(item => item.serverName) }
}

/** List durable sessions for the instruction picker. */
async function sessions(deps: ApiDeps): Promise<unknown> {
  const query = deps.ctx.get('sessionQuery') as unknown as SessionQueryLike | undefined
  if (query === undefined) return { sessions: [] }
  const records = await query.listSessions()
  const state = deps.store.current()
  return {
    sessions: records
      .map(record => {
        const header = record.header
        const id = typeof header?.id === 'string' ? header.id : undefined
        if (id === undefined) return undefined
        return {
          id,
          title: typeof header?.title === 'string' ? header.title : '',
          cwd: typeof header?.cwd === 'string' ? header.cwd : '',
          updatedAt: typeof header?.updatedAt === 'number' ? header.updatedAt : 0,
          prompt: state.sessionPrompts[id] ?? '',
        }
      })
      .filter(entry => entry !== undefined)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 200),
  }
}

/** Store or clear one session's instruction. */
async function setSessionPrompt(deps: ApiDeps, body: Record<string, unknown>): Promise<unknown> {
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  const text = typeof body.text === 'string' ? body.text : ''
  if (sessionId.length === 0) throw new Error('sessionId is required')
  const next = await deps.store.mutate(state => {
    const sessionPrompts = { ...state.sessionPrompts }
    if (text.trim().length === 0) delete sessionPrompts[sessionId]
    else sessionPrompts[sessionId] = text
    return { ...state, sessionPrompts }
  })
  return { sessionId, text: next.sessionPrompts[sessionId] ?? '' }
}

/** Shape of the session query service this module reads. */
interface SessionQueryLike {
  /** List durable sessions. */
  listSessions(signal?: AbortSignal): Promise<readonly SessionRecordLike[]>
}

/** The part of a session record the picker needs. */
interface SessionRecordLike {
  readonly header?: { readonly id?: unknown; readonly title?: unknown; readonly cwd?: unknown; readonly updatedAt?: unknown }
}

/** Whether the request came from the local machine. */
function isLoopback(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** Read and parse a JSON request body. */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('request body is too large')
    chunks.push(buffer)
  }
  if (size === 0) return {}
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('request body must be a JSON object')
  return parsed as Record<string, unknown>
}

/** Send one JSON response. */
function send(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

/** Read an optional array-of-strings field. */
function stringListField(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`${field} must be an array of strings`)
  return value.filter((item): item is string => typeof item === 'string')
}

/** Keep only known source identifiers. */
function normalizeSources(values: readonly string[]): ExternalSourceId[] {
  const known = new Set<string>(EXTERNAL_SOURCE_IDS)
  return values.filter((value): value is ExternalSourceId => known.has(value))
}
