import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  Config,
  DEFAULTS,
  ENGINE_ENTRY_ID,
  MODES,
  ROW_CONFIG_KEYS,
  ROW_CONFIG_KEY,
  deepFreeze,
  readConfig,
  toNativeConfig,
} from '../src/config.js'

const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/** A mutable fake volatile reference with the real cosmokit shape. */
function fakeRef(initial) {
  let value = initial
  return {
    get: () => value,
    [VOLATILE_WRITE]: () => undefined,
    set: (next) => {
      value = next
    },
  }
}

/** Build a normalized config from a partial raw config object. */
function normalize(partial = {}) {
  return readConfig({ ...rawDefaults(), ...partial })
}

/** Default raw values in plain (non-volatile) form. */
function rawDefaults() {
  return {
    mode: DEFAULTS.mode,
    auto: DEFAULTS.auto,
    thresholdRatio: DEFAULTS.thresholdRatio,
    headroomTokens: DEFAULTS.headroomTokens,
    summarizationProvider: DEFAULTS.summarizationProvider,
    summarizationModel: DEFAULTS.summarizationModel,
    reasoningEffort: DEFAULTS.reasoningEffort,
    cachePriority: DEFAULTS.cachePriority,
    compactionRetries: DEFAULTS.compactionRetries,
    maxOverflowRetries: DEFAULTS.maxOverflowRetries,
    modelPolicies: [],
  }
}

test('Config schema exposes every documented volatile field with native defaults', () => {
  const parsed = Config({})
  assert.equal(parsed.mode.get(), 'goal')
  assert.equal(parsed.auto.get(), true)
  assert.equal(parsed.thresholdRatio.get(), 0.8)
  assert.equal(parsed.headroomTokens.get(), 65536)
  assert.equal(parsed.retainRatio.get(), undefined)
  assert.equal(parsed.retainTokens.get(), undefined)
  assert.equal(parsed.summarizationProvider.get(), '')
  assert.equal(parsed.summarizationModel.get(), '')
  assert.equal(parsed.reasoningEffort.get(), '')
  assert.equal(parsed.cachePriority.get(), true)
  assert.equal(parsed.maxTokens.get(), undefined)
  assert.equal(parsed.compactionRetries.get(), 1)
  assert.equal(parsed.maxOverflowRetries.get(), 1)
  assert.deepEqual(parsed.modelPolicies.get(), [])
  for (const [key, field] of Object.entries(Config.dict)) {
    assert.equal(field.meta.volatile === true, true, `${key} must be volatile`)
  }
})

test('readConfig normalizes defaults exactly per the S2 table', () => {
  assert.deepEqual(normalize(), {
    mode: 'goal',
    auto: true,
    thresholdRatio: 0.8,
    headroomTokens: 65536,
    retainRatio: 0.16,
    retainTokens: null,
    summarizationProvider: '',
    summarizationModel: '',
    reasoningEffort: '',
    cachePriority: true,
    maxTokens: 65536,
    compactionRetries: 1,
    maxOverflowRetries: 1,
    modelPolicies: [],
  })
})

test('readConfig resolves maxTokens from headroom when omitted and keeps explicit values', () => {
  assert.equal(normalize({ headroomTokens: 1234 }).maxTokens, 1234)
  assert.equal(normalize({ headroomTokens: 1234, maxTokens: 999 }).maxTokens, 999)
})

test('retention is one of ratio/tokens and supports the absolute form', () => {
  const ratio = normalize({ retainRatio: 0.1 })
  assert.equal(ratio.retainRatio, 0.1)
  assert.equal(ratio.retainTokens, null)
  const absolute = normalize({ retainTokens: 2048 })
  assert.equal(absolute.retainRatio, null)
  assert.equal(absolute.retainTokens, 2048)
  assert.equal(toNativeConfig(absolute).retainTokens, 2048)
  assert.equal(toNativeConfig(absolute).retainRatio, undefined)
})

test('toNativeConfig strips enhanced-only keys and keeps native meanings', () => {
  const native = toNativeConfig(normalize({ mode: 'handoff', reasoningEffort: 'high', cachePriority: false }))
  assert.equal('mode' in native, false)
  assert.equal('reasoningEffort' in native, false)
  assert.equal('cachePriority' in native, false)
  for (const key of ['thresholdRatio', 'headroomTokens', 'retainRatio', 'summarizationProvider', 'maxTokens', 'auto']) {
    assert.ok(key in native, key)
  }
})

test('the Config schema rejects exclusive ratio boundaries before readConfig runs', () => {
  assert.throws(() => Config({ thresholdRatio: 0 }))
  assert.throws(() => Config({ thresholdRatio: 1 }))
  assert.throws(() => Config({ retainRatio: 0 }))
  assert.throws(() => Config({ retainRatio: 1 }))
  assert.throws(() => Config({ modelPolicies: [{ provider: 'p', model: 'm', retainRatio: 0 }] }))
  assert.throws(() => Config({ modelPolicies: [{ provider: 'p', model: 'm', thresholdRatio: 1 }] }))
  const parsed = Config({})
  assert.equal(parsed.thresholdRatio.get(), 0.8)
})

test('the Config schema is Web-client rehydratable and contains no transform node', () => {
  // The Web settings client rehydrates the wire schema without transform
  // callbacks; a transform node leaves the row form stuck on "Reading
  // configuration…". Keep every node a plain schemastery type.
  const json = Config.toJSON()
  const visit = (node) => {
    if (node === null || typeof node !== 'object') return false
    if (node.type === 'transform') return true
    if (Array.isArray(node.list) && node.list.some(visit)) return true
    if (node.dict && Object.values(node.dict).some(visit)) return true
    return false
  }
  const roots = [json, ...Object.values(json.refs ?? {})]
  assert.equal(roots.some(visit), false, 'Config schema must not contain transform nodes')
})

test('unknown top-level and policy keys are rejected with actionable messages', () => {
  assert.throws(
    () => readConfig({ ...rawDefaults(), bogus: true }),
    /unknown configuration key "bogus"; supported keys:/,
  )
  // The Loader's schema output preserves unknown keys; load-time validation
  // must reject them instead of silently dropping a manual-patch typo.
  const parsed = Config({ mode: 'goal', bogus: true })
  assert.throws(() => readConfig(parsed), /unknown configuration key "bogus"/)
  assert.throws(
    () => readConfig({ ...rawDefaults(), modelPolicies: [{ provider: 'p', model: 'm', bogus: true }] }),
    /modelPolicies\[0\]: unknown key "bogus"/,
  )
  const parsedPolicy = Config({ modelPolicies: [{ provider: 'p', model: 'm', bogus: true }] })
  assert.throws(() => readConfig(parsedPolicy), /modelPolicies\[0\]: unknown key "bogus"/)
})

test('readConfig rejects conflicting or invalid settings', () => {
  const cases = [
    () => readConfig({ ...rawDefaults(), retainRatio: 0.2, retainTokens: 100 }),
    () => readConfig({ ...rawDefaults(), summarizationProvider: 'p' }),
    () => readConfig({ ...rawDefaults(), summarizationModel: 'm' }),
    () => readConfig({ ...rawDefaults(), retainRatio: 0.8 }),
    () => readConfig({ ...rawDefaults(), retainRatio: 0 }),
    () => readConfig({ ...rawDefaults(), retainRatio: 1 }),
    () => readConfig({ ...rawDefaults(), thresholdRatio: 0 }),
    () => readConfig({ ...rawDefaults(), thresholdRatio: 1 }),
    () => readConfig({ ...rawDefaults(), mode: 'off' }),
    () => readConfig({ ...rawDefaults(), headroomTokens: -1 }),
    () => readConfig({ ...rawDefaults(), headroomTokens: 1.5 }),
    () => readConfig({ ...rawDefaults(), maxTokens: 0 }),
    () => readConfig({ ...rawDefaults(), headroomTokens: 0 }),
    () => readConfig({ ...rawDefaults(), compactionRetries: -1 }),
    () => readConfig({ ...rawDefaults(), maxOverflowRetries: 0.5 }),
    () => readConfig({ ...rawDefaults(), reasoningEffort: '   ' }),
    () => readConfig({ ...rawDefaults(), cachePriority: 'yes' }),
    () => readConfig({ ...rawDefaults(), modelPolicies: {} }),
  ]
  for (const [index, run] of cases.entries()) {
    assert.throws(run, TypeError, `case ${index} must be rejected`)
  }
})

test('modelPolicies preserve native exact-target semantics and validation', () => {
  const config = normalize({
    modelPolicies: [
      {
        provider: 'it-noop',
        model: 'noop',
        thresholdRatio: 0.5,
        retainRatio: 0.1,
        summarizationProvider: 'sum',
        summarizationModel: 'sum-model',
      },
    ],
  })
  assert.equal(config.modelPolicies.length, 1)
  assert.deepEqual(config.modelPolicies[0], {
    provider: 'it-noop',
    model: 'noop',
    thresholdRatio: 0.5,
    retainRatio: 0.1,
    summarizationProvider: 'sum',
    summarizationModel: 'sum-model',
  })

  assert.throws(
    () => normalize({ modelPolicies: [{ provider: 'a', model: 'b', extra: 1 }] }),
    /unknown key "extra"/,
  )
  assert.throws(
    () => normalize({ modelPolicies: [{ provider: 'a', model: 'b' }, { provider: 'a', model: 'b' }] }),
    /duplicate model policy/,
  )
  assert.throws(
    () => normalize({ modelPolicies: [{ provider: 'a', model: 'b', retainRatio: 0.9, thresholdRatio: 0.5 }] }),
    /must be less than/,
  )
  assert.throws(
    () => normalize({ modelPolicies: [{ provider: 'a', model: 'b', retainRatio: 0.1, retainTokens: 5 }] }),
    /mutually exclusive/,
  )
  assert.throws(
    () => normalize({ modelPolicies: [{ provider: 'a', model: 'b', summarizationProvider: 'p' }] }),
    /must be set together/,
  )
  const emptyPair = normalize({
    modelPolicies: [{ provider: 'a', model: 'b', summarizationProvider: '', summarizationModel: '' }],
  })
  assert.equal(emptyPair.modelPolicies[0].summarizationProvider, '')
  assert.equal(emptyPair.modelPolicies[0].summarizationModel, '')
})

test('a policy threshold cannot fall below an inherited global ratio retention', () => {
  assert.throws(
    () =>
      normalize({
        retainRatio: 0.5,
        modelPolicies: [{ provider: 'p', model: 'm', thresholdRatio: 0.4 }],
      }),
    /inherited retainRatio \(0.5\) must be less than the resolved thresholdRatio \(0.4\)/,
  )
  // Absolute retention has no ratio to conflict with at load time.
  const absolute = normalize({
    retainTokens: 100,
    modelPolicies: [{ provider: 'p', model: 'm', thresholdRatio: 0.4 }],
  })
  assert.equal(absolute.modelPolicies[0].thresholdRatio, 0.4)
  // An explicit policy ratio is checked by normalizePolicy already.
  assert.throws(
    () =>
      normalize({
        retainRatio: 0.1,
        modelPolicies: [{ provider: 'p', model: 'm', thresholdRatio: 0.4, retainRatio: 0.45 }],
      }),
    /must be less than/,
  )
})

test('a policy-level headroom becomes that policy maxTokens only when global maxTokens is absent', () => {
  const implicit = normalize({
    modelPolicies: [{ provider: 'p', model: 'm', headroomTokens: 2048 }],
  })
  assert.equal(implicit.modelPolicies[0].maxTokens, 2048)
  assert.equal(implicit.maxTokens, 65536)

  const explicit = normalize({
    maxTokens: 4096,
    modelPolicies: [{ provider: 'p', model: 'm', headroomTokens: 2048 }],
  })
  assert.equal(explicit.modelPolicies[0].maxTokens, undefined)

  assert.throws(
    () =>
      normalize({
        modelPolicies: [{ provider: 'p', model: 'm', headroomTokens: 0 }],
      }),
    /maxTokens is required/,
  )
})

test('volatile references are read live and snapshots stay frozen', () => {
  const refs = Object.fromEntries(
    Object.entries({
      ...rawDefaults(),
      retainTokens: undefined,
      maxTokens: undefined,
    }).map(([key, value]) => [key, fakeRef(value)]),
  )
  const before = readConfig(refs)
  assert.equal(before.mode, 'goal')
  refs.mode.set('native')
  refs.thresholdRatio.set(0.5)
  const after = readConfig(refs)
  assert.equal(after.mode, 'native')
  assert.equal(before.mode, 'goal')
  assert.notDeepEqual(after, before)
  const frozen = deepFreeze(before)
  assert.equal(Object.isFrozen(frozen), true)
  assert.equal(Object.isFrozen(frozen.modelPolicies), true)
})

test('stable row identities and keys match the published contract', () => {
  assert.equal(ENGINE_ENTRY_ID, 'dsh-better-compact-engine')
  assert.deepEqual(MODES, ['native', 'goal', 'handoff'])
  assert.equal(ROW_CONFIG_KEY, 'dsh-better-compact#dsh-better-compact')
  assert.deepEqual(ROW_CONFIG_KEYS, [
    'dsh-better-compact#dsh-better-compact',
    '@menghuan1918/dsh-apollo#dsh-better-compact',
    'dsh-apollo#dsh-better-compact',
  ])
})
