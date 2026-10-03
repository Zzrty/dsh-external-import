/**
 * Discovery of skill directories owned by other agent tools.
 *
 * Every supported tool stores a skill as a directory holding `SKILL.md`, and
 * several tools link one shared skill store into their own directory. A scan
 * therefore resolves each skill directory to its real path and keeps the first
 * occurrence, so one shared skill is not registered once per linking tool.
 *
 * @module dsh-external-import/discover/skills
 */

import { join } from 'node:path'
import { isDirectory, listDirectory, readTextPrefix, resolveRealPath } from '../parse/read.ts'
import { parseFrontmatter } from '../parse/frontmatter.ts'
import type { SkillRoot, SourceDescriptor, DiscoveryContext } from '../sources.ts'
import type { ExternalSourceId, SkillCandidateRef, SkillProblem } from '../types.ts'

/** Bounded prefix read during discovery; enough for any real frontmatter block. */
const DEFAULT_FRONTMATTER_BYTES = 16_384

/** Skill names the registry accepts. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Options that bound a skill scan. */
export interface SkillScanOptions {
  /** Maximum bytes read from each instruction file while scanning. */
  readonly frontmatterBytes: number
}

/** Accumulated skill discovery result. */
export interface SkillDiscovery {
  /** Skills that can be registered. */
  readonly skills: readonly SkillCandidateRef[]
  /** Directories that were skipped, including duplicates. */
  readonly problems: readonly SkillProblem[]
  /** Skill roots that existed. */
  readonly scannedRoots: readonly string[]
}

/** One directory's parse outcome: a usable skill, a reason to skip it, or neither. */
type SkillReading =
  | { readonly kind: 'skill'; readonly skill: SkillCandidateRef }
  | { readonly kind: 'problem'; readonly reason: SkillProblem['reason']; readonly detail: string }
  | { readonly kind: 'absent' }

/**
 * Walk every selected source's skill roots.
 * @param descriptors - sources to scan.
 * @param context - working directory and scope selection for this scan.
 * @param options - scan bounds; omission uses the default frontmatter budget.
 * @returns skills and the reasons other directories were skipped.
 */
export async function discoverSkills(
  descriptors: readonly SourceDescriptor[],
  context: DiscoveryContext,
  options: SkillScanOptions = { frontmatterBytes: DEFAULT_FRONTMATTER_BYTES },
): Promise<SkillDiscovery> {
  const skills: SkillCandidateRef[] = []
  const problems: SkillProblem[] = []
  const scannedRoots: string[] = []
  const takenNames = new Set<string>()
  const takenDirs = new Set<string>()
  for (const descriptor of descriptors) {
    for (const root of await descriptor.skillRoots(context)) {
      if (!(await isDirectory(root.path))) continue
      scannedRoots.push(root.path)
      for (const reading of await listRoot(root, descriptor.id, options)) {
        if (reading.kind === 'absent') continue
        if (reading.kind === 'problem') {
          problems.push({ dir: root.path, source: descriptor.id, reason: reading.reason, detail: reading.detail })
          continue
        }
        const skill = reading.skill
        const skip = duplicateReason(skill, takenNames, takenDirs)
        if (skip !== undefined) {
          problems.push({ dir: skill.dir, source: descriptor.id, reason: 'duplicate', detail: skip })
          continue
        }
        takenNames.add(skill.name)
        takenDirs.add(skill.realDir)
        skills.push(skill)
      }
    }
  }
  return { skills, problems, scannedRoots }
}

/** Explain why a skill is already covered, or `undefined` when it is new. */
function duplicateReason(skill: SkillCandidateRef, names: ReadonlySet<string>, dirs: ReadonlySet<string>): string | undefined {
  if (dirs.has(skill.realDir)) return 'the same skill directory is already registered from another root'
  if (names.has(skill.name)) return `the skill name "${skill.name}" is already provided by an earlier root`
  return undefined
}

/** Locate every skill directory directly inside one root. */
async function listRoot(root: SkillRoot, source: ExternalSourceId, options: SkillScanOptions): Promise<SkillReading[]> {
  const found: SkillReading[] = []
  for (const entry of await listDirectory(root.path)) {
    const path = join(root.path, entry.name)
    if (entry.isDirectory()) {
      const direct = await readSkill(root, source, join(path, 'SKILL.md'), path, options)
      if (direct.kind !== 'absent') {
        found.push(direct)
        continue
      }
      // Tools such as Codex group their built-in skills under a hidden
      // container directory; walking one more level finds them.
      if (!entry.name.startsWith('.')) continue
      for (const nested of await listDirectory(path)) {
        if (!nested.isDirectory()) continue
        found.push(await readSkill(root, source, join(path, nested.name, 'SKILL.md'), join(path, nested.name), options))
      }
      continue
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      found.push(await readSkill(root, source, path, root.path, options))
    }
  }
  return found
}

/** Parse one instruction file into a skill reference. */
async function readSkill(
  root: SkillRoot,
  source: ExternalSourceId,
  file: string,
  directory: string,
  options: SkillScanOptions,
): Promise<SkillReading> {
  const prefix = await readTextPrefix(file, options.frontmatterBytes)
  if (prefix === undefined) return { kind: 'absent' }
  const parsed = parseFrontmatter(prefix)
  if (parsed === undefined) {
    return { kind: 'problem', reason: 'missing-frontmatter', detail: `${file} has no YAML frontmatter block` }
  }
  const declaredName = stringValue(parsed.data.name)
  const description = stringValue(parsed.data.description)
  if (declaredName === undefined) {
    return { kind: 'problem', reason: 'missing-name', detail: `${file} frontmatter has no "name"` }
  }
  if (description === undefined || description.trim().length === 0) {
    return { kind: 'problem', reason: 'missing-description', detail: `${file} frontmatter has no "description"` }
  }
  const name = normalizeSkillName(declaredName)
  if (name === undefined) {
    return { kind: 'problem', reason: 'invalid-name', detail: `skill name "${declaredName}" has no characters usable in a skill name` }
  }
  const whenToUse = stringValue(parsed.data.when_to_use) ?? stringValue(parsed.data.whenToUse)
  return {
    kind: 'skill',
    skill: {
      name,
      description: description.trim(),
      whenToUse: whenToUse?.trim(),
      invocation: invocationPolicy(parsed.data),
      dir: directory,
      file,
      source,
      scope: root.scope,
      realDir: await resolveRealPath(directory),
    },
  }
}

/**
 * Read the invocation policy the owning tool declared.
 * @param data - parsed skill frontmatter.
 * @returns the resolved policy; both surfaces are enabled unless the file says otherwise.
 */
export function invocationPolicy(data: Readonly<Record<string, unknown>>): { modelInvocable: boolean; userInvocable: boolean } {
  const modelDisabled = truthy(data['disable-model-invocation']) || truthy(data.disableModelInvocation)
  const userDisabled = data['user-invocable'] === false || data.userInvocable === false
  return { modelInvocable: !modelDisabled, userInvocable: !userDisabled }
}

/** Whether a frontmatter value means "true" in the spellings the tools accept. */
function truthy(value: unknown): boolean {
  if (value === true) return true
  if (typeof value !== 'string') return false
  return ['true', 'yes', 'on', '1'].includes(value.trim().toLowerCase())
}

/** Read an optional string frontmatter value. */
function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Convert a declared skill name into the registry's kebab-case grammar.
 *
 * Other tools allow capitals and underscores (`ESP-IDF`, `TRAE-debugger`,
 * `sem32_hal`), which the registry rejects outright. Converting keeps those
 * skills importable; the locator and the instruction file keep the original
 * spelling, so nothing about the owning directory changes.
 * @param declared - name as the skill file spells it.
 * @returns the kebab-case name, or `undefined` when no usable character remains.
 */
export function normalizeSkillName(declared: string): string | undefined {
  if (SKILL_NAME.test(declared)) return declared
  const normalized = declared
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
  return normalized.length === 0 || !SKILL_NAME.test(normalized) ? undefined : normalized
}
