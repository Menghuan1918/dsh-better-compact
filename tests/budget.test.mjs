import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BudgetConfigError,
  fixedPrefixTokens,
  measurementKind,
  resolveCompactSpec,
  resolveTargetPolicy,
  selectCompactableRange,
  targetFromHeader,
} from '../src/budget.js'
import { readConfig } from '../src/config.js'

/** Build a fake session with the surface/tool-pairing shape the helpers read. */
function fakeSession(spec) {
  const events = spec.map((entry, seq) => ({
    seq,
    type: entry.type,
    data:
      entry.type === 'assistant/message'
        ? { message: { role: 'assistant', content: entry.content } }
        : entry.type === 'user/message' || entry.type === 'system/message'
          ? { role: entry.type === 'system/message' ? 'system' : 'user', content: entry.content ?? [] }
          : {},
  }))
  const nodes = events.map((event) => event.seq)
  return {
    seq: events.length,
    surface: { nodes, replaceGeneration: 0, contentGeneration: 0 },
    eventAt: (seq) => events[Number(seq)],
    requestHeader: () => undefined,
  }
}

/** Build a measurement aligned with a fake session. */
function fakeMeasurement(session, prices) {
  const nodes = session.surface.nodes.map((seq, index) => ({
    seq,
    tokens: prices[index],
    heuristicTokens: prices[index],
  }))
  return {
    nodes,
    totalTokens: 100 + prices.reduce((total, price) => total + price, 0),
    surfaceTokens: prices.reduce((total, price) => total + price, 0),
    baseline: { kind: 'usage', tokens: 0, usage: {} },
  }
}

const text = (value) => [{ type: 'text', text: value }]

function normalize(partial = {}) {
  return readConfig({ mode: 'goal', ...partial })
}

test('native capacity formulas: W=100000 O=8192 headroom=65536 threshold/retain', () => {
  const config = normalize()
  const policy = resolveTargetPolicy(config, { provider: 'p', model: 'm' })
  const spec = resolveCompactSpec(policy, 100000, 8192)
  // messageBudget = 91808; pressureBudget = 26272; threshold = min(80000, 26272)
  assert.equal(spec.thresholdTokens, 26272)
  // retain = floor(91808 * 0.16)
  assert.equal(spec.retainTokens, 14689)
  assert.equal(spec.contextWindow, 100000)
})

test('absolute retention wins and per-target overrides merge', () => {
  const config = normalize({
    retainTokens: 4096,
    modelPolicies: [
      { provider: 'p', model: 'm', thresholdRatio: 0.5, retainTokens: 2048, maxTokens: 1024 },
    ],
  })
  const policy = resolveTargetPolicy(config, { provider: 'p', model: 'm' })
  assert.equal(policy.thresholdRatio, 0.5)
  assert.equal(policy.retainTokens, 2048)
  assert.equal(policy.maxTokens, 1024)
  const spec = resolveCompactSpec(policy, 100000, 1000)
  assert.equal(spec.thresholdTokens, 33464)
  assert.equal(spec.retainTokens, 2048)

  const other = resolveTargetPolicy(config, { provider: 'p', model: 'other' })
  assert.equal(other.retainTokens, 4096)
  assert.equal(other.maxTokens, 65536)
})

test('capacity and retention conflicts are actionable BudgetConfigError values', () => {
  const config = normalize()
  const policy = resolveTargetPolicy(config, { provider: 'p', model: 'm' })
  assert.throws(() => resolveCompactSpec(policy, 0, 0), BudgetConfigError)
  assert.throws(() => resolveCompactSpec(policy, 100000, -1), BudgetConfigError)
  assert.throws(
    () => resolveCompactSpec(policy, 50000, 1000),
    /leaving no pressure budget; reduce headroomTokens/,
  )
  assert.throws(
    () => resolveCompactSpec(policy, 8192, 8192),
    /leaving no message budget/,
  )
  const bigRetain = resolveTargetPolicy(normalize({ retainTokens: 40000 }), { provider: 'p', model: 'm' })
  assert.throws(
    () => resolveCompactSpec(bigRetain, 100000, 0),
    /retainTokens \(40000\) must be less than threshold tokens/,
  )
})

test('selectCompactableRange retains the priced recent tail', () => {
  const session = fakeSession([
    { type: 'system/message', content: text('system') },
    { type: 'user/message', content: text('a') },
    { type: 'user/message', content: text('b') },
    { type: 'user/message', content: text('c') },
  ])
  const measurement = fakeMeasurement(session, [10, 100, 100, 100])
  // retain 150: accumulate node3 (100), node2 (200) -> keepFromIdx 2.
  const range = selectCompactableRange(session, measurement, 150)
  assert.deepEqual(range, { start: 1, end: 1 })
  // retain 0 keeps only the newest node; compact the rest.
  assert.deepEqual(selectCompactableRange(session, measurement, 0), { start: 1, end: 2 })
  // retain 10000 cannot keep the whole surface: no earlier span remains.
  assert.equal(selectCompactableRange(session, measurement, 10000), null)
})

test('selectCompactableRange never splits a tool-call/result pair', () => {
  const session = fakeSession([
    { type: 'user/message', content: text('a') },
    { type: 'assistant/message', content: [{ type: 'tool-call', id: 't1', name: 'x', arguments: '{}' }] },
    { type: 'tool/result', content: text('r') },
    { type: 'user/message', content: text('b') },
  ])
  const measurement = fakeMeasurement(session, [10, 20, 30, 40])
  // retain 0 -> keepFromIdx 3 is balanced; range [0,2] would split nothing?
  // The cut before node 3 is after the tool result, so it is balanced:
  assert.deepEqual(selectCompactableRange(session, measurement, 0), { start: 0, end: 2 })
  // retain 45 keeps node3 (40) and needs node2 too (70), whose leading cut is
  // inside the tool pair, so selection walks back to the balanced cut at node1.
  assert.deepEqual(selectCompactableRange(session, measurement, 45), { start: 0, end: 0 })
})

test('selectCompactableRange is a no-op without a system head or with one node', () => {
  const session = fakeSession([{ type: 'user/message', content: text('only') }])
  const measurement = fakeMeasurement(session, [10])
  assert.equal(selectCompactableRange(session, measurement, 0), null)
  const empty = fakeSession([])
  assert.equal(selectCompactableRange(empty, { nodes: [] }, 0), null)
})

test('fixedPrefixTokens prices tools plus a leading system node only', () => {
  const session = fakeSession([
    { type: 'system/message', content: text('system') },
    { type: 'user/message', content: text('a') },
  ])
  const measurement = fakeMeasurement(session, [500, 100])
  assert.equal(fixedPrefixTokens(session, measurement, 700), 1200)
  const noSystem = fakeSession([{ type: 'user/message', content: text('a') }])
  assert.equal(fixedPrefixTokens(noSystem, fakeMeasurement(noSystem, [100]), 700), 700)
  assert.equal(fixedPrefixTokens(session, undefined, 700), null)
})

test('targetFromHeader and measurementKind use only provable facts', () => {
  assert.deepEqual(targetFromHeader({ config: { provider: 'p', model: 'm' } }), { provider: 'p', model: 'm' })
  assert.equal(targetFromHeader(undefined), undefined)
  assert.equal(targetFromHeader({ config: { provider: '', model: 'm' } }), undefined)
  assert.equal(measurementKind(undefined), 'unavailable')
  assert.equal(measurementKind({ baseline: { kind: 'usage' } }), 'measured')
  assert.equal(measurementKind({ baseline: { kind: 'estimated', tokens: 5 } }), 'estimated')
  assert.equal(measurementKind({ baseline: { kind: 'none' } }), 'estimated')
})
