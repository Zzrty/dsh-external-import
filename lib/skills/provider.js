/**
 * Skill provider over skill directories owned by other agent tools.
 *
 * The provider is read-only: it never writes to another tool's directory, and
 * it re-reads a skill body on every load so an edit made in the owning tool is
 * visible on the next model step without restarting the harness.
 *
 * @module dsh-external-import/skills/provider
 */
import { discoverSkills } from "../discover/skills.js";
import { parseFrontmatter } from "../parse/frontmatter.js";
import { readTextFile } from "../parse/read.js";
import { selectSources } from "../sources.js";
/** Provider name registered with the skill registry. */
export const EXTERNAL_SKILL_PROVIDER = 'external-import';
/** Serves skills discovered in other agent tools' directories. */
export class ExternalSkillProvider {
    config;
    logger;
    store;
    /** Provider name; must equal the name passed to the registry. */
    name = EXTERNAL_SKILL_PROVIDER;
    cache;
    control;
    lastProblems = 0;
    /**
     * @param config - resolved plugin configuration.
     * @param logger - plugin logger for scan diagnostics.
     * @param store - durable management state supplying the user's switches.
     */
    constructor(config, logger, store) {
        this.config = config;
        this.logger = logger;
        this.store = store;
    }
    /**
     * Attach the registration lifecycle control the registry hands to the provider factory.
     * @param control - lifecycle and invalidation control of this registration.
     */
    bind(control) {
        this.control = control;
    }
    /**
     * List skills found in the selected sources.
     * @param options - lookup options; `cwd` selects project-level skill roots.
     * @returns candidates the registry ranks and merges.
     */
    async list(options) {
        const discovery = await this.scan(options.cwd ?? this.config.projectCwd);
        const state = this.store.current();
        const disabledSources = new Set(state.disabledSources);
        const disabledSkills = new Set(state.disabledSkills);
        return discovery.skills
            .filter(skill => !disabledSources.has(skill.source) && !disabledSkills.has(skill.name))
            .map(skill => this.toCandidate(skill));
    }
    /**
     * Read one skill's full instruction body.
     * @param candidate - a candidate previously returned by {@link list}.
     * @param options - lookup options; unused because the locator is an absolute path.
     * @returns the loaded skill, or `undefined` when the file is gone or no longer valid.
     */
    async get(candidate, options) {
        void options;
        const ref = candidate.locator;
        if (!isSkillRef(ref))
            return undefined;
        const text = await readTextFile(ref.file);
        if (text === undefined)
            return undefined;
        const parsed = parseFrontmatter(text);
        if (parsed === undefined)
            return undefined;
        const description = typeof parsed.data.description === 'string' ? parsed.data.description.trim() : '';
        const name = typeof parsed.data.name === 'string' ? parsed.data.name : '';
        if (name !== ref.name || description.length === 0)
            return undefined;
        const whenToUse = typeof parsed.data.when_to_use === 'string'
            ? parsed.data.when_to_use.trim()
            : typeof parsed.data.whenToUse === 'string' ? parsed.data.whenToUse.trim() : undefined;
        return {
            name: ref.name,
            description,
            ...whenToUse === undefined ? {} : { whenToUse },
            invocation: ref.invocation,
            source: ref.source,
            provider: this.name,
            resourceBase: { kind: 'directory', path: ref.dir },
            path: ref.file,
            content: parsed.body,
        };
    }
    /** Drop the cached scan and ask the registry to re-read this provider's catalog. */
    invalidate() {
        this.cache = undefined;
        this.control?.invalidate();
    }
    /** Scan the selected sources, reusing a recent result for the same directory. */
    async scan(cwd) {
        const cached = this.cache;
        if (cached !== undefined && cached.cwd === cwd && Date.now() - cached.at < this.config.scanCacheTtlMs) {
            return cached.discovery;
        }
        const discovery = await discoverSkills(selectSources(this.config.sources), { cwd }, { frontmatterBytes: this.config.frontmatterBytes });
        this.reportProblems(discovery);
        this.cache = { cwd, at: Date.now(), discovery };
        return discovery;
    }
    /** Log skipped directories once per scan, so a bad skill file is diagnosable. */
    reportProblems(discovery) {
        this.lastProblems = discovery.problems.length;
        for (const problem of discovery.problems) {
            if (problem.reason === 'duplicate')
                continue;
            this.logger.warn(`external-import: skipped skill at ${problem.dir}: ${problem.detail}`);
        }
    }
    /** Number of non-duplicate problems reported by the most recent scan. */
    problemCount() {
        return this.lastProblems;
    }
    /** Project one discovered skill onto a registry candidate. */
    toCandidate(skill) {
        return {
            name: skill.name,
            description: skill.description,
            ...skill.whenToUse === undefined || skill.whenToUse.length === 0 ? {} : { whenToUse: skill.whenToUse },
            invocation: skill.invocation,
            source: skill.source,
            provider: this.name,
            rank: this.config.skillRank,
            locator: skill,
            path: skill.file,
            resourceBase: { kind: 'directory', path: skill.dir },
        };
    }
}
/** Whether an opaque locator is one of this provider's skill references. */
function isSkillRef(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const ref = value;
    return typeof ref.name === 'string' && typeof ref.file === 'string' && typeof ref.dir === 'string' && typeof ref.source === 'string';
}
