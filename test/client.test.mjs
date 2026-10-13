// 浏览器半侧的离线自测：不装浏览器，直接在 Node 里跑 client.js 的模块工厂、成本
// 轮询与组件渲染。
//
//   node --test test/client.test.mjs
//
// 验证内容：模块 id、导出、slot 注册目标/参数、样式注入，成本轮询对
// usage-billing 路由的解析与降级，以及徽章在「命中投影」「只有 modelSelection
// 兜底」「带 ¥ 金额」「完全没有数据」四种情况下的渲染结果。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/** Minimal React stand-in: element trees only, no renderer. */
const React = {
  createElement(type, props, ...children) {
    return { type, props: { ...(props ?? {}), children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false) } }
  },
  Fragment: Symbol('Fragment'),
  useSyncExternalStore(subscribe, getSnapshot) {
    return getSnapshot()
  },
}

/** A fetch response stub. */
const jsonResponse = (body) => ({ ok: true, json: async () => body })

/**
 * Load client.js against stubs, apply it, and hand back the registered occupant.
 * @param options - locale, fetch stub, row config.
 * @returns the registered component plus what apply() touched.
 */
function setup(options = {}) {
  const { lang = 'zh-CN', fetchImpl = async () => ({ ok: false }), config } = options
  const loads = []
  const styles = []
  const cleanups = []
  const windowStub = { __ModuleLoader__: { load: (definition) => loads.push(definition) } }
  const documentStub = {
    hidden: false,
    documentElement: { lang },
    head: { appendChild: (element) => styles.push(element) },
    createElement: (tag) => ({ tag, id: '', textContent: '', remove() {} }),
    getElementById: () => null,
    addEventListener() {},
    removeEventListener() {},
  }
  const previousFetch = globalThis.fetch
  globalThis.fetch = fetchImpl
  try {
    const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
    new Function('window', 'document', source)(windowStub, documentStub)
    const definition = loads[0]
    const exportsObject = definition.factory((specifier) => {
      if (specifier === 'react') return React
      throw new Error(`client.js required an unexpected module: ${specifier}`)
    })
    const registrations = []
    exportsObject.apply(
      {
        effect: (callback) => {
          const cleanup = callback()
          if (typeof cleanup === 'function') cleanups.push(cleanup)
          return cleanup
        },
        slots: {
          inject: (key, callback) => callback(),
          register: (slotOptions, component) => registrations.push({ slotOptions, component }),
        },
      },
      config,
    )
    return { definition, exportsObject, registrations, styles, cleanups, Badge: registrations[0].component, slotOptions: registrations[0].slotOptions }
  } finally {
    globalThis.fetch = previousFetch
  }
}

/** Every string in an element tree, in order. */
function textOf(element) {
  if (typeof element === 'string') return [element]
  if (element === null || element === undefined) return []
  return (element.props.children ?? []).flatMap((child) => textOf(child))
}

/** The badge's tooltip text. */
function titleOf(element) {
  return element.props.children[0].props.title
}

test('client.js registers one module whose id is the package name', () => {
  const { definition } = setup()
  assert.equal(definition.id, 'dsh-turn-meta-badge')
  assert.equal(typeof definition.factory, 'function')
})

test('apply injects the stylesheet and occupies the turn footer slot', () => {
  const { exportsObject, styles, slotOptions, cleanups } = setup()
  assert.deepEqual(exportsObject.inject, ['slots'])
  assert.equal(slotOptions.name, 'conversation.chat.turnTail')
  assert.equal(slotOptions.id, 'turn-meta-badge')
  assert.equal(typeof slotOptions.order, 'number')
  assert.equal(styles.length, 1)
  assert.match(styles[0].textContent, /\.dsh-turn-meta-row\{display:flex;justify-content:flex-end/)
  assert.equal(styles[0].id, 'dsh-turn-meta-badge-style')
  for (const cleanup of cleanups) cleanup()
})

test('badge renders model, reasoning depth and turn tokens', async () => {
  const { Badge, cleanups } = setup()
  const projections = {
    turnMeta: {
      header: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' },
      turns: {
        3: {
          provider: 'deepseek-official',
          model: 'deepseek-flash',
          reasoningEffort: 'high',
          steps: 1,
          inputTokens: 3221,
          outputTokens: 507,
          cacheReadTokens: 21504,
          totalTokens: 25232,
        },
      },
    },
    modelSelection: { lastUsed: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' } },
  }
  const element = Badge({ turn: 3, sessionId: 'session-1', useProjection: (key) => projections[key] })
  assert.equal(element.type, 'div')
  assert.equal(element.props.className, 'dsh-turn-meta-row')
  assert.equal(element.props['data-turn-meta'], '3')
  assert.equal(element.props['data-turn-meta-source'], 'turn')
  assert.equal(textOf(element).join(''), 'deepseek-flash·思考深度 高·用量 25.2K tok')
  const title = titleOf(element)
  assert.match(title, /deepseek-official \/ deepseek-flash/)
  assert.match(title, /未缓存输入: 3,221/)
  assert.match(title, /输出: 507/)
  assert.match(title, /合计: 25,232/)
  for (const cleanup of cleanups) cleanup()
})

test('badge appends the per-turn CNY cost reported by the billing host', async () => {
  const { Badge, cleanups } = setup({
    fetchImpl: async () =>
      jsonResponse({
        byTurn: [
          { sessionId: 'session-1', turn: 3, model: 'flash', cost: 0.10317608 },
          { sessionId: 'session-9', turn: 1, model: 'hy3', cost: 0 },
        ],
        bySession: [{ id: 'session-1', cost: 2.3759842399999997 }],
      }),
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  const projections = {
    turnMeta: { header: null, turns: { 3: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high', totalTokens: 25232 } } },
  }
  const element = Badge({ turn: 3, sessionId: 'session-1', useProjection: (key) => projections[key] })
  assert.equal(textOf(element).join(''), 'deepseek-flash·思考深度 高·用量 25.2K tok·¥0.103')
  const title = titleOf(element)
  assert.match(title, /本轮费用: ¥0\.103/)
  assert.match(title, /本会话累计: ¥2\.38/)
  for (const cleanup of cleanups) cleanup()
})

test('a zero-cost turn still shows ¥0 instead of hiding the money', async () => {
  const { Badge, cleanups } = setup({
    fetchImpl: async () => jsonResponse({ byTurn: [{ sessionId: 'session-1', turn: 1, cost: 0 }], bySession: [] }),
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  const element = Badge({
    turn: 1,
    sessionId: 'session-1',
    useProjection: () => ({ header: null, turns: { 1: { model: 'hy3', totalTokens: 120 } } }),
  })
  assert.equal(textOf(element).join(''), 'hy3·用量 120 tok·¥0')
  for (const cleanup of cleanups) cleanup()
})

test('cost is dropped when the billing route is absent, and cost:false skips the poll', async () => {
  let calls = 0
  const { Badge, cleanups } = setup({
    fetchImpl: async () => {
      calls += 1
      return { ok: false }
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(calls, 1)
  const element = Badge({
    turn: 1,
    sessionId: 'session-1',
    useProjection: () => ({ header: null, turns: { 1: { model: 'hy3', totalTokens: 120 } } }),
  })
  assert.equal(textOf(element).join(''), 'hy3·用量 120 tok')
  for (const cleanup of cleanups) cleanup()

  const disabled = setup({ config: { cost: false } })
  assert.equal(disabled.cleanups.length, 1) // 只有样式表的清理，成本轮询没启动
  for (const cleanup of disabled.cleanups) cleanup()
})

test('badge renders English labels when the GUI is not Chinese', () => {
  const { Badge, cleanups } = setup({ lang: 'en-US' })
  const element = Badge({
    turn: 1,
    useProjection: () => ({ header: { provider: 'p', model: 'hy3', reasoningEffort: 'high' }, turns: {} }),
  })
  assert.equal(textOf(element).join(''), 'hy3·depth high')
  assert.equal(element.props['data-turn-meta-source'], 'header')
  for (const cleanup of cleanups) cleanup()
})

test('badge degrades to the session selection and explains the missing projection', () => {
  const { Badge, cleanups } = setup()
  const element = Badge({
    turn: 9,
    sessionId: 'session-1',
    useProjection: (key) => (key === 'modelSelection' ? { lastUsed: { provider: 'p', model: 'deepseek-flash', reasoningEffort: 'low' } } : undefined),
  })
  assert.equal(textOf(element).join(''), 'deepseek-flash·思考深度 低')
  assert.equal(element.props['data-turn-meta-source'], 'session')
  assert.match(titleOf(element), /未收到本轮用量：刷新一次页面/)
  for (const cleanup of cleanups) cleanup()
})

test('badge renders nothing when no model is known at all', () => {
  const { Badge, cleanups } = setup()
  assert.equal(Badge({ turn: 1, useProjection: () => undefined }), null)
  for (const cleanup of cleanups) cleanup()
})
