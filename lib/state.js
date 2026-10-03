/**
 * Durable management state for imported skills, sources, and session prompts.
 *
 * The state is a small JSON document under the Harness home. It is written
 * atomically and read once at activation, so a hand edit or a partial write can
 * never leave the plugin with half a configuration: an unreadable document is
 * reported and replaced by defaults rather than crashing the profile.
 *
 * @module dsh-external-import/state
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
/** Schema version of the persisted document. */
const STATE_VERSION = 1;
/** State used before anything is stored, and whenever the document is unusable. */
export function defaultState() {
    return { version: STATE_VERSION, disabledSources: [], disabledSkills: [], sessionPrompts: {} };
}
/** Read/write handle over one state document. */
export class StateStore {
    path;
    logger;
    state;
    /** Serializes writers so two mutations cannot interleave their file writes. */
    writing = Promise.resolve();
    constructor(path, state, logger) {
        this.path = path;
        this.logger = logger;
        this.state = state;
    }
    /**
     * Read the document at `path`, falling back to defaults when it is absent or unusable.
     * @param path - absolute path of the state document.
     * @param logger - logger for an unreadable document.
     * @returns a store holding the current state.
     */
    static async open(path, logger) {
        const store = new StateStore(path, defaultState(), logger);
        await store.reload();
        return store;
    }
    /** The current state; callers treat it as readonly. */
    current() {
        return this.state;
    }
    /**
     * Apply one change and persist it.
     * @param mutate - pure function producing the next state from the current one.
     * @returns the persisted state.
     */
    async mutate(mutate) {
        const next = { ...mutate(this.state), version: STATE_VERSION };
        this.state = next;
        const write = this.writing.then(() => this.persist(next));
        this.writing = write.catch(() => undefined);
        await write;
        return next;
    }
    /** Re-read the document from disk. */
    async reload() {
        let text;
        try {
            text = await readFile(this.path, 'utf8');
        }
        catch {
            this.state = defaultState();
            return;
        }
        try {
            this.state = parseState(JSON.parse(text));
        }
        catch (error) {
            this.logger.warn(`external-import: ignoring unreadable state at ${this.path}: ${String(error)}`);
            this.state = defaultState();
        }
    }
    /** Write one document through a temporary file so a reader never sees half of it. */
    async persist(state) {
        const temporary = `${this.path}.tmp`;
        await mkdir(dirname(this.path), { recursive: true });
        await writeFile(temporary, `${JSON.stringify(state, undefined, 2)}\n`, 'utf8');
        await rename(temporary, this.path);
    }
}
/** Validate one parsed document, filling defaults for anything absent. */
function parseState(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        throw new TypeError('state document is not an object');
    const record = value;
    if (record.version !== STATE_VERSION)
        throw new TypeError(`state document version ${String(record.version)} is not ${STATE_VERSION}`);
    return {
        version: STATE_VERSION,
        disabledSources: stringList(record.disabledSources),
        disabledSkills: stringList(record.disabledSkills),
        sessionPrompts: stringMap(record.sessionPrompts),
    };
}
/** Read an optional array of strings. */
function stringList(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value))
        throw new TypeError('expected an array of strings');
    return value.filter((item) => typeof item === 'string');
}
/** Read an optional record of strings. */
function stringMap(value) {
    if (value === undefined)
        return {};
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        throw new TypeError('expected an object of strings');
    const result = {};
    for (const [key, item] of Object.entries(value)) {
        if (typeof item === 'string')
            result[key] = item;
    }
    return result;
}
/**
 * Resolve the default state document path inside a Harness home.
 * @param home - absolute Harness home directory.
 * @returns the absolute path of the state document.
 */
export function defaultStatePath(home) {
    return `${home.replace(/[\\/]+$/, '')}/external-import/state.json`;
}
