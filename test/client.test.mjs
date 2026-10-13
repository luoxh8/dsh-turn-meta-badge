// 浏览器半侧的离线自测：不装浏览器，直接在 Node 里跑 client.js 的模块工厂与组件逻辑。
//
//   node --test test/client.test.mjs
//
// 验证内容：模块 id、导出、slot 注册目标/参数、样式注入，以及徽章在
// 命中投影、只有 modelSelection 兜底、完全没有数据三种情况下的渲染结果。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/** Minimal React stand-in: element trees only, no renderer. */
const React = {
  createElement(type, props, ...children) {
    return { type, props: { ...(props ?? {}), children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false) } }
  },
  Fragment: Symbol('Fragment'),
}

/** Load client.js against stubs and return what it registered. */
function loadClient(lang = 'zh-CN') {
  const loads = []
  const styles = []
  const windowStub = { __ModuleLoader__: { load: (definition) => loads.push(definition) } }
  const documentStub = {
    documentElement: { lang },
    head: { appendChild: (element) => styles.push(element) },
    createElement: (tag) => ({ tag, id: '', textContent: '', remove() {} }),
    getElementById: () => null,
  }
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  new Function('window', 'document', source)(windowStub, documentStub)

  const definition = loads[0]
  const exportsObject = definition.factory((specifier) => {
    if (specifier === 'react') return React
    throw new Error(`client.js required an unexpected module: ${specifier}`)
  })
  return { definition, exportsObject, styles, documentStub }
}

/** Every string in an element tree, in order. */
function textOf(element) {
  if (typeof element === 'string') return [element]
  if (element === null || element === undefined) return []
  return (element.props.children ?? []).flatMap((child) => textOf(child))
}

test('client.js registers one module whose id is the package name', () => {
  const { definition } = loadClient()
  assert.equal(definition.id, 'dsh-turn-meta-badge')
  assert.equal(typeof definition.factory, 'function')
})

test('apply injects the stylesheet and occupies the turn footer slot', () => {
  const { exportsObject, styles } = loadClient()
  const registrations = []
  const injected = []
  const ctx = {
    effect: (callback) => callback(),
    slots: {
      inject: (key, callback) => {
        injected.push(key)
        return callback()
      },
      register: (options, component) => {
        registrations.push({ options, component })
        return { dispose() {} }
      },
    },
  }
  exportsObject.apply(ctx)

  assert.deepEqual(exportsObject.inject, ['slots'])
  assert.deepEqual(injected, ['conversation.chat.turnTail'])
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].options.name, 'conversation.chat.turnTail')
  assert.equal(registrations[0].options.id, 'turn-meta-badge')
  assert.equal(typeof registrations[0].options.order, 'number')
  assert.equal(styles.length, 1)
  assert.match(styles[0].textContent, /\.dsh-turn-meta-row\{display:flex;justify-content:flex-end/)
  assert.equal(styles[0].id, 'dsh-turn-meta-badge-style')
})

test('badge renders model, reasoning depth and turn tokens', () => {
  const { exportsObject } = loadClient('zh-CN')
  const component = exportsObject.apply === undefined ? undefined : null
  const registrations = []
  exportsObject.apply({
    effect: (callback) => callback(),
    slots: {
      inject: (key, callback) => callback(),
      register: (options, fn) => registrations.push(fn),
    },
  })
  const Badge = registrations[0]
  void component // 组件由注册回调给出

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
  const element = Badge({ turn: 3, useProjection: (key) => projections[key] })
  assert.equal(element.type, 'div')
  assert.equal(element.props.className, 'dsh-turn-meta-row')
  assert.equal(element.props['data-turn-meta'], '3')
  const text = textOf(element).join('')
  assert.equal(text, 'deepseek-flash·思考深度 高·用量 25.2K tok')
  // hover 详情带精确桶
  const badge = element.props.children[0]
  assert.equal(badge.props.className, 'dsh-turn-meta')
  assert.match(badge.props.title, /未缓存输入: 3,221/)
  assert.match(badge.props.title, /输出: 507/)
  assert.match(badge.props.title, /合计: 25,232/)
})

test('badge renders English labels when the GUI is not Chinese', () => {
  const { exportsObject } = loadClient('en-US')
  const registrations = []
  exportsObject.apply({
    effect: (callback) => callback(),
    slots: { inject: (key, callback) => callback(), register: (options, fn) => registrations.push(fn) },
  })
  const element = registrations[0]({
    turn: 1,
    useProjection: () => ({ header: { provider: 'p', model: 'hy3', reasoningEffort: 'high' }, turns: {} }),
  })
  assert.equal(textOf(element).join(''), 'hy3·depth high')
})

test('badge degrades to the session selection when the host projection is absent', () => {
  const { exportsObject } = loadClient('zh-CN')
  const registrations = []
  exportsObject.apply({
    effect: (callback) => callback(),
    slots: { inject: (key, callback) => callback(), register: (options, fn) => registrations.push(fn) },
  })
  const element = registrations[0]({
    turn: 9,
    useProjection: (key) => (key === 'modelSelection' ? { lastUsed: { provider: 'p', model: 'deepseek-flash', reasoningEffort: 'low' } } : undefined),
  })
  assert.equal(textOf(element).join(''), 'deepseek-flash·思考深度 低')
})

test('badge renders nothing when no model is known at all', () => {
  const { exportsObject } = loadClient('zh-CN')
  const registrations = []
  exportsObject.apply({
    effect: (callback) => callback(),
    slots: { inject: (key, callback) => callback(), register: (options, fn) => registrations.push(fn) },
  })
  assert.equal(registrations[0]({ turn: 1, useProjection: () => undefined }), null)
})
