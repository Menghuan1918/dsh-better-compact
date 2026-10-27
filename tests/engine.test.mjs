import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rm, readFile } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { GOAL_SECTIONS, HANDOFF_SECTIONS, HANDOFF_TITLE } from '../src/prompts.js'
import { readConfig } from '../src/config.js'
import { continuationOutcome, lastBudgetFallback, resetLiveRegistry } from '../src/live.js'
import { projectLastCompaction } from '../src/inspect.js'
import Engine from '../src/engine.js'

const text = (value) => [{ type: 'text', text: value }]

function goalBody() {
  return ['# Checkpoint', ...GOAL_SECTIONS.map((heading) => `${heading}\n- fact`)].join('\n')
}

function handoffBody() {
  return [HANDOFF_TITLE, ...HANDOFF_SECTIONS.map((heading) => `${heading}\n- fact`)].join('\n')
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

function streamOf(payload, finish = { kind: 'stop' }) {
  return () => {
    const iterator = (async function* () {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      if (typeof payload === 'string') {
        yield { type: 'block-end', index: 0, block: { type: 'text', text: payload } }
      } else {
        yield payload
      }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 7 } }
      yield { type: 'finish', reason: finish }
    })()
    return iterator
  }
}

async function makeEngine(config, services = {}) {
  const ctx = new Context()
  ctx.provide('betterCompactConfig', { snapshot: () => config, current: () => config })
  ctx.provide('llm', services.llm ?? {})
  ctx.provide('tokenMeter', services.tokenMeter ?? {})
  ctx.provide('sessions', services.sessions ?? {})
  for (const [name, value] of Object.entries(services.extra ?? {})) ctx.provide(name, value)
  const engine = new Engine(ctx)
  return { ctx, engine, dispose: () => ctx.fiber.dispose() }
}

function fakeAgent(id = 'session-1') {
  return {
    id,
    status: 'idle',
    options: { provider: 'p', model: 'm' },
    inbox: { nextTurn: [], nextStep: [] },
    session: {
      id,
      requestHeader: () => ({ config: { provider: 'p', model: 'm', maxTokens: 10 }, tools: [] }),
      toolHistory: () => ({ tools: [], updates: [] }),
    },
  }
}

test('the engine reads only the frozen snapshot and keeps the native base config', async () => {
  resetLiveRegistry()
  const config = normalized({ mode: 'native' })
  const { engine, dispose } = await makeEngine(config)
  try {
    assert.equal(engine.activeMode, 'native')
    assert.equal(engine.snapshot, config)
    assert.equal(engine.config.thresholdRatio, 0.5)
    assert.equal(engine.config.retainRatio, 0.1)
    assert.deepEqual(Engine.Config({}), {})
    assert.deepEqual(Engine.inject, ['llm', 'tokenMeter', 'sessions', 'betterCompactConfig'])
  } finally {
    await dispose()
  }
})

test('a missing host companion row fails the engine row with an actionable error', async () => {
  const ctx = new Context()
  ctx.provide('llm', {})
  ctx.provide('tokenMeter', {})
  ctx.provide('sessions', {})
  try {
    assert.throws(() => new Engine(ctx), /host companion row "dsh-better-compact" is not mounted/)
  } finally {
    await ctx.fiber.dispose()
  }
})

test('native mode delegates to the inherited native summarizer', async () => {
  resetLiveRegistry()
  const calls = []
  const llm = { stream: (options) => { calls.push(options); return streamOf('native summary')() } }
  const original = BasicCompactionEngine.prototype.summarize
  let inherited = 0
  BasicCompactionEngine.prototype.summarize = async function (...args) {
    inherited += 1
    return original.apply(this, args)
  }
  const { engine, dispose } = await makeEngine(normalized({ mode: 'native' }), { llm })
  try {
    const agent = fakeAgent()
    const result = await engine.summarize({ messages: [{ role: 'system', content: text('sys') }] }, agent)
    assert.equal(inherited, 1, 'native mode must call the inherited summarize implementation')
    assert.equal(calls.length, 1)
    assert.equal(result.llmStreamCall, true)
    assert.equal(result.summary[0].text, 'native summary')
    assert.equal(result.provider, 'p')
    assert.equal(result.model, 'm')
    assert.equal(calls[0].purpose, 'compaction')
    assert.equal(calls[0].maxTokens, 50)
    assert.equal('reasoningEffort' in calls[0], false)
  } finally {
    BasicCompactionEngine.prototype.summarize = original
    await dispose()
  }
})

test('native attempts mark live summary activity so inspect can report running', async () => {
  resetLiveRegistry()
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const llm = {
    stream: () =>
      (async function* () {
        await gate
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'native summary' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })(),
  }
  const { engine, dispose } = await makeEngine(normalized({ mode: 'native' }), { llm })
  try {
    const agent = fakeAgent()
    const start = {
      type: 'compaction/start',
      seq: 0,
      time: 1,
      data: { compactionId: 'native-open', turn: 1 },
    }
    agent.session = {
      id: agent.id,
      seq: 1,
      eventAt: () => start,
      requestHeader: () => ({ config: { provider: 'p', model: 'm', maxTokens: 10 }, tools: [] }),
      toolHistory: () => ({ tools: [], updates: [] }),
    }
    const pending = engine.summarize({ messages: [{ role: 'system', content: text('sys') }] }, agent)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(engine.activeSummaryFor(agent.id), 'native')
    assert.equal(projectLastCompaction([start], agent.id).status, 'running')
    release()
    await pending
    assert.equal(engine.activeSummaryFor(agent.id), null)
    assert.equal(projectLastCompaction([start], agent.id).status, 'failed')
  } finally {
    await dispose()
  }
})

test('goal mode injects live authoritative state and passes effort/cache controls', async () => {
  resetLiveRegistry()
  const calls = []
  const llm = {
    resolveModelInfo: async () => ({
      provider: 'p',
      id: 'm',
      name: 'm',
      context: { contextWindow: 2000 },
      defaultMaxTokens: 10,
      reasoning: { efforts: [{ id: 'high', name: 'High' }] },
    }),
    stream: (options) => {
      calls.push(options)
      return streamOf(goalBody())()
    },
  }
  const goal = {
    id: 'g1',
    revision: 1,
    objective: 'Ship S2',
    phase: 'active',
    roundsStarted: 2,
    maxGoalRounds: 8,
  }
  const { engine, dispose } = await makeEngine(
    normalized({ mode: 'goal', reasoningEffort: 'high' }),
    {
      llm,
      extra: {
        goals: { get: () => goal },
        sessionProjections: {
          stateOf: (_, key) =>
            key === 'todos' ? [{ content: 'Run smoke', status: 'in_progress' }] : undefined,
        },
        jobs: { list: () => [] },
        agents: { list: () => [] },
      },
    },
  )
  try {
    const agent = fakeAgent()
    const result = await engine.summarize({ messages: [{ role: 'system', content: text('sys') }] }, agent)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].reasoningEffort, 'high')
    assert.ok(calls[0].messages.at(-1).content[0].text.includes('Ship S2'))
    assert.ok(calls[0].messages.at(-1).content[0].text.includes('[in_progress] Run smoke'))
    assert.equal(calls[0].tools, undefined)
    assert.deepEqual(calls[0].toolHistory, { tools: [], updates: [] })
    assert.equal(result.summary[0].text, goalBody())
    assert.equal(result.usage.cacheReadTokens, 7)
  } finally {
    await dispose()
  }
})

test('cachePriority=false builds a leaner request without tool declarations', async () => {
  resetLiveRegistry()
  const calls = []
  const llm = {
    resolveModelInfo: async () => ({ provider: 'p', id: 'm', name: 'm', context: { contextWindow: 2000 } }),
    stream: (options) => {
      calls.push(options)
      return streamOf(goalBody())()
    },
  }
  const { engine, dispose } = await makeEngine(
    normalized({ mode: 'goal', cachePriority: false }),
    { llm, extra: { agents: { list: () => [] } } },
  )
  try {
    const agent = fakeAgent()
    await engine.summarize(
      { messages: [{ role: 'system', content: text('sys') }], tools: [{ name: 'x', description: 'x', parameters: {} }] },
      agent,
    )
    assert.equal(calls[0].tools, undefined)
    assert.equal(calls[0].toolHistory, undefined)
  } finally {
    await dispose()
  }
})

test('unsupported effort rejects before the provider call (never substituted)', async () => {
  resetLiveRegistry()
  let streamed = 0
  const llm = {
    resolveModelInfo: async () => ({ provider: 'p', id: 'm', name: 'm', context: { contextWindow: 2000 } }),
    stream: () => {
      streamed += 1
      return streamOf(goalBody())()
    },
  }
  const { engine, dispose } = await makeEngine(
    normalized({ mode: 'goal', reasoningEffort: 'max' }),
    { llm, extra: { agents: { list: () => [] } } },
  )
  try {
    await assert.rejects(
      () => engine.summarize({ messages: [] }, fakeAgent()),
      (error) => error.code === 'UNSUPPORTED_REASONING_EFFORT',
    )
    assert.equal(streamed, 0)
  } finally {
    await dispose()
  }
})

test('truncated and malformed enhanced output is rejected, not installed', async () => {
  resetLiveRegistry()
  const llmFor = (body, finish) => ({
    resolveModelInfo: async () => ({ provider: 'p', id: 'm', name: 'm', context: { contextWindow: 2000 } }),
    stream: () => streamOf(body, finish)(),
  })
  const first = await makeEngine(normalized({ mode: 'goal' }), {
    llm: llmFor(goalBody(), { kind: 'max-tokens' }),
    extra: { agents: { list: () => [] } },
  })
  try {
    await assert.rejects(() => first.engine.summarize({ messages: [] }, fakeAgent()), /truncated/)
  } finally {
    await first.dispose()
  }
  const second = await makeEngine(normalized({ mode: 'goal' }), {
    llm: llmFor('a degenerate summary with no sections'),
    extra: { agents: { list: () => [] } },
  })
  try {
    await assert.rejects(
      () => second.engine.summarize({ messages: [] }, fakeAgent()),
      (error) => error.code === 'BETTER_COMPACT_STRUCTURE',
    )
  } finally {
    await second.dispose()
  }
})

test('handoff mode writes the exact document to an owner-only temp file and embeds it', async () => {
  resetLiveRegistry()
  const directories = []
  const secret = 'sk-abcdefghijklmnopqrstuvwx123456'
  const llm = {
    resolveModelInfo: async () => ({ provider: 'p', id: 'm', name: 'm', context: { contextWindow: 4000 } }),
    stream: () => streamOf(`${handoffBody()}\n- leaked key: ${secret}`)(),
  }
  const { engine, dispose } = await makeEngine(normalized({ mode: 'handoff' }), {
    llm,
    extra: { agents: { list: () => [] } },
  })
  try {
    const agent = fakeAgent()
    const result = await engine.summarize({ messages: [] }, agent)
    const document = result.summary[0].text
    assert.equal(document.startsWith(HANDOFF_TITLE), true)
    assert.equal(document.includes(secret), false, 'summary must not leak the secret')
    assert.equal(JSON.stringify(result.rawOutput).includes(secret), false, 'rawOutput must not leak the secret')
    const path = /Handoff file: (.+)/.exec(document)?.[1]?.trim()
    assert.ok(path, 'document must name the actual file')
    directories.push(path.replace(/\/[^/]+$/, ''))
    assert.equal(await readFile(path, 'utf8'), document)
    assert.equal((await readFile(path, 'utf8')).includes(secret), false)
  } finally {
    for (const directory of directories) await rm(directory, { recursive: true, force: true })
    await dispose()
  }
})

function budgetEngineLike() {
  return {
    mode: 'goal',
    snapshot: { cachePriority: false },
    _estimateRequest: Engine.prototype._estimateRequest,
    ctx: { logger: { warn: () => undefined } },
  }
}

test('_chooseInstruction drops todos first, discloses it, and keeps pending work', () => {
  resetLiveRegistry()
  const engineLike = budgetEngineLike()
  const input = { messages: [{ role: 'system', content: text('x'.repeat(400)) }] }
  const state = {
    goal: { objective: 'goal', phase: 'active', roundsStarted: 1, maxGoalRounds: 2 },
    todos: Array.from({ length: 40 }, (_, index) => ({ content: 't'.repeat(200), status: 'pending' })),
    questions: [{ callId: 'q-1', state: 'continued', questions: [{ id: 'q', question: 'Which provider?' }] }],
    jobs: [{ id: 'job-1', kind: 'bash', label: 'still running', status: 'running' }],
    children: [{ id: 'child-1', depth: 1 }],
  }
  const info = { provider: 'p', id: 'm', name: 'm', context: { contextWindow: 1100 } }
  const chosen = Engine.prototype._chooseInstruction.call(
    engineLike,
    input,
    state,
    info,
    100,
    'budget-fallback-session',
  )
  assert.match(chosen, /## Current Goal and Unresolved Requests/)
  assert.equal(chosen.includes('Todos (authoritative'), false)
  assert.match(
    chosen,
    /Budget note: only the goal, pending questions, running jobs, running child agents were included; todos were omitted to fit/,
  )
  assert.match(chosen, /Which provider\?/)
  assert.match(chosen, /job-1/)
  assert.match(chosen, /child-1/)
  assert.deepEqual(lastBudgetFallback('budget-fallback-session').omitted, ['todos'])

  // When pending facts also do not fit, the instruction says everything that
  // was dropped instead of silently losing them.
  const bigState = {
    ...state,
    questions: [{
      callId: 'q-2',
      state: 'continued',
      questions: [{ id: 'q', question: 'q'.repeat(4000) }],
    }],
  }
  const goalOnly = Engine.prototype._chooseInstruction.call(
    engineLike,
    input,
    bigState,
    { ...info, context: { contextWindow: 1000 } },
    100,
    'budget-fallback-session',
  )
  assert.match(goalOnly, /only the goal was included; todos, pending questions, running jobs, running child agents were omitted/)
  assert.deepEqual(lastBudgetFallback('budget-fallback-session').omitted, [
    'todos',
    'pending questions',
    'running jobs',
    'running child agents',
  ])

  assert.throws(
    () =>
      Engine.prototype._chooseInstruction.call(
        engineLike,
        input,
        state,
        { ...info, context: { contextWindow: 200 } },
        100,
        'budget-fallback-session',
      ),
    (error) => error.code === 'BETTER_COMPACT_BUDGET',
  )
})

test('_resolveEffort and _resolveRoute validate the exact route', () => {
  const engineLike = {
    snapshot: {
      summarizationProvider: '',
      summarizationModel: '',
      reasoningEffort: '',
      maxTokens: 10,
      modelPolicies: [],
      thresholdRatio: 0.8,
      headroomTokens: 100,
      retainRatio: 0.1,
      retainTokens: null,
      compactionRetries: 1,
      maxOverflowRetries: 1,
    },
  }
  assert.equal(Engine.prototype._resolveEffort.call(engineLike, { provider: 'p', id: 'm', reasoning: { efforts: [] } }), undefined)
  engineLike.snapshot.reasoningEffort = 'high'
  assert.equal(
    Engine.prototype._resolveEffort.call(engineLike, { provider: 'p', id: 'm', reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } }),
    'high',
  )
  assert.throws(
    () => Engine.prototype._resolveEffort.call(engineLike, { provider: 'p', id: 'm' }),
    (error) => error.code === 'UNSUPPORTED_REASONING_EFFORT',
  )

  const agent = fakeAgent()
  assert.deepEqual(Engine.prototype._resolveRoute.call(engineLike, agent), {
    target: { provider: 'p', model: 'm' },
    policy: {
      target: { provider: 'p', model: 'm' },
      thresholdRatio: 0.8,
      headroomTokens: 100,
      retainRatio: 0.1,
      summarizationProvider: '',
      summarizationModel: '',
      maxTokens: 10,
      compactionRetries: 1,
      maxOverflowRetries: 1,
    },
  })
  engineLike.snapshot.summarizationProvider = 'sum'
  engineLike.snapshot.summarizationModel = 'sum-model'
  assert.deepEqual(Engine.prototype._resolveRoute.call(engineLike, agent).target, {
    provider: 'sum',
    model: 'sum-model',
  })
  const noTarget = {
    snapshot: {
      summarizationProvider: '',
      summarizationModel: '',
      reasoningEffort: '',
      maxTokens: 10,
      modelPolicies: [],
      thresholdRatio: 0.8,
      headroomTokens: 100,
      retainRatio: 0.1,
      retainTokens: null,
      compactionRetries: 1,
      maxOverflowRetries: 1,
    },
  }
  assert.throws(
    () =>
      Engine.prototype._resolveRoute.call(noTarget, {
        ...fakeAgent(),
        options: {},
        session: { requestHeader: () => undefined },
      }),
    (error) => error.code === 'BETTER_COMPACT_ROUTE',
  )
})

test('_supersededByPreset keeps the host engine out of a preset-owned realm', () => {
  const agent = fakeAgent()
  const privateEngine = { private: true }
  const host = { ctx: { get: () => ({ serviceFor: () => privateEngine }) } }
  assert.equal(Engine.prototype._supersededByPreset.call(host, agent), true)
  const own = { ctx: { get: () => ({ serviceFor: () => own }) } }
  assert.equal(Engine.prototype._supersededByPreset.call(own, agent), false)
  const none = { ctx: { get: () => undefined } }
  assert.equal(Engine.prototype._supersededByPreset.call(none, agent), false)
})

test('_maybeContinue schedules exactly one ordinary follow-up and respects blockers', async () => {
  resetLiveRegistry()
  const followups = []
  const agent = fakeAgent()
  const flushes = []
  const sessions = { flush: async (session) => { flushes.push(session) } }
  const ctx = {
    sessions,
    get: (name) => (name === 'agents' ? { get: () => agent, list: () => [agent] } : undefined),
    logger: { info: () => undefined, warn: () => undefined },
  }
  agent.followup = (message) => followups.push(message)
  const engineLike = { ctx }
  const result = { compactionId: 'c1', shadowedSeqs: [1, 2] }
  await Engine.prototype._maybeContinue.call(engineLike, agent, result, undefined)
  assert.equal(followups.length, 1)
  assert.equal(followups[0].source.kind, 'user')
  assert.equal(continuationOutcome(agent.id).status, 'scheduled')
  assert.deepEqual(continuationOutcome(agent.id).blockers, [])
  assert.match(followups[0].content[0].text, /Continue the same task in this session/)
  assert.equal(flushes.length, 1)
  // Replay/second attempt with the same id cannot schedule twice.
  await Engine.prototype._maybeContinue.call(engineLike, agent, result, undefined)
  assert.equal(followups.length, 1)
  // Cancellation stops the continuation.
  await Engine.prototype._maybeContinue.call(engineLike, agent, { compactionId: 'c2', shadowedSeqs: [] }, {
    aborted: true,
  })
  assert.equal(followups.length, 1)
  // A paused goal stops the continuation without touching the goal.
  agent.status = 'idle'
  const pausedCtx = {
    ...ctx,
    get: (name) => {
      if (name === 'goals') return { get: () => ({ objective: 'x', phase: 'paused', roundsStarted: 1, maxGoalRounds: 2 }) }
      return ctx.get(name)
    },
    agents: ctx.agents,
    sessions,
  }
  await Engine.prototype._maybeContinue.call({ ctx: pausedCtx }, agent, { compactionId: 'c3', shadowedSeqs: [] }, undefined)
  assert.equal(followups.length, 1)
  assert.equal(continuationOutcome(agent.id).status, 'skipped')
  assert.match(continuationOutcome(agent.id).blockers.join('; '), /goal is paused/)
})
