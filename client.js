/**
 * dsh-turn-meta-badge — browser half.
 *
 * One occupant of the completed-Turn footer slot `conversation.chat.turnTail`
 * (declared by `@deepseek-ai/dsh-client-ui-chat`), right-aligned so it reads as
 * the bottom-right meta line of every assistant reply:
 *
 *     deepseek-flash · 思考深度 高 · 用量 25.2k tok
 *
 * Values come from the host-half Session projection `turnMeta`; when that
 * projection is absent (host half not loaded) the badge degrades to the
 * Session's current `modelSelection` and simply omits the token figure.
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

    const CSS = [
      '.dsh-turn-meta-row{display:flex;justify-content:flex-end;width:100%;min-width:0;margin-bottom:-8px}',
      '.dsh-turn-meta{display:inline-flex;align-items:center;gap:8px;max-width:100%;min-width:0;',
      'color:var(--dsw-alias-label-tertiary);',
      'font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);',
      'line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));',
      'font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.dsh-turn-meta__model{overflow:hidden;text-overflow:ellipsis;max-width:min(320px,40vw)}',
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

    /** The effort label for one catalog id, or `null` when the id is absent. */
    function effortLabel(effort, chinese) {
      if (typeof effort !== 'string' || effort === '') return null
      const table = chinese ? EFFORT_ZH : EFFORT_EN
      return table[effort] ?? effort
    }

    /** Hover detail: exact buckets of the Turn beyond the inline summary. */
    function detailOf(entry, chinese) {
      if (entry === undefined || entry === null) return undefined
      const lines = []
      if (typeof entry.provider === 'string' && typeof entry.model === 'string') {
        lines.push(`${entry.provider} / ${entry.model}`)
      }
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
      return lines.length === 0 ? undefined : lines.join('\n')
    }

    /**
     * Bottom-right meta line of one completed Turn.
     * @param props - slot owner props (`turn`), plus the Session standard kit.
     * @returns the badge, or `null` while no model is known for the Turn.
     */
    function TurnMetaBadge(props) {
      const turn = props.turn
      const useProjection = props.useProjection
      const hasProjection = typeof useProjection === 'function'
      const projection = hasProjection ? useProjection('turnMeta') : undefined
      const selection = hasProjection ? useProjection('modelSelection') : undefined
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

      const parts = []
      if (typeof model === 'string' && model !== '') {
        parts.push(React.createElement('span', { className: 'dsh-turn-meta__model', key: 'model' }, model))
      }
      const effortText = effortLabel(effort, chinese)
      if (effortText !== null) {
        parts.push(
          React.createElement(
            'span',
            { key: 'effort' },
            `${chinese ? '思考深度' : 'depth'} ${effortText}`,
          ),
        )
      }
      if (entry !== undefined && isCount(entry.totalTokens)) {
        parts.push(
          React.createElement(
            'span',
            { key: 'usage' },
            `${chinese ? '用量' : 'usage'} ${formatTokens(entry.totalTokens)} tok`,
          ),
        )
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

      return React.createElement(
        'div',
        { className: 'dsh-turn-meta-row', 'data-turn-meta': key },
        React.createElement('span', { className: 'dsh-turn-meta', title: detailOf(entry ?? live, chinese) }, children),
      )
    }

    /** Cordis services required by this half. */
    const inject = ['slots']

    /**
     * Install the badge stylesheet and the footer-slot occupant.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      ctx.effect(() => {
        if (document.getElementById(STYLE_ID) !== null) return
        const style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'turn-meta-badge: stylesheet')

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
