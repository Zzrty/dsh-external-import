/**
 * Mapping of external server names onto the MCP client's namespace grammar.
 *
 * The bridge accepts `[A-Za-z0-9_-]{1,32}` and keeps one reservation per name
 * in a scope. Foreign configuration uses names with dots, spaces, non-ASCII
 * characters, and occasional 60-character identifiers, so a mapping is needed.
 * The mapping is deterministic: the same raw name always yields the same
 * server name, and a lossy conversion appends a hash so two raw names can never
 * collapse into one namespace.
 *
 * @module dsh-external-import/mcp/naming
 */
import { createHash } from 'node:crypto';
/** Namespace grammar the MCP client accepts. */
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/;
/** Maximum accepted length of a server name. */
const MAX_LENGTH = 32;
/** Length of the disambiguating hash appended to a lossy conversion. */
const HASH_LENGTH = 8;
/** Characters a converted name keeps for its own body after the prefix. */
const MIN_BODY_LENGTH = 10;
/**
 * Convert a foreign server name into a valid, unique MCP server namespace.
 * @param rawName - name as the external tool spells it.
 * @param prefix - namespace prefix applied before the converted name.
 * @param used - names already reserved by this plugin; the chosen name is added.
 * @returns a name matching the MCP client grammar and not already in `used`.
 */
export function toServerName(rawName, prefix, used) {
    const safePrefix = sanitize(prefix).slice(0, MAX_LENGTH - MIN_BODY_LENGTH).replace(/-+$/, '');
    const head = safePrefix.length > 0 ? `${safePrefix}-` : '';
    const body = sanitize(rawName) || 'server';
    const hash = digest(rawName);
    // Dropping leading or trailing separators is cosmetic, so it keeps the
    // readable name; dropping interior characters, or truncating, appends a
    // digest of the original name so two raw names never share one namespace.
    const cosmetic = rawName.replace(/^[-_]+/, '').replace(/[-_]+$/, '');
    const truncated = head.length + body.length > MAX_LENGTH;
    let candidate = truncated || body !== cosmetic
        ? `${head}${body.slice(0, Math.max(1, MAX_LENGTH - head.length - hash.length - 1))}-${hash}`
        : `${head}${body}`;
    if (!SERVER_NAME.test(candidate)) {
        candidate = `${head}server-${hash}`.slice(0, MAX_LENGTH).replace(/-+$/, '');
    }
    let suffix = 2;
    while (used.has(candidate)) {
        const tag = `-${suffix}`;
        candidate = `${head}${body.slice(0, Math.max(1, MAX_LENGTH - head.length - tag.length))}${tag}`;
        suffix += 1;
    }
    used.add(candidate);
    return candidate;
}
/** Replace characters outside the namespace grammar and collapse separators. */
function sanitize(value) {
    return value
        .replace(/[^A-Za-z0-9_-]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^[-_]+/, '')
        .replace(/-+$/, '');
}
/** Deterministic 8-hex-character digest of a raw name. */
function digest(value) {
    return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, HASH_LENGTH);
}
