/**
 * dsh-turn-meta-badge — Harness host half.
 *
 * Owns one client-visible Session projection, `turnMeta`, that folds the durable
 * log into per-turn request metadata for the browser half:
 *
 * - the provider/model/reasoning effort in force for each attempt (the logged
 *   `request/header` defines the effort, the settled `assistant/message`
 *   `source` defines the route the reply actually came from), and
 * - the exact token buckets every assistant attempt of that Turn reported.
 *
 * The projection carries no model-visible content, registers no tool and writes
 * no Session event: it only reads events other packages already logged.
 *
 * @module dsh-turn-meta-badge
 */

/** Session projection key owned by this plugin. */
const KEY = 'turnMeta'

/**
 * The projection registry only ever calls `parse` on these. Every value passing
 * through is produced by this module, so validation is deliberately identity
 * instead of a second, drifting copy of the shape.
 */
const identitySchema = Object.freeze({ parse: (value) => value })

/** Shared empty tables keep unchanged state references unchanged. */
const NO_TURNS = Object.freeze({})
const NO_STEPS = Object.freeze({})

/** Whether one provider usage field is an exact non-negative count. */
function isCount(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** The selection a canonical request header config names, or `null` when it names none. */
function selectionOf(config) {
  if (config === null || typeof config !== 'object') return null
  const provider = typeof config.provider === 'string' ? config.provider : ''
  const model = typeof config.model === 'string' ? config.model : ''
  if (provider === '' || model === '') return null
  const effort = config.reasoningEffort
  return typeof effort === 'string' && effort !== ''
    ? { provider, model, reasoningEffort: effort }
    : { provider, model }
}

/** Whether two selections carry the same route and effort. */
function sameSelection(left, right) {
  if (left === right) return true
  if (left === null || right === null || left === undefined || right === undefined) return false
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    (left.reasoningEffort ?? '') === (right.reasoningEffort ?? '')
  )
}

/** The usage sample one durable assistant event reports, if it reports one. */
function usageSample(event) {
  const data = event.data
  if (data === null || typeof data !== 'object') return undefined
  if (data.usage !== null && typeof data.usage === 'object') return data.usage
  const stream = data.stream
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index]
    if (record === null || typeof record !== 'object') continue
    const chunk = record.chunk
    if (chunk !== null && typeof chunk === 'object' && chunk.type === 'usage' && chunk.usage !== null && typeof chunk.usage === 'object') {
      return chunk.usage
    }
  }
  return undefined
}

/** One attempt's token buckets, normalized onto the fields the badge renders. */
function bucketsOf(sample) {
  const inputTokens = sample.inputTokens
  const outputTokens = sample.outputTokens
  if (!isCount(inputTokens) || !isCount(outputTokens)) return null
  const cacheReadTokens = isCount(sample.cacheReadTokens) ? sample.cacheReadTokens : undefined
  const cacheWriteTokens = isCount(sample.cacheWriteTokens) ? sample.cacheWriteTokens : undefined
  const reasoningTokens = isCount(sample.reasoningTokens) ? sample.reasoningTokens : undefined
  const totalTokens = isCount(sample.totalTokens)
    ? sample.totalTokens
    : inputTokens + outputTokens + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0)
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
  }
}

/** Whether two attempt buckets are interchangeable. */
function sameBuckets(left, right) {
  return (
    left.inputTokens === right.inputTokens &&
    left.outputTokens === right.outputTokens &&
    left.totalTokens === right.totalTokens &&
    left.cacheReadTokens === right.cacheReadTokens &&
    left.cacheWriteTokens === right.cacheWriteTokens &&
    left.reasoningTokens === right.reasoningTokens
  )
}

/**
 * Sum one Turn's attempts. Cache and reasoning buckets survive only when every
 * counted attempt reported them, so a partial number is never invented.
 */
function totalsOf(steps) {
  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  let steps_count = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let reasoningTokens = 0
  let everyCacheRead = true
  let everyCacheWrite = true
  let everyReasoning = true
  for (const key of Object.keys(steps)) {
    const buckets = steps[key]
    steps_count += 1
    inputTokens += buckets.inputTokens
    outputTokens += buckets.outputTokens
    totalTokens += buckets.totalTokens
    if (buckets.cacheReadTokens === undefined) everyCacheRead = false
    else cacheReadTokens += buckets.cacheReadTokens
    if (buckets.cacheWriteTokens === undefined) everyCacheWrite = false
    else cacheWriteTokens += buckets.cacheWriteTokens
    if (buckets.reasoningTokens === undefined) everyReasoning = false
    else reasoningTokens += buckets.reasoningTokens
  }
  return {
    steps: steps_count,
    inputTokens,
    outputTokens,
    totalTokens,
    ...(everyCacheRead && steps_count > 0 ? { cacheReadTokens } : {}),
    ...(everyCacheWrite && steps_count > 0 ? { cacheWriteTokens } : {}),
    ...(everyReasoning && steps_count > 0 ? { reasoningTokens } : {}),
  }
}

/** Advance one Turn entry with one assistant attempt. */
function withAttempt(state, event) {
  const turn = event.data === undefined ? undefined : event.data.turn
  const step = event.data === undefined ? undefined : event.data.step
  if (!Number.isSafeInteger(turn) || !Number.isSafeInteger(step)) return state

  const sample = usageSample(event)
  const buckets = sample === undefined ? null : bucketsOf(sample)

  const source = event.type === 'assistant/message' && event.data.message !== undefined ? event.data.message.source : undefined
  const selection =
    source !== undefined && source !== null && typeof source.provider === 'string' && typeof source.model === 'string' && source.provider !== '' && source.model !== ''
      ? selectionOf({
          provider: source.provider,
          model: source.model,
          ...(state.header === null || state.header.reasoningEffort === undefined ? {} : { reasoningEffort: state.header.reasoningEffort }),
        })
      : state.header

  const entry = state.turns[turn] ?? { selection: state.header, steps: NO_STEPS }
  const previous = entry.steps[step]
  if (buckets === null && sameSelection(selection, entry.selection)) return state
  const nextBuckets = buckets === null ? previous : buckets
  if (
    previous !== undefined &&
    nextBuckets !== undefined &&
    sameBuckets(previous, nextBuckets) &&
    sameSelection(selection, entry.selection)
  ) {
    return state
  }

  const steps = { ...entry.steps }
  if (nextBuckets === undefined) delete steps[step]
  else steps[step] = nextBuckets

  return {
    header: state.header,
    turns: { ...state.turns, [turn]: { selection: selection ?? entry.selection, steps } },
  }
}

/** Fold one committed Session event into the projection state. */
function applyEvent(state, event) {
  switch (event.type) {
    case 'request/header': {
      const selection = selectionOf(event.data === undefined ? undefined : event.data.header === undefined ? undefined : event.data.header.config)
      if (sameSelection(selection, state.header)) return state
      return { header: selection, turns: state.turns }
    }
    case 'turn/start': {
      const turn = event.data === undefined ? undefined : event.data.turn
      if (!Number.isSafeInteger(turn) || state.turns[turn] !== undefined) return state
      return { header: state.header, turns: { ...state.turns, [turn]: { selection: state.header, steps: NO_STEPS } } }
    }
    case 'llm/retry-started': {
      const turn = event.data === undefined ? undefined : event.data.turn
      const step = event.data === undefined ? undefined : event.data.step
      const entry = state.turns[turn]
      if (entry === undefined || entry.steps[step] === undefined) return state
      const steps = { ...entry.steps }
      delete steps[step]
      return { header: state.header, turns: { ...state.turns, [turn]: { selection: entry.selection, steps } } }
    }
    case 'assistant/message':
    case 'assistant/attempt':
      return withAttempt(state, event)
    default:
      return state
  }
}

/** Project the fold into the browser-visible per-Turn value. */
function viewOf(state) {
  const turns = {}
  for (const turn of Object.keys(state.turns)) {
    const entry = state.turns[turn]
    turns[turn] = {
      ...(entry.selection === null ? {} : entry.selection),
      ...totalsOf(entry.steps),
    }
  }
  return { header: state.header, turns }
}

/**
 * The projection unit this plugin owns.
 *
 * Exported so the projection can be driven offline (see `test/`): the Loader
 * only consumes `name`/`inject`/`apply`, so this adds no contract.
 */
export const turnMetaProjection = {
  key: KEY,
  stateVersion: 1,
  stateSchema: identitySchema,
  init: () => ({ header: null, turns: NO_TURNS }),
  apply: (state, event) => applyEvent(state, event),
  wire: {
    viewSchema: identitySchema,
    view: (state) => viewOf(state),
  },
}

/** Cordis plugin name. */
export const name = 'turn-meta-badge'

/** The projection registry must exist before this plugin contributes to it. */
export const inject = ['sessionProjections']

/**
 * Register the per-Turn request/token projection.
 * @param ctx - owning Harness plugin context.
 */
export function apply(ctx) {
  ctx.sessionProjections.register(turnMetaProjection)
}
