/**
 * Model-facing tools for scanning and importing external tool configuration.
 *
 * Importing is preview-first: a scan never connects to anything, and the MCP
 * import tool does nothing until its caller passes `apply: true`. Credentials
 * are redacted in every result, because tool results are durable transcript
 * content.
 *
 * @module dsh-external-import/tools
 */
import { isAbsolute } from 'node:path';
import { runDiscovery } from "./discovery.js";
import { maskUrl } from "./mcp/mask.js";
import { EXTERNAL_SOURCE_IDS } from "./types.js";
/**
 * Register the model-facing tools on the plugin context.
 * @param deps - context, configuration, and the live import state.
 */
export function registerTools(deps) {
    const { ctx } = deps;
    ctx.tools.register(scanTool(deps));
    ctx.tools.register(importTool(deps));
    ctx.tools.register(unmountTool(deps));
    ctx.tools.register(statusTool(deps));
}
/** Build the read-only discovery tool. */
function scanTool(deps) {
    return {
        name: 'external_scan',
        description: [
            'List the MCP servers and skills that other agent tools on this machine already have configured.',
            'Reads Claude Code, Codex CLI, Cursor, Trae, VS Code and the shared ~/.agents directory, plus project-level configuration for the working directory.',
            'Read-only: nothing is connected or imported. Credential values are redacted.',
        ].join(' '),
        parameters: {
            type: 'object',
            properties: {
                sources: sourceListSchema(),
                cwd: { type: 'string', description: 'Working directory whose project-level configuration is scanned; defaults to the session working directory.' },
                includeProjects: { type: 'boolean', description: 'Whether project-level configuration is scanned at all; defaults to true.' },
                includeMcp: { type: 'boolean', description: 'Whether MCP servers are listed; defaults to true.' },
                includeSkills: { type: 'boolean', description: 'Whether skills are listed; defaults to true.' },
                refresh: { type: 'boolean', description: 'Whether to discard the cached skill scan before listing.' },
            },
            additionalProperties: false,
        },
        output: {
            schema: scanSchema(),
            render: (_args, value) => [{ type: 'text', text: renderScan(value) }],
        },
        async execute(rawArgs, exec) {
            const args = rawArgs;
            throwIfAborted(exec.signal);
            if (args.refresh === true)
                deps.skills?.invalidate();
            const report = await discover(deps, args, args.includeMcp !== false, args.includeSkills !== false);
            return toScanResult(report, deps.mounts.list().map(entry => entry.rawName));
        },
    };
}
/** Build the preview-and-import tool for MCP servers. */
function importTool(deps) {
    return {
        name: 'external_mcp_import',
        description: [
            'Import MCP servers that another agent tool already configured into this DeepSeek Harness session, so their tools become usable here.',
            'Without apply:true this only previews what would be connected; call it that way first and show the preview to the user.',
            'With apply:true each server is connected and verified, and its tools appear under mcp__<serverName>__<tool>. Already connected servers are left alone.',
        ].join(' '),
        parameters: {
            type: 'object',
            properties: {
                sources: sourceListSchema(),
                cwd: { type: 'string', description: 'Working directory whose project-level configuration is scanned.' },
                includeProjects: { type: 'boolean', description: 'Whether project-level configuration is scanned at all; defaults to true.' },
                servers: { type: 'array', items: { type: 'string' }, description: 'Import only these server names, as the external tool spells them; defaults to every discovered server.' },
                apply: { type: 'boolean', description: 'Actually connect the servers; defaults to false, which only previews.' },
                serverNamePrefix: { type: 'string', description: 'Prefix for the generated mcp__<name>__ tool namespace.' },
            },
            additionalProperties: false,
        },
        output: {
            schema: importSchema(),
            render: (_args, value) => [{ type: 'text', text: renderImport(value) }],
        },
        async execute(rawArgs, exec) {
            const args = rawArgs;
            throwIfAborted(exec.signal);
            const report = await discover(deps, args, true, false);
            const selected = selectServers(report.servers, args.servers);
            const prefix = args.serverNamePrefix ?? deps.config.serverNamePrefix;
            const planned = [];
            const mounted = [];
            for (const candidate of selected) {
                throwIfAborted(exec.signal);
                const serverName = deps.mounts.reserveName(candidate.spec.rawName, prefix);
                planned.push({ serverName, rawName: candidate.spec.rawName, source: candidate.source, origin: candidate.origin, transport: candidate.spec.transport });
                if (args.apply !== true)
                    continue;
                const outcome = await deps.mounts.mount(candidate, serverName);
                mounted.push({
                    serverName: outcome.serverName,
                    rawName: outcome.rawName,
                    source: outcome.source,
                    mounted: outcome.mounted,
                    detail: outcome.detail ?? '',
                });
            }
            return {
                applied: args.apply === true,
                planned,
                mounted,
                missing: (args.servers ?? []).filter(name => !selected.some(candidate => candidate.spec.rawName === name)),
                problems: report.problems.map(toProblemResult),
            };
        },
    };
}
/** Build the tool that disconnects an imported server. */
function unmountTool(deps) {
    return {
        name: 'external_mcp_unmount',
        description: 'Disconnect an MCP server that was imported by external_mcp_import, removing its tools from this session.',
        parameters: {
            type: 'object',
            properties: {
                serverName: { type: 'string', description: 'Namespace returned by external_mcp_import, such as mcp__github__ uses "github".' },
                all: { type: 'boolean', description: 'Disconnect every imported server instead of one.' },
            },
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    removed: { type: 'array', items: { type: 'string' } },
                    remaining: { type: 'array', items: { type: 'string' } },
                },
                required: ['removed', 'remaining'],
                additionalProperties: false,
            },
            render: (_args, value) => {
                const result = value;
                const text = result.removed.length === 0
                    ? 'No imported MCP server matched.'
                    : `Disconnected: ${result.removed.join(', ')}.`;
                return [{ type: 'text', text: `${text}${result.remaining.length === 0 ? '' : ` Still connected: ${result.remaining.join(', ')}.`}` }];
            },
        },
        async execute(rawArgs) {
            const args = rawArgs;
            const removed = [];
            if (args.all === true) {
                for (const entry of deps.mounts.list())
                    removed.push(entry.serverName);
                await deps.mounts.disposeAll();
            }
            else if (typeof args.serverName === 'string' && args.serverName.length > 0) {
                if (await deps.mounts.unmount(args.serverName))
                    removed.push(args.serverName);
            }
            return { removed, remaining: deps.mounts.list().map(entry => entry.serverName) };
        },
    };
}
/** Build the tool that reports what is currently imported. */
function statusTool(deps) {
    return {
        name: 'external_mcp_status',
        description: 'List the MCP servers imported into this session by external_mcp_import, with the namespace their tools use.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        output: {
            schema: {
                type: 'object',
                properties: {
                    servers: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                serverName: { type: 'string' },
                                rawName: { type: 'string' },
                                source: { type: 'string' },
                                origin: { type: 'string' },
                                transport: { type: 'string' },
                                toolPrefix: { type: 'string' },
                            },
                            required: ['serverName', 'rawName', 'source', 'origin', 'transport', 'toolPrefix'],
                            additionalProperties: false,
                        },
                    },
                },
                required: ['servers'],
                additionalProperties: false,
            },
            render: (_args, value) => {
                const servers = value.servers;
                const text = servers.length === 0
                    ? 'No MCP server has been imported in this session.'
                    : servers.map(server => `${server.serverName} (tools: ${server.toolPrefix})`).join('\n');
                return [{ type: 'text', text }];
            },
        },
        execute() {
            return Promise.resolve({
                servers: deps.mounts.list().map(entry => ({
                    serverName: entry.serverName,
                    rawName: entry.rawName,
                    source: entry.source,
                    origin: entry.origin,
                    transport: entry.transport,
                    toolPrefix: `mcp__${entry.serverName}__`,
                })),
            });
        },
    };
}
/** Run discovery with the arguments a tool received. */
async function discover(deps, args, wantMcp, wantSkills) {
    const sources = resolveSources(args.sources);
    const cwd = resolveCwd(args.cwd, deps.config);
    return await runDiscovery({
        sources,
        cwd: args.includeProjects === false ? undefined : cwd,
        frontmatterBytes: deps.config.frontmatterBytes,
        want: { mcp: wantMcp, skills: wantSkills },
    });
}
/** Validate the optional source list a tool received. */
function resolveSources(value) {
    if (value === undefined)
        return [];
    const supported = new Set(EXTERNAL_SOURCE_IDS);
    const selected = [];
    for (const entry of value) {
        if (typeof entry !== 'string' || !supported.has(entry)) {
            throw new Error(`unknown source "${String(entry)}"; supported sources are ${EXTERNAL_SOURCE_IDS.join(', ')}`);
        }
        selected.push(entry);
    }
    return selected;
}
/** Resolve the working directory a tool asked about. */
function resolveCwd(value, config) {
    if (value === undefined || value.length === 0)
        return config.projectCwd;
    if (!isAbsolute(value))
        throw new Error(`cwd must be an absolute path, received "${value}"`);
    return value;
}
/** Keep only the servers the caller named, if any. */
function selectServers(servers, wanted) {
    if (wanted === undefined || wanted.length === 0)
        return servers;
    const names = new Set(wanted);
    return servers.filter(candidate => names.has(candidate.spec.rawName));
}
/** Project the discovery report onto the scan tool's canonical value. */
function toScanResult(report, importedNames) {
    const imported = new Set(importedNames);
    return prune({
        scanned: [...report.scannedFiles],
        servers: report.servers.map(candidate => ({
            rawName: candidate.spec.rawName,
            source: candidate.source,
            scope: candidate.scope,
            origin: candidate.origin,
            transport: candidate.spec.transport,
            summary: summarize(candidate),
            envKeys: Object.keys(candidate.spec.env).sort(),
            headerKeys: Object.keys(candidate.spec.headers).sort(),
            alreadyMounted: imported.has(candidate.spec.rawName),
        })),
        serverProblems: report.problems.map(toProblemResult),
        skills: report.skills.map(skill => ({
            name: skill.name,
            source: skill.source,
            scope: skill.scope,
            dir: skill.dir,
            modelInvocable: skill.invocation.modelInvocable,
            description: skill.description,
        })),
        skillProblems: report.skillProblems.map(toSkillProblemResult),
        importedSkillCount: report.skills.length,
    });
}
/** Describe one server without revealing its credentials. */
function summarize(candidate) {
    const spec = candidate.spec;
    if (spec.transport === 'http')
        return `http ${maskUrl(spec.url ?? '')}`;
    const envKeys = Object.keys(spec.env).sort();
    const envNote = envKeys.length === 0 ? '' : ` (env keys: ${envKeys.join(', ')})`;
    return `stdio ${spec.command ?? ''} ${spec.args.join(' ')}${envNote}`.trim();
}
/** Project one MCP problem onto the tool result vocabulary. */
function toProblemResult(problem) {
    return { rawName: problem.rawName, source: problem.source, origin: problem.origin, reason: problem.reason, detail: problem.detail };
}
/** Project one skill problem onto the tool result vocabulary. */
function toSkillProblemResult(problem) {
    return { rawName: problem.dir, source: problem.source, origin: problem.dir, reason: problem.reason, detail: problem.detail };
}
/** Render a scan result as model-facing text. */
function renderScan(result) {
    const lines = [];
    lines.push(`Scanned ${result.scanned.length} configuration location(s); found ${result.servers.length} MCP server(s) and ${result.skills.length} skill(s).`);
    if (result.servers.length > 0) {
        lines.push('', 'MCP servers:');
        for (const server of result.servers) {
            lines.push(`- ${server.rawName} [${server.source}, ${server.scope}] ${server.summary}`);
        }
    }
    if (result.serverProblems.length > 0) {
        lines.push('', 'Skipped MCP entries:');
        for (const problem of result.serverProblems)
            lines.push(`- ${problem.rawName} (${problem.reason}): ${problem.detail}`);
    }
    if (result.skills.length > 0) {
        lines.push('', 'Skills:');
        for (const skill of result.skills.slice(0, 60)) {
            lines.push(`- ${skill.name} [${skill.source}${skill.modelInvocable ? '' : ', user-only'}]`);
        }
        if (result.skills.length > 60)
            lines.push(`- ... and ${result.skills.length - 60} more`);
    }
    if (result.skillProblems.length > 0) {
        lines.push('', `Skipped skill directories: ${result.skillProblems.length} (duplicates and invalid frontmatter are excluded).`);
    }
    return lines.join('\n');
}
/** Render an import result as model-facing text. */
function renderImport(result) {
    const lines = [];
    if (result.planned.length === 0) {
        lines.push('No MCP server matched the request.');
    }
    else if (!result.applied) {
        lines.push(`Preview: ${result.planned.length} server(s) can be imported. Call again with apply:true to connect them.`);
        for (const server of result.planned)
            lines.push(`- ${server.rawName} -> mcp__${server.serverName}__ [${server.source}]`);
    }
    else {
        const ok = result.mounted.filter(entry => entry.mounted);
        const failed = result.mounted.filter(entry => !entry.mounted);
        lines.push(`Connected ${ok.length} of ${result.mounted.length} server(s).`);
        for (const server of ok)
            lines.push(`- ${server.rawName}: tools available as mcp__${server.serverName}__*`);
        for (const server of failed)
            lines.push(`- ${server.rawName}: failed (${server.detail})`);
    }
    if (result.missing.length > 0)
        lines.push(`Not found in any scanned configuration: ${result.missing.join(', ')}.`);
    if (result.problems.length > 0) {
        lines.push(`Skipped ${result.problems.length} unusable entr(y/ies); see the result value for reasons.`);
    }
    return lines.join('\n');
}
/** JSON Schema fragment listing the supported source identifiers. */
function sourceListSchema() {
    return {
        type: 'array',
        items: { type: 'string', enum: [...EXTERNAL_SOURCE_IDS] },
        description: 'External tools to scan; defaults to every supported tool.',
    };
}
/** Output schema of the scan tool. */
function scanSchema() {
    return {
        type: 'object',
        properties: {
            scanned: { type: 'array', items: { type: 'string' } },
            servers: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        rawName: { type: 'string' },
                        source: { type: 'string' },
                        scope: { type: 'string' },
                        origin: { type: 'string' },
                        transport: { type: 'string' },
                        summary: { type: 'string' },
                        envKeys: { type: 'array', items: { type: 'string' } },
                        headerKeys: { type: 'array', items: { type: 'string' } },
                        alreadyMounted: { type: 'boolean' },
                    },
                    required: ['rawName', 'source', 'scope', 'origin', 'transport', 'summary', 'envKeys', 'headerKeys', 'alreadyMounted'],
                    additionalProperties: false,
                },
            },
            serverProblems: { type: 'array', items: problemSchema() },
            skills: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        source: { type: 'string' },
                        scope: { type: 'string' },
                        dir: { type: 'string' },
                        modelInvocable: { type: 'boolean' },
                        description: { type: 'string' },
                    },
                    required: ['name', 'source', 'scope', 'dir', 'modelInvocable', 'description'],
                    additionalProperties: false,
                },
            },
            skillProblems: { type: 'array', items: problemSchema() },
            importedSkillCount: { type: 'number' },
        },
        required: ['scanned', 'servers', 'serverProblems', 'skills', 'skillProblems', 'importedSkillCount'],
        additionalProperties: false,
    };
}
/** Output schema of the import tool. */
function importSchema() {
    return {
        type: 'object',
        properties: {
            applied: { type: 'boolean' },
            planned: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        serverName: { type: 'string' },
                        rawName: { type: 'string' },
                        source: { type: 'string' },
                        origin: { type: 'string' },
                        transport: { type: 'string' },
                    },
                    required: ['serverName', 'rawName', 'source', 'origin', 'transport'],
                    additionalProperties: false,
                },
            },
            mounted: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        serverName: { type: 'string' },
                        rawName: { type: 'string' },
                        source: { type: 'string' },
                        mounted: { type: 'boolean' },
                        detail: { type: 'string' },
                    },
                    required: ['serverName', 'rawName', 'source', 'mounted', 'detail'],
                    additionalProperties: false,
                },
            },
            missing: { type: 'array', items: { type: 'string' } },
            problems: { type: 'array', items: problemSchema() },
        },
        required: ['applied', 'planned', 'mounted', 'missing', 'problems'],
        additionalProperties: false,
    };
}
/** Shared schema for one skipped configuration entry. */
function problemSchema() {
    return {
        type: 'object',
        properties: {
            rawName: { type: 'string' },
            source: { type: 'string' },
            origin: { type: 'string' },
            reason: { type: 'string' },
            detail: { type: 'string' },
        },
        required: ['rawName', 'source', 'origin', 'reason', 'detail'],
        additionalProperties: false,
    };
}
/** Remove `undefined` members so the value is lossless JSON. */
function prune(value) {
    if (Array.isArray(value))
        return value.map(item => prune(item));
    if (typeof value !== 'object' || value === null)
        return value;
    const result = {};
    for (const [key, item] of Object.entries(value)) {
        if (item === undefined)
            continue;
        result[key] = prune(item);
    }
    return result;
}
/** Stop before doing work the caller cancelled. */
function throwIfAborted(signal) {
    if (signal.aborted)
        throw new Error('external-import: cancelled');
}
