/**
 * Tolerant filesystem access for reading other tools' configuration.
 *
 * Every file this plugin reads belongs to another application, so absence,
 * truncation, or unparseable content is ordinary rather than exceptional. Each
 * helper reports that outcome as `undefined` and leaves the caller to record a
 * problem; none of them throws for a missing or damaged file.
 *
 * @module dsh-external-import/parse/read
 */
import { open, readdir, readFile, realpath, stat } from 'node:fs/promises';
/**
 * Read the beginning of a UTF-8 text file.
 *
 * Skill instructions can be large, and discovery only needs the frontmatter,
 * so a scan reads a bounded prefix and the body is read when the skill is
 * actually loaded.
 * @param path - absolute file path.
 * @param maxBytes - maximum number of leading bytes to read.
 * @returns the decoded prefix, or `undefined` when the file cannot be read.
 */
export async function readTextPrefix(path, maxBytes) {
    let handle;
    try {
        handle = await open(path, 'r');
    }
    catch {
        return undefined;
    }
    try {
        const buffer = Buffer.alloc(maxBytes);
        const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
        return buffer.subarray(0, bytesRead).toString('utf8');
    }
    catch {
        return undefined;
    }
    finally {
        await handle.close().catch(() => undefined);
    }
}
/**
 * Read a UTF-8 text file.
 * @param path - absolute file path.
 * @returns the file text, or `undefined` when it cannot be read.
 */
export async function readTextFile(path) {
    try {
        return await readFile(path, 'utf8');
    }
    catch {
        return undefined;
    }
}
/**
 * Read a JSON file into an object.
 * @param path - absolute file path.
 * @returns the parsed object, or `undefined` for a missing, empty, or invalid file.
 */
export async function readJsonObject(path) {
    const text = await readTextFile(path);
    if (text === undefined)
        return undefined;
    const trimmed = text.trim();
    if (trimmed.length === 0)
        return undefined;
    try {
        const parsed = JSON.parse(trimmed);
        return isRecord(parsed) ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * List a directory without failing on absence.
 * @param path - absolute directory path.
 * @returns its entries, or an empty array when it cannot be listed.
 */
export async function listDirectory(path) {
    try {
        return await readdir(path, { withFileTypes: true });
    }
    catch {
        return [];
    }
}
/**
 * Resolve a path to its real location, collapsing symbolic links and junctions.
 * @param path - absolute path.
 * @returns the resolved path, or the input when resolution fails.
 */
export async function resolveRealPath(path) {
    try {
        return await realpath(path);
    }
    catch {
        return path;
    }
}
/**
 * Report whether a path exists as a directory.
 * @param path - absolute path.
 * @returns whether a directory (or a link to one) is present.
 */
export async function isDirectory(path) {
    try {
        return (await stat(path)).isDirectory();
    }
    catch {
        return false;
    }
}
/** Whether a parsed JSON value is a plain object. */
export function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
