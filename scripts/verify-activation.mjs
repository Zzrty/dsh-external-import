/**
 * Development check: mount the plugin on a real Cordis context with the real
 * tool and skill registries, then exercise the registered tools.
 *
 *   node scripts/verify-activation.mjs [cwd]
 *
 * The registry packages are loaded from the repository's built output by
 * relative path, because this package declares them as peers and resolves them
 * from the installation at run time.
 */

const root = new URL('../../../', import.meta.url)

const { Context } = await import(new URL('vendor/cordis/lib/index.js', root))
const { default: SystemPrompt } = await import(new URL('packages/core/system-prompt/lib/index.js', root))
const { default: Tools } = await import(new URL('packages/core/tools/lib/index.js', root))
const { default: Skills } = await import(new URL('packages/skill/skill/lib/index.js', root))
const ExternalImport = await import('../lib/index.js')

const cwd = process.argv[2] ?? process.cwd()
const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(Tools)
await ctx.plugin(Skills)
await ctx.plugin(ExternalImport, {
  sources: [],
  projectCwd: cwd,
  includeProjectScope: true,
  importSkills: true,
  registerTools: true,
})

const registered = ctx.tools.schemas().map(schema => schema.name).filter(name => name.startsWith('external_'))
console.log('registered tools:', registered.join(', '))
if (registered.length !== 4) throw new Error(`expected 4 registered tools, saw ${registered.length}`)

const catalog = await ctx.skills.list({ cwd })
console.log(`skill catalog: ${catalog.length} total, ${catalog.filter(skill => skill.provider === 'external-import').length} imported`)
const sample = catalog.find(skill => skill.provider === 'external-import')
if (sample === undefined) throw new Error('no imported skill reached the catalog')
console.log('sample imported skill:', sample.name, '| source:', sample.source, '| rank/provider:', sample.provider)

const loaded = await ctx.skills.get(sample.name, { cwd })
if (loaded === undefined) throw new Error(`could not load ${sample.name}`)
console.log(`loaded body: ${loaded.content.length} bytes, first line: ${loaded.content.split('\n')[0]}`)

const scan = ctx.tools.get('external_scan')
if (scan === undefined) throw new Error('external_scan is not registered')
const scanValue = await scan.execute({ includeMcp: true, includeSkills: true }, { signal: new AbortController().signal })
console.log('external_scan:', scanValue.servers.length, 'servers,', scanValue.skills.length, 'skills,', scanValue.serverProblems.length, 'skipped servers')
console.log('rendered:\n' + scan.output.render({}, scanValue).map(block => block.text).join('\n').split('\n').slice(0, 12).join('\n'))

const preview = ctx.tools.get('external_mcp_import')
const previewValue = await preview.execute({}, { signal: new AbortController().signal })
console.log('\nexternal_mcp_import preview:', previewValue.applied, previewValue.planned.map(entry => entry.serverName).join(', '))
console.log(preview.output.render({}, previewValue).map(block => block.text).join('\n'))

const status = ctx.tools.get('external_mcp_status')
console.log('\nexternal_mcp_status:', JSON.stringify(await status.execute({}, { signal: new AbortController().signal })))

// Validate every generated launch config against the real bridge schema. This
// exercises the whole foreign-config-to-bridge translation without connecting.
const { buildLaunchConfig } = await import('../lib/mcp/manager.js')
const { toServerName } = await import('../lib/mcp/naming.js')
const { resolveConfig } = await import('../lib/config.js')
const McpClient = await import('@deepseek-ai/dsh-mcp-client')
const resolved = resolveConfig({ sources: [] })
const used = new Set()
let validated = 0
for (const candidate of await collectCandidates()) {
  const launch = McpClient.Config(buildLaunchConfig(candidate, toServerName(candidate.spec.rawName, '', used), resolved))
  if (typeof launch.serverName !== 'string' || launch.serverName.length === 0) throw new Error('bridge config lost its serverName')
  validated += 1
}
console.log(`\nbridge config validated for ${validated} server(s)`)

await ctx.fiber.dispose()
console.log('\nOK')

/** Re-run discovery so the schema check covers exactly what a scan reports. */
async function collectCandidates() {
  const { runDiscovery } = await import('../lib/discovery.js')
  const report = await runDiscovery({ sources: [], cwd, frontmatterBytes: 16_384, want: { mcp: true, skills: false } })
  return report.servers
}
