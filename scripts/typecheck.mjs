/**
 * Run the type check against whichever resolution is available.
 *
 * Inside a DeepSeek Harness checkout, `scripts/link-workspace.mjs` has already
 * written `tsconfig.workspace.json`; a standalone clone may instead have the
 * harness packages installed in `node_modules`, which the committed
 * `tsconfig.json` uses. This picks the former when present.
 */

import { spawnSync } from 'node:child_process'
import { access } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const workspaceConfig = join(root, 'tsconfig.workspace.json')
const hasWorkspace = await access(workspaceConfig).then(() => true, () => false)
const config = hasWorkspace ? 'tsconfig.workspace.json' : 'tsconfig.json'

if (!hasWorkspace) {
  const installed = await access(join(root, 'node_modules', '@deepseek-ai', 'dsh-tools')).then(() => true, () => false)
  if (!installed) {
    console.error([
      'Cannot resolve the DeepSeek Harness type declarations.',
      '',
      'Point this package at a harness checkout first:',
      '  npm install',
      '  npm run link-workspace -- ../deepseek-harness',
      '',
      '(the checkout must have been built once, so its lib/types declarations exist)',
    ].join('\n'))
    process.exit(2)
  }
}

const tsc = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc')
const binary = await access(tsc).then(() => tsc, () => 'tsc')
const result = spawnSync(binary, ['-p', config], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
if (result.error !== undefined && binary === 'tsc') {
  console.error(`tsc is not installed; run \`npm install\` first (${result.error.message})`)
  process.exit(2)
}
process.exit(result.status ?? 1)
