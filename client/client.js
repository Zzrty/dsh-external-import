/**
 * Browser half of dsh-external-import: one Settings page that shows the skills
 * and MCP servers imported from other agent tools and lets the user switch
 * them, plus a per-session instruction editor.
 *
 * The file is a lazy-CJS client bundle in the exact format the host's client
 * module system loads: it registers a factory, and the factory's exports are
 * the Cordis plugin. `react` is the only module requested, and it is a platform
 * seed, so no `dsh.client.external` entry is needed.
 *
 * Data comes from the plugin's own management route (`/external-import/api`),
 * which accepts loopback requests only.
 */

window.__ModuleLoader__.load({
  id: 'dsh-external-import',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    /** Absolute prefix of the host management route. */
    const API = '/external-import/api'

    /** Call one management endpoint and return its JSON body. */
    async function api(path, body) {
      const response = await fetch(API + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`)
      return payload
    }

    // ---- shared presentation ----

    const styles = {
      page: { padding: '4px 2px', fontSize: 13, lineHeight: 1.5 },
      tabs: { display: 'flex', gap: 6, marginBottom: 14, borderBottom: '1px solid rgba(127,127,127,0.25)' },
      tab: { padding: '6px 12px', cursor: 'pointer', border: 'none', background: 'transparent', color: 'inherit', fontSize: 13, opacity: 0.6, borderBottom: '2px solid transparent' },
      tabActive: { opacity: 1, borderBottom: '2px solid currentColor' },
      row: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' },
      muted: { opacity: 0.6 },
      list: { maxHeight: 420, overflowY: 'auto', marginTop: 8, border: '1px solid rgba(127,127,127,0.22)', borderRadius: 6 },
      item: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 10px', borderBottom: '1px solid rgba(127,127,127,0.14)' },
      input: { padding: '5px 8px', fontSize: 13, borderRadius: 6, border: '1px solid rgba(127,127,127,0.35)', background: 'transparent', color: 'inherit' },
      button: { padding: '5px 12px', fontSize: 13, borderRadius: 6, border: '1px solid rgba(127,127,127,0.4)', background: 'transparent', color: 'inherit', cursor: 'pointer' },
      badge: { fontSize: 11, padding: '1px 6px', borderRadius: 999, border: '1px solid rgba(127,127,127,0.35)', opacity: 0.8, whiteSpace: 'nowrap' },
      error: { padding: '8px 10px', borderRadius: 6, background: 'rgba(220,80,80,0.14)', border: '1px solid rgba(220,80,80,0.4)', marginBottom: 10 },
      notice: { padding: '8px 10px', borderRadius: 6, background: 'rgba(80,160,220,0.14)', border: '1px solid rgba(80,160,220,0.4)', marginBottom: 10 },
      textarea: { width: '100%', minHeight: 120, padding: 8, fontSize: 13, fontFamily: 'inherit', borderRadius: 6, border: '1px solid rgba(127,127,127,0.35)', background: 'transparent', color: 'inherit', resize: 'vertical' },
    }

    /** One tab button. */
    function Tab(props) {
      return h('button', {
        type: 'button',
        style: { ...styles.tab, ...(props.active ? styles.tabActive : {}) },
        onClick: props.onSelect,
      }, props.label)
    }

    /** Skills tab: source switches plus one switch per imported skill. */
    function SkillsTab(props) {
      const [query, setQuery] = React.useState('')
      const overview = props.overview
      const needle = query.trim().toLowerCase()
      const skills = needle.length === 0
        ? overview.skills
        : overview.skills.filter(skill => skill.name.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle))
      return h('div', undefined,
        h('div', { style: styles.row },
          h('strong', undefined, '按来源'),
          ...overview.sources.map(source => h('label', { key: source.id, style: { ...styles.row, gap: 4 } },
            h('input', {
              type: 'checkbox',
              checked: source.enabled,
              disabled: props.busy,
              onChange: () => props.toggleSource(source.id, !source.enabled),
            }),
            h('span', undefined, source.id),
            h('span', { style: styles.badge }, `${source.skills} 技能 / ${source.servers} MCP`)))),
        h('div', { style: styles.row },
          h('input', {
            style: { ...styles.input, flex: 1 },
            placeholder: `搜索技能（共 ${overview.skills.length} 个）`,
            value: query,
            onChange: event => setQuery(event.target.value),
          }),
          h('button', {
            type: 'button',
            style: styles.button,
            disabled: props.busy,
            onClick: () => props.setManySkills(skills.map(skill => skill.name), false),
          }, '启用筛选结果'),
          h('button', {
            type: 'button',
            style: styles.button,
            disabled: props.busy,
            onClick: () => props.setManySkills(skills.map(skill => skill.name), true),
          }, '停用筛选结果')),
        h('div', { style: styles.list },
          skills.length === 0
            ? h('div', { style: { ...styles.item, ...styles.muted } }, '没有匹配的技能')
            : skills.map(skill => h('label', { key: `${skill.source}:${skill.name}`, style: styles.item },
              h('input', {
                type: 'checkbox',
                checked: !skill.disabled,
                disabled: props.busy,
                onChange: () => props.toggleSkill(skill.name, !skill.disabled),
              }),
              h('span', { style: { flex: 1 } },
                h('div', undefined, h('strong', undefined, skill.name), !skill.modelInvocable ? h('span', { style: { ...styles.badge, marginLeft: 6 } }, '仅手动') : null),
                h('div', { style: styles.muted }, skill.description.slice(0, 160))),
              h('span', { style: styles.badge }, skill.source)))))
    }

    /** MCP tab: discovered servers with a connect toggle, plus skipped entries. */
    function McpTab(props) {
      const overview = props.overview
      return h('div', undefined,
        h('div', { style: styles.muted }, `发现 ${overview.servers.length} 个服务器，已连接 ${overview.servers.filter(server => server.mounted).length} 个。连接会启动本地进程或建立网络连接。`),
        h('div', { style: styles.list },
          overview.servers.length === 0
            ? h('div', { style: { ...styles.item, ...styles.muted } }, '没有发现任何 MCP 服务器')
            : overview.servers.map(server => h('div', { key: `${server.source}:${server.rawName}`, style: styles.item },
              h('div', { style: { flex: 1 } },
                h('div', undefined,
                  h('strong', undefined, server.rawName),
                  h('span', { style: { ...styles.badge, marginLeft: 6 } }, server.source),
                  h('span', { style: { ...styles.badge, marginLeft: 6 } }, server.scope),
                  server.mounted ? h('span', { style: { ...styles.badge, marginLeft: 6 } }, `mcp__${server.serverName}__`) : null),
                h('div', { style: { ...styles.muted, wordBreak: 'break-all' } }, server.summary)),
              h('button', {
                type: 'button',
                style: styles.button,
                disabled: props.busy,
                onClick: () => (server.mounted ? props.disconnect(server.rawName) : props.connect(server.rawName)),
              }, server.mounted ? '断开' : '连接')))),
        overview.problems.length === 0 ? null : h('div', { style: { marginTop: 14 } },
          h('strong', undefined, `被跳过的条目（${overview.problems.length}）`),
          h('div', { style: styles.list },
            overview.problems.map((problem, index) => h('div', { key: `${problem.source}:${problem.rawName}:${index}`, style: styles.item },
              h('div', { style: { flex: 1 } },
                h('div', undefined, h('strong', undefined, problem.rawName), h('span', { style: { ...styles.badge, marginLeft: 6 } }, problem.reason)),
                h('div', { style: styles.muted }, problem.detail)))))))
    }

    /** Session tab: pick a session and edit its instruction. */
    function SessionTab(props) {
      return h('div', undefined,
        h('div', { style: styles.muted }, '该指令只对所选会话生效，会作为系统提示的一部分进入模型上下文，并记录在该会话的日志里。清空即移除。'),
        h('div', { style: { ...styles.row, marginTop: 10 } },
          h('span', undefined, '会话'),
          h('select', {
            style: { ...styles.input, flex: 1, maxWidth: 520 },
            value: props.sessionId,
            onChange: event => props.selectSession(event.target.value),
          },
            h('option', { value: '' }, props.sessions.length === 0 ? '（读取会话列表…）' : '选择会话…'),
            ...props.sessions.map(session => h('option', { key: session.id, value: session.id },
              `${session.title || session.id}${session.prompt ? ' ★' : ''}`))),
          h('button', { type: 'button', style: styles.button, disabled: props.busy, onClick: props.reloadSessions }, '刷新')),
        h('textarea', {
          style: { ...styles.textarea, marginTop: 10 },
          placeholder: '例如：这个会话只讨论 STM32H7 的时钟树，回答前先给结论。',
          value: props.promptText,
          disabled: props.sessionId === '',
          onChange: event => props.setPromptText(event.target.value),
        }),
        h('div', { style: { ...styles.row, marginTop: 8 } },
          h('button', {
            type: 'button',
            style: styles.button,
            disabled: props.busy || props.sessionId === '',
            onClick: props.savePrompt,
          }, '保存'),
          h('button', {
            type: 'button',
            style: styles.button,
            disabled: props.busy || props.sessionId === '',
            onClick: props.clearPrompt,
          }, '清空并移除'),
          h('span', { style: styles.muted }, '★ 表示该会话已有自定义指令')))
    }

    /** The Settings page itself. */
    function ExternalImportSection() {
      const [overview, setOverview] = React.useState(null)
      const [sessions, setSessions] = React.useState([])
      const [sessionId, setSessionId] = React.useState('')
      const [promptText, setPromptText] = React.useState('')
      const [tab, setTab] = React.useState('skills')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')

      const load = React.useCallback(async () => {
        try {
          setOverview(await api('/overview'))
          setError('')
        } catch (failure) {
          setError(failure.message || String(failure))
        }
      }, [])

      const loadSessions = React.useCallback(async () => {
        try {
          const payload = await api('/sessions')
          setSessions(payload.sessions || [])
        } catch (failure) {
          setError(failure.message || String(failure))
        }
      }, [])

      React.useEffect(() => { void load() }, [load])
      React.useEffect(() => { if (tab === 'session') void loadSessions() }, [tab, loadSessions])

      /** Run one mutation, report it, and refresh the page data. */
      const mutate = React.useCallback(async (label, work) => {
        setBusy(true)
        setError('')
        setNotice('')
        try {
          const result = await work()
          setNotice(result || label)
          await load()
        } catch (failure) {
          setError(failure.message || String(failure))
        } finally {
          setBusy(false)
        }
      }, [load])

      if (overview === null) {
        return h('div', { style: styles.page }, error === '' ? '读取中…' : h('div', { style: styles.error }, error))
      }

      const disabledSources = overview.sources.filter(source => !source.enabled).map(source => source.id)
      const disabledSkills = overview.skills.filter(skill => skill.disabled).map(skill => skill.name)

      const toggleSource = (id, enabled) => mutate('已更新来源开关', async () => {
        const next = enabled ? disabledSources.filter(item => item !== id) : [...disabledSources, id]
        await api('/state', { disabledSources: next })
        return `来源 ${id} 已${enabled ? '启用' : '停用'}`
      })

      const toggleSkill = (name, enabled) => mutate('已更新技能开关', async () => {
        const next = enabled ? disabledSkills.filter(item => item !== name) : [...disabledSkills, name]
        await api('/state', { disabledSkills: next })
        return `技能 ${name} 已${enabled ? '启用' : '停用'}`
      })

      const setManySkills = (names, disable) => mutate('已批量更新', async () => {
        const set = new Set(disabledSkills)
        for (const name of names) {
          if (disable) set.add(name)
          else set.delete(name)
        }
        await api('/state', { disabledSkills: [...set] })
        return `${names.length} 个技能已${disable ? '停用' : '启用'}`
      })

      const connect = (rawName) => mutate('连接中…', async () => {
        const payload = await api('/mcp/mount', { servers: [rawName] })
        const outcome = (payload.outcomes || [])[0] || {}
        return outcome.mounted ? `${rawName} 已连接（工具前缀 mcp__${outcome.serverName}__）` : `${rawName} 连接失败：${outcome.detail || '未知原因'}`
      })

      const disconnect = (rawName) => mutate('断开中…', async () => {
        await api('/mcp/unmount', { rawName })
        return `${rawName} 已断开`
      })

      const selectSession = (id) => {
        setSessionId(id)
        const session = sessions.find(item => item.id === id)
        setPromptText(session === undefined ? '' : session.prompt)
      }

      const savePrompt = () => mutate('已保存会话指令', async () => {
        await api('/session-prompt', { sessionId, text: promptText })
        await loadSessions()
        return '会话指令已保存，下一轮生效'
      })

      const clearPrompt = () => mutate('已清除', async () => {
        await api('/session-prompt', { sessionId, text: '' })
        setPromptText('')
        await loadSessions()
        return '已移除该会话的自定义指令'
      })

      return h('div', { style: styles.page },
        error === '' ? null : h('div', { style: styles.error }, error),
        notice === '' ? null : h('div', { style: styles.notice }, notice),
        h('div', { style: styles.tabs },
          h(Tab, { label: `技能 (${overview.skills.length})`, active: tab === 'skills', onSelect: () => setTab('skills') }),
          h(Tab, { label: `MCP (${overview.servers.length})`, active: tab === 'mcp', onSelect: () => setTab('mcp') }),
          h(Tab, { label: '会话指令', active: tab === 'session', onSelect: () => setTab('session') }),
          busy ? h('span', { style: { ...styles.muted, alignSelf: 'center' } }, '处理中…') : null),
        tab === 'skills' ? h(SkillsTab, { overview, busy, toggleSource, toggleSkill, setManySkills }) : null,
        tab === 'mcp' ? h(McpTab, { overview, busy, connect, disconnect }) : null,
        tab === 'session' ? h(SessionTab, { sessions, sessionId, promptText, busy, selectSession, setPromptText, savePrompt, clearPrompt, reloadSessions: loadSessions }) : null)
    }

    /** Services this browser half uses. */
    const inject = ['slots']

    /** Register the Settings page. */
    function apply(ctx) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'external-import',
        order: 40,
        label: () => '外部导入',
      }, ExternalImportSection))
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
