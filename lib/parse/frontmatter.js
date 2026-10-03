/**
 * Reader for the YAML frontmatter that `SKILL.md` files carry.
 *
 * Skills use a small, flat frontmatter: `name`, `description`, and occasional
 * scalars, block scalars, lists, or one level of nested mapping. This parser
 * covers those forms without pulling a YAML engine into the plugin, so the
 * package stays installable without runtime dependencies.
 *
 * @module dsh-external-import/parse/frontmatter
 */
/**
 * Parse leading `---` frontmatter from a skill file.
 * @param text - complete file contents.
 * @returns the parsed frontmatter, or `undefined` when the file has none.
 */
export function parseFrontmatter(text) {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
    if ((lines[0] ?? '').trim() !== '---')
        return undefined;
    let end = -1;
    for (let index = 1; index < lines.length; index += 1) {
        const trimmed = (lines[index] ?? '').trim();
        if (trimmed === '---' || trimmed === '...') {
            end = index;
            break;
        }
    }
    if (end < 0)
        return undefined;
    const data = parseMapping(lines.slice(1, end), 0);
    const body = lines.slice(end + 1).join('\n').replace(/^\n+/, '');
    return { data, body, endLine: end };
}
/** Indentation width of a line, counting spaces only. */
function indentOf(line) {
    const match = /^[ \t]*/.exec(line);
    return match === null ? 0 : match[0].replaceAll('\t', '  ').length;
}
/** Whether a line carries no content or only a comment. */
function isBlank(line) {
    const trimmed = line.trim();
    return trimmed.length === 0 || trimmed.startsWith('#');
}
/** Parse an indentation-delimited mapping starting at `start`. */
function parseMapping(lines, start) {
    const result = {};
    let index = start;
    const baseIndent = start < lines.length ? indentOf(lines[start] ?? '') : 0;
    while (index < lines.length) {
        const line = lines[index] ?? '';
        if (isBlank(line)) {
            index += 1;
            continue;
        }
        const indent = indentOf(line);
        if (indent < baseIndent)
            break;
        if (indent > baseIndent) {
            index += 1;
            continue;
        }
        const content = line.trim();
        if (content.startsWith('- '))
            break;
        const separator = content.indexOf(':');
        if (separator < 0) {
            index += 1;
            continue;
        }
        const key = unquote(content.slice(0, separator).trim());
        const inline = content.slice(separator + 1).trim();
        const parsed = parseValue(lines, index, inline, indent);
        if (key.length > 0)
            result[key] = parsed.value;
        index = parsed.next;
    }
    return result;
}
/** Parse one value that may continue on following, more-indented lines. */
function parseValue(lines, index, inline, parentIndent) {
    if (inline === '|' || inline === '|-' || inline === '>-' || inline === '>') {
        return parseBlockScalar(lines, index + 1, parentIndent, inline.startsWith('>'), inline.endsWith('-'));
    }
    if (inline.length > 0)
        return { value: parseScalar(inline), next: index + 1 };
    return parseNested(lines, index + 1, parentIndent);
}
/** Parse a nested mapping or list that follows a bare `key:`. */
function parseNested(lines, start, parentIndent) {
    let index = start;
    while (index < lines.length && isBlank(lines[index] ?? ''))
        index += 1;
    if (index >= lines.length || indentOf(lines[index] ?? '') <= parentIndent)
        return { value: null, next: index };
    const first = (lines[index] ?? '').trim();
    if (first.startsWith('- ') || first === '-')
        return parseList(lines, index, indentOf(lines[index] ?? ''));
    return { value: parseMapping(lines, index), next: skipBlock(lines, index, parentIndent) };
}
/** Parse a block list at one indentation level. */
function parseList(lines, start, listIndent) {
    const items = [];
    let index = start;
    while (index < lines.length) {
        const line = lines[index] ?? '';
        if (isBlank(line)) {
            index += 1;
            continue;
        }
        if (indentOf(line) < listIndent)
            break;
        const content = line.trim();
        if (!content.startsWith('- ') && content !== '-')
            break;
        const inline = content.slice(1).trim();
        if (inline.length === 0) {
            const nested = parseNested(lines, index + 1, listIndent);
            items.push(nested.value);
            index = nested.next;
            continue;
        }
        const separator = inline.indexOf(':');
        if (separator > 0 && /^[A-Za-z0-9_.-]+$/.test(inline.slice(0, separator).trim())) {
            const entry = {};
            const key = inline.slice(0, separator).trim();
            const rest = inline.slice(separator + 1).trim();
            entry[key] = rest.length > 0 ? parseScalar(rest) : null;
            index += 1;
            const continuation = parseMapping(lines, index);
            index = skipBlock(lines, index, listIndent);
            items.push({ ...entry, ...continuation });
            continue;
        }
        items.push(parseScalar(inline));
        index += 1;
    }
    return { value: items, next: index };
}
/** Advance past every line that belongs to a nested block. */
function skipBlock(lines, start, parentIndent) {
    let index = start;
    while (index < lines.length) {
        const line = lines[index] ?? '';
        if (isBlank(line)) {
            index += 1;
            continue;
        }
        if (indentOf(line) <= parentIndent)
            break;
        index += 1;
    }
    return index;
}
/** Collect a `|` or `>` block scalar body. */
function parseBlockScalar(lines, start, parentIndent, folded, strip) {
    const collected = [];
    let index = start;
    let bodyIndent = -1;
    while (index < lines.length) {
        const line = lines[index] ?? '';
        if (line.trim().length === 0) {
            collected.push('');
            index += 1;
            continue;
        }
        const indent = indentOf(line);
        if (indent <= parentIndent)
            break;
        if (bodyIndent < 0)
            bodyIndent = indent;
        collected.push(line.slice(Math.min(bodyIndent, line.length)));
        index += 1;
    }
    while (collected.length > 0 && (collected[collected.length - 1] ?? '').trim().length === 0)
        collected.pop();
    const text = folded ? foldLines(collected) : collected.join('\n');
    return { value: strip ? text : `${text}\n`, next: index };
}
/** Fold block-scalar lines the way `>` does: single breaks become spaces. */
function foldLines(lines) {
    let result = '';
    for (const line of lines) {
        if (line.trim().length === 0)
            result += '\n';
        else
            result += result.length === 0 || result.endsWith('\n') ? line : ` ${line}`;
    }
    return result;
}
/** Parse an inline scalar: quoted string, list, boolean, number, or plain text. */
function parseScalar(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        const inner = trimmed.slice(1, -1).trim();
        if (inner.length === 0)
            return [];
        return inner.split(',').map(item => parseScalar(item));
    }
    if (trimmed.startsWith('"') || trimmed.startsWith("'"))
        return unquote(trimmed);
    if (trimmed === 'true')
        return true;
    if (trimmed === 'false')
        return false;
    if (trimmed === 'null' || trimmed === '~')
        return null;
    if (/^[+-]?\d+$/.test(trimmed))
        return Number(trimmed);
    return trimmed;
}
/** Strip matching surrounding quotes and unescape the double-quoted form. */
function unquote(text) {
    if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
        return text.slice(1, -1).replace(/\\(["\\nrt])/g, (_match, escaped) => {
            switch (escaped) {
                case 'n': return '\n';
                case 'r': return '\r';
                case 't': return '\t';
                default: return escaped;
            }
        });
    }
    if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
        return text.slice(1, -1).replaceAll("''", "'");
    }
    return text;
}
