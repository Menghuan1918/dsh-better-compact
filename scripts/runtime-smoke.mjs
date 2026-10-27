/**
 * Real-profile smoke for dsh-better-compact.
 *
 * A throwaway DSH_HOME + profile is built from the installed runtime
 * (DSH_PACKAGE_ROOT) and this package's shipped files only. A scripted LLM
 * adapter replaces the provider; the native Windows-style durable log,
 * compaction transaction, commands, settings/config editor, preset registry,
 * webserver, and session replay are all the real host implementations.
 *
 * Covered:
 *   - standalone bundle row mount: native compaction disabled, host engine live;
 *   - automatic pressure compaction with exact native event sequence;
 *   - inspect GET over the real Host webserver (200/400/404/405/no-store) and
 *     live/cold/unknown session semantics, with a read-only event-count check;
 *   - goal/todo state in the summary instruction and authoritative-state rules;
 *   - manual /compact success, failure mapping and no-op;
 *   - automatic summary failure keeps the original surface and the turn;
 *   - handoff temp file (path/mode/read-back), embedded checkpoint, exactly one
 *     same-session continuation; deleting the file and replaying the session;
 *   - native mode equivalence: inherited summarizer, no effort/cache overrides;
 *   - preset path: the `better-compact` preset owns an isolated engine and the
 *     host engine does not double-compact;
 *   - settings save -> requiresReload -> profile restart -> active snapshot.
 *
 * Not covered (reported honestly): real-model summary fidelity, provider cache
 * hit rates, and the S3 visual settings page.
 */

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, cp, symlink, rm, stat, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dsh = process.env.DSH_PACKAGE_ROOT
if (!dsh) throw new Error('Set DSH_PACKAGE_ROOT to the installed @deepseek-ai/dsh package directory')
const at = (name) => pathToFileURL(join(dirname(dsh), name)).href
const home = await mkdtemp(join(tmpdir(), 'dsh-better-compact-smoke-'))
process.env.DSH_HOME = home
process.env.DSH_TELEMETRY_DISABLED = '1'

const appBoot = await import(at('dsh-app-boot/lib/index.js'))
const { symbols } = await import(at('cordis/lib/index.js'))
const { createUserMessage } = await import(at('dsh-llm/lib/index.js'))
const { runProfile } = await import(at('dsh/lib/profile-boot.js'))

const profileDir = appBoot.resolveProfileDir('it', home)
appBoot.initProfile(profileDir, [...appBoot.PROFILE_TEMPLATES.headless.bundles, 'dsh-better-compact'])

// Install a published-layout copy: only shipped files, with peers resolved from
// the same runtime as the host. No copied node_modules, no .git, no specs.
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const modules = join(profileDir, 'node_modules')
await mkdir(modules, { recursive: true })
const pluginDir = join(modules, 'dsh-better-compact')
await mkdir(pluginDir, { recursive: true })
await cp(join(root, 'package.json'), join(pluginDir, 'package.json'))
for (const name of pkg.files) {
  try {
    await cp(join(root, name), join(pluginDir, name), { recursive: true })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}
await symlink(dirname(dsh), join(modules, '@deepseek-ai'))
const manifestPath = join(profileDir, 'package.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
manifest.dependencies['dsh-better-compact'] = `file:${pluginDir}`
await writeFile(manifestPath, JSON.stringify(manifest, null, 2))

/** Load the shipped standard preset so a real foreign-engine session can be inspected. */
const standardPresetPatches = appBoot.loadOverlayPatches(
  'better-compact-smoke',
  join(dirname(dsh), 'dsh-web-app', 'presets', 'standard.patch.yml'),
)

/** Initial row override: absolute retention + a small-capacity test route. */
const INITIAL_CONFIG = {
  mode: 'goal',
  auto: true,
  thresholdRatio: 0.25,
  headroomTokens: 50,
  retainTokens: 100,
  maxTokens: 100,
  compactionRetries: 0,
  maxOverflowRetries: 1,
}
await writeFile(
  join(profileDir, 'cordis.patch.yml'),
  JSON.stringify(
    [
      ...standardPresetPatches,
      { id: 'headless-startup', disabled: true },
      { id: 'headless-runner', disabled: true },
      { id: 'dsh-better-compact', config: INITIAL_CONFIG },
      { id: 'credentials', disabled: false, config: { watch: false } },
      {
        insert: [
          {
            id: 'agent-preset-registry',
            name: '@deepseek-ai/dsh-agent-preset-registry',
            config: { default: 'better-compact' },
          },
          { id: 'workspace', name: '@deepseek-ai/dsh-workspace' },
          {
            id: 'subagent-model-selection-settings',
            name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings',
            config: {
              enabled: true,
              allowedModels: [{ provider: 'it-noop', model: 'noop' }],
            },
          },
          {
            id: 'webserver',
            name: '@deepseek-ai/dsh-host-webserver',
            config: { host: '127.0.0.1', port: 0, compression: 'none' },
          },
          {
            id: 'connection',
            name: '@deepseek-ai/dsh-client-connection',
            config: { trustedHosts: [], cookieMaxAgeDays: 30 },
          },
          {
            id: 'tool-ask-user',
            name: '@deepseek-ai/dsh-tool-ask-user',
            config: { mode: 'timed', timeout: 5 },
          },
        ],
      },
    ],
    null,
    2,
  ),
)

const results = { passed: false, home, checks: [] }
const check = (name) => results.checks.push(name)

const textBlock = (text) => [{ type: 'text', text }]
const goalTemplate = () =>
  [
    '# Goal checkpoint',
    '## Current Goal and Unresolved Requests',
    '- goal',
    '## Constraints, Preferences, and Approved Boundaries',
    '- constraints',
    '## Decisions and Reasons',
    '- decision',
    '## Completed Work',
    '- done',
    '## In Progress',
    '- wip',
    '## Blocked, Pending, and Unverified',
    '- unverified',
    '## Key References',
    '- ref',
    '## Next Actions',
    '- next',
  ].join('\n')
/** Deliberate credential in model output; redaction must remove it everywhere. */
const HANDOFF_SECRET = 'sk-abcdefghijklmnopqrstuvwx123456'
const handoffTemplate = () =>
  [
    '# Session Handoff',
    '## Objective and Unresolved Requests',
    '- objective',
    '## Current State',
    '- state',
    '## Constraints and Approved Boundaries',
    '- constraints',
    '## Decisions and Reasons',
    '- decision',
    '## Completed Work',
    '- done',
    '## In Progress',
    '- wip',
    '## Blocked, Pending, and Unverified',
    '- unverified',
    '## Key References',
    '- ref',
    '## Next Actions',
    '- next',
    '## Suggested Skills',
    '- suggestion only',
    '## Redaction Probe',
    `- leaked token: ${HANDOFF_SECRET}`,
  ].join('\n')
const nativeTemplate = () =>
  [
    '# Native checkpoint',
    '## Primary Request and Intent',
    '- intent',
    '## Key Technical Concepts',
    '- concepts',
    '## Critical Context',
    '- context',
  ].join('\n')

/** Scripted adapter state shared across boots. */
const llmState = {
  contextWindow: 30000,
  scripted: [],
  compactionCalls: [],
  compactionBehavior: 'ok',
  normalCalls: 0,
}

const adapter = {
  providerInfo: (id) => ({ id, name: 'Better Compact scripted adapter' }),
  providerRetryPolicy: () => undefined,
  imageRequestPricing: () => undefined,
  listModels: async () => [
    { provider: 'it-noop', id: 'noop', name: 'Noop', inputModalities: ['text'] },
  ],
  resolveModel: async (provider, id) => ({
    provider,
    id,
    name: id,
    inputModalities: ['text'],
    context: { contextWindow: llmState.contextWindow },
    defaultMaxTokens: 64,
    reasoning: {
      efforts: [
        { id: 'low', name: 'Low' },
        { id: 'high', name: 'High' },
      ],
    },
  }),
  async prepareCall(provider, model) {
    const resolved = await adapter.resolveModel(provider, model)
    return { model: resolved, stream: (options) => adapter.stream(options) }
  },
  async *stream(options) {
    if (options.purpose === 'compaction') {
      llmState.compactionCalls.push(options)
      if (llmState.compactionBehavior === 'throw') throw new Error('scripted compaction provider failure')
      if (llmState.compactionBehavior === 'hang') {
        await waitForAbort(options.signal)
        return
      }
      if (llmState.compactionBehavior === 'max-tokens') {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'partial' } }
        yield { type: 'finish', reason: { kind: 'max-tokens' } }
        return
      }
      const mode = llmState.summaryMode
      const content = mode === 'handoff' ? handoffTemplate() : mode === 'native' ? nativeTemplate() : goalTemplate()
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: content } }
      yield {
        type: 'usage',
        usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 7, cacheWriteTokens: 3 },
      }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    if (options.purpose === 'session-title') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Compacted session' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    if (llmState.compactionBehavior === 'hang' && options.purpose === 'compaction') {
      await waitForAbort(options.signal)
      return
    }
    llmState.normalCalls += 1
    let next = llmState.scripted.shift()
    if (typeof next === 'function') next = next()
    if (next === undefined || next === null) next = 'Acknowledged.'
    if (typeof next === 'object' && next.hang === true) {
      await waitForAbort(options.signal)
      return
    }
    if (typeof next === 'object' && typeof next.tool === 'string') {
      const id = `it-tool-${randomUUID()}`
      const args = JSON.stringify(next.arguments ?? {})
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: next.tool, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: next.tool, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const response =
      typeof next === 'object' && typeof next.text === 'string' ? next.text : String(next)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: response } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  },
}

/** Reject once the operation signal aborts; used to hold a provider stream open. */
function waitForAbort(signal) {
  return new Promise((resolve, reject) => {
    if (signal === undefined) return resolve()
    if (signal.aborted) return reject(new Error('aborted'))
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  })
}

/** Authenticated browser-session cookie for the inspect route (Host connection). */
let inspectorCookie = null

/**
 * Exchange the process launch token for a real Connection API cookie. The
 * inspect route is only registered when the connection fence exists, so every
 * HTTP check below runs through the real authentication path.
 */
async function authenticateInspector(ctx) {
  const connection = ctx.get('connection')
  assert.ok(connection, 'the smoke profile must mount the real connection service')
  const url = new URL(connection.authenticatedUrl(ctx.get('webServer').getOrigin()))
  url.pathname = '/connect'
  url.searchParams.set('interactions', 'none')
  const response = await fetch(url, { redirect: 'manual' })
  const body = response.status === 302 ? '' : await response.text()
  assert.equal(response.status, 302, `connect failed: ${response.status} ${body}`)
  const setCookie = response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie')
  assert.ok(setCookie, 'connect must set a session cookie')
  inspectorCookie = setCookie.split(';')[0]
}

/** Boot the profile with the scripted provider registered and an inspect cookie minted. */
async function boot() {
  const booted = await runProfile({
    profile: 'it',
    patchFiles: [],
    args: [],
    environment: appBoot.loadLayeredEnv('dsh'),
  })
  booted.ctx.llm.registerAdapter(['it-noop'], adapter)
  await authenticateInspector(booted.ctx)
  return booted.ctx
}

/** Per-agent session-event recorder and waiter. */
function record(ctx, agent) {
  const events = []
  const waiters = new Set()
  const off = ctx.on('session/event', (session, event) => {
    if (session.id !== agent.id) return
    events.push(event)
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(event)) continue
      waiters.delete(waiter)
      clearTimeout(waiter.timer)
      waiter.resolve(event)
    }
  })
  return {
    events,
    waitFor(predicate, label = 'event', timeout = 20000) {
      return new Promise((resolvePromise, reject) => {
        const waiter = { predicate, resolve: resolvePromise }
        waiter.timer = setTimeout(() => {
          waiters.delete(waiter)
          reject(
            new Error(
              `timed out waiting for ${label}; saw ${events.map((event) => event.type).join(',')}`,
            ),
          )
        }, timeout)
        waiters.add(waiter)
      })
    },
    count(type, from = 0) {
      return events.slice(from).filter((event) => event.type === type).length
    },
    dispose() {
      off()
    },
  }
}

/** Create one agent without a preset (host-plane engine). */
async function createHostAgent(ctx, options = {}) {
  const created = await ctx.agents.create({
    sessionId: randomUUID(),
    meta: {
      cwd: home,
      ...(options.agentPreset === undefined ? {} : { agentPreset: options.agentPreset }),
    },
    agentOptions: { provider: 'it-noop', model: 'noop' },
    setup: options.setup ?? (async () => {}),
  })
  return created.agent
}

/** Create one agent whose session composition is mounted from a preset id. */
async function createPresetAgent(ctx, preset) {
  return createHostAgent(ctx, {
    agentPreset: preset,
    setup: async (agentCtx) => {
      await ctx.agentPresets.mount(agentCtx, preset)
    },
  })
}

/** Poll a read-only condition; used when an event can be emitted before a waiter registers. */
async function waitUntil(predicate, label, timeout = 20000) {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
}

/** Run one ordinary turn and wait for its end event. */
async function runTurn(agent, recorder, text, expected = 'completed') {
  const pending = recorder.waitFor((event) => event.type === 'turn/end', 'turn/end')
  agent.followup(createUserMessage({ content: textBlock(text), source: { kind: 'user' } }))
  const end = await pending
  assert.equal(end.data.reason.kind, expected, JSON.stringify(end.data))
  await agent.whenIdle()
  return end
}

/** Read the inspect endpoint over the real Host webserver. */
async function inspectHttp(ctx, sessionId, options = {}) {
  const base = ctx.get('webServer').getOrigin()
  const suffix =
    sessionId === undefined
      ? ''
      : `?sessionId=${encodeURIComponent(sessionId)}`
  const cookie = options.cookie === undefined ? inspectorCookie : options.cookie
  const response = await fetch(`${base}/better-compact/api/inspect${suffix}`, {
    method: options.method ?? 'GET',
    ...(cookie === null ? {} : { headers: { cookie } }),
  })
  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  return { response, text, json }
}

function compactionEvents(recorder) {
  return recorder.events.filter((event) => event.type.startsWith('compaction/'))
}

function lastCompactionStart(recorder) {
  return [...recorder.events].reverse().find((event) => event.type === 'compaction/start')
}

function summaryFor(recorder, id) {
  return recorder.events.find(
    (event) => event.type === 'compaction/summary' && event.data.compactionId === id,
  )
}

function replacementFor(recorder, id) {
  return recorder.events.find(
    (event) =>
      event.type === 'user/message' &&
      event.data.source?.kind === 'compact-checkpoint' &&
      event.data.source.compactionId === id,
  )
}

function endFor(recorder, id) {
  return recorder.events.find(
    (event) => event.type === 'compaction/end' && event.data.compactionId === id,
  )
}

let ctx
try {
  // ── Boot 1: goal mode, auto pressure, inspect, failure paths, save ────────
  llmState.summaryMode = 'goal'
  ctx = await boot()
  check('real-profile-boot')

  const companion = ctx.get('betterCompactConfig')
  assert.ok(companion, 'host companion service must exist')
  assert.equal(companion.snapshot().mode, 'goal')
  assert.equal(companion.snapshot().retainTokens, 100)
  assert.equal(companion.snapshot().retainRatio, null)
  assert.ok(ctx.compaction, 'ctx.compaction must exist')
  assert.equal(ctx.compaction.activeMode, 'goal')
  assert.equal(ctx.compaction.constructor.name, 'BetterCompactEngine')
  check('standalone-host-engine-mounted')

  const presets = await ctx.agentPresets.list()
  assert.ok(presets.some((entry) => entry.id === 'better-compact'), JSON.stringify(presets))
  check('preset-registered')

  // Inspect with no session: plugin state only.
  const bare = await inspectHttp(ctx)
  assert.equal(bare.response.status, 200)
  assert.equal(bare.response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(Object.keys(bare.json).sort(), [
    'activeConfig',
    'budget',
    'engine',
    'handoffContinuation',
    'lastCompaction',
    'preview',
    'requiresReload',
    'sessionId',
  ])
  assert.equal(bare.json.activeConfig.mode, 'goal')
  assert.equal(bare.json.requiresReload, false)
  assert.equal(bare.json.sessionId, null)
  assert.equal(bare.json.budget, null)
  check('inspect-plugin-state')

  // ── Agent A: automatic pressure + goal/todo state ────────────────────────
  const agentA = await createHostAgent(ctx)
  const recA = record(ctx, agentA)
  llmState.scripted = [
    () => 'x'.repeat(1200),
    () => 'y'.repeat(6000),
    'turn three response',
  ]
  await runTurn(agentA, recA, 'seed the session')
  await runTurn(agentA, recA, 'build more history')
  assert.equal(recA.count('compaction/start'), 0, 'history must stay below trigger until the third turn')

  // Authoritative goal, disarmed in the same synchronous block so the native
  // goal driver cannot queue an automatic round. The native todo projection is
  // turn-scoped (reset by turn/start), so todo inclusion is exercised on the
  // manual idle path in the handoff boot where the last turn's list is current.
  ctx.goals.create(agentA, { objective: 'Verify goal-aware compaction', maxGoalRounds: 8 })
  ctx.goals.disarm(agentA)

  const previewBefore = (await inspectHttp(ctx, agentA.id)).json
  assert.equal(previewBefore.sessionId, agentA.id)
  assert.equal(previewBefore.engine.owner, 'host')
  assert.equal(previewBefore.engine.inspectApplies, true)
  assert.equal(previewBefore.handoffContinuation, null)
  assert.equal(previewBefore.budget.retainTokens, 100)
  assert.equal(previewBefore.budget.contextWindow, 30000)
  assert.equal(previewBefore.budget.summaryMaxTokens, 100)
  assert.equal(previewBefore.budget.thresholdTokens, 7500)
  assert.equal(typeof previewBefore.budget.currentTokens, 'number')
  assert.ok(
    ['measured', 'estimated'].includes(previewBefore.budget.measurement),
    previewBefore.budget.measurement,
  )
  assert.equal(previewBefore.lastCompaction, null)
  assert.ok(Number.isInteger(previewBefore.preview.rangeStart))
  assert.ok(Number.isInteger(previewBefore.preview.rangeEnd))
  check('inspect-budget-and-preview')

  const seqBeforeInspect = agentA.session.seq
  const normalCallsBeforeInspect = llmState.normalCalls
  await inspectHttp(ctx, agentA.id)
  assert.equal(agentA.session.seq, seqBeforeInspect, 'inspect must not append session events')
  assert.equal(llmState.normalCalls, normalCallsBeforeInspect, 'inspect must not run an LLM call')
  check('inspect-read-only')

  // The compacting turn: pre-step sees exactly the surface inspect previewed.
  const startCountBefore = recA.count('compaction/start')
  await runTurn(agentA, recA, 'continue toward completion')
  assert.equal(recA.count('compaction/start'), startCountBefore + 1, 'exactly one automatic compaction')
  const autoStart = lastCompactionStart(recA)
  const autoId = autoStart.data.compactionId
  assert.equal(autoStart.data.turn !== null, true, 'automatic compaction is enclosed in a turn')
  const autoSummary = summaryFor(recA, autoId)
  assert.ok(autoSummary, 'compaction/summary must exist')
  assert.ok(replacementFor(recA, autoId), 'checkpoint replacement must exist')
  assert.ok(endFor(recA, autoId), 'compaction/end must exist')
  assert.equal(endFor(recA, autoId).data.error, undefined)
  assert.deepEqual(autoSummary.data.shadowedRange, {
    start: previewBefore.preview.rangeStart,
    end: previewBefore.preview.rangeEnd,
  })
  assert.ok(autoSummary.data.shadowedTokenCount > 0)
  assert.equal(autoSummary.data.provider, 'it-noop')
  assert.equal(autoSummary.data.model, 'noop')
  check('automatic-native-event-sequence')
  check('inspect-preview-matches-native-selection')

  const instruction = llmState.compactionCalls.at(-1).messages.at(-1).content[0].text
  assert.match(instruction, /Verify goal-aware compaction/)
  assert.match(instruction, /## Current Goal and Unresolved Requests/)
  assert.equal(llmState.compactionCalls.at(-1).reasoningEffort, undefined)
  check('goal-state-in-summary-instruction')

  const afterAuto = (await inspectHttp(ctx, agentA.id)).json
  assert.equal(afterAuto.lastCompaction.id, autoId)
  assert.equal(afterAuto.lastCompaction.status, 'completed')
  assert.equal(afterAuto.lastCompaction.trigger, 'automatic')
  assert.equal(afterAuto.lastCompaction.mode, 'goal')
  assert.ok(afterAuto.lastCompaction.beforeTokens > 0)
  assert.equal(typeof afterAuto.lastCompaction.afterTokens, 'number')
  assert.ok(afterAuto.lastCompaction.durationMs >= 0)
  assert.equal(afterAuto.lastCompaction.cacheReadTokens, 7)
  assert.equal(afterAuto.lastCompaction.cacheWriteTokens, 3)
  check('inspect-last-compaction-projection')

  // ── Agent B: automatic summary failure keeps surface and turn ────────────
  const agentB = await createHostAgent(ctx)
  const recB = record(ctx, agentB)
  llmState.scripted = [
    () => 'y'.repeat(1200),
    () => 'z'.repeat(6000),
    'turn continues after failure',
    'recovered turn',
    'extra turn',
  ]
  await runTurn(agentB, recB, 'seed failure session')
  await runTurn(agentB, recB, 'build more failure history')
  llmState.compactionBehavior = 'throw'
  const failedTurn = await runTurn(agentB, recB, 'trigger the failing compaction')
  assert.equal(failedTurn.data.reason.kind, 'completed', 'the turn must continue after a failed auto summary')
  const failedStart = lastCompactionStart(recB)
  const failedId = failedStart.data.compactionId
  assert.ok(endFor(recB, failedId)?.data.error, 'the failed attempt must be recorded')
  assert.equal(replacementFor(recB, failedId), undefined, 'no replacement is installed')
  llmState.compactionBehavior = 'ok'
  await runTurn(agentB, recB, 'retry after recovery')
  const recoveredStart = lastCompactionStart(recB)
  assert.notEqual(recoveredStart.data.compactionId, failedId)
  assert.ok(replacementFor(recB, recoveredStart.data.compactionId), 'a later turn can compact again')
  check('automatic-failure-keeps-surface-and-turn')
  check('automatic-failure-recovers')

  // ── Agent C: manual failure maps to a native-comprehensible error ────────
  const agentC = await createHostAgent(ctx)
  const recC = record(ctx, agentC)
  llmState.scripted = ['manual failure seed']
  await runTurn(agentC, recC, 'manual failure seed')
  llmState.compactionBehavior = 'throw'
  const manualFail = await ctx.commands.execute(
    agentC,
    '/compact',
    [],
    new AbortController().signal,
  )
  assert.equal(manualFail.result.kind, 'error', JSON.stringify(manualFail))
  assert.match(manualFail.result.text, /could not produce a useful summary/)
  const manualFailId = lastCompactionStart(recC).data.compactionId
  assert.ok(endFor(recC, manualFailId)?.data.error)
  assert.equal(replacementFor(recC, manualFailId), undefined)
  llmState.compactionBehavior = 'ok'
  check('manual-failure-native-error-mapping')

  // ── Agent D: manual no-op with no compactable history ────────────────────
  const agentD = await createHostAgent(ctx)
  const recD = record(ctx, agentD)
  const noop = await ctx.commands.execute(agentD, '/compact', [], new AbortController().signal)
  assert.equal(noop.result.kind, 'success', JSON.stringify(noop))
  assert.match(noop.result.text, /No compactable history yet/)
  assert.equal(recD.count('compaction/start'), 0, 'a no-op writes no compaction events')
  check('manual-noop-reason')

  // ── Inspect HTTP auth and error contract ─────────────────────────────────
  const unauthenticated = await inspectHttp(ctx, undefined, { cookie: null })
  assert.ok([401, 403].includes(unauthenticated.response.status), String(unauthenticated.response.status))
  assert.equal(unauthenticated.response.headers.get('cache-control'), 'no-store')
  const unknown = await inspectHttp(ctx, `missing-${randomUUID()}`)
  assert.equal(unknown.response.status, 404)
  assert.equal(unknown.response.headers.get('cache-control'), 'no-store')
  const base = ctx.get('webServer').getOrigin()
  const bad = await fetch(`${base}/better-compact/api/inspect?bogus=1`, {
    headers: { cookie: inspectorCookie },
  })
  assert.equal(bad.status, 400)
  assert.equal(bad.headers.get('cache-control'), 'no-store')
  const post = await inspectHttp(ctx, undefined, { method: 'POST' })
  assert.equal(post.response.status, 405)
  assert.equal(post.response.headers.get('allow'), 'GET')
  check('inspect-http-401-400-404-405-no-store')

  // ── Settings save is volatile; the engine snapshot requires a reload ─────
  const row = (await ctx.settings.describe()).find((entry) => entry.ns === 'dsh-better-compact')
  assert.ok(row, 'the plugin row must expose its volatile config')
  await ctx.settings.update(
    'dsh-better-compact',
    {
      mode: 'handoff',
      auto: false,
      thresholdRatio: 0.5,
      reasoningEffort: 'high',
      cachePriority: false,
    },
    row.revision,
  )
  const saved = (await ctx.settings.describe()).find((entry) => entry.ns === 'dsh-better-compact')
  assert.equal(saved.value.mode, 'handoff')
  assert.equal(saved.value.auto, false)
  assert.equal(saved.value.thresholdRatio, 0.5)
  let afterSave
  for (let attempt = 0; attempt < 50; attempt += 1) {
    afterSave = (await inspectHttp(ctx)).json
    if (afterSave.requiresReload) break
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
  assert.equal(afterSave.requiresReload, true, 'a saved value must be reported as pending reload')
  assert.equal(afterSave.activeConfig.mode, 'goal', 'the running engine keeps its frozen snapshot')
  assert.equal(afterSave.activeConfig.auto, true)
  assert.equal(afterSave.activeConfig.thresholdRatio, 0.25)
  assert.equal(ctx.compaction.activeMode, 'goal')
  assert.equal(companion.current().mode, 'handoff', 'current() reads the live saved value')
  check('save-requires-reload-active-config')

  for (const recorder of [recA, recB, recC, recD]) recorder.dispose()
  await ctx.fiber.dispose()
  ctx = undefined

  // ── Boot 2: handoff mode (auto off) + manual continuation + paused goal ──
  llmState.summaryMode = 'handoff'
  ctx = await boot()
  assert.equal(ctx.get('betterCompactConfig').snapshot().mode, 'handoff')
  assert.equal(ctx.get('betterCompactConfig').snapshot().auto, false)
  assert.equal(ctx.compaction.activeMode, 'handoff')
  assert.equal((await inspectHttp(ctx)).json.requiresReload, false)
  check('reload-applies-snapshot')

  const handoffAgent = await createHostAgent(ctx)
  const recH = record(ctx, handoffAgent)
  llmState.scripted = [() => 'h'.repeat(900), () => 'h'.repeat(900), () => 'h'.repeat(900)]
  await runTurn(handoffAgent, recH, 'seed the handoff session')
  await runTurn(handoffAgent, recH, 'add handoff history one')
  await runTurn(handoffAgent, recH, 'add handoff history two')
  ctx.goals.create(handoffAgent, { objective: 'Continue the file handoff', maxGoalRounds: 8 })
  ctx.goals.disarm(handoffAgent)
  handoffAgent.session.append('todo/write', {
    todos: [
      { content: 'Capture the authoritative state', status: 'completed' },
      { content: 'Prove the checkpoint transaction', status: 'in_progress' },
    ],
  })
  const turnsBefore = recH.count('turn/start')
  const manual = await ctx.commands.execute(handoffAgent, '/compact', [], new AbortController().signal)
  assert.equal(manual.result.kind, 'success', JSON.stringify(manual))
  await handoffAgent.whenIdle()
  const handoffStart = lastCompactionStart(recH)
  const handoffId = handoffStart.data.compactionId
  const handoffSummary = summaryFor(recH, handoffId)
  assert.ok(handoffSummary)
  const handoffDocument = handoffSummary.data.summary
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
  assert.match(handoffDocument, /# Session Handoff/)
  const path = /Handoff file: (.+)/.exec(handoffDocument)?.[1]?.trim()
  assert.ok(path, 'the document must carry the actual file path')
  const info = await stat(path)
  assert.equal(info.mode & 0o777, 0o600, 'the handoff file must be owner-only')
  assert.equal(await readFile(path, 'utf8'), handoffDocument, 'file and checkpoint body must match')
  const replacement = replacementFor(recH, handoffId)
  assert.ok(replacement, 'the checkpoint replacement must contain the document')
  const replacementText = replacement.data.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
  assert.ok(replacementText.includes('# Session Handoff'), 'replacement must embed the handoff body')
  assert.equal(recH.count('turn/start'), turnsBefore + 1, 'exactly one continuation turn')
  const continuationMessages = recH.events.filter(
    (event) =>
      event.type === 'user/message' &&
      event.data.source?.kind === 'user' &&
      event.data.content.some(
        (block) => block.type === 'text' && block.text.includes('Continue the same task in this session'),
      ),
  )
  assert.equal(continuationMessages.length, 1, 'exactly one ordinary continuation message')
  assert.equal(handoffAgent.inbox.nextTurn.length, 0)
  assert.equal(handoffAgent.inbox.nextStep.length, 0)
  check('handoff-file-permissions-readback')
  check('handoff-self-contained-checkpoint')
  check('handoff-single-same-session-continuation')

  // Redaction must cover the visible summary, the persisted raw provider
  // output, the replacement checkpoint and the file itself.
  assert.equal(handoffDocument.includes(HANDOFF_SECRET), false, 'summary leaked the secret')
  assert.equal(JSON.stringify(handoffSummary.data).includes(HANDOFF_SECRET), false, 'compaction/summary leaked the secret')
  assert.equal(replacementText.includes(HANDOFF_SECRET), false, 'replacement checkpoint leaked the secret')
  assert.equal((await readFile(path, 'utf8')).includes(HANDOFF_SECRET), false, 'handoff file leaked the secret')
  const handoffInspect = (await inspectHttp(ctx, handoffAgent.id)).json
  assert.equal(handoffInspect.engine.owner, 'host')
  assert.equal(handoffInspect.handoffContinuation.status, 'scheduled')
  assert.equal(handoffInspect.handoffContinuation.compactionId, handoffId)
  assert.deepEqual(handoffInspect.handoffContinuation.blockers, [])
  check('handoff-redaction-all-surfaces')
  check('handoff-continuation-scheduled-visible')

  const handoffCall = llmState.compactionCalls.at(-1)
  const handoffInstruction = handoffCall.messages.at(-1).content[0].text
  assert.match(handoffInstruction, /Continue the file handoff/)
  assert.match(handoffInstruction, /\[in_progress\] Prove the checkpoint transaction/)
  check('goal-and-todo-state-in-handoff-instruction')
  assert.equal(handoffCall.reasoningEffort, 'high')
  assert.equal(handoffCall.tools, undefined)
  assert.equal(handoffCall.toolHistory, undefined)
  check('handoff-effort-applied')
  check('cache-priority-false-lean-request')

  await rm(path, { force: true })
  await access(path).then(
    () => assert.fail('handoff file should be deleted'),
    () => undefined,
  )
  await ctx.sessions.flush(handoffAgent.session)
  const handoffSessionId = handoffAgent.id
  recH.dispose()

  // Paused goal: manual handoff commits, but no continuation is scheduled.
  const pausedAgent = await createHostAgent(ctx)
  const recP = record(ctx, pausedAgent)
  llmState.scripted = [() => 'p'.repeat(900), () => 'p'.repeat(900), () => 'p'.repeat(900)]
  await runTurn(pausedAgent, recP, 'seed paused goal')
  await runTurn(pausedAgent, recP, 'paused history one')
  await runTurn(pausedAgent, recP, 'paused history two')
  const pausedGoal = ctx.goals.create(pausedAgent, { objective: 'A goal the user paused', maxGoalRounds: 4 })
  ctx.goals.pause(pausedAgent, { id: pausedGoal.id, revision: pausedGoal.revision })
  const pausedTurnsBefore = recP.count('turn/start')
  const pausedCompact = await ctx.commands.execute(pausedAgent, '/compact', [], new AbortController().signal)
  assert.equal(pausedCompact.result.kind, 'success', JSON.stringify(pausedCompact))
  await pausedAgent.whenIdle()
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
  assert.equal(recP.count('turn/start'), pausedTurnsBefore, 'a paused goal must not be continued')
  assert.equal(ctx.goals.get(pausedAgent).phase, 'paused', 'the goal stays paused')
  assert.ok(summaryFor(recP, lastCompactionStart(recP).data.compactionId), 'the checkpoint is still committed')
  const pausedInspect = (await inspectHttp(ctx, pausedAgent.id)).json
  assert.equal(pausedInspect.handoffContinuation.status, 'skipped')
  assert.match(pausedInspect.handoffContinuation.blockers.join('; '), /goal is paused/)
  check('paused-goal-blocks-continuation')
  check('handoff-continuation-skipped-visible')
  recP.dispose()

  // ── Real standard-preset session: a foreign native compaction engine ─────
  const standardPresets = await ctx.agentPresets.list()
  assert.ok(standardPresets.some((entry) => entry.id === 'standard'), JSON.stringify(standardPresets))
  llmState.summaryMode = 'native'
  const standardAgent = await createPresetAgent(ctx, 'standard')
  const recStd = record(ctx, standardAgent)
  llmState.scripted = [() => 's'.repeat(900), () => 's'.repeat(900), () => 's'.repeat(900)]
  await runTurn(standardAgent, recStd, 'seed standard session')
  await runTurn(standardAgent, recStd, 'standard history one')
  await runTurn(standardAgent, recStd, 'standard history two')
  const standardEngine = ctx.agentPresets.serviceFor(standardAgent, 'compaction')
  assert.ok(standardEngine, 'the standard preset provides its own native engine')
  assert.notEqual(standardEngine, ctx.compaction)
  const standardCompact = await ctx.commands.execute(
    standardAgent,
    '/compact',
    [],
    new AbortController().signal,
  )
  assert.equal(standardCompact.result.kind, 'success', JSON.stringify(standardCompact))
  const standardStart = lastCompactionStart(recStd)
  assert.ok(summaryFor(recStd, standardStart.data.compactionId))
  const standardInspect = (await inspectHttp(ctx, standardAgent.id)).json
  assert.equal(standardInspect.engine.owner, 'foreign-preset')
  assert.equal(standardInspect.engine.inspectApplies, false)
  assert.match(standardInspect.engine.reason, /different compaction engine/)
  assert.equal(standardInspect.budget, null)
  assert.equal(standardInspect.preview, null)
  assert.equal(standardInspect.lastCompaction.status, 'completed')
  assert.equal(standardInspect.lastCompaction.mode, 'native')
  assert.equal(standardInspect.handoffContinuation, null)
  check('standard-preset-inspect-foreign-engine')
  recStd.dispose()
  llmState.summaryMode = 'handoff'

  // ── Persistence (flush) failure surfaces as persistence-error ────────────
  let failFlushFor = null
  const offFlush = ctx.on('session/flush', (session) => {
    if (session.id !== failFlushFor) return
    // The checkpoint policy flushes before model calls too. The compaction's
    // durability checkpoint is the flush whose newest event is compaction/end.
    const latest = session.eventAt(session.seq - 1)
    if (latest?.type !== 'compaction/end') return
    throw new Error('simulated durability flush failure')
  })
  const flushAgent = await createHostAgent(ctx)
  const recFlush = record(ctx, flushAgent)
  llmState.scripted = [() => 'f'.repeat(900), () => 'f'.repeat(900), () => 'f'.repeat(900)]
  await runTurn(flushAgent, recFlush, 'seed flush session')
  await runTurn(flushAgent, recFlush, 'flush history one')
  await runTurn(flushAgent, recFlush, 'flush history two')
  failFlushFor = flushAgent.id
  const flushCompact = await ctx.commands.execute(flushAgent, '/compact', [], new AbortController().signal)
  failFlushFor = null
  assert.equal(flushCompact.result.kind, 'error', JSON.stringify(flushCompact))
  assert.match(flushCompact.result.text, /could not be saved/)
  const flushInspect = (await inspectHttp(ctx, flushAgent.id)).json
  assert.equal(flushInspect.lastCompaction.status, 'persistence-error')
  assert.match(flushInspect.lastCompaction.error, /simulated durability flush failure/)
  check('manual-persistence-error')
  offFlush()
  recFlush.dispose()

  // ── In-flight cancellation ────────────────────────────────────────────────
  const cancelAgent = await createHostAgent(ctx)
  const recCancel = record(ctx, cancelAgent)
  llmState.scripted = ['cancel seed']
  await runTurn(cancelAgent, recCancel, 'seed cancellation session')
  llmState.compactionBehavior = 'hang'
  const cancelController = new AbortController()
  const startSeen = recCancel.waitFor((event) => event.type === 'compaction/start', 'compaction/start')
  const runningCompaction = ctx.commands.execute(
    cancelAgent,
    '/compact',
    [],
    cancelController.signal,
  )
  await startSeen
  cancelController.abort()
  // The command runtime races the handler against the caller signal, so an
  // in-flight cancellation rejects with the abort reason (the command handler's
  // own cancelled result is intentionally superseded by the host race).
  await assert.rejects(runningCompaction, (error) => error?.name === 'AbortError' || /abort/i.test(error?.message ?? ''))
  llmState.compactionBehavior = 'ok'
  await cancelAgent.whenIdle()
  const cancelInspect = (await inspectHttp(ctx, cancelAgent.id)).json
  assert.equal(cancelInspect.lastCompaction.status, 'cancelled')
  assert.match(cancelInspect.lastCompaction.error, /abort|cancel/i)
  check('manual-in-flight-cancellation')
  recCancel.dispose()

  // ── Commit-stage failure that cannot append compaction/end ────────────────
  const commitAgent = await createHostAgent(ctx)
  const recCommit = record(ctx, commitAgent)
  llmState.scripted = [() => 'c'.repeat(900), () => 'c'.repeat(900), () => 'c'.repeat(900)]
  await runTurn(commitAgent, recCommit, 'seed commit session')
  await runTurn(commitAgent, recCommit, 'commit history one')
  await runTurn(commitAgent, recCommit, 'commit history two')
  const realAppend = commitAgent.session.append.bind(commitAgent.session)
  commitAgent.session.append = (type, data, options) => {
    if (type === 'compaction/end') throw new Error('simulated end append failure')
    return realAppend(type, data, options)
  }
  const commitResult = await ctx.commands.execute(commitAgent, '/compact', [], new AbortController().signal)
  assert.equal(commitResult.result.kind, 'error', JSON.stringify(commitResult))
  assert.match(commitResult.result.text, /did not finish cleanly/)
  const commitInspect = (await inspectHttp(ctx, commitAgent.id)).json
  assert.equal(commitInspect.lastCompaction.status, 'failed')
  assert.match(commitInspect.lastCompaction.error, /simulated end append failure/)
  check('manual-commit-append-failure')
  commitAgent.session.append = realAppend
  recCommit.dispose()

  // ── Pending user question blocks continuation (real ask tool) ─────────────
  const questionAgent = await createHostAgent(ctx)
  assert.ok(ctx.tools.get('ask_user_question', questionAgent), 'host composition must expose the ask tool')
  const recQuestion = record(ctx, questionAgent)
  llmState.scripted = [
    () => 'q'.repeat(900),
    () => 'q'.repeat(900),
    () => 'q'.repeat(900),
    {
      tool: 'ask_user_question',
      arguments: {
        questions: [{ id: 'smoke-question', question: 'Which provider should be used?' }],
        timeout: 1,
      },
    },
    { text: 'Waiting for the user.' },
  ]
  await runTurn(questionAgent, recQuestion, 'seed question session')
  await runTurn(questionAgent, recQuestion, 'question history one')
  await runTurn(questionAgent, recQuestion, 'question history two')
  await runTurn(questionAgent, recQuestion, 'ask the pending question')
  const pendingQuestions = ctx.sessionProjections.stateOf(questionAgent.session, 'userQuestions')
  assert.ok(pendingQuestions.questions.active.length > 0, 'the timed ask must leave a pending question')
  const questionTurnsBefore = recQuestion.count('turn/start')
  const questionCompact = await ctx.commands.execute(questionAgent, '/compact', [], new AbortController().signal)
  assert.equal(questionCompact.result.kind, 'success', JSON.stringify(questionCompact))
  await questionAgent.whenIdle()
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
  assert.equal(recQuestion.count('turn/start'), questionTurnsBefore, 'a pending question must not be continued')
  const questionInspect = (await inspectHttp(ctx, questionAgent.id)).json
  assert.equal(questionInspect.handoffContinuation.status, 'skipped')
  assert.match(questionInspect.handoffContinuation.blockers.join('; '), /user question is still pending/)
  check('pending-question-blocks-continuation')
  recQuestion.dispose()

  // ── Running job blocks continuation (real job registry) ──────────────────
  const jobAgent = await createHostAgent(ctx)
  const recJob = record(ctx, jobAgent)
  llmState.scripted = [() => 'j'.repeat(900), () => 'j'.repeat(900), () => 'j'.repeat(900)]
  await runTurn(jobAgent, recJob, 'seed job session')
  await runTurn(jobAgent, recJob, 'job history one')
  await runTurn(jobAgent, recJob, 'job history two')
  let settleJob
  const jobDone = new Promise((resolvePromise) => {
    settleJob = resolvePromise
  })
  const jobId = ctx.jobs.start({
    kind: 'smoke',
    label: 'smoke background job',
    owner: jobAgent.id,
    run: () => ({
      cancel: () => settleJob({ status: 'killed', detail: 'smoke cleanup' }),
      done: jobDone,
    }),
  })
  assert.ok(
    ctx.jobs.list(jobAgent.id).some((job) => job.id === jobId && job.status === 'running'),
  )
  const jobCompact = await ctx.commands.execute(jobAgent, '/compact', [], new AbortController().signal)
  assert.equal(jobCompact.result.kind, 'success', JSON.stringify(jobCompact))
  await jobAgent.whenIdle()
  const jobInspect = (await inspectHttp(ctx, jobAgent.id)).json
  assert.equal(jobInspect.handoffContinuation.status, 'skipped')
  assert.match(jobInspect.handoffContinuation.blockers.join('; '), /background job/)
  check('running-job-blocks-continuation')
  ctx.jobs.kill(jobId, jobAgent.id, 'smoke cleanup')
  await jobDone
  recJob.dispose()

  // ── Running child agent blocks continuation (real AgentLoop) ─────────────
  const parentAgent = await createHostAgent(ctx)
  const recParent = record(ctx, parentAgent)
  llmState.scripted = [() => 'r'.repeat(900), () => 'r'.repeat(900), () => 'r'.repeat(900)]
  await runTurn(parentAgent, recParent, 'seed child-parent session')
  await runTurn(parentAgent, recParent, 'child-parent history one')
  await runTurn(parentAgent, recParent, 'child-parent history two')
  const childCreated = await ctx.agents.create({
    sessionId: randomUUID(),
    parentAgent,
    meta: { cwd: home, parentSession: parentAgent.id, origin: 'subagent', delegationDepth: 1 },
    agentOptions: { provider: 'it-noop', model: 'noop' },
    setup: async () => {},
  })
  const child = childCreated.agent
  const recChild = record(ctx, child)
  llmState.scripted = [{ hang: true }]
  child.followup(createUserMessage({ content: textBlock('hold the child turn'), source: { kind: 'user' } }))
  await waitUntil(
    () => recChild.events.some((event) => event.type === 'turn/start'),
    'child turn/start',
  )
  assert.equal(child.status, 'running')
  const childCompact = await ctx.commands.execute(parentAgent, '/compact', [], new AbortController().signal)
  assert.equal(childCompact.result.kind, 'success', JSON.stringify(childCompact))
  await parentAgent.whenIdle()
  const childInspect = (await inspectHttp(ctx, parentAgent.id)).json
  assert.equal(childInspect.handoffContinuation.status, 'skipped')
  assert.match(childInspect.handoffContinuation.blockers.join('; '), /child agent is still running/)
  check('running-child-blocks-continuation')
  child.cancel({ kind: 'user' })
  await child.whenIdle()
  recChild.dispose()
  await childCreated.dispose()

  // Re-enable auto for the next boot; saving is still reload-gated.
  const autoRow = (await ctx.settings.describe()).find((entry) => entry.ns === 'dsh-better-compact')
  await ctx.settings.update('dsh-better-compact', { auto: true }, autoRow.revision)
  check('save-auto-toggle')
  await ctx.sessions.flush(handoffAgent.session)
  await ctx.sessions.flush(pausedAgent.session)
  await ctx.fiber.dispose()
  ctx = undefined

  // ── Boot 3: handoff auto mode + preset isolated engine ────────────────────
  llmState.summaryMode = 'handoff'
  ctx = await boot()
  assert.equal(ctx.compaction.activeMode, 'handoff')
  assert.equal(ctx.get('betterCompactConfig').snapshot().auto, true)
  assert.equal(ctx.get('betterCompactConfig').snapshot().thresholdRatio, 0.5)

  // Automatic handoff compaction finishes in the original turn and schedules
  // no extra continuation (continuation is manual-only by contract).
  const autoHandoff = await createHostAgent(ctx)
  const recAH = record(ctx, autoHandoff)
  llmState.scripted = [
    () => 'a'.repeat(30000),
    () => 'a'.repeat(30000),
    'auto handoff trigger turn',
  ]
  await runTurn(autoHandoff, recAH, 'seed auto handoff')
  await runTurn(autoHandoff, recAH, 'auto handoff history one')
  const autoTurnsBefore = recAH.count('turn/start')
  await runTurn(autoHandoff, recAH, 'auto handoff trigger')
  assert.equal(recAH.count('compaction/start'), 1)
  assert.ok(replacementFor(recAH, lastCompactionStart(recAH).data.compactionId))
  assert.equal(recAH.count('turn/start'), autoTurnsBefore + 1, 'automatic compaction must not add a turn')
  assert.equal(autoHandoff.inbox.nextTurn.length, 0)
  const autoHandoffSummary = summaryFor(recAH, lastCompactionStart(recAH).data.compactionId)
  const autoHandoffPath = /Handoff file: (.+)/.exec(
    autoHandoffSummary.data.summary.filter((block) => block.type === 'text').map((block) => block.text).join('\n'),
  )?.[1]?.trim()
  assert.ok(autoHandoffPath)
  await rm(autoHandoffPath, { force: true })
  check('automatic-handoff-no-extra-turn')
  recAH.dispose()

  // Preset engine: isolated compaction service, no host double-compaction.
  const presetAgent = await createPresetAgent(ctx, 'better-compact')
  const recPreset = record(ctx, presetAgent)
  const presetEngine = ctx.agentPresets.serviceFor(presetAgent, 'compaction')
  assert.ok(presetEngine, 'the preset must provide an isolated compaction service')
  assert.notEqual(presetEngine, ctx.compaction, 'the preset engine must not be the host-plane engine')
  assert.equal(presetEngine.activeMode, 'handoff')
  llmState.scripted = [
    () => 'z'.repeat(30000),
    () => 'z'.repeat(30000),
    'preset trigger turn',
  ]
  await runTurn(presetAgent, recPreset, 'seed preset session')
  await runTurn(presetAgent, recPreset, 'build preset history one')
  await runTurn(presetAgent, recPreset, 'trigger preset pressure')
  assert.equal(recPreset.count('compaction/start'), 1, 'host engine must not double-compact a preset agent')
  assert.ok(replacementFor(recPreset, lastCompactionStart(recPreset).data.compactionId))
  check('preset-engine-isolated')
  check('no-host-double-compaction')
  recPreset.dispose()

  const nativeRow = (await ctx.settings.describe()).find((entry) => entry.ns === 'dsh-better-compact')
  await ctx.settings.update('dsh-better-compact', { mode: 'native' }, nativeRow.revision)
  check('save-native-mode')
  await ctx.fiber.dispose()
  ctx = undefined

  // ── Boot 4: native mode, cold inspect, replay after file deletion ─────────
  llmState.summaryMode = 'native'
  ctx = await boot()
  assert.equal(ctx.compaction.activeMode, 'native')
  const cold = (await inspectHttp(ctx, handoffSessionId)).json
  assert.equal(cold.sessionId, handoffSessionId)
  assert.equal(cold.lastCompaction.status, 'completed')
  assert.equal(cold.lastCompaction.mode, 'handoff')
  assert.ok(['measured', 'estimated'].includes(cold.budget.measurement))
  check('cold-inspect-handoff-mode')

  const resumed = (
    await ctx.agents.resume({
      resumeSessionId: handoffSessionId,
      agentOptions: { provider: 'it-noop', model: 'noop' },
      setup: async () => {},
    })
  ).agent
  assert.equal(resumed.status, 'idle')
  assert.equal(resumed.inbox.nextTurn.length, 0, 'replay must not re-trigger a continuation')
  const resumedMessages = resumed.session.deriveMessages()
  const replayedCheckpoint = resumedMessages.find(
    (message) => message.source?.kind === 'compact-checkpoint' && message.source.compactionId === handoffId,
  )
  assert.ok(replayedCheckpoint, 'the persisted checkpoint must replay')
  const replayedText = replayedCheckpoint.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
  assert.ok(replayedText.includes('# Session Handoff'), 'the embedded handoff survives file deletion')
  assert.ok(replayedText.includes('## Suggested Skills'))
  check('replay-after-handoff-file-deleted')

  // Native mode: inherited summarizer, no enhanced request overrides.
  const nativeAgent = await createHostAgent(ctx)
  const recN = record(ctx, nativeAgent)
  llmState.scripted = [
    () => 'n'.repeat(30000),
    () => 'n'.repeat(30000),
    'native trigger turn',
  ]
  await runTurn(nativeAgent, recN, 'seed native session')
  await runTurn(nativeAgent, recN, 'build native history one')
  await runTurn(nativeAgent, recN, 'trigger native pressure')
  assert.equal(recN.count('compaction/start'), 1)
  const nativeId = lastCompactionStart(recN).data.compactionId
  const nativeSummary = summaryFor(recN, nativeId)
  const nativeText = nativeSummary.data.summary
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
  assert.match(nativeText, /## Primary Request and Intent/)
  const nativeCall = llmState.compactionCalls.at(-1)
  assert.equal(nativeCall.reasoningEffort, undefined, 'native mode must not apply the saved effort')
  assert.equal('tools' in nativeCall, true, 'native mode keeps its own request shape')
  check('native-mode-inherited-summarizer')
  check('native-mode-no-enhanced-overrides')

  const nativeInspect = (await inspectHttp(ctx, nativeAgent.id)).json
  assert.equal(nativeInspect.lastCompaction.mode, 'native')
  check('inspect-native-mode-projection')
  recN.dispose()

  await ctx.fiber.dispose()
  ctx = undefined
  results.passed = true
  results.checks = [...new Set(results.checks)]
  console.log('BETTER_COMPACT_RUNTIME_SMOKE_PASSED', JSON.stringify(results))
} catch (error) {
  console.error('BETTER_COMPACT_RUNTIME_SMOKE_FAILED', error)
  console.error('checks so far:', JSON.stringify(results.checks))
  process.exitCode = 1
} finally {
  if (ctx !== undefined) await ctx.fiber.dispose().catch(() => undefined)
  if (process.env.BETTER_COMPACT_KEEP_SMOKE_HOME !== '1') {
    await rm(home, { recursive: true, force: true })
  } else {
    console.error('kept smoke home:', home)
  }
}
