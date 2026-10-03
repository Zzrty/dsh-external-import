/**
 * Runtime mounting of imported MCP servers.
 *
 * Each imported server becomes one `@deepseek-ai/dsh-mcp-client` plugin
 * instance, mounted as a child of this plugin so Cordis unwinds it with the
 * import. The bridge is loaded by module specifier rather than imported
 * statically: an installation without the bridge still gets the skill half of
 * this plugin, and the operator can point the import at their own copy.
 *
 * @module dsh-external-import/mcp/manager
 */
var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
import { toServerName } from "./naming.js";
/** Owns the live MCP child plugins and the namespace reservations they use. */
export class McpMountRegistry {
    ctx;
    config;
    mounts = new Map();
    reserved = new Set();
    client;
    /**
     * @param ctx - the plugin context that owns every mounted child.
     * @param config - resolved plugin configuration.
     */
    constructor(ctx, config) {
        this.ctx = ctx;
        this.config = config;
    }
    /** Servers currently mounted, in mount order. */
    list() {
        return [...this.mounts.values()];
    }
    /**
     * Reserve a namespace for one external server.
     * @param rawName - name the external tool used.
     * @param prefix - prefix for this reservation; omission uses the configured prefix.
     * @returns a namespace matching the bridge grammar and unused in this plugin.
     */
    reserveName(rawName, prefix = this.config.serverNamePrefix) {
        return toServerName(rawName, prefix, this.reserved);
    }
    /**
     * Release a namespace reserved by {@link reserveName} whose mount did not happen.
     * @param serverName - the reserved namespace.
     */
    releaseName(serverName) {
        this.reserved.delete(serverName);
    }
    /**
     * Mount one server as a child MCP client plugin.
     * @param candidate - discovered server to connect.
     * @param serverName - namespace previously reserved for this server.
     * @returns whether the connection was established, with the failure detail.
     */
    async mount(candidate, serverName) {
        const outcome = (mounted, detail) => ({
            serverName,
            rawName: candidate.spec.rawName,
            source: candidate.source,
            mounted,
            detail,
        });
        if (this.mounts.has(serverName))
            return outcome(false, `namespace "${serverName}" is already mounted`);
        let client;
        let launch;
        try {
            client = await this.loadClient();
            launch = client.Config(buildLaunchConfig(candidate, serverName, this.config));
        }
        catch (error) {
            return outcome(false, describeError(error));
        }
        let fiber;
        try {
            fiber = this.ctx.plugin(client, launch);
        }
        catch (error) {
            return outcome(false, describeError(error));
        }
        try {
            // The bridge reports a failed initial connection by rejecting this
            // promise only while `failOnStartupError` is set, which `launchConfig`
            // does when verification is requested.
            await fiber;
        }
        catch (error) {
            await fiber.dispose().catch(() => undefined);
            return outcome(false, describeError(error));
        }
        this.mounts.set(serverName, {
            serverName,
            rawName: candidate.spec.rawName,
            source: candidate.source,
            origin: candidate.origin,
            transport: candidate.spec.transport,
            fiber,
        });
        return outcome(true, undefined);
    }
    /**
     * Disconnect one mounted server and release its namespace.
     * @param serverName - namespace returned when the server was mounted.
     * @returns whether a mounted server was found and disposed.
     */
    async unmount(serverName) {
        const mounted = this.mounts.get(serverName);
        if (mounted === undefined)
            return false;
        this.mounts.delete(serverName);
        this.reserved.delete(serverName);
        await mounted.fiber.dispose().catch(() => undefined);
        return true;
    }
    /** Disconnect every mounted server; used when the plugin unloads. */
    async disposeAll() {
        const mounted = [...this.mounts.values()];
        this.mounts.clear();
        this.reserved.clear();
        await Promise.allSettled(mounted.map(entry => entry.fiber.dispose()));
    }
    /** Load and cache the MCP client bridge module. */
    async loadClient() {
        if (this.client !== undefined)
            return this.client;
        const specifier = this.config.mcpClientModule;
        let imported;
        try {
            imported = await import(__rewriteRelativeImportExtension(specifier));
        }
        catch (error) {
            throw new Error(`external-import: cannot load the MCP client bridge "${specifier}" (${describeError(error)}); set config.mcpClientModule to the module that provides it`);
        }
        if (typeof imported.Config !== 'function' || typeof imported.apply !== 'function') {
            throw new Error(`external-import: "${specifier}" is not an MCP client bridge module (it must export "apply" and the "Config" schema)`);
        }
        this.client = imported;
        return imported;
    }
}
/** Render an unknown failure as one sentence. */
function describeError(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
/**
 * Translate one discovered server into an MCP client bridge configuration.
 *
 * Exported because it is the whole compatibility surface between a foreign
 * configuration file and the bridge: a caller can validate the result against
 * the bridge's own `Config` schema without connecting anything.
 * @param candidate - discovered server.
 * @param serverName - namespace previously reserved for it.
 * @param config - resolved plugin configuration.
 * @returns the bridge configuration object for this server.
 */
export function buildLaunchConfig(candidate, serverName, config) {
    const spec = candidate.spec;
    const shared = {
        serverName,
        failOnStartupError: config.verifyOnMount,
        ...config.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: config.toolCallTimeoutMs },
    };
    if (spec.transport === 'http') {
        return { ...shared, transport: 'streamable-http', url: spec.url ?? '', headers: { ...spec.headers } };
    }
    return {
        ...shared,
        transport: 'stdio',
        command: spec.command ?? '',
        args: [...spec.args],
        env: { ...spec.env },
        ...spec.cwd === undefined ? {} : { cwd: spec.cwd },
    };
}
