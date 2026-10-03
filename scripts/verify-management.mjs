/**
 * Development check: mount the plugin on a real Cordis context with a stubbed
 * host web server, then drive the management route over real HTTP.
 *
 *   node scripts/verify-management.mjs [cwd]
 *
 * Runs inside the session workspace: the state document and the listening
 * socket both stay local to this checkout.
 */

import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('../../../', import.meta.url)
const { Context } = await import(new URL('vendor/cordis/lib/index.js', root))
const { default: SystemPrompt } = await import(new URL('packages/core/system-prompt/lib/index.js', root))
const { default: Tools } = await import(new URL('packages/core/tools/lib/index.js', root))
const { default: Skills } = await import(new URL('packages/skill/skill/lib/index.js', root))
const ExternalImport = await import('../lib/index.js')
const { API_PREFIX } = await import('../lib/api.js')

const cwd = process.argv[2] ?? process.cwd()
const directory = await mkdtemp(join(tmpdir(), 'external-import-verify-'))
const statePath = join(directory, 'state.json')

const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(Tools)
await ctx.plugin(Skills)

/** Route the plugin registers; the HTTP server below serves it. */
let route
ctx.provide('webServer', {
  register(candidate) {
    route = candidate
    return () => { route = undefined }
  },
})

await ctx.plugin(ExternalImport, {
  sources: [],
  projectCwd: cwd,
  includeProjectScope: true,
  importSkills: true,
  registerTools: true,
  managementApi: true,
  statePath,
})

if (route === undefined) throw new Error('the plugin did not claim a management route')
if (route.path !== API_PREFIX) throw new Error(`unexpected route path ${route.path}`)

const server = createServer((req, res) => { void route.handler(req, res) })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}${API_PREFIX}`

/** Call one endpoint and return its parsed body. */
async function call(path, body) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

const overview = await call('/overview')
if (overview.status !== 200) throw new Error(`overview failed: ${JSON.stringify(overview)}`)
console.log(`overview: ${overview.body.skills.length} skills, ${overview.body.servers.length} servers, ${overview.body.problems.length} skipped`)
console.log('sources:', overview.body.sources.map(source => `${source.id}=${source.enabled ? 'on' : 'off'}`).join(' '))
console.log('first server:', JSON.stringify(overview.body.servers[0]))

const target = overview.body.skills[0]
const disabled = await call('/state', { disabledSkills: [target.name] })
if (disabled.status !== 200) throw new Error(`state failed: ${JSON.stringify(disabled)}`)
const catalog = await ctx.skills.list({ cwd })
const stillListed = catalog.filter(skill => skill.provider === 'external-import').some(skill => skill.name === target.name)
if (stillListed) throw new Error(`disabled skill ${target.name} is still offered by the provider`)
console.log(`disabled "${target.name}"; provider now offers ${catalog.filter(skill => skill.provider === 'external-import').length} imported skills`)

const sourcesOff = await call('/state', { disabledSources: ['cursor', 'trae'] })
if (sourcesOff.status !== 200) throw new Error(`source switch failed: ${JSON.stringify(sourcesOff)}`)
console.log('disabled sources:', sourcesOff.body.disabledSources.join(', '))

const missing = await call('/mcp/mount', { servers: ['definitely-not-a-server'] })
console.log('mount of an unknown server:', JSON.stringify(missing.body.outcomes))

const saved = await call('/session-prompt', { sessionId: 'session-verify', text: '只回答要点。' })
if (saved.status !== 200 || saved.body.text !== '只回答要点。') throw new Error(`session prompt failed: ${JSON.stringify(saved)}`)
const sessions = await call('/sessions')
console.log('sessions endpoint:', sessions.status, JSON.stringify(sessions.body).slice(0, 80))

const stored = JSON.parse(await readFile(statePath, 'utf8'))
console.log('persisted state:', JSON.stringify(stored))

const cleared = await call('/session-prompt', { sessionId: 'session-verify', text: '   ' })
if (cleared.body.text !== '') throw new Error('clearing the session prompt did not remove it')
console.log('cleared session prompt')

const notFound = await call('/nope')
if (notFound.status !== 404) throw new Error(`unknown endpoint returned ${notFound.status}`)
console.log('unknown endpoint ->', notFound.status)

// Session instructions must reach exactly the scope that owns them.
const { createScope } = await import(new URL('packages/core/scope/lib/index.js', root))
const instruction = '只回答要点，先给结论。'
await call('/session-prompt', { sessionId: 'session-scoped', text: instruction })
const key = { label: 'session-scoped' }
const scope = createScope(ctx, key)
const agent = { id: 'session-scoped', ctx: scope.ctx }
ctx.emit('agent/created', { agent, source: 'created' })
// The scoped registration activates on its own fiber, so let that settle.
await new Promise(resolve => setTimeout(resolve, 20))

const own = JSON.stringify((await ctx.systemPrompt.assemble({ scope: key })).sections)
if (!own.includes(instruction)) throw new Error(`the session instruction did not reach its own prompt: ${own.slice(0, 400)}`)
console.log('session instruction reached its own assembly')

const other = JSON.stringify((await ctx.systemPrompt.assemble({ scope: { label: 'other-session' } })).sections)
if (other.includes(instruction)) throw new Error('the session instruction leaked into another scope')
console.log('another scope does not see it')

scope.dispose()
server.close()
await ctx.fiber.dispose()
await rm(directory, { recursive: true, force: true })
console.log('\nOK')
