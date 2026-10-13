/**
 * dsh-turn-meta-badge — browser half.
 *
 * One occupant of the completed-Turn footer slot `conversation.chat.turnTail`
 * (declared by `@deepseek-ai/dsh-client-ui-chat`), right-aligned so it reads as
 * the bottom-right meta line of every assistant reply — everything inline, no
 * hover dependency:
 *
 *     glm-5.3-flash · 思考深度 高 · 21.6万 tok · ¥0.103
 *
 * Data sources, in priority order:
 * - tokens & cost: the installed usage-billing plugin's loopback route
 *   `/api/billing/usage-stats` (`byTurn` rows carry per-turn token buckets and
 *   the CNY cost) — polled, so it never depends on when the page was loaded;
 * - model & reasoning effort: the host-half Session projection `turnMeta`
 *   (per-turn), degrading to the Session's current `modelSelection`.
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

    /** Polled route of the usage-billing plugin; the primary token/cost source. */
    const STATS_ROUTE = '/api/billing/usage-stats'

    /** Poll period: fresh enough for a just-finished Turn, light enough to leave on. */
    const DEFAULT_POLL_MS = 15000

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

    /** Whether one field is a renderable non-negative number. */
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
     * One Turn's token buckets as the billing host reported them.
     * @param row - a `byTurn` row (`{input, output, cacheHit, cacheMiss, …}`).
     * @returns the summed token count, or `undefined` when the row carries none.
     */
    function tokensOfRow(row) {
      const total = (row.input ?? 0) + (row.output ?? 0) + (row.cacheHit ?? 0) + (row.cacheMiss ?? 0)
      return total > 0 ? total : undefined
    }

    /**
     * Polled store over the usage-billing plugin's `byTurn`/`bySession` rows:
     * per-Turn tokens & cost, plus per-Session totals.
     * @returns the store handle used by the badge component.
     */
    function createStatsStore() {
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
          const response = await fetchImpl(STATS_ROUTE, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
          if (response === undefined || response === null || response.ok !== true) {
            // No billing host on this profile: stop asking.
            publish({ status: 'unavailable', turns: null, sessions: null })
            stopTimer()
            return
          }
          const document_ = await response.json()
          const turns = new Map()
          for (const row of Array.isArray(document_?.byTurn) ? document_.byTurn : []) {
            if (typeof row?.sessionId !== 'string') continue
            const turn = typeof row?.turn === 'number' ? row.turn : undefined
            if (turn === undefined) continue
            turns.set(`${row.sessionId}#${turn}`, {
              tokens: tokensOfRow(row),
              cost: Number.isFinite(row?.cost) ? row.cost : undefined,
            })
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
    const statsStore = createStatsStore()

    /** `useSyncExternalStore` when the platform React has it (React 18+). */
    const useSyncExternalStore = React.useSyncExternalStore

    /** Subscribe the badge to polled turn stats. */
    function useStatsSnapshot() {
      if (typeof useSyncExternalStore !== 'function') return undefined
      return useSyncExternalStore(statsStore.subscribe, statsStore.getSnapshot)
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
      const stats = useStatsSnapshot()
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
      const billing =
        stats !== undefined && stats.turns !== null && sessionId !== undefined && key !== undefined
          ? stats.turns.get(`${sessionId}#${key}`)
          : undefined
      const sessionCost =
        stats !== undefined && stats.sessions !== null && sessionId !== undefined ? stats.sessions.get(sessionId) : undefined

      // Tokens: billing's per-turn buckets win (they are independent of page load
      // timing); the host projection is the fallback.
      const tokens = (billing === undefined ? undefined : billing.tokens) ?? (entry === undefined ? undefined : entry.totalTokens)
      const cost = billing === undefined ? undefined : billing.cost

      const parts = []
      if (typeof model === 'string' && model !== '') {
        parts.push(React.createElement('span', { className: 'dsh-turn-meta__model', key: 'model' }, model))
      }
      const effortText = effortLabel(effort, chinese)
      if (effortText !== null) {
        parts.push(React.createElement('span', { key: 'effort' }, `${chinese ? '思考深度' : 'depth'} ${effortText}`))
      }
      if (isCount(tokens)) {
        parts.push(React.createElement('span', { key: 'usage' }, `${chinese ? '用量' : 'usage'} ${formatTokens(tokens)} tok`))
      }
      if (Number.isFinite(cost)) {
        parts.push(React.createElement('span', { className: 'dsh-turn-meta__cost', key: 'cost' }, `¥${formatCny(cost)}`))
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

      const source = billing !== undefined ? 'billing' : entry !== undefined ? 'turn' : live !== undefined ? 'header' : 'session'

      return React.createElement(
        'div',
        { className: 'dsh-turn-meta-row', 'data-turn-meta': key, 'data-turn-meta-source': source },
        React.createElement('span', { className: 'dsh-turn-meta' }, children),
      )
    }

    /** Cordis services required by this half. */
    const inject = ['slots']

    /**
     * Install the badge stylesheet, start the stats poll, and occupy the footer slot.
     * @param ctx - client root context.
     * @param config - row config; `cost: false` disables the billing poll, `pollMs` tunes it.
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
          statsStore.start(settings.pollMs === undefined ? undefined : { pollMs: settings.pollMs })
          return () => statsStore.stop()
        }, 'turn-meta-badge: stats poll')
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
