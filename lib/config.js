/**
 * Plugin configuration.
 *
 * Every deployment-varying choice is a field here, so a profile can change it
 * from `cordis.patch.yml` without editing this package. The config is
 * validated at activation and fails loud: a mistyped field rejects the plugin
 * instead of silently falling back to a default the operator did not choose.
 *
 * @module dsh-external-import/config
 */
import { isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { EXTERNAL_SOURCE_IDS } from "./types.js";
import { defaultStatePath } from "./state.js";
/** Default byte budget for reading a skill's frontmatter during discovery. */
const DEFAULT_FRONTMATTER_BYTES = 16_384;
/** Default lifetime of one discovery result. */
const DEFAULT_SCAN_CACHE_TTL_MS = 3_000;
/**
 * Rank assigned to imported skills. Lower ranks win a duplicate name, so this
 * rank keeps every skill DeepSeek Harness itself provides ahead of an import.
 */
const DEFAULT_SKILL_RANK = 900;
/** Package name of the MCP client bridge this plugin mounts. */
const DEFAULT_MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client';
/**
 * Validate raw plugin configuration and apply defaults.
 * @param raw - configuration object from the plugin entry, or `undefined`.
 * @returns the fully defaulted configuration.
 * @throws Error naming the first field that is present with a wrong value.
 */
export function resolveConfig(raw) {
    const input = raw ?? {};
    const sources = resolveSources(input.sources);
    return {
        sources,
        includeProjectScope: booleanField(input.includeProjectScope, 'includeProjectScope', true),
        projectCwd: resolve(absolutePathField(input.projectCwd, 'projectCwd') ?? process.cwd()),
        mcpClientModule: stringField(input.mcpClientModule, 'mcpClientModule') ?? DEFAULT_MCP_CLIENT_MODULE,
        serverNamePrefix: stringField(input.serverNamePrefix, 'serverNamePrefix') ?? '',
        verifyOnMount: booleanField(input.verifyOnMount, 'verifyOnMount', true),
        toolCallTimeoutMs: positiveField(input.toolCallTimeoutMs, 'toolCallTimeoutMs'),
        autoMount: stringArrayField(input.autoMount, 'autoMount'),
        importSkills: booleanField(input.importSkills, 'importSkills', true),
        skillRank: numberField(input.skillRank, 'skillRank') ?? DEFAULT_SKILL_RANK,
        frontmatterBytes: positiveField(input.frontmatterBytes, 'frontmatterBytes') ?? DEFAULT_FRONTMATTER_BYTES,
        scanCacheTtlMs: positiveField(input.scanCacheTtlMs, 'scanCacheTtlMs') ?? DEFAULT_SCAN_CACHE_TTL_MS,
        registerTools: booleanField(input.registerTools, 'registerTools', true),
        statePath: resolve(absolutePathField(input.statePath, 'statePath') ?? defaultStatePath(resolveDshHome())),
        managementApi: booleanField(input.managementApi, 'managementApi', true),
    };
}
/** Harness home directory, honouring `DSH_HOME` the way the launcher does. */
function resolveDshHome() {
    const configured = process.env.DSH_HOME;
    return configured !== undefined && configured.trim().length > 0 ? configured.trim() : join(homedir(), '.dsh');
}
/** Validate the requested source list against the supported identifiers. */
function resolveSources(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value))
        throw new Error('external-import: config.sources must be an array of source identifiers');
    const supported = new Set(EXTERNAL_SOURCE_IDS);
    const selected = [];
    const seen = new Set();
    for (const entry of value) {
        if (typeof entry !== 'string' || !supported.has(entry)) {
            throw new Error(`external-import: config.sources contains "${String(entry)}"; supported values are ${EXTERNAL_SOURCE_IDS.join(', ')}`);
        }
        if (seen.has(entry))
            continue;
        seen.add(entry);
        selected.push(entry);
    }
    return selected;
}
/** Read an optional string field, rejecting other types. */
function stringField(value, field) {
    if (value === undefined)
        return undefined;
    if (typeof value !== 'string')
        throw new Error(`external-import: config.${field} must be a string`);
    return value;
}
/** Read an optional path field that must be absolute when present. */
function absolutePathField(value, field) {
    const text = stringField(value, field);
    if (text === undefined)
        return undefined;
    if (!isAbsolute(text))
        throw new Error(`external-import: config.${field} must be an absolute path`);
    return text;
}
/** Read an optional boolean field, rejecting other types. */
function booleanField(value, field, fallback) {
    if (value === undefined)
        return fallback;
    if (typeof value !== 'boolean')
        throw new Error(`external-import: config.${field} must be a boolean`);
    return value;
}
/** Read an optional finite number field. */
function numberField(value, field) {
    if (value === undefined)
        return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value))
        throw new Error(`external-import: config.${field} must be a finite number`);
    return value;
}
/** Read an optional positive number field. */
function positiveField(value, field) {
    const parsed = numberField(value, field);
    if (parsed === undefined)
        return undefined;
    if (parsed <= 0)
        throw new Error(`external-import: config.${field} must be greater than zero`);
    return parsed;
}
/** Read an optional array of strings. */
function stringArrayField(value, field) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value))
        throw new Error(`external-import: config.${field} must be an array of strings`);
    for (const entry of value) {
        if (typeof entry !== 'string')
            throw new Error(`external-import: config.${field} must be an array of strings`);
    }
    return value;
}
