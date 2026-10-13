/**
 * dsh-turn-meta-badge — browser half.
 *
 * One occupant of the completed-Turn footer slot `conversation.chat.turnTail`
 * (declared by `@deepseek-ai/dsh-client-ui-chat`), right-aligned so it reads as
 * the bottom-right meta line of every assistant reply:
 *
 *     deepseek-flash · 思考深度 高 · 用量 25.2K tok · ¥0.1032
 *
 * Model, reasoning effort and per-Turn tokens come from the host-half Session
 * projection `turnMeta`. Cost (CNY) comes from the installed usage-billing
 * plugin's loopback route `/api/billing/usage-stats` (`byTurn` rows) when that
 * plugin is present; without it the cost segment is simply absent, and without
 * the projection the badge degrades to the Session's current `modelSelection`.
 *
 * Plain-JS bundle: no build step, no dependency beyond the platform seed table.
 */

window.__ModuleLoader__.load({
  id: 'dsh-turn-meta-badge',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    /** `id` of the injected stylesheet, so a reload replaces rather than stacks it. */
    const STYLE_ID = 'dsh-turn-meta-badge-style'

    /** Polled route of the usage-billing plugin; the only cost source on this host. */
    const COST_ROUTE = '/api/billing/usage-stats'

    /** Default cost poll period: the billing host coalesces its own aggregation for 5s. */
    const DEFAULT_POLL_MS = 30000

    const CSS = [
      '.dsh-turn-meta-row{display:flex;justify-content:flex-end;width:100%;min-width:0;margin-bottom:-8px}',
      '.dsh-turn-meta{display:inline-flex;align-items:center;gap:8px;max-width:100%;min-width:0;',
      'color:var(--dsw-alias-label-tertiary);',
      'font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);',
      'line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));',
      'font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.dsh-turn-meta__model{overflow:hidden;text-overflow:ellipsis;max-width:min(320px,40vw)}',
      '.dsh-turn-meta__cost{color:var(--dsw-alias-label-secondary)}',
      '.dsh-turn-meta__sep{color:var(--dsw-alias-separator-primary)}',
    ].join('')

    /** Effort ids are model-catalog owned; unknown ids fall through verbatim. */
    const EFFORT_ZH = {
      none: '无',
      minimal: '极简',
      low: '低',
      medium: '中',
      high: '高',
      xhigh: '极高',
      max: '最高',
    }
    const EFFORT_EN = {
      none: 'none',
      minimal: 'minimal',
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max',
    }

    /** Whether the GUI is currently Chinese. */
    function isChinese() {
      const lang = document.documentElement.lang
      return typeof lang === 'string' && lang.toLowerCase().startsWith('zh')
    }

    /** Whether one projection field is a renderable non-negative count. */
    function isCount(value) {
      return typeof value === 'number' && Number.isFinite(value) && value >= 0
    }

    /**
     * Compact token figure using the built-in chat rule: 517 / 12.2K / 517K / 1.2M.
     * @param value - non-negative token count.
     * @returns compact display string, or `''` for a missing count.
     */
    function formatTokens(value) {
      if (!isCount(value)) return ''
      if (value < 1000) return String(value)
      const scaled = (candidate) => (candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10))
      if (value < 1000000) return `${scaled(value / 1000)}K`
      return `${scaled(value / 1000000)}M`
    }

    /** Exact figure for the hover detail. */
    function exact(value) {
      return isCount(value) ? value.toLocaleString('en-US') : ''
    }

    /**
     * CNY figure: keep cents for ordinary amounts, and four significant decimals
     * for sub-cent Turns (single cheap calls really do cost fractions of a cent).
     * @param value - cost in CNY.
     * @returns display string without the currency symbol.
     */
    function formatCny(value) {
      if (!Number.isFinite(value)) return ''
      if (value === 0) return '0'
      if (value >= 1) return value.toFixed(2)
      if (value >= 0.01) return value.toFixed(3)
      return value.toFixed(4)
    }

    /** The effort label for one catalog id, or `null` when the id is absent. */
    function effortLabel(effort, chinese) {
      if (typeof effort !== 'string' || effort === '') return null
      const table = chinese ? EFFORT_ZH : EFFORT_EN
      return table[effort] ?? effort
    }

    /**
     * Hover detail: exact buckets of the Turn beyond the inline summary.
     * @param entry - the turn's `turnMeta` row (`undefined` when the projection missed it).
     * @param live - the projection's in-force header.
     * @param turnCost - this Turn's CNY cost, when the billing host reported one.
     * @param sessionCost - the Session's cumulative CNY cost, when reported.
     * @param chinese - whether to label in Chinese.
     * @returns the tooltip text, or `undefined` when there is nothing to add.
     */
    function detailOf(entry, live, turnCost, sessionCost, chinese) {
      const lines = []
      const route = entry ?? live
      if (route !== undefined && route !== null && typeof route.provider === 'string' && typeof route.model === 'string') {
        lines.push(`${route.provider} / ${route.model}`)
      }
      if (entry !== undefined && entry !== null) {
        const effort = effortLabel(entry.reasoningEffort, chinese)
        if (effort !== null) lines.push(`${chinese ? '思考深度' : 'Reasoning effort'}: ${effort}`)
        if (isCount(entry.inputTokens)) lines.push(`${chinese ? '未缓存输入' : 'Uncached input'}: ${exact(entry.inputTokens)}`)
        if (isCount(entry.cacheReadTokens)) lines.push(`${chinese ? '缓存读取' : 'Cached input'}: ${exact(entry.cacheReadTokens)}`)
        if (isCount(entry.cacheWriteTokens)) lines.push(`${chinese ? '缓存写入' : 'Cache write'}: ${exact(entry.cacheWriteTokens)}`)
        if (isCount(entry.outputTokens)) {
          const reasoning = isCount(entry.reasoningTokens)
            ? chinese
              ? `（其中推理 ${exact(entry.reasoningTokens)}）`
              : ` (${exact(entry.reasoningTokens)} reasoning)`
            : ''
          lines.push(`${chinese ? '输出' : 'Output'}: ${exact(entry.outputTokens)}${reasoning}`)
        }
        if (isCount(entry.totalTokens)) lines.push(`${chinese ? '合计' : 'Total'}: ${exact(entry.totalTokens)}`)
      } else {
        // The page loaded before this plugin's projection existed; its Session
        // payload carries no `turnMeta` until the next load.
        lines.push(chinese ? '未收到本轮用量：刷新一次页面即可载入 host 投影 turnMeta' : 'Turn usage unavailable: reload the page once to receive the turnMeta projection')
      }
      if (Number.isFinite(turnCost)) lines.push(`${chinese ? '本轮费用' : 'Turn cost'}: ¥${formatCny(turnCost)}`)
      if (Number.isFinite(sessionCost)) lines.push(`${chinese ? '本会话累计' : 'Session total'}: ¥${formatCny(sessionCost)}`)
      return lines.length === 0 ? undefined : lines.join('\n')
    }

    /**
     * Polled cost store over the usage-billing plugin's `byTurn`/`bySession` rows.
     * @returns the store handle used by the badge component.
     */
    function createCostStore() {
      const listeners = new Set()
      let snapshot = { status: 'idle', turns: null, sessions: null }
      let timer = null
      let pollMs = DEFAULT_POLL_MS
      let stopped = false

      const publish = (next) => {
        snapshot = next
        for (const listener of listeners) listener()
      }

      const load = async () => {
        if (stopped) return
        const fetchImpl = globalThis.fetch
        if (typeof fetchImpl !== 'function') {
          publish({ status: 'unavailable', turns: null, sessions: null })
          return
        }
        try {
          const response = await fetchImpl(COST_ROUTE, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
          if (response === undefined || response === null || response.ok !== true) {
            // No billing host on this profile: stop asking, keep the tokens line.
            publish({ status: 'unavailable', turns: null, sessions: null })
            stopTimer()
            return
          }
          const document_ = await response.json()
          const turns = new Map()
          for (const row of Array.isArray(document_?.byTurn) ? document_.byTurn : []) {
            if (typeof row?.sessionId === 'string' && Number.isFinite(row?.cost)) turns.set(`${row.sessionId}#${row.turn}`, row.cost)
          }
          const sessions = new Map()
          for (const row of Array.isArray(document_?.bySession) ? document_.bySession : []) {
            if (typeof row?.id === 'string' && Number.isFinite(row?.cost)) sessions.set(row.id, row.cost)
          }
          publish({ status: 'ready', turns, sessions })
        } catch {
          publish({ status: 'error', turns: null, sessions: null })
        }
      }

      function stopTimer() {
        if (timer !== null) {
          clearInterval(timer)
          timer = null
        }
      }

      const onVisibility = () => {
        if (document.hidden !== true && snapshot.status === 'ready') void load()
      }

      return {
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        getSnapshot() {
          return snapshot
        },
        start(options) {
          if (options !== undefined && Number.isFinite(options.pollMs) && options.pollMs > 0) pollMs = options.pollMs
          void load()
          stopTimer()
          timer = setInterval(() => {
            if (document.hidden !== true) void load()
          }, pollMs)
          document.addEventListener('visibilitychange', onVisibility)
        },
        stop() {
          stopped = true
          stopTimer()
          document.removeEventListener('visibilitychange', onVisibility)
          listeners.clear()
        },
      }
    }

    /** One store per plugin instance; the slot occupant subscribes to it. */
    const costStore = createCostStore()

    /** `useSyncExternalStore` when the platform React has it (React 18+). */
    const useSyncExternalStore = React.useSyncExternalStore

    /** Subscribe the badge to polled costs without re-rendering on unrelated slot churn. */
    function useCostSnapshot() {
      if (typeof useSyncExternalStore !== 'function') return undefined
      return useSyncExternalStore(costStore.subscribe, costStore.getSnapshot)
    }

    /**
     * Bottom-right meta line of one completed Turn.
     * @param props - slot owner props (`turn`), plus the Session standard kit.
     * @returns the badge, or `null` while nothing is known about the Turn.
     */
    function TurnMetaBadge(props) {
      const turn = props.turn
      const useProjection = props.useProjection
      const hasProjection = typeof useProjection === 'function'
      const projection = hasProjection ? useProjection('turnMeta') : undefined
      const selection = hasProjection ? useProjection('modelSelection') : undefined
      const costs = useCostSnapshot()
      const chinese = isChinese()

      const key = turn === undefined || turn === null ? undefined : String(turn)
      const entry =
        key === undefined || projection === undefined || projection === null || projection.turns === undefined
          ? undefined
          : projection.turns[key]
      const live =
        projection !== undefined && projection !== null && projection.header !== undefined && projection.header !== null
          ? projection.header
          : undefined
      const sessionSelection =
        selection === undefined || selection === null ? undefined : (selection.lastUsed ?? selection.next ?? undefined)
      const model =
        (entry === undefined ? undefined : entry.model) ??
        (live === undefined ? undefined : live.model) ??
        (sessionSelection === undefined ? undefined : sessionSelection.model)
      const effort =
        (entry === undefined ? undefined : entry.reasoningEffort) ??
        (live === undefined ? undefined : live.reasoningEffort) ??
        (sessionSelection === undefined ? undefined : sessionSelection.reasoningEffort)

      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : undefined
      const turnCost =
        costs !== undefined && costs.turns !== null && sessionId !== undefined && key !== undefined
          ? costs.turns.get(`${sessionId}#${key}`)
          : undefined
      const sessionCost = costs !== undefined && costs.sessions !== null && sessionId !== undefined ? costs.sessions.get(sessionId) : undefined

      const parts = []
      if (typeof model === 'string' && model !== '') {
        parts.push(React.createElement('span', { className: 'dsh-turn-meta__model', key: 'model' }, model))
      }
      const effortText = effortLabel(effort, chinese)
      if (effortText !== null) {
        parts.push(React.createElement('span', { key: 'effort' }, `${chinese ? '思考深度' : 'depth'} ${effortText}`))
      }
      if (entry !== undefined && isCount(entry.totalTokens)) {
        parts.push(
          React.createElement('span', { key: 'usage' }, `${chinese ? '用量' : 'usage'} ${formatTokens(entry.totalTokens)} tok`),
        )
      }
      if (Number.isFinite(turnCost)) {
        parts.push(React.createElement('span', { className: 'dsh-turn-meta__cost', key: 'cost' }, `¥${formatCny(turnCost)}`))
      }
      if (parts.length === 0) return null

      const children = []
      for (let index = 0; index < parts.length; index += 1) {
        if (index > 0) {
          children.push(
            React.createElement('span', { className: 'dsh-turn-meta__sep', key: `sep-${index}`, 'aria-hidden': true }, '·'),
          )
        }
        children.push(parts[index])
      }

      const source = entry !== undefined ? 'turn' : live !== undefined ? 'header' : sessionSelection !== undefined ? 'session' : 'none'

      return React.createElement(
        'div',
        { className: 'dsh-turn-meta-row', 'data-turn-meta': key, 'data-turn-meta-source': source },
        React.createElement(
          'span',
          { className: 'dsh-turn-meta', title: detailOf(entry, live, turnCost, sessionCost, chinese) },
          children,
        ),
      )
    }

    /** Cordis services required by this half. */
    const inject = ['slots']

    /**
     * Install the badge stylesheet, start the cost poll, and occupy the footer slot.
     * @param ctx - client root context.
     * @param config - row config; `cost: false` disables the cost source, `pollMs` tunes it.
     */
    function apply(ctx, config) {
      const settings = config !== null && typeof config === 'object' ? config : {}

      ctx.effect(() => {
        if (document.getElementById(STYLE_ID) !== null) return
        const style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'turn-meta-badge: stylesheet')

      if (settings.cost !== false) {
        ctx.effect(() => {
          costStore.start(settings.pollMs === undefined ? undefined : { pollMs: settings.pollMs })
          return () => costStore.stop()
        }, 'turn-meta-badge: cost poll')
      }

      ctx.slots.inject('conversation.chat.turnTail', () =>
        ctx.slots.register(
          {
            name: 'conversation.chat.turnTail',
            id: 'turn-meta-badge',
            order: 40,
          },
          TurnMetaBadge,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
