# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-03

First release.

### Added

- Read-only skill provider over the skill directories of Claude Code
  (`~/.claude/skills`, project `.claude/skills`), Codex (`$CODEX_HOME/skills`,
  including one nested `.system/*` level), Cursor (`~/.cursor/skills-cursor`,
  `~/.cursor/skills`), Trae (`~/.trae/skills`, `~/.trae/builtin_skills`) and the
  shared `~/.agents/skills`. Skill directories are resolved to their real path,
  so a store linked into several tools is registered once; names that are not
  kebab-case are normalized; bodies are re-read on every load.
- MCP discovery for Claude Code (`~/.claude.json`, `.mcp.json`), Codex
  (`config.toml`), Cursor (`mcp.json`), Trae (desktop user directory,
  `~/.trae/mcp.json`) and VS Code (`servers` keys, per editor profile).
  Unusable entries are reported with a reason instead of being dropped:
  disabled, duplicate, empty command, missing transport, unsupported transport,
  invalid field, and VS Code `${input:…}` placeholders.
- Four model-facing tools: `external_scan`, `external_mcp_import` (preview
  first, connect on `apply: true`), `external_mcp_unmount`, `external_mcp_status`.
  Each imported server is mounted as one `@deepseek-ai/dsh-mcp-client` child
  plugin and proved by connecting before it is kept.
- A **External import** Settings page with three tabs: skills (per-source and
  per-skill switches, search, bulk enable/disable), MCP (connect/disconnect each
  discovered server, with the skipped entries and their reasons), and session
  instructions.
- Per-session instructions: one scoped system-prompt section per session, read
  at every assembly, logged by the agent loop as `system/message` so it replays
  with the session.
- Durable management state in `$DSH_HOME/external-import/state.json`, written
  atomically and reset to defaults when unreadable.
- Credential redaction for every value that reaches a model or the settings
  page.

[Unreleased]: https://github.com/Zzrty/dsh-external-import/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Zzrty/dsh-external-import/releases/tag/v0.1.0
