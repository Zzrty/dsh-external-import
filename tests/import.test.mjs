/**
 * Behaviour tests for MCP entry normalization, server naming, credential
 * masking, and skill-name normalization. Run with `node --test tests/`.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { normalizeEntry } from '../lib/discover/mcp.js'
import { normalizeSkillName } from '../lib/discover/skills.js'
import { maskRecord, maskUrl } from '../lib/mcp/mask.js'
import { toServerName } from '../lib/mcp/naming.js'

test('normalize: claude-code stdio entry', () => {
  const result = normalizeEntry('memory', {
    type: 'stdio',
    command: 'cmd',
    args: ['/c', 'npx', '-y', '@modelcontextprotocol/server-memory'],
  })
  assert.ok('spec' in result)
  assert.equal(result.spec.transport, 'stdio')
  assert.equal(result.spec.command, 'cmd')
  assert.deepEqual(result.spec.args, ['/c', 'npx', '-y', '@modelcontextprotocol/server-memory'])
})

test('normalize: cursor http entry', () => {
  const result = normalizeEntry('-docs', { type: 'http', url: 'https://mcp.espressif.com/docs', headers: {} })
  assert.ok('spec' in result)
  assert.equal(result.spec.transport, 'http')
  assert.equal(result.spec.url, 'https://mcp.espressif.com/docs')
})

test('normalize: trae serverUrl alias', () => {
  const result = normalizeEntry('espressif-docs', {
    serverUrl: 'https://mcp.espressif.com/docs',
    transport: 'http',
    url: 'https://mcp.espressif.com/docs',
  })
  assert.ok('spec' in result)
  assert.equal(result.spec.transport, 'http')
})

test('normalize: rejects unusable entries with a reason', () => {
  assert.equal(normalizeEntry('nested', { 'espressif-documentation': { url: 'x' } }).reason, 'missing-transport')
  assert.equal(normalizeEntry('empty', { type: 'stdio', command: '' }).reason, 'empty-command')
  assert.equal(normalizeEntry('off', { command: 'x', enabled: false }).reason, 'disabled')
  assert.equal(normalizeEntry('bad', 'not-an-object').reason, 'invalid-entry')
  assert.equal(normalizeEntry('args', { command: 'x', args: 'nope' }).reason, 'invalid-field')
})

test('normalize: VS Code input placeholders are reported, not imported', () => {
  const url = normalizeEntry('remote', { type: 'http', url: 'https://x/${input:api-key}' })
  assert.equal(url.reason, 'needs-user-input')
  const env = normalizeEntry('local', { command: 'x', args: ['--token', '${input:token}'] })
  assert.equal(env.reason, 'needs-user-input')
})

test('naming: grammar, lossy conversion, and collisions', () => {
  const used = new Set()
  assert.equal(toServerName('-docs', '', used), 'docs')
  assert.equal(toServerName('ESP-IDF', '', used), 'ESP-IDF')
  assert.match(toServerName('x'.repeat(60), '', used), /^x{23}-[0-9a-f]{8}$/)

  const nonAscii = toServerName('m_舵机协议', '', new Set())
  assert.match(nonAscii, /^[A-Za-z0-9_-]{1,32}$/)
  assert.notEqual(nonAscii, 'm_舵机协议')

  const collided = new Set()
  const first = toServerName('docs', '', collided)
  const second = toServerName('-docs', '', collided)
  assert.equal(first, 'docs')
  assert.notEqual(second, first)
})

test('masking: credential keys and URL user information are redacted', () => {
  assert.deepEqual(maskRecord({ API_KEY: 'secret', MODE: 'fast' }), { API_KEY: '<redacted>', MODE: 'fast' })
  assert.equal(maskUrl('https://user:pass@example.com/mcp?token=abc&mode=1'), 'https://example.com/mcp?token=%3Credacted%3E&mode=1')
  assert.equal(maskUrl('https://example.com/mcp?mode=1'), 'https://example.com/mcp?mode=1')
})

test('skill names are normalized into the registry grammar', () => {
  assert.equal(normalizeSkillName('401-403-bypass-techniques'), '401-403-bypass-techniques')
  assert.equal(normalizeSkillName('ESP-IDF'), 'esp-idf')
  assert.equal(normalizeSkillName('TRAE-debugger'), 'trae-debugger')
  assert.equal(normalizeSkillName('sem32_hal'), 'sem32-hal')
  assert.equal(normalizeSkillName('舵机'), undefined)
})
