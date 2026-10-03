/**
 * Shared value types for external-tool discovery and import.
 *
 * The plugin reads configuration that other agent tools own. Nothing here
 * writes to those files: a discovered value is a copy, and the original path
 * stays in `origin` so every report can name where it came from.
 *
 * @module dsh-external-import/types
 */
/** Every source this plugin knows about, in scan order. */
export const EXTERNAL_SOURCE_IDS = [
    'agents',
    'claude-code',
    'codex',
    'cursor',
    'trae',
    'vscode',
];
