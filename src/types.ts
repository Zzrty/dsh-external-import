/**
 * Shared value types for external-tool discovery and import.
 *
 * The plugin reads configuration that other agent tools own. Nothing here
 * writes to those files: a discovered value is a copy, and the original path
 * stays in `origin` so every report can name where it came from.
 *
 * @module dsh-external-import/types
 */

/** Identifier of an external agent tool whose configuration this plugin reads. */
export type ExternalSourceId = 'agents' | 'claude-code' | 'codex' | 'cursor' | 'trae' | 'vscode'

/** Every source this plugin knows about, in scan order. */
export const EXTERNAL_SOURCE_IDS: readonly ExternalSourceId[] = [
  'agents',
  'claude-code',
  'codex',
  'cursor',
  'trae',
  'vscode',
]

/** Whether a discovered entry came from a user-level or a project-level file. */
export type ConfigScope = 'project' | 'user'

/** Transport of one discovered MCP server. */
export type McpTransport = 'stdio' | 'http'

/** One MCP server that can be handed to the MCP client bridge. */
export interface McpServerSpec {
  /** Name as the owning tool spells it. */
  readonly rawName: string
  /** Transport the entry declares, or the one inferred from its fields. */
  readonly transport: McpTransport
  /** Executable to spawn; present for `stdio`. */
  readonly command: string | undefined
  /** Arguments passed verbatim; empty for `http`. */
  readonly args: readonly string[]
  /** Extra environment variables for the child process. */
  readonly env: Readonly<Record<string, string>>
  /** Working directory for the child process, when the entry declares one. */
  readonly cwd: string | undefined
  /** Endpoint URL; present for `http`. */
  readonly url: string | undefined
  /** Request headers; empty for `stdio`. */
  readonly headers: Readonly<Record<string, string>>
}

/** A discovered MCP server plus where it was found. */
export interface McpCandidate {
  /** Normalized connection fields. */
  readonly spec: McpServerSpec
  /** Source that owns the configuration file. */
  readonly source: ExternalSourceId
  /** Scope of the file that declared the entry. */
  readonly scope: ConfigScope
  /** Absolute path of the configuration file. */
  readonly origin: string
}

/** Why one configuration entry could not become an MCP server. */
export interface McpProblem {
  /** Source that owns the configuration file. */
  readonly source: ExternalSourceId
  /** Scope of the file that declared the entry. */
  readonly scope: ConfigScope
  /** Absolute path of the configuration file. */
  readonly origin: string
  /** Entry name as the file spells it. */
  readonly rawName: string
  /** Stable reason code. */
  readonly reason:
    | 'disabled'
    | 'duplicate'
    | 'empty-command'
    | 'invalid-entry'
    | 'invalid-field'
    | 'missing-transport'
    | 'needs-user-input'
    | 'unsupported-transport'
  /** One sentence naming what was wrong, safe to show a model. */
  readonly detail: string
}

/** A skill directory found in another tool's skill root. */
export interface SkillCandidateRef {
  /** Kebab-case skill name from frontmatter. */
  readonly name: string
  /** Routing description from frontmatter. */
  readonly description: string
  /** Extra routing guidance from frontmatter, when present. */
  readonly whenToUse: string | undefined
  /** Invocation policy the owning tool declared, with both surfaces enabled by default. */
  readonly invocation: { readonly modelInvocable: boolean; readonly userInvocable: boolean }
  /** Absolute directory holding the skill. */
  readonly dir: string
  /** Absolute path of the instruction file. */
  readonly file: string
  /** Source that owns the skill root. */
  readonly source: ExternalSourceId
  /** Scope of the skill root. */
  readonly scope: ConfigScope
  /** Real path of the skill directory, used to collapse links to one skill. */
  readonly realDir: string
}

/** Why one skill directory was skipped. */
export interface SkillProblem {
  /** Absolute path of the skill directory. */
  readonly dir: string
  /** Source that owns the skill root. */
  readonly source: ExternalSourceId
  /** Stable reason code. */
  readonly reason: 'duplicate' | 'invalid-name' | 'missing-description' | 'missing-frontmatter' | 'missing-name' | 'unreadable'
  /** One sentence naming what was wrong. */
  readonly detail: string
}

/** Complete result of one discovery pass. */
export interface DiscoveryReport {
  /** MCP servers that can be mounted. */
  readonly servers: readonly McpCandidate[]
  /** Entries that could not become servers. */
  readonly problems: readonly McpProblem[]
  /** Skills that can be registered. */
  readonly skills: readonly SkillCandidateRef[]
  /** Skill directories that were skipped, including duplicates. */
  readonly skillProblems: readonly SkillProblem[]
  /** Configuration files that were read, whether or not they held entries. */
  readonly scannedFiles: readonly string[]
}
