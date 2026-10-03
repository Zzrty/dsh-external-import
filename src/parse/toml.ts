/**
 * Reader for the TOML subset that agent-tool configuration files use.
 *
 * Codex keeps MCP servers in `config.toml`. That file uses tables, dotted and
 * quoted keys, arrays, inline tables, and both string forms, so a general TOML
 * parser is unnecessary but a line-oriented `key = value` reader is not
 * enough either. This parser covers tables, inline tables, arrays, quoted
 * keys, literals, numbers, and booleans, and rejects nothing silently: an
 * unreadable construct becomes a plain string rather than dropping the entry.
 *
 * @module dsh-external-import/parse/toml
 */

/** A parsed TOML value. */
export type TomlValue = string | number | boolean | TomlValue[] | TomlTable

/** A parsed TOML table. */
export interface TomlTable {
  readonly [key: string]: TomlValue
}

/**
 * Parse TOML text into nested tables.
 * @param text - complete file contents.
 * @returns the root table; an empty file yields an empty table.
 */
export function parseTomlSubset(text: string): TomlTable {
  const root: Record<string, TomlValue> = {}
  let current: Record<string, TomlValue> = root
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim()
    if (line.length === 0) continue
    if (line.startsWith('[[') && line.endsWith(']]')) {
      const path = splitKeyPath(line.slice(2, -2).trim())
      current = pushArrayTable(root, path)
      continue
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      const path = splitKeyPath(line.slice(1, -1).trim())
      current = ensureTable(root, path)
      continue
    }
    const separator = indexOfTopLevel(line, '=')
    if (separator < 0) continue
    const key = splitKeyPath(line.slice(0, separator).trim())
    if (key.length === 0) continue
    assign(current, key, parseValue(line.slice(separator + 1).trim()))
  }
  return root
}

/** Remove a trailing `#` comment that is outside both string forms. */
function stripComment(line: string): string {
  let quote: '"' | "'" | undefined
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quote === '"') {
      if (char === '\\') index += 1
      else if (char === '"') quote = undefined
      continue
    }
    if (quote === "'") {
      if (char === "'") quote = undefined
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '#') return line.slice(0, index)
  }
  return line
}

/** Find `needle` outside quotes and nested brackets. */
function indexOfTopLevel(text: string, needle: string): number {
  let quote: '"' | "'" | undefined
  let depth = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quote === '"') {
      if (char === '\\') index += 1
      else if (char === '"') quote = undefined
      continue
    }
    if (quote === "'") {
      if (char === "'") quote = undefined
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '[' || char === '{' || char === '(') depth += 1
    else if (char === ']' || char === '}' || char === ')') depth -= 1
    else if (depth === 0 && char === needle) return index
  }
  return -1
}

/** Split a dotted key path, honouring quoted segments. */
function splitKeyPath(text: string): string[] {
  const segments: string[] = []
  let buffer = ''
  let quote: '"' | "'" | undefined
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      else if (char === '\\' && quote === '"') {
        index += 1
        buffer += unescapeBasic(text[index] ?? '')
      } else buffer += char
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '.') {
      segments.push(buffer.trim())
      buffer = ''
    } else buffer += char
  }
  segments.push(buffer.trim())
  return segments.filter(segment => segment.length > 0)
}

/** Descend into `path`, creating tables as needed, and return the final table. */
function ensureTable(root: Record<string, TomlValue>, path: readonly string[]): Record<string, TomlValue> {
  let node = root
  for (const segment of path) {
    const existing = node[segment]
    if (isTable(existing)) {
      node = existing
      continue
    }
    const created: Record<string, TomlValue> = {}
    node[segment] = created
    node = created
  }
  return node
}

/** Descend into `path`, appending a new table when the final segment is an array of tables. */
function pushArrayTable(root: Record<string, TomlValue>, path: readonly string[]): Record<string, TomlValue> {
  if (path.length === 0) return root
  const parent = ensureTable(root, path.slice(0, -1))
  const last = path[path.length - 1] ?? ''
  const existing = parent[last]
  const created: Record<string, TomlValue> = {}
  if (Array.isArray(existing)) parent[last] = [...existing, created]
  else parent[last] = [created]
  return created
}

/** Assign a dotted key inside one table. */
function assign(table: Record<string, TomlValue>, path: readonly string[], value: TomlValue): void {
  const parent = ensureTable(table, path.slice(0, -1))
  const last = path[path.length - 1]
  if (last !== undefined) parent[last] = value
}

/** Parse one TOML value expression. */
function parseValue(text: string): TomlValue {
  if (text.length === 0) return ''
  const first = text[0]
  if (first === '"') return parseBasicString(text)
  if (first === "'") return parseLiteralString(text)
  if (first === '[') return parseArray(text)
  if (first === '{') return parseInlineTable(text)
  if (text === 'true') return true
  if (text === 'false') return false
  const numeric = parseNumber(text)
  if (numeric !== undefined) return numeric
  return text
}

/** Parse a double-quoted TOML string, including its escape sequences. */
function parseBasicString(text: string): string {
  let result = ''
  for (let index = 1; index < text.length; index += 1) {
    const char = text[index]
    if (char === '\\') {
      index += 1
      result += unescapeBasic(text[index] ?? '')
      continue
    }
    if (char === '"') break
    result += char
  }
  return result
}

/** Parse a single-quoted TOML literal string, which has no escapes. */
function parseLiteralString(text: string): string {
  const end = text.indexOf("'", 1)
  return end < 0 ? text.slice(1) : text.slice(1, end)
}

/** Expand one basic-string escape, including the Unicode and newline forms. */
function unescapeBasic(char: string): string {
  switch (char) {
    case 'n': return '\n'
    case 't': return '\t'
    case 'r': return '\r'
    case '"': return '"'
    case '\\': return '\\'
    case 'b': return '\b'
    case 'f': return '\f'
    default: return char
  }
}

/** Parse a single-line TOML array. */
function parseArray(text: string): TomlValue[] {
  const inner = text.replace(/^\[/, '').replace(/\]$/, '')
  return splitTopLevel(inner, ',').map(item => parseValue(item.trim())).filter((_item, index, all) => all.length > 0 && index < all.length)
}

/** Parse a single-line TOML inline table. */
function parseInlineTable(text: string): Record<string, TomlValue> {
  const inner = text.replace(/^\{/, '').replace(/\}$/, '')
  const table: Record<string, TomlValue> = {}
  for (const entry of splitTopLevel(inner, ',')) {
    const separator = indexOfTopLevel(entry, '=')
    if (separator < 0) continue
    const key = splitKeyPath(entry.slice(0, separator).trim())
    if (key.length === 0) continue
    assign(table, key, parseValue(entry.slice(separator + 1).trim()))
  }
  return table
}

/** Split on a separator that is outside quotes and nesting. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = []
  let buffer = ''
  let quote: '"' | "'" | undefined
  let depth = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quote === '"') {
      if (char === '\\') {
        buffer += char
        index += 1
        buffer += text[index] ?? ''
        continue
      }
      if (char === '"') quote = undefined
      buffer += char
      continue
    }
    if (quote === "'") {
      if (char === "'") quote = undefined
      buffer += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      buffer += char
      continue
    }
    if (char === '[' || char === '{' || char === '(') depth += 1
    if (char === ']' || char === '}' || char === ')') depth -= 1
    if (depth === 0 && char === separator) {
      parts.push(buffer)
      buffer = ''
      continue
    }
    buffer += char
  }
  parts.push(buffer)
  return parts
}

/** Parse an integer or float, normalising TOML underscore separators. */
function parseNumber(text: string): number | undefined {
  const normalised = text.replaceAll('_', '')
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(normalised)) return undefined
  const value = Number(normalised)
  return Number.isFinite(value) ? value : undefined
}

/** Whether a value is a nested table rather than an array of tables. */
function isTable(value: TomlValue | undefined): value is Record<string, TomlValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
