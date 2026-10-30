import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readConfig } from '../src/config.js'
import {
  InspectError,
  NATIVE_CHECKPOINT_FRAMING_TOKENS,
  buildBudgetPreview,
  inspectPlugin,
  projectLastCompaction,
} from '../src/inspect.js'
import {
  markSummaryEnd,
  markSummaryStart,
  recordBudgetFallback,
  recordCompactionFailure,
  recordContinuationOutcome,
  resetLiveRegistry,
} from '../src/live.js'

const text = (value) => [{ type: 'text', text: value }]

function event(type, data, seq, time = seq * 10) {
  return { type, seq, time, data }
}

const SURFACE_TYPES = new Set([
  'system/message',
  'developer/message',
  'user/message',
  'assistant/message',
  'tool/result',
])

function fakeSession(events, header) {
  return {
    id: 'session-1',
    seq: events.length,
    surface: {
      nodes: events.filter((item) => SURFACE_TYPES.has(item.type)).map((item) => item.seq),
      replaceGeneration: 0,
      contentGeneration: 0,
    },
    eventAt: (seq) => events[Number(seq)],
    requestHeader: () => header,
  }
}

function normalized(partial = {}) {
  return readConfig({
    mode: 'goal',
    headroomTokens: 100,
    thresholdRatio: 0.5,
    retainRatio: 0.1,
    maxTokens: 50,
    ...partial,
  })
}

function eventsOfSession(session) {
  const events = []
  for (let seq = 0; seq < session.seq; seq += 1) events.push(session.eventAt(seq))
  return events
}

function goalText() {
  return [
    '# Checkpoint',
    '## Current Goal and Unresolved Requests',
    '- goal',
    '## Constraints, Preferences, and Approved Boundaries',
    '- c',
    '## Decisions and Reasons',
    '- d',
    '## Completed Work',
    '- done',
    '## In Progress',
    '- wip',
    '## Blocked, Pending, and Unverified',
    '- blocked',
    '## Key References',
    '- ref',
    '## Next Actions',
    '- next',
  ].join('\n')
}

test('projectLastCompaction reports a completed manual goal compaction from real events', () => {
  resetLiveRegistry()
  const summaryText = goalText()
  const events = [
    event('compaction/start', { compactionId: 'c1', turn: null }, 0, 100),
    event(
      'compaction/summary',
      {
        compactionId: 'c1',
        summary: text(summaryText),
        shadowedRange: { start: 1, end: 2 },
        shadowedSeqs: [1, 2],
        shadowedTokenCount: 1234,
        provider: 'p',
        model: 'm',
        usage: { cacheReadTokens: 11, cacheWriteTokens: 22 },
      },
      1,
      140,
    ),
    event('user/message', {
      role: 'user',
      id: 'u1',
      content: text('checkpoint'),
      source: { kind: 'compact-checkpoint', compactionId: 'c1' },
    }, 2, 150),
    event('compaction/end', { compactionId: 'c1', turn: null }, 3, 180),
  ]
  const record = projectLastCompaction(events, 'session-1')
  assert.equal(record.id, 'c1')
  assert.equal(record.trigger, 'manual')
  assert.equal(record.status, 'completed')
  assert.equal(record.mode, 'goal')
  assert.equal(record.beforeTokens, 1234)
  assert.equal(typeof record.afterTokens, 'number')
  assert.equal(record.durationMs, 80)
  assert.equal(record.cacheReadTokens, 11)
  assert.equal(record.cacheWriteTokens, 22)
  assert.equal(record.error, null)
})

test('projectLastCompaction distinguishes automatic, failed, cancelled, running and persistence-error', () => {
  resetLiveRegistry()
  const automatic = projectLastCompaction(
    [
      event('compaction/start', { compactionId: 'c2', turn: 3 }, 0, 10),
      event('compaction/end', { compactionId: 'c2', turn: 3, error: 'provider failed' }, 1, 20),
    ],
    'session-1',
  )
  assert.equal(automatic.trigger, 'automatic')
  assert.equal(automatic.status, 'failed')
  assert.equal(automatic.error, 'provider failed')
  assert.equal(automatic.mode, null)
  assert.equal(automatic.beforeTokens, null)

  const cancelled = projectLastCompaction(
    [
      event('compaction/start', { compactionId: 'c3', turn: null }, 0, 10),
      event('compaction/end', { compactionId: 'c3', turn: null, error: 'This operation was aborted' }, 1, 20),
    ],
    'session-1',
  )
  assert.equal(cancelled.status, 'cancelled')

  const start = event('compaction/start', { compactionId: 'c4', turn: null }, 0, 10)
  const runningSession = fakeSession([start])
  markSummaryStart(runningSession, 'handoff')
  const running = projectLastCompaction([start], 'session-1')
  assert.equal(running.status, 'running')
  markSummaryEnd('session-1')
  const orphaned = projectLastCompaction([start], 'session-1')
  assert.equal(orphaned.status, 'failed')

  const session = fakeSession([
    event('compaction/start', { compactionId: 'c5', turn: null }, 0, 10),
    event('compaction/summary', {
      compactionId: 'c5',
      summary: text('native heading?'),
      shadowedTokenCount: 1,
    }, 1, 20),
    event('user/message', {
      role: 'user',
      id: 'u',
      content: text('x'),
      source: { kind: 'compact-checkpoint', compactionId: 'c5' },
    }, 2, 30),
    event('compaction/end', { compactionId: 'c5', turn: null }, 3, 40),
  ])
  recordCompactionFailure(session, 'persistence-error', 'flush failed')
  const persistence = projectLastCompaction(eventsOfSession(session), 'session-1')
  assert.equal(persistence.status, 'persistence-error')
  assert.equal(persistence.error, 'flush failed')
  assert.equal(persistence.mode, null)
})

test('projectLastCompaction surfaces a recorded failure on an open bracket', () => {
  resetLiveRegistry()
  const events = [event('compaction/start', { compactionId: 'c9', turn: null }, 0, 10)]
  const session = fakeSession(events)
  recordCompactionFailure(session, 'failed', 'simulated append failure', 'c9')
  const record = projectLastCompaction(events, 'session-1')
  assert.equal(record.status, 'failed')
  assert.equal(record.error, 'simulated append failure')
  assert.equal(record.mode, null)
})

test('projectLastCompaction returns null when no compaction exists', () => {
  resetLiveRegistry()
  assert.equal(projectLastCompaction([], 'session-1'), null)
  assert.equal(projectLastCompaction([event('turn/start', { turn: 1 }, 0)], 'session-1'), null)
})

function fakeBudgetCtx(measurement, info) {
  return {
    get: (name) => {
      if (name === 'tokenMeter') return { measure: () => measurement }
      if (name === 'llm') return { resolveModelInfo: async () => info, stream: () => { throw new Error('stream must not run') } }
      return undefined
    },
  }
}

test('buildBudgetPreview reports threshold, retain, fixed prefix and a below-trigger candidate', () => {
  const header = { config: { provider: 'p', model: 'm', maxTokens: 20 }, tools: [] }
  const events = [
    event('request/header', { header, reason: 'initial' }, 0),
    event('system/message', { role: 'system', content: text('sys') }, 1),
    event('user/message', { role: 'user', id: 'u1', content: text('a'), source: { kind: 'user' } }, 2),
    event('user/message', { role: 'user', id: 'u2', content: text('b'), source: { kind: 'user' } }, 3),
    event('user/message', { role: 'user', id: 'u3', content: text('c'), source: { kind: 'user' } }, 4),
  ]
  const session = fakeSession(events, header)
  const measurement = {
    nodes: [
      { seq: 1, tokens: 10, heuristicTokens: 10 },
      { seq: 2, tokens: 100, heuristicTokens: 100 },
      { seq: 3, tokens: 100, heuristicTokens: 100 },
      { seq: 4, tokens: 100, heuristicTokens: 100 },
    ],
    totalTokens: 310,
    surfaceTokens: 310,
    baseline: { kind: 'estimated', tokens: 0 },
  }
  const activeConfig = normalized()
  // W=1000, O=20, headroom=100 -> messageBudget 980, pressure 880,
  // threshold floor(min(500, 880)) = 500; retain floor(980*0.1)=98.
  const info = { provider: 'p', id: 'm', name: 'm', context: { contextWindow: 1000 }, defaultMaxTokens: 20 }
  const { budget, preview } = buildBudgetPreview({
    ctx: fakeBudgetCtx(measurement, info),
    session,
    events,
    activeConfig,
    measurement,
    modelInfo: info,
  })
  assert.deepEqual(budget, {
    target: { provider: 'p', model: 'm' },
    contextWindow: 1000,
    reservedCompletionTokens: 20,
    messageBudgetTokens: 980,
    headroomTokens: 100,
    pressureBudgetTokens: 880,
    ratioThresholdTokens: 500,
    currentTokens: 310,
    measurement: 'estimated',
    fixedTokens: 10,
    thresholdTokens: 500,
    retainTokens: 98,
    summaryMaxTokens: 50,
  })
  assert.equal(preview.beforeTokens, 310)
  assert.equal(preview.retainedTokens, 100)
  assert.equal(preview.replacedTokens, 200)
  assert.equal(preview.checkpointFramingTokens, NATIVE_CHECKPOINT_FRAMING_TOKENS)
  assert.equal(preview.rangeStart, 2)
  assert.equal(preview.rangeEnd, 3)
  // fixed 10 + tail node3 100 + maxTokens 50
  assert.equal(preview.afterUpperBoundTokens, 160 + NATIVE_CHECKPOINT_FRAMING_TOKENS)
  assert.match(preview.reason, /below the automatic trigger 500/)

  const disabled = buildBudgetPreview({
    ctx: fakeBudgetCtx(measurement, info),
    session,
    events,
    activeConfig: normalized({ auto: false }),
    measurement,
    modelInfo: info,
  })
  assert.match(disabled.preview.reason, /automatic compaction is disabled \(auto=false\)/)
  assert.match(disabled.preview.reason, /below the automatic trigger/)
})

test('buildBudgetPreview reports unknown capacity and no safe range without inventing numbers', () => {
  const events = [event('user/message', { role: 'user', id: 'u', content: text('a') }, 0)]
  const session = fakeSession(events, undefined)
  const measurement = {
    nodes: [{ seq: 0, tokens: 10, heuristicTokens: 10 }],
    totalTokens: 10,
    surfaceTokens: 10,
    baseline: { kind: 'none' },
  }
  const activeConfig = normalized()
  const first = buildBudgetPreview({
    ctx: {},
    session,
    events,
    activeConfig,
    measurement,
    modelInfo: undefined,
  })
  assert.equal(first.budget.target, null)
  assert.equal(first.budget.contextWindow, null)
  assert.equal(first.budget.reservedCompletionTokens, null)
  assert.equal(first.budget.messageBudgetTokens, null)
  assert.equal(first.budget.headroomTokens, null)
  assert.equal(first.budget.pressureBudgetTokens, null)
  assert.equal(first.budget.ratioThresholdTokens, null)
  assert.equal(first.budget.thresholdTokens, null)
  assert.equal(first.budget.currentTokens, 10)
  assert.equal(first.budget.measurement, 'estimated')
  assert.equal(first.preview.afterUpperBoundTokens, null)
  assert.equal(first.preview.rangeStart, null)
  assert.match(first.preview.reason, /no routed request/)

  const header = { config: { provider: 'p', model: 'm' } }
  const routedEvents = [
    event('request/header', { header, reason: 'initial' }, 0),
    event('user/message', { role: 'user', id: 'u', content: text('a') }, 1),
  ]
  const routedMeasurement = {
    nodes: [{ seq: 1, tokens: 10, heuristicTokens: 10 }],
    totalTokens: 10,
    surfaceTokens: 10,
    baseline: { kind: 'none' },
  }
  const second = buildBudgetPreview({
    ctx: {},
    session: fakeSession(routedEvents, header),
    events: routedEvents,
    activeConfig,
    measurement: routedMeasurement,
    modelInfo: { provider: 'p', id: 'm', name: 'm', context: { contextWindow: 1000 } },
  })
  assert.equal(second.budget.thresholdTokens, 500)
  assert.equal(second.preview.rangeStart, null)
  assert.match(second.preview.reason, /no safe compactable range/)

  const metadataFailure = buildBudgetPreview({
    ctx: {},
    session: fakeSession(routedEvents, header),
    events: routedEvents,
    activeConfig,
    measurement: routedMeasurement,
    modelInfo: undefined,
    modelInfoError: 'model metadata is unavailable for p/m: no adapter',
  })
  assert.equal(metadataFailure.budget.thresholdTokens, null)
  assert.match(metadataFailure.preview.reason, /model metadata is unavailable/)
})

function companionFor(config) {
  return {
    snapshot: () => config,
    current: () => config,
  }
}

test('inspectPlugin without a session returns only plugin state', async () => {
  const config = normalized()
  const payload = await inspectPlugin({ get: () => undefined }, companionFor(config), null)
  assert.deepEqual(payload, {
    activeConfig: config,
    requiresReload: false,
    sessionId: null,
    engine: null,
    diagnostics: [],
    budget: null,
    preview: null,
    lastCompaction: null,
    handoffContinuation: null,
  })
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload)
})

test('inspectPlugin distinguishes a saved value from the active snapshot', async () => {
  const active = normalized({ mode: 'goal' })
  const live = normalized({ mode: 'native' })
  const payload = await inspectPlugin({ get: () => undefined }, {
    snapshot: () => active,
    current: () => live,
  }, null)
  assert.equal(payload.requiresReload, true)
  assert.equal(payload.activeConfig.mode, 'goal')
  const broken = await inspectPlugin({ get: () => undefined }, {
    snapshot: () => active,
    current: () => {
      throw new TypeError('invalid saved config')
    },
  }, null)
  assert.equal(broken.requiresReload, true)
})

test('inspectPlugin inspects a live session and never calls the LLM or mutates it', async () => {
  resetLiveRegistry()
  const events = [
    event('request/header', { header: { config: { provider: 'p', model: 'm', maxTokens: 20 }, tools: [] }, reason: 'initial' }, 0),
    event('system/message', { role: 'system', content: text('sys') }, 1),
    event('user/message', { role: 'user', id: 'u1', content: text('a'), source: { kind: 'user' } }, 2),
    event('user/message', { role: 'user', id: 'u2', content: text('b'), source: { kind: 'user' } }, 3),
    event('user/message', { role: 'user', id: 'u3', content: text('c'), source: { kind: 'user' } }, 4),
    event('compaction/start', { compactionId: 'c1', turn: null }, 5),
    event('compaction/summary', {
      compactionId: 'c1',
      summary: text(goalText()),
      shadowedTokenCount: 10,
    }, 6),
    event('user/message', {
      role: 'user',
      id: 'u4',
      content: text('checkpoint'),
      source: { kind: 'compact-checkpoint', compactionId: 'c1' },
    }, 7),
    event('compaction/end', { compactionId: 'c1', turn: null }, 8),
  ]
  const surface = [1, 2, 3, 4, 7]
  const session = {
    id: 'session-1',
    seq: events.length,
    surface: { nodes: surface, replaceGeneration: 1, contentGeneration: 1 },
    eventAt: (seq) => events[Number(seq)],
    requestHeader: () => events[0].data.header,
  }
  const measurement = {
    nodes: [
      { seq: 1, tokens: 10, heuristicTokens: 10 },
      { seq: 2, tokens: 400, heuristicTokens: 400 },
      { seq: 3, tokens: 400, heuristicTokens: 400 },
      { seq: 4, tokens: 400, heuristicTokens: 400 },
      { seq: 7, tokens: 20, heuristicTokens: 20 },
    ],
    totalTokens: 1230,
    surfaceTokens: 1230,
    baseline: { kind: 'usage', tokens: 0 },
  }
  const info = { provider: 'p', id: 'm', name: 'm', context: { contextWindow: 1000 }, defaultMaxTokens: 20 }
  let measured = 0
  let streamed = 0
  const ctx = {
    get: (name) => {
      if (name === 'agents') return { get: () => ({ id: 'session-1', session }) }
      if (name === 'tokenMeter') return { measure: () => { measured += 1; return measurement } }
      if (name === 'llm') return { resolveModelInfo: async () => info, stream: () => { streamed += 1 } }
      return undefined
    },
  }
  const payload = await inspectPlugin(ctx, companionFor(normalized()), 'session-1')
  assert.equal(measured, 1)
  assert.equal(streamed, 0)
  assert.equal(payload.sessionId, 'session-1')
  assert.equal(payload.budget.measurement, 'measured')
  assert.equal(payload.lastCompaction.mode, 'goal')
  assert.equal(payload.lastCompaction.status, 'completed')
  assert.equal(payload.lastCompaction.trigger, 'manual')
  assert.equal(payload.preview.retainedTokens, 420)
  assert.equal(payload.preview.replacedTokens, 800)
  assert.equal(payload.preview.checkpointFramingTokens, NATIVE_CHECKPOINT_FRAMING_TOKENS)
  assert.equal(payload.preview.rangeStart, 2)
  assert.equal(payload.preview.rangeEnd, 3)
  assert.equal(payload.preview.afterUpperBoundTokens, 480 + NATIVE_CHECKPOINT_FRAMING_TOKENS)
  assert.equal(payload.engine.owner, 'unknown')
  assert.equal(payload.engine.inspectApplies, true)
  assert.equal(payload.handoffContinuation, null)
  assert.ok(Array.isArray(payload.diagnostics))
})

test('inspectPlugin maps unknown, invisible and unavailable sessions', async () => {
  const config = normalized()
  const notFoundCtx = {
    get: (name) => {
      if (name === 'agents' || name === 'sessions') return { get: () => undefined }
      if (name === 'sessionQuery') {
        return {
          observeSession: async () => {
            const error = new Error('missing')
            error.code = 'SESSION_QUERY_SESSION_NOT_FOUND'
            throw error
          },
        }
      }
      return undefined
    },
  }
  await assert.rejects(
    () => inspectPlugin(notFoundCtx, companionFor(config), 'missing'),
    (error) => error instanceof InspectError && error.status === 404,
  )
  const unavailable = { get: () => undefined }
  await assert.rejects(
    () => inspectPlugin(unavailable, companionFor(config), 'missing'),
    (error) => error instanceof InspectError && error.status === 503,
  )
})

test('inspectPlugin reads a cold session through observeSession and reports unknown fields as null', async () => {
  const used = []
  const ctx = {
    get: (name) => {
      if (name === 'agents' || name === 'sessions') return { get: () => undefined }
      if (name === 'sessionQuery') {
        return {
          observeSession: async (id) => {
            used.push(id)
            const events = []
            return {
              source: 'prepared',
              header: { id, version: 4, createdAt: 1, isSeeded: false },
              inheritedEventCount: 0,
              events,
              cursor: -1,
              retain: () => null,
              [Symbol.dispose]: () => undefined,
            }
          },
        }
      }
      if (name === 'tokenMeter') {
        return {
          measure: (session) => ({
            nodes: [],
            totalTokens: 0,
            surfaceTokens: 0,
            baseline: { kind: 'none' },
          }),
        }
      }
      return undefined
    },
  }
  const payload = await inspectPlugin(ctx, companionFor(normalized()), 'cold-1')
  assert.deepEqual(used, ['cold-1'])
  assert.equal(payload.sessionId, 'cold-1')
  assert.equal(payload.lastCompaction, null)
  assert.equal(payload.budget.currentTokens, 0)
  assert.equal(payload.budget.contextWindow, null)
  assert.equal(payload.budget.thresholdTokens, null)
  assert.equal(payload.preview.beforeTokens, 0)
  assert.equal(payload.preview.rangeStart, null)
  assert.match(payload.preview.reason, /no routed request/)
  assert.equal(payload.engine.owner, 'unknown')
  assert.equal(payload.handoffContinuation, null)
  assert.ok(payload.diagnostics.some((entry) => /engine ownership cannot be proven/.test(entry)))
})

test('inspect flags a foreign preset engine and keeps only real-event lastCompaction', async () => {
  resetLiveRegistry()
  const events = [
    event('request/header', { header: { config: { provider: 'p', model: 'm' } }, reason: 'initial' }, 0),
    event('user/message', { role: 'user', id: 'u', content: text('a'), source: { kind: 'user' } }, 1),
    event('compaction/start', { compactionId: 'foreign-1', turn: null }, 2, 10),
    event('compaction/summary', {
      compactionId: 'foreign-1',
      summary: text('## Primary Request and Intent\n## Critical Context'),
      shadowedTokenCount: 30,
    }, 3, 20),
    event('user/message', {
      role: 'user',
      id: 'u2',
      content: text('ckpt'),
      source: { kind: 'compact-checkpoint', compactionId: 'foreign-1' },
    }, 4, 30),
    event('compaction/end', { compactionId: 'foreign-1', turn: null }, 5, 40),
  ]
  const session = fakeSession(events, { config: { provider: 'p', model: 'm' } })
  const agent = { id: 'session-1', session, ctx: {} }
  class NativeEngine {}
  const native = new NativeEngine()
  let measured = 0
  const ctx = {
    get: (name) => {
      if (name === 'agents') return { get: () => agent }
      if (name === 'agentPresets') return { serviceFor: () => native }
      if (name === 'compaction') return { constructor: { betterCompactEngine: true } }
      if (name === 'tokenMeter') return { measure: () => { measured += 1; return { nodes: [], totalTokens: 0, surfaceTokens: 0, baseline: { kind: 'none' } } } }
      return undefined
    },
  }
  const payload = await inspectPlugin(ctx, companionFor(normalized()), 'session-1')
  assert.equal(measured, 0, 'foreign engine sessions must not be metered by this plugin')
  assert.equal(payload.engine.owner, 'foreign-preset')
  assert.equal(payload.engine.inspectApplies, false)
  assert.match(payload.engine.reason, /different compaction engine/)
  assert.deepEqual(payload.diagnostics, [payload.engine.reason])
  assert.equal(payload.budget, null)
  assert.equal(payload.preview, null)
  assert.equal(payload.lastCompaction.id, 'foreign-1')
  assert.equal(payload.lastCompaction.status, 'completed')
  assert.equal(payload.lastCompaction.mode, 'native')
})

test('inspect applies to a session on the better-compact preset engine', async () => {
  resetLiveRegistry()
  const events = [
    event('request/header', { header: { config: { provider: 'p', model: 'm' } }, reason: 'initial' }, 0),
    event('user/message', { role: 'user', id: 'u', content: text('a'), source: { kind: 'user' } }, 1),
  ]
  const session = fakeSession(events, { config: { provider: 'p', model: 'm' } })
  const agent = { id: 'session-1', session, ctx: {} }
  class BetterCompactEngine {
    static betterCompactEngine = true
  }
  const mounted = new BetterCompactEngine()
  const ctx = {
    get: (name) => {
      if (name === 'agents') return { get: () => agent }
      if (name === 'agentPresets') return { serviceFor: () => mounted }
      if (name === 'llm') return { resolveModelInfo: async () => ({ provider: 'p', id: 'm', name: 'm', context: { contextWindow: 1000 } }) }
      if (name === 'tokenMeter') return { measure: () => ({ nodes: [{ seq: 1, tokens: 10, heuristicTokens: 10 }], totalTokens: 10, surfaceTokens: 10, baseline: { kind: 'none' } }) }
      return undefined
    },
  }
  const payload = await inspectPlugin(ctx, companionFor(normalized()), 'session-1')
  assert.equal(payload.engine.owner, 'better-compact-preset')
  assert.equal(payload.engine.inspectApplies, true)
  assert.equal(payload.budget.contextWindow, 1000)
  assert.ok(Array.isArray(payload.diagnostics))
})

test('inspect reports token-meter failure as unavailable plus a diagnostic', async () => {
  resetLiveRegistry()
  const events = [
    event('request/header', { header: { config: { provider: 'p', model: 'm' } }, reason: 'initial' }, 0),
    event('user/message', { role: 'user', id: 'u', content: text('a'), source: { kind: 'user' } }, 1),
  ]
  const session = fakeSession(events, { config: { provider: 'p', model: 'm' } })
  const agent = { id: 'session-1', session, ctx: {} }
  const ctx = {
    get: (name) => {
      if (name === 'agents') return { get: () => agent }
      if (name === 'tokenMeter') {
        return {
          measure: () => {
            throw new Error('meter replay failed')
          },
        }
      }
      if (name === 'llm') return { resolveModelInfo: async () => ({ provider: 'p', id: 'm', name: 'm', context: { contextWindow: 1000 } }) }
      return undefined
    },
  }
  const payload = await inspectPlugin(ctx, companionFor(normalized()), 'session-1')
  assert.equal(payload.budget.measurement, 'unavailable')
  assert.equal(payload.budget.currentTokens, null)
  assert.equal(payload.preview, null)
  assert.ok(payload.diagnostics.some((entry) => /token measurement is unavailable/.test(entry)))
  assert.ok(payload.diagnostics.some((entry) => /meter replay failed/.test(entry)))
})

test('inspect exposes the last summary budget omission as a diagnostic', async () => {
  resetLiveRegistry()
  recordBudgetFallback('session-1', ['todos', 'pending questions'])
  const ctx = {
    get: (name) => {
      if (name === 'agents') return { get: () => ({ id: 'session-1', session: fakeSession([]) }) }
      return undefined
    },
  }
  const payload = await inspectPlugin(ctx, companionFor(normalized()), 'session-1')
  assert.ok(
    payload.diagnostics.some((entry) => /omitted authoritative state .*todos; pending questions/.test(entry)),
  )
})

test('inspect exposes the latest handoff continuation decision', async () => {
  resetLiveRegistry()
  recordContinuationOutcome('session-1', {
    compactionId: 'c1',
    status: 'skipped',
    blockers: ['a user question is still pending'],
    at: 123,
  })
  const ctx = {
    get: (name) => {
      if (name === 'agents') return { get: () => ({ id: 'session-1', session: fakeSession([]) }) }
      return undefined
    },
  }
  const payload = await inspectPlugin(ctx, companionFor(normalized()), 'session-1')
  assert.deepEqual(payload.handoffContinuation, {
    compactionId: 'c1',
    status: 'skipped',
    blockers: ['a user question is still pending'],
    at: 123,
  })
})
