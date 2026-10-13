// 投影折叠的自测：合成事件用例 + 可选的真实会话日志回放。
//
//   node --test test/                     # 只跑合成用例
//   $env:DSH_SESSION_JSONL='D:\...\session.jsonl'; node --test test/   # 追加真实日志回放
//
// 真实日志回放会把投影结果与「独立数出来的原始事件」逐轮对比：轮数、每轮 token
// 合计、每轮模型/思考深度都必须一致，否则测试失败。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { turnMetaProjection } from '../index.js'

/** Drive the projection definition the way the registry does. */
function fold(events) {
  let state = turnMetaProjection.init()
  for (const event of events) state = turnMetaProjection.apply(state, event)
  return turnMetaProjection.wire.view(state)
}

const header = (config) => ({ type: 'request/header', seq: 1, time: 0, data: { header: { config } } })
const turnStart = (turn) => ({ type: 'turn/start', seq: 2, time: 0, data: { turn } })
const turnEnd = (turn) => ({ type: 'turn/end', seq: 3, time: 0, data: { turn, reason: { kind: 'completed' } } })
const assistant = (turn, step, usage, source) => ({
  type: 'assistant/message',
  seq: 4,
  time: 0,
  data: {
    turn,
    step,
    usage,
    message: {
      role: 'assistant',
      content: [],
      id: `m-${turn}-${step}`,
      source: source ?? { kind: 'model', provider: 'deepseek-official', model: 'deepseek-flash' },
    },
  },
})

test('one turn reports the route actually used and the logged request effort', () => {
  const view = fold([
    header({ provider: 'workbuddy', model: 'hy3', reasoningEffort: 'high' }),
    turnStart(1),
    assistant(1, 1, { inputTokens: 100, outputTokens: 10, cacheReadTokens: 4890, totalTokens: 5000 }),
    turnEnd(1),
  ])
  assert.deepEqual(view.turns['1'], {
    provider: 'deepseek-official',
    model: 'deepseek-flash',
    reasoningEffort: 'high',
    steps: 1,
    inputTokens: 100,
    outputTokens: 10,
    totalTokens: 5000,
    cacheReadTokens: 4890,
  })
})

test('attempts of one turn are summed across steps', () => {
  const view = fold([
    header({ provider: 'p', model: 'm', reasoningEffort: 'medium' }),
    turnStart(7),
    assistant(7, 1, { inputTokens: 10, outputTokens: 1, totalTokens: 11 }),
    assistant(7, 2, { inputTokens: 20, outputTokens: 2, totalTokens: 22 }),
    turnEnd(7),
  ])
  assert.equal(view.turns['7'].steps, 2)
  assert.equal(view.turns['7'].inputTokens, 30)
  assert.equal(view.turns['7'].outputTokens, 3)
  assert.equal(view.turns['7'].totalTokens, 33)
  assert.equal(view.turns['7'].reasoningEffort, 'medium')
  // 缓存桶不是每个 attempt 都报，聚合时整体省略而不是编造 0。
  assert.equal('cacheReadTokens' in view.turns['7'], false)
})

test('a retried attempt replaces its own buckets instead of double counting', () => {
  const first = assistant(3, 1, { inputTokens: 10, outputTokens: 1, totalTokens: 11 })
  const view = fold([
    header({ provider: 'p', model: 'm' }),
    turnStart(3),
    first,
    { type: 'llm/retry-started', seq: 5, time: 0, data: { turn: 3, step: 1 } },
    assistant(3, 1, { inputTokens: 40, outputTokens: 4, totalTokens: 44 }),
    turnEnd(3),
  ])
  assert.equal(view.turns['3'].steps, 1)
  assert.equal(view.turns['3'].totalTokens, 44)
})

test('a turn with no attempt yet still reports the model in force', () => {
  const view = fold([header({ provider: 'workbuddy', model: 'hy3' }), turnStart(2)])
  assert.deepEqual(view.turns['2'], { provider: 'workbuddy', model: 'hy3', steps: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 })
})

test('unrelated events keep the state reference unchanged', () => {
  let state = turnMetaProjection.apply(turnMetaProjection.init(), header({ provider: 'p', model: 'm' }))
  const before = state
  for (const event of [
    { type: 'tool/call', seq: 9, time: 0, data: { turn: 1, step: 1 } },
    { type: 'session/title', seq: 10, time: 0, data: { title: 'x' } },
    { type: 'request/header', seq: 11, time: 0, data: { header: { config: { provider: 'p', model: 'm' } } } },
    { type: 'turn/start', seq: 12, time: 0, data: { turn: 1 } },
    { type: 'turn/start', seq: 13, time: 0, data: { turn: 1 } },
  ]) {
    state = turnMetaProjection.apply(state, event)
  }
  assert.notEqual(state, before) // turn/start 建了条目
  const afterTurn = state
  assert.equal(turnMetaProjection.apply(afterTurn, { type: 'tool/result', seq: 14, time: 0, data: { turn: 1, step: 1 } }), afterTurn)
})

test('a usage sample carried only by the stream still counts', () => {
  const view = fold([
    header({ provider: 'p', model: 'm' }),
    turnStart(4),
    {
      type: 'assistant/attempt',
      seq: 6,
      time: 0,
      data: {
        turn: 4,
        step: 1,
        stream: [
          { type: 'chunk', time: 1, chunk: { type: 'text-delta', text: 'hi' } },
          { type: 'chunk', time: 2, chunk: { type: 'usage', usage: { inputTokens: 5, outputTokens: 6, totalTokens: 11 } } },
        ],
      },
    },
  ])
  assert.equal(view.turns['4'].totalTokens, 11)
  assert.equal(view.turns['4'].model, 'm')
})

test('real session log replay matches an independent count', { skip: process.env.DSH_SESSION_JSONL === undefined ? 'set DSH_SESSION_JSONL to a decoded .jsonl session log' : false }, () => {
  const events = readFileSync(process.env.DSH_SESSION_JSONL, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))

  const view = fold(events)

  // 独立口径：直接数原始事件。
  const expectedTurns = new Set(events.filter((event) => event.type === 'turn/start').map((event) => String(event.data.turn)))
  assert.deepEqual(new Set(Object.keys(view.turns)), expectedTurns)

  const sums = new Map()
  const routes = new Map()
  let effort = undefined
  for (const event of events) {
    if (event.type === 'request/header') effort = event.data.header.config.reasoningEffort
    if (event.type !== 'assistant/message') continue
    const turn = String(event.data.turn)
    const usage = event.data.usage
    if (usage === undefined) continue
    const bucket = sums.get(turn) ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    bucket.inputTokens += usage.inputTokens
    bucket.outputTokens += usage.outputTokens
    bucket.totalTokens += usage.totalTokens
    sums.set(turn, bucket)
    routes.set(turn, event.data.message.source.model)
    if (effort !== undefined) routes.set(`${turn}#effort`, effort)
  }
  for (const [turn, bucket] of sums) {
    assert.equal(view.turns[turn].totalTokens, bucket.totalTokens, `turn ${turn} totalTokens`)
    assert.equal(view.turns[turn].inputTokens, bucket.inputTokens, `turn ${turn} inputTokens`)
    assert.equal(view.turns[turn].outputTokens, bucket.outputTokens, `turn ${turn} outputTokens`)
    assert.equal(view.turns[turn].model, routes.get(turn), `turn ${turn} model`)
    assert.equal(view.turns[turn].reasoningEffort, routes.get(`${turn}#effort`), `turn ${turn} effort`)
  }
  console.log(`replayed ${events.length} events -> ${Object.keys(view.turns).length} turns`)
})
