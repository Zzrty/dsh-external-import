/**
 * Behaviour tests for the parsing layer, run with `node --test tests/`.
 * Each case uses a fragment copied from a real configuration file shape.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseTomlSubset } from '../lib/parse/toml.js'
import { parseFrontmatter } from '../lib/parse/frontmatter.js'

test('toml: tables, arrays, inline tables and literal strings', () => {
  const parsed = parseTomlSubset([
    '[windows]',
    '# a comment',
    '[mcp_servers]',
    '',
    '[mcp_servers.memory]',
    'type = "stdio"',
    'command = "cmd"',
    'args = ["/c", "npx", "-y", "@modelcontextprotocol/server-memory"]',
    '',
    '[mcp_servers.node_repl.env]',
    "CODEX_HOME = 'C:\\Users\\123\\.codex'",
    'NODE_REPL_TRUSTED_SERVICES = \'{"browser":"C:/x/browser-service.mjs","sky":"@oai/sky/service"}\'',
    '',
    '[mcp_servers.ESP-IDF]',
    'espressif-documentation = { url = "https://mcp.espressif.com/docs" }',
    '',
    '[mcp_servers.cua_repl]',
    'enabled = false',
  ].join('\n'))

  const servers = parsed.mcp_servers
  assert.equal(typeof servers, 'object')
  const memory = servers.memory
  assert.equal(memory.type, 'stdio')
  assert.deepEqual(memory.args, ['/c', 'npx', '-y', '@modelcontextprotocol/server-memory'])
  assert.equal(servers.node_repl.env.CODEX_HOME, 'C:\\Users\\123\\.codex')
  assert.equal(servers.node_repl.env.NODE_REPL_TRUSTED_SERVICES, '{"browser":"C:/x/browser-service.mjs","sky":"@oai/sky/service"}')
  assert.equal(servers['ESP-IDF']['espressif-documentation'].url, 'https://mcp.espressif.com/docs')
  assert.equal(servers.cua_repl.enabled, false)
})

test('toml: quoted table segments and escape sequences', () => {
  const parsed = parseTomlSubset([
    '[plugins."documents@openai-primary-runtime"]',
    'name = "documents"',
    'note = "line\\nbreak"',
  ].join('\n'))
  assert.equal(parsed.plugins['documents@openai-primary-runtime'].name, 'documents')
  assert.equal(parsed.plugins['documents@openai-primary-runtime'].note, 'line\nbreak')
})

test('frontmatter: folded description and plain body', () => {
  const parsed = parseFrontmatter([
    '---',
    'name: 401-403-bypass-techniques',
    'description: >-',
    '  401/403 bypass playbook. Use when encountering access-denied responses',
    '  on admin panels, API endpoints, or restricted paths.',
    '---',
    '',
    '# SKILL: 401/403 Bypass Techniques',
    '',
    'Body line.',
  ].join('\n'))

  assert.ok(parsed)
  assert.equal(parsed.data.name, '401-403-bypass-techniques')
  assert.equal(parsed.data.description, '401/403 bypass playbook. Use when encountering access-denied responses on admin panels, API endpoints, or restricted paths.')
  assert.equal(parsed.body, '# SKILL: 401/403 Bypass Techniques\n\nBody line.')
})

test('frontmatter: lists, nested maps, booleans and quoted values', () => {
  const parsed = parseFrontmatter([
    '---',
    'name: "quoted-name"',
    'allowed-tools: [read, write]',
    'disable-model-invocation: true',
    'metadata:',
    '  owner: platform',
    '  tags:',
    '    - one',
    '    - two',
    '---',
    'body',
  ].join('\n'))

  assert.ok(parsed)
  assert.equal(parsed.data.name, 'quoted-name')
  assert.deepEqual(parsed.data['allowed-tools'], ['read', 'write'])
  assert.equal(parsed.data['disable-model-invocation'], true)
  assert.equal(parsed.data.metadata.owner, 'platform')
  assert.deepEqual(parsed.data.metadata.tags, ['one', 'two'])
  assert.equal(parsed.body, 'body')
})

test('frontmatter: absent or unterminated blocks are reported as absent', () => {
  assert.equal(parseFrontmatter('# just markdown'), undefined)
  assert.equal(parseFrontmatter('---\nname: x\n'), undefined)
})
