import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as React from 'react'
import TestRenderer from 'react-test-renderer'

const { createElement: h } = React
const act = TestRenderer.act ?? TestRenderer.default?.act
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const SOURCE = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')

function loadClient() {
  const registrations = []
  new Function('window', SOURCE)({
    __ModuleLoader__: { load: (entry) => registrations.push(entry) },
  })
  assert.equal(registrations.length, 1)
  const exports = new Function(
    'require',
    'return (' + registrations[0].factory.toString() + ')(require)',
  )((specifier) => {
    if (specifier === 'react') return React
    throw new Error('unexpected external require: ' + specifier)
  })
  return { entry: registrations[0], exports }
}

// ── fixtures ──────────────────────────────────────────────────────────────

function formValue(overrides = {}) {
  return {
    mode: 'goal',
    auto: true,
    thresholdRatio: 0.8,
    headroomTokens: 65536,
    summarizationProvider: '',
    summarizationModel: '',
    reasoningEffort: '',
    cachePriority: true,
    compactionRetries: 1,
    maxOverflowRetries: 1,
    modelPolicies: [],
    ...overrides,
  }
}

function activeConfig(overrides = {}) {
  return {
    ...formValue(),
    retainRatio: 0.16,
    retainTokens: null,
    maxTokens: 65536,
    ...overrides,
  }
}

function pluginPayload(overrides = {}) {
  return {
    activeConfig: activeConfig(),
    requiresReload: false,
    sessionId: null,
    engine: null,
    diagnostics: [],
    budget: null,
    preview: null,
    lastCompaction: null,
    handoffContinuation: null,
    ...overrides,
  }
}

function measuredBudget(overrides = {}) {
  return {
    contextWindow: 200000,
    currentTokens: 142000,
    measurement: 'measured',
    fixedTokens: 12000,
    thresholdTokens: 160000,
    retainTokens: 20000,
    summaryMaxTokens: 8000,
    ...overrides,
  }
}

function sessionPayload(overrides = {}) {
  return {
    activeConfig: activeConfig(),
    requiresReload: false,
    sessionId: 'session-1',
    engine: { owner: 'host', inspectApplies: true, reason: null },
    diagnostics: [],
    budget: measuredBudget(),
    preview: {
      beforeTokens: 142000,
      afterUpperBoundTokens: 50000,
      rangeStart: 2,
      rangeEnd: 9,
      reason: null,
    },
    lastCompaction: {
      id: 'c1',
      trigger: 'automatic',
      status: 'completed',
      mode: 'goal',
      beforeTokens: 90000,
      afterTokens: 42000,
      durationMs: 1234,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      error: null,
    },
    handoffContinuation: null,
    ...overrides,
  }
}

function modelsPayload(overrides = {}) {
  return {
    enabled: true,
    routes: [{ provider: 'p', model: 'm', efforts: ['low', 'high'], defaultEffort: 'low' }],
    ...overrides,
  }
}

function router({ plugin = pluginPayload(), session = sessionPayload(), models = { enabled: false, routes: [] } } = {}) {
  return async (url) => {
    if (url === '/better-compact/api/models') return models
    if (url.startsWith('/better-compact/api/inspect?')) return session
    if (url === '/better-compact/api/inspect') return plugin
    throw new Error('unexpected read-only URL: ' + url)
  }
}

function httpError(status, body) {
  return { __httpError: true, status, body }
}

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

function makeSessions(initial = {}) {
  let snapshot = {
    ids: [],
    byId: {},
    phase: 'ready',
    error: null,
    projectionsBySession: {},
    ...initial,
  }
  const listeners = new Set()
  return {
    list: {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    set(next) {
      snapshot = { ...snapshot, ...next }
      for (const listener of [...listeners]) listener()
    },
  }
}

function makeForm(value, options = {}) {
  const mutateCalls = []
  const { revision = 3, writable = true, status = 'ready', mutateResult = true, mutateError = null } = options
  const form = {
    state: { status, writable, revision, value, base: {}, user: {} },
    async mutate(ops, expectedRevision) {
      mutateCalls.push({ ops, expectedRevision })
      if (mutateError !== null) throw mutateError
      return mutateResult
    },
  }
  return { form, mutateCalls }
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function renderPage(options = {}) {
  const { exports } = loadClient()
  const {
    value = formValue(),
    formOptions = {},
    sessions = makeSessions(),
    handler = router(),
  } = options
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url)
    calls.push({ url: target, init })
    const body = await handler(target, init)
    if (body instanceof Error) throw body
    if (body !== null && typeof body === 'object' && body.__httpError === true) {
      return response(body.body, body.status)
    }
    return response(body)
  }
  const { form, mutateCalls } = makeForm(value, formOptions)
  const entry = exports.createConfigEntry(sessions)
  let tree
  await act(async () => {
    tree = TestRenderer.create(h(entry, { view: 'page', form }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  const update = async (nextForm) => {
    await act(async () => {
      tree.update(h(entry, { view: 'page', form: nextForm }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  return { exports, entry, sessions, tree, form, mutateCalls, calls, update }
}

// ── tree helpers ──────────────────────────────────────────────────────────

function json(tree) {
  return JSON.stringify(tree.toJSON())
}

/** Text the user can see, excluding the injected stylesheet. */
function visibleText(tree) {
  const parts = []
  for (const node of tree.root.findAll((candidate) => typeof candidate.type === 'string' && candidate.type !== 'style')) {
    for (const child of node.children) {
      if (typeof child === 'string') parts.push(child)
    }
  }
  return parts.join('\n')
}

function hostNodes(tree, predicate) {
  return tree.root.findAll((node) => typeof node.type === 'string' && predicate(node.props ?? {}, node))
}

function byName(tree, name) {
  const nodes = hostNodes(tree, (props) => props.name === name)
  assert.ok(nodes.length > 0, `expected a control named ${name}`)
  return nodes[0]
}

function byData(tree, value) {
  return hostNodes(tree, (props) => props['data-bc'] === value)
}

function bySection(tree, name) {
  return hostNodes(tree, (props) => props['data-bc-section'] === name)
}

async function click(tree, node) {
  await act(async () => {
    node.props.onClick()
  })
}

async function change(tree, node, value) {
  await act(async () => {
    node.props.onChange({ target: { value } })
  })
}

async function clickButton(tree, text) {
  const buttons = hostNodes(tree, (props, node) => node.type === 'button')
  const match = buttons.find((node) =>
    node.children.some((child) => typeof child === 'string' && child.includes(text)),
  )
  assert.ok(match, `expected a button containing "${text}"`)
  await click(tree, match)
  return match
}

async function unmount(tree) {
  await act(async () => tree.unmount())
}

// ── tests ─────────────────────────────────────────────────────────────────

test('client module identity, exports and slot registration stay stable', () => {
  const { entry, exports } = loadClient()
  assert.equal(entry.id, 'dsh-better-compact')
  assert.deepEqual(exports.inject, ['slots', 'sessions'])
  assert.deepEqual(exports.ROW_CONFIG_KEYS, [
    'dsh-better-compact#dsh-better-compact',
    '@menghuan1918/dsh-apollo#dsh-better-compact',
    'dsh-apollo#dsh-better-compact',
  ])
  const watchers = new Map()
  const registrations = []
  const slots = {
    inject(name, callback) {
      const set = watchers.get(name) ?? new Set()
      watchers.set(name, set)
      set.add(callback)
      return () => set.delete(callback)
    },
    register(options, component) {
      const record = { options, component }
      registrations.push(record)
      return () => {
        const index = registrations.indexOf(record)
        if (index >= 0) registrations.splice(index, 1)
      }
    },
    declare(name) {
      const disposers = []
      for (const callback of watchers.get(name) ?? []) disposers.push(callback())
      return disposers
    },
  }
  const sessions = makeSessions()
  const ctx = {
    slots,
    sessions,
    effect(fn, label) {
      assert.equal(typeof label, 'string')
      return fn()
    },
  }
  exports.apply(ctx)
  const disposers = slots.declare('plugins.row.config')
  assert.equal(registrations.length, 3)
  assert.deepEqual(
    registrations.map((record) => record.options.key),
    exports.ROW_CONFIG_KEYS,
  )
  for (const dispose of disposers) dispose()
  assert.equal(registrations.length, 0)
})

test('summary slot renders the stable one-line description', async () => {
  const { exports } = loadClient()
  let tree
  await act(async () => {
    tree = TestRenderer.create(h(exports.BetterCompactConfigEntry, { view: 'summary' }))
  })
  assert.match(json(tree), /Native, goal-aware, or file-handoff/)
  await unmount(tree)
})

test('page renders in overview order with three distinct strategy diagrams', async () => {
  const { tree, calls } = await renderPage()
  const markers = []
  for (const node of hostNodes(tree, () => true)) {
    const props = node.props ?? {}
    if (props['data-bc'] === 'mode-cards') markers.push('modes')
    if (props['data-bc'] === 'advanced') markers.push('advanced')
    if (props['data-bc-section'] !== undefined) markers.push(props['data-bc-section'])
  }
  assert.deepEqual(markers, ['modes', 'model', 'budget', 'cache', 'advanced', 'status'])

  const diagrams = hostNodes(tree, (props) => typeof props['data-diagram'] === 'string')
  assert.deepEqual(
    diagrams.map((node) => node.props['data-diagram']),
    ['native', 'goal', 'handoff'],
  )
  assert.equal(new Set(diagrams.map((node) => node.props['aria-label'])).size, 3)
  const nativeLabel = diagrams[0].props['aria-label']
  const goalLabel = diagrams[1].props['aria-label']
  const handoffLabel = diagrams[2].props['aria-label']
  assert.match(nativeLabel, /native summary/)
  assert.match(nativeLabel, /recent verbatim/i)
  assert.match(nativeLabel, /native checkpoint/)
  assert.match(goalLabel, /authoritative goal and todo/)
  assert.match(goalLabel, /goal, constraints, progress/)
  assert.match(goalLabel, /recent verbatim/i)
  assert.match(handoffLabel, /temporary Markdown handoff file/)
  assert.match(handoffLabel, /native events store the same handoff body/i)
  assert.match(handoffLabel, /same-session continuation/)
  assert.match(handoffLabel, /Recent verbatim messages are retained/)
  assert.match(json(tree), /Strategy schematic, not a live token flow or cache hit rate/)
  assert.deepEqual(
    calls.map((call) => call.url).sort(),
    ['/better-compact/api/inspect', '/better-compact/api/models'],
  )
  await unmount(tree)
})

test('mode cards use radio semantics, keyboard selection and a disabled state', async () => {
  const { tree } = await renderPage()
  const group = hostNodes(tree, (props) => props.role === 'radiogroup')
  assert.ok(group.length >= 1)
  const radios = hostNodes(tree, (props) => props.role === 'radio')
  assert.equal(radios.length, 3)
  const goal = radios.find((node) => node.props['data-mode'] === 'goal')
  const handoff = radios.find((node) => node.props['data-mode'] === 'handoff')
  const native = radios.find((node) => node.props['data-mode'] === 'native')
  assert.equal(goal.props['aria-checked'], true)
  assert.equal(goal.props.tabIndex, 0)
  assert.equal(handoff.props['aria-checked'], false)
  assert.equal(handoff.props.tabIndex, -1)

  await act(async () => {
    goal.props.onKeyDown({ key: 'ArrowRight', preventDefault() {} })
  })
  assert.equal(handoff.props['aria-checked'], true)
  assert.equal(goal.props['aria-checked'], false)
  await act(async () => {
    native.props.onKeyDown({ key: ' ', preventDefault() {} })
  })
  assert.equal(native.props['aria-checked'], true)
  await unmount(tree)

  const disabled = await renderPage({ formOptions: { writable: false } })
  const disabledRadios = hostNodes(disabled.tree, (props) => props.role === 'radio')
  assert.ok(disabledRadios.every((node) => node.props['aria-disabled'] === true))
  const before = disabledRadios.find((node) => node.props['data-mode'] === 'goal').props['aria-checked']
  await click(disabled.tree, disabledRadios.find((node) => node.props['data-mode'] === 'handoff'))
  assert.equal(
    hostNodes(disabled.tree, (props) => props.role === 'radio' && props['data-mode'] === 'goal')[0].props['aria-checked'],
    before,
  )
  await unmount(disabled.tree)
})

test('selected mode differing from the active snapshot is flagged for a profile reload', async () => {
  const { tree } = await renderPage({
    handler: router({
      plugin: pluginPayload({ requiresReload: true, activeConfig: activeConfig({ mode: 'native' }) }),
    }),
  })
  const goalCard = hostNodes(
    tree,
    (props) => props.role === 'radio' && props['data-mode'] === 'goal',
  )[0]
  const pending = hostNodes(tree, (props, node) => node.props['data-bc-mode-pending'] === 'true')
  assert.equal(pending.length, 1)
  assert.match(json(tree), /reload the profile to apply/)
  assert.equal(goalCard.props['aria-checked'], true)
  assert.match(json(tree), /Saved configuration differs from the active engine snapshot/)
  const banner = byData(tree, 'active-config')[0]
  assert.equal(banner.props['data-requires-reload'], 'true')
  await unmount(tree)
})

test('native mode disables enhanced effort and cache controls but keeps saved values', async () => {
  const { tree } = await renderPage({
    value: formValue({
      mode: 'native',
      summarizationProvider: 'p',
      summarizationModel: 'm',
      reasoningEffort: 'ultra',
      cachePriority: true,
    }),
    handler: router({ models: modelsPayload() }),
  })
  const effort = byName(tree, 'reasoningEffort')
  const cache = byName(tree, 'cachePriority')
  assert.equal(effort.props.disabled, true)
  assert.equal(effort.props.value, 'ultra')
  assert.equal(cache.props.disabled, true)
  assert.equal(cache.props.checked, true)
  assert.match(json(tree), /not applicable: the native implementation decides/)
  assert.match(json(tree), /The saved value is kept for switching back/)
  assert.equal(byName(tree, 'summarizationProvider').props.disabled, false)
  assert.equal(hostNodes(tree, (props) => props['data-bc-error'] === 'reasoningEffort').length, 0)

  const goalCard = hostNodes(tree, (props) => props.role === 'radio' && props['data-mode'] === 'goal')[0]
  await click(tree, goalCard)
  assert.equal(byName(tree, 'reasoningEffort').props.disabled, false)
  assert.equal(byName(tree, 'reasoningEffort').props.value, 'ultra')
  assert.equal(byName(tree, 'cachePriority').props.disabled, false)
  assert.equal(hostNodes(tree, (props) => props['data-bc-error'] === 'reasoningEffort').length, 1)
  assert.match(json(tree), /not advertised by p\/m/)
  await unmount(tree)
})

test('saved model and effort values stay visible and are marked when outside capabilities', async () => {
  const legacy = await renderPage({
    value: formValue({ summarizationProvider: 'legacy', summarizationModel: 'retired' }),
    handler: router({ models: modelsPayload() }),
  })
  assert.equal(byName(legacy.tree, 'summarizationProvider').props.value, 'legacy')
  assert.equal(byName(legacy.tree, 'summarizationModel').props.value, 'retired')
  assert.match(json(legacy.tree), /not in the host’s allowed candidate list/)
  assert.match(json(legacy.tree), /The saved value is kept/)
  assert.ok(byData(legacy.tree, 'route-warning')[0])
  await change(legacy.tree, byName(legacy.tree, 'thresholdRatio'), '0.7')
  await clickButton(legacy.tree, 'Save settings')
  await flush()
  assert.equal(legacy.mutateCalls.length, 1, 'the candidate warning must not block a save')
  await unmount(legacy.tree)

  const effort = await renderPage({
    value: formValue({ summarizationProvider: 'p', summarizationModel: 'm', reasoningEffort: 'ultra' }),
    handler: router({ models: modelsPayload() }),
  })
  const select = byName(effort.tree, 'reasoningEffort')
  assert.equal(select.props.value, 'ultra')
  const savedOption = hostNodes(
    effort.tree,
    (props) => props.value === 'ultra',
  )[0]
  assert.ok(savedOption)
  assert.match(json(effort.tree), /not advertised by p\/m/)
  assert.match(json(effort.tree), /saved; not advertised/)
  await unmount(effort.tree)
})

test('provider/model clear as a pair and unknown capability is labelled', async () => {
  const paired = await renderPage({
    value: formValue({ summarizationProvider: 'p', summarizationModel: 'm' }),
    handler: router({ models: modelsPayload() }),
  })
  await change(paired.tree, byName(paired.tree, 'summarizationProvider'), '')
  assert.equal(byName(paired.tree, 'summarizationProvider').props.value, '')
  assert.equal(byName(paired.tree, 'summarizationModel').props.value, '')
  await unmount(paired.tree)

  const unknown = await renderPage({
    value: formValue({ summarizationProvider: 'p', summarizationModel: 'm' }),
    handler: router({ models: { enabled: false, routes: [] } }),
  })
  assert.match(json(unknown.tree), /Capability unknown for this route/)
  assert.match(json(unknown.tree), /discovered and currently usable routes are unknown/)
  assert.equal(byName(unknown.tree, 'reasoningEffort').props.value, '')
  await unmount(unknown.tree)
})

test('retention form switch clears the other form and saves one pair', async () => {
  const { tree, mutateCalls } = await renderPage({
    value: formValue({ retainRatio: 0.2 }),
  })
  assert.ok(byName(tree, 'retainRatio'))
  const tokensRadio = hostNodes(tree, (props) => props.name === 'retainMode' && props.value === 'tokens')[0]
  await act(async () => {
    tokensRadio.props.onChange()
  })
  assert.equal(hostNodes(tree, (props) => props.name === 'retainRatio').length, 0)
  await change(tree, byName(tree, 'retainTokens'), '1000')
  await clickButton(tree, 'Save settings')
  await flush()
  assert.equal(mutateCalls.length, 1)
  const ops = mutateCalls[0].ops
  assert.ok(ops.some((op) => op.op === 'unset' && op.path[0] === 'retainRatio'))
  assert.ok(
    ops.some(
      (op) => op.op === 'set' && op.path[0] === 'retainTokens' && op.value === 1000,
    ),
  )
  await unmount(tree)
})

test('save sends one atomic mutation with the expected revision and preserves model policies', async () => {
  const { tree, mutateCalls } = await renderPage({
    value: formValue({
      retainRatio: 0.16,
      modelPolicies: [{ provider: 'p', model: 'm', maxTokens: 100 }],
    }),
  })
  const handoff = hostNodes(tree, (props) => props.role === 'radio' && props['data-mode'] === 'handoff')[0]
  await click(tree, handoff)
  await change(tree, byName(tree, 'summarizationProvider'), 'p')
  await change(tree, byName(tree, 'summarizationModel'), 'm')
  await change(tree, byName(tree, 'thresholdRatio'), '0.7')
  await change(tree, byName(tree, 'headroomTokens'), '32768')
  const tokensRadio = hostNodes(tree, (props) => props.name === 'retainMode' && props.value === 'tokens')[0]
  await act(async () => {
    tokensRadio.props.onChange()
  })
  await change(tree, byName(tree, 'retainTokens'), '8000')
  await act(async () => {
    byName(tree, 'cachePriority').props.onChange({ target: { checked: false } })
  })
  await act(async () => {
    byName(tree, 'auto').props.onChange({ target: { checked: false } })
  })
  await change(tree, byName(tree, 'maxTokens'), '4096')
  await change(tree, byName(tree, 'compactionRetries'), '2')
  await change(tree, byName(tree, 'maxOverflowRetries'), '0')
  assert.match(json(tree), /p\/m/)
  assert.match(json(tree), /maxTokens=100/)

  await clickButton(tree, 'Save settings')
  await flush()
  assert.equal(mutateCalls.length, 1)
  const { ops, expectedRevision } = mutateCalls[0]
  assert.equal(expectedRevision, 3)
  const find = (path) => ops.find((op) => op.path[0] === path)
  assert.deepEqual(find('mode'), { op: 'set', path: ['mode'], value: 'handoff' })
  assert.deepEqual(find('summarizationProvider'), { op: 'set', path: ['summarizationProvider'], value: 'p' })
  assert.deepEqual(find('summarizationModel'), { op: 'set', path: ['summarizationModel'], value: 'm' })
  assert.deepEqual(find('thresholdRatio'), { op: 'set', path: ['thresholdRatio'], value: 0.7 })
  assert.deepEqual(find('headroomTokens'), { op: 'set', path: ['headroomTokens'], value: 32768 })
  assert.deepEqual(find('retainTokens'), { op: 'set', path: ['retainTokens'], value: 8000 })
  assert.deepEqual(find('retainRatio'), { op: 'unset', path: ['retainRatio'] })
  assert.deepEqual(find('cachePriority'), { op: 'set', path: ['cachePriority'], value: false })
  assert.deepEqual(find('auto'), { op: 'set', path: ['auto'], value: false })
  assert.deepEqual(find('maxTokens'), { op: 'set', path: ['maxTokens'], value: 4096 })
  assert.deepEqual(find('compactionRetries'), { op: 'set', path: ['compactionRetries'], value: 2 })
  assert.deepEqual(find('maxOverflowRetries'), { op: 'set', path: ['maxOverflowRetries'], value: 0 })
  assert.equal(ops.some((op) => op.path[0] === 'modelPolicies'), false)
  await unmount(tree)
})

test('save success asks for a profile reload and sends no write HTTP', async () => {
  const { tree, mutateCalls, calls } = await renderPage()
  await change(tree, byName(tree, 'thresholdRatio'), '0.7')
  await clickButton(tree, 'Save settings')
  await flush()
  assert.equal(mutateCalls.length, 1)
  const message = byData(tree, 'save-saved')[0]
  assert.ok(message)
  assert.match(json(tree), /Saved — reload profile/)
  assert.match(json(tree), /Refreshing the web page does not reload the engine/)
  assert.ok(calls.length >= 2)
  assert.ok(calls.every((call) => call.init.method === 'GET'))
  assert.ok(calls.every((call) => call.url.startsWith('/better-compact/api/')))
  await unmount(tree)
})

test('a host revision change surfaces a conflict instead of silently overwriting', async () => {
  const first = await renderPage()
  await change(first.tree, byName(first.tree, 'thresholdRatio'), '0.7')
  const external = {
    state: {
      ...first.form.state,
      revision: 4,
      value: formValue({ thresholdRatio: 0.75 }),
    },
    mutate: first.form.mutate,
  }
  await first.update(external)
  assert.ok(byData(first.tree, 'revision-conflict')[0])
  assert.match(json(first.tree), /cannot silently overwrite/)
  const saveButton = byData(first.tree, 'save-button')[0]
  assert.equal(saveButton.props.disabled, true)
  await click(first.tree, saveButton)
  await flush()
  assert.equal(first.mutateCalls.length, 0)
  await clickButton(first.tree, 'Reload host values')
  await flush()
  assert.equal(byData(first.tree, 'revision-conflict').length, 0)
  assert.equal(byName(first.tree, 'thresholdRatio').props.value, '0.75')
  await unmount(first.tree)
})

test('a refused or failed save keeps the draft and never reports success', async () => {
  const refused = await renderPage({ formOptions: { mutateResult: false } })
  await change(refused.tree, byName(refused.tree, 'thresholdRatio'), '0.7')
  await clickButton(refused.tree, 'Save settings')
  await flush()
  assert.ok(byData(refused.tree, 'save-rejected')[0])
  assert.match(json(refused.tree), /The draft is kept and was not applied/)
  assert.equal(byName(refused.tree, 'thresholdRatio').props.value, '0.7')
  assert.equal(json(refused.tree).includes('Saved — reload profile'), false)
  await unmount(refused.tree)

  const transported = await renderPage({
    formOptions: { mutateError: new Error('socket closed') },
  })
  await change(transported.tree, byName(transported.tree, 'thresholdRatio'), '0.7')
  await clickButton(transported.tree, 'Save settings')
  await flush()
  const transport = byData(transported.tree, 'save-transport')[0]
  assert.ok(transport)
  assert.match(json(transported.tree), /socket closed/)
  assert.equal(byName(transported.tree, 'thresholdRatio').props.value, '0.7')
  assert.equal(json(transported.tree).includes('Saved — reload profile'), false)
  await unmount(transported.tree)
})

test('budget unknowns stay unknown while measured values, framing and safe cut are shown', async () => {
  const sessions = makeSessions({ ids: ['session-1'], byId: { 'session-1': { id: 'session-1', displayTitle: 'One', running: false } } })
  const unknown = await renderPage({
    sessions,
    handler: router({
      session: sessionPayload({
        budget: {
          contextWindow: null,
          currentTokens: null,
          measurement: 'unavailable',
          fixedTokens: null,
          thresholdTokens: null,
          retainTokens: null,
          summaryMaxTokens: null,
        },
        preview: null,
      }),
    }),
  })
  assert.ok(byData(unknown.tree, 'budget-incomplete')[0])
  assert.equal(/(?:^|[^\d,])0 tokens/.test(visibleText(unknown.tree)), false)
  assert.equal(visibleText(unknown.tree).includes('100%'), false)
  await unmount(unknown.tree)

  const measured = await renderPage({
    sessions,
    handler: router({ session: sessionPayload() }),
  })
  const windowBar = byData(measured.tree, 'budget-window-bar')[0]
  assert.ok(windowBar)
  assert.match(windowBar.props['aria-label'], /window 200,000 tokens/)
  assert.match(windowBar.props['aria-label'], /current 142,000 tokens/)
  assert.match(windowBar.props['aria-label'], /fixed prefix 12,000 tokens/)
  assert.match(windowBar.props['aria-label'], /retained tail 20,000 tokens/)
  assert.match(json(measured.tree), /measured \(provider usage anchor\)/)
  assert.equal(hostNodes(measured.tree, (props) => props['data-bc-current'] === 'true').length, 1)
  assert.ok(byData(measured.tree, 'before-label')[0])
  assert.ok(byData(measured.tree, 'after-label')[0])
  assert.ok(byData(measured.tree, 'retention-compare')[0])
  assert.match(json(measured.tree), /Manual compact \/ context-overflow recovery/)
  assert.match(json(measured.tree), /not a permanent pin/)
  assert.match(json(measured.tree), /Safe cut candidate: surface seq 2–9/)
  assert.match(json(measured.tree), /budget upper-bound estimate/)
  assert.match(json(measured.tree), /not a prediction of the generated summary length/)
  await unmount(measured.tree)
})

test('no safe cut and budget conflict reasons point at the controls to change', async () => {
  const sessions = makeSessions({ ids: ['session-1'], byId: { 'session-1': { id: 'session-1', displayTitle: 'One', running: false } } })
  const { tree } = await renderPage({
    sessions,
    handler: router({
      session: sessionPayload({
        diagnostics: [
          'routed model reserves 64000 completion tokens of its 30000-token context window, leaving no message budget; configure a larger adapter contextWindow or a smaller maxTokens',
          'routed model retainTokens (20000) must be less than threshold tokens 16000; lower the retention budget or raise the trigger',
          'routed model retainTokens (20000) must be less than threshold tokens 16000; lower the retention budget or raise the trigger',
        ],
        preview: {
          beforeTokens: 142000,
          afterUpperBoundTokens: null,
          rangeStart: null,
          rangeEnd: null,
          reason: 'no safe compactable range: the session has no older balanced span left after the system prompt and retained tail',
        },
      }),
    }),
  })
  const text = json(tree)
  assert.ok(byData(tree, 'no-safe-cut')[0])
  assert.match(text, /Capacity too small/)
  assert.match(text, /Retention conflicts with the trigger/)
  assert.match(text, /Adjusted|Adjust the summary model|Lower the retention budget|Lower headroomTokens/)
  assert.match(text, /Fixed prefix \/ retained tail leaves no safe range/)
  assert.equal((text.match(/Capacity too small/g) ?? []).length, 1)
  await unmount(tree)
})

test('compaction status distinguishes completed, unknown cache usage and persistence-error', async () => {
  const sessions = makeSessions({ ids: ['session-1'], byId: { 'session-1': { id: 'session-1', displayTitle: 'One', running: false } } })
  const completed = await renderPage({ sessions, handler: router({ session: sessionPayload() }) })
  assert.ok(byData(completed.tree, 'last-compaction')[0])
  assert.match(json(completed.tree), /Completed · automatic/)
  assert.match(json(completed.tree), /Cache usage: unknown/)
  assert.equal(json(completed.tree).includes('Cache read tokens'), false)
  await unmount(completed.tree)

  const persistence = await renderPage({
    sessions,
    handler: router({
      session: sessionPayload({
        lastCompaction: {
          id: 'c9',
          trigger: 'manual',
          status: 'persistence-error',
          mode: 'handoff',
          beforeTokens: 1000,
          afterTokens: null,
          durationMs: null,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          error: 'flush failed',
        },
      }),
    }),
  })
  assert.match(json(persistence.tree), /Persistence error · manual/)
  assert.ok(byData(persistence.tree, 'persistence-error')[0])
  assert.match(json(persistence.tree), /not a clean success and not a full rollback/)
  assert.match(json(persistence.tree), /Recorded error: flush failed/)
  await unmount(persistence.tree)

  const usage = await renderPage({
    sessions,
    handler: router({
      session: sessionPayload({
        lastCompaction: {
          ...sessionPayload().lastCompaction,
          cacheReadTokens: 7,
          cacheWriteTokens: 3,
        },
      }),
    }),
  })
  assert.match(json(usage.tree), /Cache read tokens \(reported\)/)
  assert.match(json(usage.tree), /7 tokens/)
  assert.match(json(usage.tree), /Cache write tokens \(reported\)/)
  assert.match(json(usage.tree), /3 tokens/)
  await unmount(usage.tree)
})

test('handoff continuation and deduplicated diagnostics are shown', async () => {
  const sessions = makeSessions({ ids: ['session-1'], byId: { 'session-1': { id: 'session-1', displayTitle: 'One', running: false } } })
  const { tree } = await renderPage({
    sessions,
    handler: router({
      session: sessionPayload({
        diagnostics: ['diagnostic one', 'diagnostic one', 'diagnostic two'],
        handoffContinuation: {
          compactionId: 'c1',
          status: 'skipped',
          blockers: ['a user question is still pending'],
          at: 1,
        },
      }),
    }),
  })
  const continuation = byData(tree, 'handoff-continuation')[0]
  assert.ok(continuation)
  assert.match(json(tree), /waiting for the user/)
  assert.match(json(tree), /a user question is still pending/)
  assert.match(json(tree), /Replay, page refresh, or plugin reload cannot schedule another continuation/)
  assert.equal((json(tree).match(/diagnostic one/g) ?? []).length, 1)
  assert.match(json(tree), /diagnostic two/)
  await unmount(tree)
})

test('a foreign compaction engine suppresses budget/preview but keeps real records', async () => {
  const sessions = makeSessions({ ids: ['session-1'], byId: { 'session-1': { id: 'session-1', displayTitle: 'One', running: false } } })
  const { tree } = await renderPage({
    sessions,
    handler: router({
      session: sessionPayload({
        engine: { owner: 'foreign-preset', inspectApplies: false, reason: 'a different compaction engine owns this session' },
      }),
    }),
  })
  const text = json(tree)
  assert.match(text, /different compaction engine/)
  assert.equal(byData(tree, 'budget-window-bar').length, 0)
  assert.equal(byData(tree, 'safe-cut').length, 0)
  assert.ok(byData(tree, 'last-compaction')[0])
  assert.match(text, /Completed · automatic/)
  assert.ok(byData(tree, 'budget-not-applicable')[0])
  await unmount(tree)
})

test('session selection fetches the chosen session, aborts stale requests and stays empty without sessions', async () => {
  const sessions = makeSessions({
    ids: ['session-1', 'session-2'],
    byId: {
      'session-1': { id: 'session-1', displayTitle: 'One', running: false },
      'session-2': { id: 'session-2', displayTitle: 'Two', running: true },
    },
  })
  const { tree, calls } = await renderPage({
    sessions,
    handler: router({
      session: sessionPayload(),
    }),
  })
  const firstCall = calls.find((call) => call.url.includes('sessionId=session-1'))
  assert.ok(firstCall)
  await change(tree, byName(tree, 'inspectSession'), 'session-2')
  await flush()
  const secondCall = calls.find((call) => call.url.includes('sessionId=session-2'))
  assert.ok(secondCall)
  assert.equal(firstCall.init.signal.aborted, true)
  await unmount(tree)

  const empty = await renderPage()
  assert.equal(empty.calls.some((call) => call.url.includes('sessionId=')), false)
  assert.match(json(empty.tree), /No sessions are available; showing plugin state only\./)
  assert.ok(byData(empty.tree, 'status-empty')[0])
  await unmount(empty.tree)
})

test('inspect failure leaves the form editable and never triggers a write', async () => {
  const { tree, mutateCalls, calls } = await renderPage({
    handler: async (url) => {
      if (url === '/better-compact/api/models') return { enabled: false, routes: [] }
      return httpError(404, { code: 'SESSION_NOT_FOUND', message: 'session is not visible' })
    },
  })
  assert.match(json(tree), /session is not visible/)
  assert.match(json(tree), /form remains editable/)
  const handoff = hostNodes(tree, (props) => props.role === 'radio' && props['data-mode'] === 'handoff')[0]
  await click(tree, handoff)
  await clickButton(tree, 'Save settings')
  await flush()
  assert.equal(mutateCalls.length, 1)
  assert.equal(mutateCalls[0].ops[0].value, 'handoff')
  assert.ok(calls.every((call) => call.init.method === 'GET'))
  await unmount(tree)
})

test('form loading, unavailable and missing states are explicit', async () => {
  const { exports } = loadClient()
  let tree
  await act(async () => {
    tree = TestRenderer.create(
      h(exports.BetterCompactConfigEntry, {
        view: 'page',
        form: { state: { status: 'loading', writable: false, revision: undefined, value: undefined } },
      }),
    )
  })
  assert.match(json(tree), /Reading configuration…/)
  await unmount(tree)

  await act(async () => {
    tree = TestRenderer.create(
      h(exports.BetterCompactConfigEntry, {
        view: 'page',
        form: { state: { status: 'unavailable', writable: false, revision: undefined, value: undefined } },
      }),
    )
  })
  assert.match(json(tree), /The Host does not expose an editable configuration form/)
  assert.equal(json(tree).includes('mode-cards'), false)
  await unmount(tree)

  await act(async () => {
    tree = TestRenderer.create(h(exports.BetterCompactConfigEntry, { view: 'page' }))
  })
  assert.match(json(tree), /Waiting for the Host configuration form/)
  await unmount(tree)
})

test('page uses host theme tokens, reduced motion and labels every control', async () => {
  const { tree } = await renderPage()
  const styleNode = hostNodes(tree, (props, node) => node.type === 'style')[0]
  assert.ok(styleNode)
  const css = styleNode.children.join('')
  assert.match(css, /var\(--dsw-alias-/)
  assert.match(css, /var\(--dsw-focus-ring-/)
  assert.match(css, /font-variant-numeric:tabular-nums/)
  assert.match(css, /prefers-reduced-motion:reduce/)
  assert.match(css, /@media \(max-width:760px\)/)
  assert.match(css, /:focus-visible/)
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/)

  const controls = hostNodes(tree, (props, node) => ['input', 'select', 'textarea'].includes(node.type))
  assert.ok(controls.length >= 10)
  for (const control of controls) {
    assert.equal(typeof control.props.name, 'string', 'every control must carry a name')
    let labelled = false
    if (typeof control.props.id === 'string' && control.props.id.length > 0) {
      labelled = hostNodes(tree, (props) => props.htmlFor === control.props.id).length > 0
    }
    let parent = control.parent
    while (!labelled && parent !== null) {
      if (parent.type === 'label') labelled = true
      parent = parent.parent
    }
    assert.ok(labelled, `control ${control.props.name} must have an associated label`)
  }
  await unmount(tree)
})

test('client source contains no token-count or compaction-selection implementation', () => {
  assert.doesNotMatch(SOURCE, /tokenMeter|compactableRange|estimateMessage|estimateToolsTokens|selectCompactableRange/)
  assert.doesNotMatch(SOURCE, /\/better-compact\/api\/[a-z/]+['"`][\s\S]{0,200}method:\s*['"](?:POST|PUT|PATCH|DELETE)/)
  assert.match(SOURCE, /method: 'GET'/)
})
