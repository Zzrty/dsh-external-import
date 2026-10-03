/**
 * Import skills and MCP servers that other agent tools already configured.
 *
 * The plugin contributes four things: a read-only skill provider over the skill
 * directories of Claude Code, Codex, Cursor, Trae and the shared `.agents`
 * store; model-facing tools that preview and connect the MCP servers those
 * tools declare; a management route plus settings page that let the user see and
 * switch what is imported; and one scoped prompt section per session for
 * instructions the user types for that session alone.
 *
 * Nothing is written to another tool's files, and no connection is opened until
 * a caller asks for one.
 *
 * @module dsh-external-import
 */
import { installManagementApi } from "./api.js";
import { resolveConfig } from "./config.js";
import { runDiscovery } from "./discovery.js";
import { McpMountRegistry } from "./mcp/manager.js";
import { installSessionPrompts } from "./session-prompt.js";
import { ExternalSkillProvider } from "./skills/provider.js";
import { StateStore } from "./state.js";
import { registerTools } from "./tools.js";
/** Cordis plugin name used by loader diagnostics. */
export const name = 'external-import';
/** Services required by this plugin. */
export const inject = ['tools'];
/**
 * Register the skill provider, the model-facing tools, the management
 * interface, per-session instructions, and any configured automatic import.
 * @param ctx - plugin context carrying the tool registry.
 * @param config - raw plugin configuration from `cordis.patch.yml`.
 * @returns activation work: reading the persisted management state.
 */
export async function apply(ctx, config) {
    const resolved = resolveConfig(config);
    const store = await StateStore.open(resolved.statePath, ctx.logger);
    const mounts = new McpMountRegistry(ctx, resolved);
    const skills = resolved.importSkills ? new ExternalSkillProvider(resolved, ctx.logger, store) : undefined;
    if (skills !== undefined)
        registerSkillProvider(ctx, skills);
    // Child MCP fibers are effects of this fiber and unwind with it; this effect
    // only makes the teardown explicit and releases the namespace reservations.
    ctx.effect(() => () => mounts.disposeAll(), 'external-import.mcp');
    if (resolved.registerTools)
        registerTools({ ctx, config: resolved, mounts, skills });
    if (resolved.managementApi)
        installManagementApi({ ctx, config: resolved, store, mounts, skills });
    installSessionPrompts(ctx, store);
    ctx.logger.info(`external-import: ready (sources: ${describeSources(resolved.sources)}${resolved.importSkills ? ', skills on' : ''}${resolved.registerTools ? ', tools on' : ''}${resolved.managementApi ? ', management on' : ''})`);
    if (resolved.autoMount.length > 0)
        startAutoMount(ctx, resolved, mounts);
}
/** Register the external skill provider once the skill registry is available. */
function registerSkillProvider(ctx, provider) {
    ctx.inject(['skills'], (scoped) => {
        scoped.skills.registerProvider((control) => {
            provider.bind(control);
            return provider;
        });
    });
}
/** Mount the servers named in `config.autoMount` without blocking activation. */
function startAutoMount(ctx, config, mounts) {
    const run = async () => {
        const report = await runDiscovery({
            sources: config.sources,
            cwd: config.includeProjectScope ? config.projectCwd : undefined,
            frontmatterBytes: config.frontmatterBytes,
            want: { mcp: true, skills: false },
        });
        const wanted = config.autoMount;
        const selected = wanted.includes('*') ? report.servers : report.servers.filter(server => wanted.includes(server.spec.rawName));
        for (const candidate of selected) {
            const serverName = mounts.reserveName(candidate.spec.rawName);
            const outcome = await mounts.mount(candidate, serverName);
            if (outcome.mounted)
                ctx.logger.info(`external-import: mounted ${candidate.spec.rawName} as mcp__${serverName}__*`);
            else
                ctx.logger.warn(`external-import: could not mount ${candidate.spec.rawName}: ${outcome.detail ?? 'unknown failure'}`);
        }
        const missing = wanted.filter(entry => entry !== '*' && !selected.some(server => server.spec.rawName === entry));
        if (missing.length > 0)
            ctx.logger.warn(`external-import: autoMount names not found: ${missing.join(', ')}`);
    };
    void run().catch((error) => {
        ctx.logger.warn(`external-import: automatic import failed: ${error instanceof Error ? error.message : String(error)}`);
    });
}
/** Render the configured source list for the activation log line. */
function describeSources(sources) {
    return sources.length === 0 ? 'all' : sources.join(', ');
}
