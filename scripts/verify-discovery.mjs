/**
 * Development check: run discovery against this machine's real configuration
 * and print a redacted summary. Run with `node scripts/verify-discovery.mjs`.
 */

import { runDiscovery } from '../lib/discovery.js'
import { maskRecord, maskUrl } from '../lib/mcp/mask.js'
import { toServerName } from '../lib/mcp/naming.js'

const report = await runDiscovery({
  sources: [],
  cwd: process.argv[2] ?? process.cwd(),
  frontmatterBytes: 16_384,
  want: { mcp: true, skills: true },
})

console.log('scanned files:')
for (const file of report.scannedFiles) console.log('  -', file)
console.log(`\nMCP servers: ${report.servers.length}`)
const used = new Set()
for (const candidate of report.servers) {
  const spec = candidate.spec
  const where = spec.transport === 'http'
    ? maskUrl(spec.url ?? '')
    : `${spec.command} ${spec.args.join(' ')}`
  console.log(`  - ${toServerName(spec.rawName, '', used).padEnd(24)} <= ${spec.rawName} [${candidate.source}/${candidate.scope}] ${where}`)
  if (Object.keys(spec.env).length > 0) console.log(`      env: ${JSON.stringify(maskRecord(spec.env))}`)
  if (Object.keys(spec.headers).length > 0) console.log(`      headers: ${JSON.stringify(maskRecord(spec.headers))}`)
}

console.log(`\nMCP problems: ${report.problems.length}`)
for (const problem of report.problems) console.log(`  - ${problem.rawName} [${problem.source}] ${problem.reason}: ${problem.detail}`)

console.log(`\nSkills: ${report.skills.length}`)
const bySource = new Map()
for (const skill of report.skills) bySource.set(skill.source, (bySource.get(skill.source) ?? 0) + 1)
for (const [source, count] of bySource) console.log(`  ${source}: ${count}`)
console.log('  sample:', report.skills.slice(0, 5).map(skill => skill.name).join(', '))

console.log(`\nSkill problems: ${report.skillProblems.length}`)
const byReason = new Map()
for (const problem of report.skillProblems) byReason.set(problem.reason, (byReason.get(problem.reason) ?? 0) + 1)
for (const [reason, count] of byReason) console.log(`  ${reason}: ${count}`)
for (const problem of report.skillProblems.filter(entry => entry.reason !== 'duplicate').slice(0, 10)) {
  console.log(`  ! ${problem.dir}: ${problem.detail}`)
}
