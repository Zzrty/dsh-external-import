/**
 * Run the unit tests in this process.
 *
 * `node --test <files>` runs each file in a child process, and the flag that
 * turns that off changed name between Node 22 (`--experimental-test-isolation`)
 * and Node 24 (`--test-isolation`). Importing the files here runs every test in
 * one process on any supported Node version, with no flag to get wrong.
 *
 * `node:test` sets a non-zero exit code when a test fails, which is what CI
 * reports.
 */

import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const directory = new URL('../tests/', import.meta.url)
const files = (await readdir(fileURLToPath(directory)))
  .filter(name => name.endsWith('.test.mjs'))
  .sort()

if (files.length === 0) {
  console.error('no test files found in tests/')
  process.exit(2)
}

for (const name of files) {
  await import(new URL(name, directory).href)
}
