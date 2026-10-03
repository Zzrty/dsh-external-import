# dsh-external-import

[![CI](https://github.com/Zzrty/dsh-external-import/actions/workflows/ci.yml/badge.svg)](https://github.com/Zzrty/dsh-external-import/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that
imports the **skills** and **MCP servers** you already configured for other
agent tools — Claude Code, Codex CLI, Cursor, Trae and VS Code — and adds a
**Settings page** to see and manage what was imported.

Read this in [中文](README.zh.md).

## What it does

| | |
|---|---|
| **Skills** | Registers a read-only skill provider over the skill directories of every supported tool. Skills appear in the model's catalog on the next turn; bodies are read when loaded, so an edit made in the owning tool shows up without restarting. |
| **MCP** | Normalizes each tool's configuration into one model, previews it, and connects on request — one `@deepseek-ai/dsh-mcp-client` instance per server, proved by connecting before it is kept. Tools appear as `mcp__<serverName>__<tool>` and can be disconnected at any time. |
| **Settings page** | **Settings → External import**: switch sources and individual skills, connect or disconnect MCP servers, and attach a custom instruction to a single session. |
| **Nothing is written** to another tool's files. No connection is opened until you or the model asks for one. |

## What it reads

| Tool | MCP configuration | Skill directories |
|---|---|---|
| Shared convention | — | `~/.agents/skills`, `<project>/.agents/skills` |
| Claude Code | `~/.claude.json` (`mcpServers`), `<project>/.mcp.json` | `$CLAUDE_CONFIG_DIR/skills`, `<project>/.claude/skills` |
| Codex CLI | `$CODEX_HOME/config.toml` (`[mcp_servers]`), `<project>/.codex/config.toml` | `$CODEX_HOME/skills` (including one nested `.system/*` level), `<project>/.codex/skills` |
| Cursor | `~/.cursor/mcp.json`, `<project>/.cursor/mcp.json` | `~/.cursor/skills-cursor`, `~/.cursor/skills`, `<project>/.cursor/skills` |
| Trae | desktop user directory `mcp.json`, `~/.trae/mcp.json`, `<project>/.trae/mcp.json` | `~/.trae/skills`, `~/.trae/builtin_skills`, `<project>/.trae/skills` |
| VS Code | user `mcp.json` (`servers`, including editor profiles), `settings.json` (`mcp.servers`), `<project>/.vscode/mcp.json` | — |

Entries that cannot become a working server are reported with a reason rather
than silently dropped: `disabled`, `duplicate`, `empty-command`,
`missing-transport`, `unsupported-transport`, `invalid-field`, and
`needs-user-input` for VS Code `${input:…}` placeholders.

## Install

DeepSeek Harness installs plugins into a profile. This package ships its built
output, so a git install needs no build step:

```sh
dsh plugin --profile web add github:Zzrty/dsh-external-import
```

Then restart the harness once — a new bundle member is a composition change,
which the config-only HMR does not cover. It then appears in
**Settings → Plugins** as `dsh-external-import`, and its page is under
**Settings → External import**.

<details>
<summary>Other installation routes</summary>

**From a local clone** (development; the `web` profile applies the row without a
restart):

```sh
dsh plugin --profile web add /absolute/path/to/dsh-external-import
```

**Without installing as a bundle** — insert the row in your profile's own
`$DSH_HOME/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: external-import
      name: '/absolute/path/to/dsh-external-import/lib/index.js'
      config:
        autoMount: []
```

`$DSH_HOME` defaults to `~/.dsh`. The `web` profile watches this file, so the
edit applies live.

**Remove** it with the Plugins page, or
`dsh plugin --profile web remove dsh-external-import`.

</details>

## The Settings page

**Skills** — one switch per source (with how many skills and servers it
contributes), a search box, and a switch per skill. Bulk enable/disable applies
to the current search result. Switching a skill off only affects what this
plugin offers; the file itself is never touched.

**MCP** — every discovered server with its source, scope, command or URL, and —
once connected — the `mcp__<name>__` prefix its tools use. Connect and
disconnect per server. Skipped configuration entries are listed with their
reasons.

**Session instructions** — pick any session and write an instruction that
applies to that session alone (★ marks sessions that already have one). The text
becomes part of that session's system prompt from the next turn, and the agent
loop records it as a `system/message`, so it lives in the session log and
replays with the session. Clearing the box removes it.

## Model-facing tools

| Tool | Purpose |
|---|---|
| `external_scan` | List importable servers and skills, and every skipped entry with its reason. Read-only; credentials are redacted. |
| `external_mcp_import` | Preview by default; with `apply: true` connect the servers and report each outcome. |
| `external_mcp_unmount` | Disconnect one imported server, or all of them. |
| `external_mcp_status` | List what is currently imported and the tool prefix each server uses. |

## Configuration

Set these in the row's `config` (in the bundle patch, or in your profile's
`cordis.patch.yml` by id — a patch replaces the whole `config` block):

| Field | Default | Meaning |
|---|---|---|
| `sources` | `[]` (all) | Which tools to scan: `agents`, `claude-code`, `codex`, `cursor`, `trae`, `vscode` |
| `includeProjectScope` | `true` | Also scan project-level configuration under the working directory |
| `projectCwd` | process cwd | Absolute working directory for project-level scanning |
| `importSkills` | `true` | Register imported skills with the skill registry |
| `skillRank` | `900` | Precedence of imported skills; a lower rank wins, so skills shipped with the harness always beat a same-named import |
| `registerTools` | `true` | Register the four model-facing tools |
| `managementApi` | `true` | Serve the settings page's management route |
| `statePath` | `$DSH_HOME/external-import/state.json` | Where switches and session instructions are stored |
| `verifyOnMount` | `true` | Require a server to connect and list its tools before the import reports success; a failure rolls that server back |
| `autoMount` | `[]` | Servers to connect during activation, or `"*"` for every discovered one |
| `serverNamePrefix` | `''` | Prefix for generated `mcp__<name>__` namespaces |
| `mcpClientModule` | `@deepseek-ai/dsh-mcp-client` | Module specifier of the MCP client bridge |
| `toolCallTimeoutMs` | bridge default (60 s) | Per-call timeout for imported servers |
| `frontmatterBytes` | `16384` | Bytes read from each skill file while scanning |
| `scanCacheTtlMs` | `3000` | Lifetime of one discovery result |

Configuration is validated at activation: a field with a wrong type fails the
plugin instead of silently falling back to a default.

## How it works

```
Host half (lib/)                           Browser half (client/client.js)
├── skill provider ── ctx.skills           └── Settings section
├── 4 tools ───────── ctx.tools                 └── fetch /external-import/api
├── MCP mounts ────── ctx.plugin(mcp-client)           (loopback only)
├── session prompt ── agent.ctx.systemPrompt.section
└── management route ─ ctx.webServer
```

- **Skills** go through `ctx.skills.registerProvider`; the registry merges
  providers and this one deliberately sits below the harness's own skills.
- **MCP** mounts the official bridge as a child plugin per server, so Cordis
  unwinds every connection when the import unloads. The bridge is loaded by
  module specifier, so the skill half keeps working without it.
- **Session instructions** register a scoped section through `agent.ctx`. The
  agent's scope key is the agent object itself, so the section exists for that
  session only, and the loop's own `system/message` append makes it durable.
- **The settings page** reads and writes through a route this plugin registers
  on the host's web server, restricted to loopback peers. The typed Remote layer
  would need generated descriptors that cannot be produced outside the harness
  repository; the browser half therefore uses the platform's seeded React and
  nothing else.

## Security

- **Read-only towards other tools.** No file outside this plugin's own state
  document is ever written.
- **Redaction.** `env` and `header` values whose key looks like a credential,
  plus user information and credential query parameters in URLs, become
  `<redacted>` before anything reaches a model or the settings page.
- **Loopback only.** The management route answers `127.0.0.1`/`::1` and refuses
  everything else with 403.
- **Preview first.** Nothing connects or spawns a process until an import is
  requested with `apply: true` (or named in `autoMount`).
- **Failure isolation.** A server that fails to connect is rolled back; the rest
  of the import is unaffected.

## Limitations

- **VS Code `${input:…}` entries** cannot be prompted for here; those servers are
  skipped with `needs-user-input`.
- **Codex `enabled = false`** servers are not imported; the owning tool's intent
  is respected.
- **Trae configures MCP mostly through its UI.** Only what reaches `mcp.json`
  can be read.
- **Project-level scope** applies to the working directory of the session, the
  same way the owning tool scopes it.
- **Skill names are normalized** to kebab-case (`ESP-IDF` → `esp-idf`,
  `sem32_hal` → `sem32-hal`); the files themselves are untouched.
- **stdio servers** need their executable available on this machine (`cmd`,
  `npx`, `uvx`, `python3`, …), and the first connection can be slow.
- **The settings page needs a page refresh** to appear after the first install,
  because the browser's plugin table is composed when the harness starts.

## Development

```sh
npm install
npm run build          # emits lib/ (committed; CI fails when it is stale)
npm test               # parser, naming, masking, and skill-name tests
npm run link-workspace -- ../deepseek-harness   # once, for type checking
npm run typecheck
```

Development checks that run against real inputs on this machine (they need a
harness checkout):

```sh
npm run verify:discovery    # scan real tool configuration
npm run verify:activation   # mount on a real tool and skill registry, run the tools
npm run verify:management   # serve the management route over real HTTP
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the rules the code follows.

## License

[MIT](LICENSE)
