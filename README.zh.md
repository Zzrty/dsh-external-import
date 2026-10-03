# dsh-external-import

[![CI](https://github.com/Zzrty/dsh-external-import/actions/workflows/ci.yml/badge.svg)](https://github.com/Zzrty/dsh-external-import/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：
把你在其它 agent 工具（Claude Code、Codex CLI、Cursor、Trae、VS Code）里**已经配好**
的 skills 和 MCP 服务器导入 Harness，并在设置里加一页可视化界面来查看和管理它们。

[English](README.md)

## 它做什么

| | |
|---|---|
| **Skills** | 注册一个只读 skill provider，扫描各工具的 skills 目录。模型在下一轮就能看到并使用它们；正文在真正加载时才读，所以在原工具里改完**不用重启** Harness 就生效。 |
| **MCP** | 把各工具的配置归一化成统一模型，先预览、按需连接 —— 每个服务器挂载一个 `@deepseek-ai/dsh-mcp-client` 实例，且**先连上验证再保留**。工具以 `mcp__<serverName>__<tool>` 出现，可随时断开。 |
| **设置页** | **Settings → 外部导入**：按来源和单个技能开关、连接/断开 MCP 服务器、给单个会话挂一段自定义指令。 |
| **绝不写入**其它工具的文件；你或模型不主动要求，就不会连接任何东西。 |

## 它读哪些配置

| 工具 | MCP 配置 | Skills 目录 |
|---|---|---|
| 通用约定 | — | `~/.agents/skills`、`<项目>/.agents/skills` |
| Claude Code | `~/.claude.json`（`mcpServers`）、`<项目>/.mcp.json` | `$CLAUDE_CONFIG_DIR/skills`、`<项目>/.claude/skills` |
| Codex CLI | `$CODEX_HOME/config.toml`（`[mcp_servers]`）、`<项目>/.codex/config.toml` | `$CODEX_HOME/skills`（含一层嵌套的 `.system/*`）、`<项目>/.codex/skills` |
| Cursor | `~/.cursor/mcp.json`、`<项目>/.cursor/mcp.json` | `~/.cursor/skills-cursor`、`~/.cursor/skills`、`<项目>/.cursor/skills` |
| Trae | 桌面端用户目录 `mcp.json`、`~/.trae/mcp.json`、`<项目>/.trae/mcp.json` | `~/.trae/skills`、`~/.trae/builtin_skills`、`<项目>/.trae/skills` |
| VS Code | 用户 `mcp.json`（`servers`，含各编辑器 profile）、`settings.json`（`mcp.servers`）、`<项目>/.vscode/mcp.json` | — |

无法变成可用服务器的条目会**带原因**列出，而不是被静默丢掉：
`disabled`、`duplicate`、`empty-command`、`missing-transport`、
`unsupported-transport`、`invalid-field`，以及 VS Code `${input:…}` 占位符的
`needs-user-input`。

## 安装

Harness 把插件装进 profile。本包**提交了构建产物**，所以从 git 安装不需要编译：

```sh
dsh plugin --profile web add github:Zzrty/dsh-external-import
```

然后**重启一次** Harness —— 新增组合包成员属于组合变更，仅配置的 HMR 不覆盖它。
之后 **Settings → Plugins** 里会出现 `dsh-external-import`，它的页面在
**Settings → 外部导入**。

<details>
<summary>其它安装方式</summary>

**从本地克隆安装**（开发用；web profile 会即时应用这一行，无需重启）：

```sh
dsh plugin --profile web add /绝对路径/dsh-external-import
```

**不作为组合包安装** —— 直接写进你 profile 的
`$DSH_HOME/profiles/web/cordis.patch.yml`：

```yaml
- insert:
    - id: external-import
      name: '/绝对路径/dsh-external-import/lib/index.js'
      config:
        autoMount: []
```

`$DSH_HOME` 默认是 `~/.dsh`。web profile 会监视这个文件，改完即时生效。

**卸载**：在 Plugins 页面卸载，或
`dsh plugin --profile web remove dsh-external-import`。

</details>

## 设置页

**技能** —— 每个来源一个总开关（并显示它贡献了多少技能和服务器）、一个搜索框、
每个技能一个开关；批量启用/停用作用于当前搜索结果。停用只影响本插件提供什么，
**原文件不会被改动**。

**MCP** —— 列出每个发现的服务器及其来源、作用域、命令或 URL，连上后显示它的
`mcp__<name>__` 前缀；逐个连接/断开，并列出被跳过的配置条目及原因。

**会话指令** —— 选择任意会话写一段**只对它生效**的指令（★ 标记已有指令的会话）。
文本从下一轮起成为该会话系统提示的一部分，并由 agent loop 记为
`system/message`，因此进入会话日志、可随会话回放。清空即移除。

## 模型可见的工具

| 工具 | 作用 |
|---|---|
| `external_scan` | 列出可导入的服务器与技能，以及每个被跳过条目的原因。只读，凭据已脱敏。 |
| `external_mcp_import` | 默认只预览；`apply: true` 才连接并逐个报告结果。 |
| `external_mcp_unmount` | 断开某个（或全部）已导入的服务器。 |
| `external_mcp_status` | 列出当前已导入的服务器及其工具前缀。 |

## 配置

写在那一行的 `config` 里（组合包的 patch，或在 profile 的 `cordis.patch.yml` 里按 id
覆盖 —— patch 会**整块替换** `config`）：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `sources` | `[]`（全部） | 扫描哪些工具：`agents`、`claude-code`、`codex`、`cursor`、`trae`、`vscode` |
| `includeProjectScope` | `true` | 是否也扫描工作目录下的项目级配置 |
| `projectCwd` | 进程工作目录 | 项目级扫描使用的绝对路径 |
| `importSkills` | `true` | 是否注册外部 skills |
| `skillRank` | `900` | 外部 skills 的优先级；数值越小越优先，因此 Harness 自带的同名 skill 永远赢 |
| `registerTools` | `true` | 是否注册模型可见的 4 个工具 |
| `managementApi` | `true` | 是否提供设置页用的管理接口 |
| `statePath` | `$DSH_HOME/external-import/state.json` | 开关与会话指令的存放路径 |
| `verifyOnMount` | `true` | 连接时是否要求「连上并拉到工具列表」才算成功；失败会回滚该服务器 |
| `autoMount` | `[]` | 启动时自动连接的服务器名列表，`"*"` 表示全部 |
| `serverNamePrefix` | `''` | 生成的 `mcp__<name>__` 命名空间前缀 |
| `mcpClientModule` | `@deepseek-ai/dsh-mcp-client` | MCP 客户端桥的模块标识 |
| `toolCallTimeoutMs` | 桥默认 60 秒 | 已导入服务器的单次调用超时 |
| `frontmatterBytes` | `16384` | 扫描时每个技能文件读取的字节上限 |
| `scanCacheTtlMs` | `3000` | 一次扫描结果的缓存时长 |

配置在激活时校验：字段类型写错会直接让插件加载失败，而不是静默退回默认值。

## 实现结构

```
宿主半侧（lib/）                            浏览器半侧（client/client.js）
├── skill provider ── ctx.skills            └── 设置页
├── 4 个工具 ───────── ctx.tools                 └── fetch /external-import/api
├── MCP 挂载 ──────── ctx.plugin(mcp-client)          （仅 loopback）
├── 会话指令 ──────── agent.ctx.systemPrompt.section
└── 管理接口 ──────── ctx.webServer
```

- **Skills** 走 `ctx.skills.registerProvider`；注册表负责合并，本 provider 的排名
  刻意排在 Harness 自带 skills 之后。
- **MCP** 每个服务器把官方桥挂成子插件，因此卸载导入时 Cordis 会连带释放所有连接。
  桥是按模块标识动态加载的，所以缺了它 skills 半侧照常工作。
- **会话指令** 通过 `agent.ctx` 注册作用域内段落。agent 的 scope key 就是 agent 对象
  本身，所以该段落只存在于那个会话；loop 自己会追加 `system/message`，因此天然持久。
- **设置页** 通过本插件在宿主 web server 上注册的路由读写，且**只接受 loopback**。
  DSH 的 Remote（typert）层需要生成描述符，那在 Harness 仓库之外做不到；浏览器半侧
  因此只使用平台内置的 React，没有任何外部依赖。

## 安全边界

- **对其它工具只读**：除了本插件自己的状态文件，不写任何文件。
- **脱敏**：`env` / `headers` 中键名像凭据的值，以及 URL 里的用户信息和凭据型查询
  参数，都会在进入模型或设置页之前变成 `<redacted>`。
- **仅本机**：管理接口只响应 `127.0.0.1`/`::1`，其它来源一律 403。
- **先预览后动作**：在 `apply: true`（或写进 `autoMount`）之前，不连接、不启进程。
- **失败隔离**：连不上的服务器会被回滚，不影响其余导入。

## 已知限制

- **VS Code 的 `${input:…}` 条目**无法在这里交互输入，会以 `needs-user-input` 跳过。
- **Codex `enabled = false`** 的服务器不导入，尊重原工具的意图。
- **Trae 主要通过 UI 管理 MCP**，只有落到 `mcp.json` 的配置能读到。
- **项目级作用域**跟随会话的工作目录，与原工具的语义一致。
- **技能名会规范化**成 kebab-case（`ESP-IDF` → `esp-idf`、`sem32_hal` → `sem32-hal`），
  文件本身不动。
- **stdio 服务器**需要本机有对应可执行文件（`cmd`、`npx`、`uvx`、`python3`…），首次
  连接可能较慢。
- **首次安装后设置页需要刷新一次**，因为浏览器的插件表是在 Harness 启动时组装。

## 开发

```sh
npm install
npm run build          # 生成 lib/（已提交；CI 会在它与源码不一致时失败）
npm test               # 解析、命名、脱敏、技能名规范化的单测
npm run link-workspace -- ../deepseek-harness   # 首次做类型检查前执行一次
npm run typecheck
```

对着本机真实输入运行的三项开发校验（需要一份 Harness 检出）：

```sh
npm run verify:discovery    # 扫描真实的工具配置
npm run verify:activation   # 在真实 tools/skills 注册表上挂载并执行工具
npm run verify:management   # 起真实 HTTP 服务驱动管理接口
```

代码遵循的规则见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE)
