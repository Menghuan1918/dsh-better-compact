/**
 * Host-side configuration contract for dsh-better-compact.
 *
 * This module is the single source of truth for the plugin row's settings
 * schema and for the normalized configuration the host companion publishes to
 * the engine and to the read-only inspect route. The Loader re-exports
 * `Config` from `src/index.js`; DSH validates and resolves the row config
 * through that schema.
 *
 * Every field is `.volatile()`: the shipped settings service can read and save
 * the values without remounting the row. That is also why the engine takes one
 * frozen load-time snapshot instead of hot-updating: saving a value is not the
 * same as applying it to a running engine. `current()` reads the live volatile
 * value, `snapshot()` is the value the running engine actually holds.
 *
 * Native key names, units, and defaults are preserved from
 * `@deepseek-ai/dsh-compaction-basic` 0.2.1-rc.2. The enhanced-only keys
 * (`mode`, `reasoningEffort`, `cachePriority`) are stripped before the native
 * engine base receives the configuration.
 */

import { isDeepStrictEqual } from 'node:util'
import z from '@deepseek-ai/schemastery'

/** npm package name and bundle row name. */
export const PACKAGE_NAME = 'dsh-better-compact'
/** Host companion row id (also the settings namespace). */
export const ENTRY_ID = 'dsh-better-compact'
/** Host-plane / preset engine row id. */
export const ENGINE_ENTRY_ID = 'dsh-better-compact-engine'
/** Canonical `plugins.row.config` slot key. */
export const ROW_CONFIG_KEY = `${PACKAGE_NAME}#${ENTRY_ID}`
/** Apollo's published scoped package name declares the same stable row. */
export const APOLLO_ROW_CONFIG_KEY = `@menghuan1918/dsh-apollo#${ENTRY_ID}`
/** Historical unscoped Apollo row key. */
export const APOLLO_LEGACY_ROW_CONFIG_KEY = `dsh-apollo#${ENTRY_ID}`
/** Every assembly's `plugins.row.config` key, in dispatch order. */
export const ROW_CONFIG_KEYS = Object.freeze([
  ROW_CONFIG_KEY,
  APOLLO_ROW_CONFIG_KEY,
  APOLLO_LEGACY_ROW_CONFIG_KEY,
])

/** Supported compaction modes. */
export const MODES = Object.freeze(['native', 'goal', 'handoff'])

/** Native keys accepted by `BasicCompactionEngine` (native semantics/units). */
export const NATIVE_CONFIG_KEYS = Object.freeze([
  'thresholdRatio',
  'headroomTokens',
  'retainRatio',
  'retainTokens',
  'summarizationProvider',
  'summarizationModel',
  'maxTokens',
  'compactionRetries',
  'maxOverflowRetries',
  'modelPolicies',
  'auto',
])

/** Exact-target override keys preserved from the native engine. */
export const MODEL_POLICY_KEYS = Object.freeze([
  'provider',
  'model',
  'thresholdRatio',
  'headroomTokens',
  'retainRatio',
  'retainTokens',
  'summarizationProvider',
  'summarizationModel',
  'maxTokens',
  'compactionRetries',
  'maxOverflowRetries',
])

/** Enhanced-only keys stripped before the native engine sees the config. */
export const ENHANCED_CONFIG_KEYS = Object.freeze(['mode', 'reasoningEffort', 'cachePriority'])

/** Plain defaults. `maxTokens: null` means "follow headroomTokens". */
export const DEFAULTS = Object.freeze({
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
  maxTokens: null,
  compactionRetries: 1,
  maxOverflowRetries: 1,
  modelPolicies: Object.freeze([]),
})

/** One optional native policy fragment; omitted keys inherit the target. */
const modelPolicySchema = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  thresholdRatio: z.number().min(0).max(1),
  headroomTokens: z.natural(),
  retainRatio: z.number().min(0).max(1),
  retainTokens: z.natural(),
  summarizationProvider: z.string(),
  summarizationModel: z.string(),
  maxTokens: z.natural().min(1),
  compactionRetries: z.natural(),
  maxOverflowRetries: z.natural(),
})

/**
 * The plugin row's formal configuration schema.
 *
 * Per-field constraints are real: ranges, integer steps, enum membership.
 * Cross-field constraints (mutually exclusive retention, summarization pair,
 * retention below threshold) are enforced by {@link readConfig} because
 * schemastery object schemas have no sibling-field validator, and a transform
 * wrapper cannot carry per-field `.volatile()` references. They therefore fail
 * at plugin load/reload with an actionable message, and the S3 form validates
 * them before a save is attempted.
 */
export const Config = z.object({
  mode: z.union([...MODES]).default(DEFAULTS.mode).volatile(),
  auto: z.boolean().default(DEFAULTS.auto).volatile(),
  thresholdRatio: z.number().min(0).max(1).default(DEFAULTS.thresholdRatio).volatile(),
  headroomTokens: z.natural().default(DEFAULTS.headroomTokens).volatile(),
  retainRatio: z.number().min(0).max(1).volatile(),
  retainTokens: z.natural().volatile(),
  summarizationProvider: z.string().default(DEFAULTS.summarizationProvider).volatile(),
  summarizationModel: z.string().default(DEFAULTS.summarizationModel).volatile(),
  reasoningEffort: z.string().default(DEFAULTS.reasoningEffort).volatile(),
  cachePriority: z.boolean().default(DEFAULTS.cachePriority).volatile(),
  maxTokens: z.natural().min(1).volatile(),
  compactionRetries: z.natural().default(DEFAULTS.compactionRetries).volatile(),
  maxOverflowRetries: z.natural().default(DEFAULTS.maxOverflowRetries).volatile(),
  modelPolicies: z.array(modelPolicySchema).default([]).volatile(),
})

/** Shared cosmokit volatile-reference symbol (identical across package copies). */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/** Whether a value is a cosmokit volatile reference. */
function isVolatileRef(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.get === 'function' &&
    VOLATILE_WRITE in value
  )
}

/** Read one field, unwrapping a volatile reference when present. */
function fieldOf(config, key) {
  const value = config?.[key]
  return isVolatileRef(value) ? value.get() : value
}

/** Reject non-integer or out-of-range numeric values without coercion. */
function requireInteger(value, label, { min = 0, positive = false } = {}) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be a safe integer, got ${String(value)}`)
  }
  if ((positive && value <= 0) || (!positive && value < min)) {
    throw new TypeError(`${label} must be ${positive ? 'a positive integer' : `an integer >= ${min}`}, got ${value}`)
  }
  return value
}

/** Require a finite ratio strictly inside `(0, upper)`. */
function requireRatio(value, label, upper) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value >= upper) {
    throw new TypeError(`${label} must be a number in (0, ${upper}), got ${String(value)}`)
  }
  return value
}

/** Detect an explicitly present value (not `undefined`/`null`). */
function present(value) {
  return value !== undefined && value !== null
}

/**
 * Validate, detach, and normalize one policy fragment shared by the defaults
 * and exact-target overrides.
 *
 * @param source - untrusted policy fields.
 * @param name - diagnostic prefix.
 * @param thresholdRatio - resolved threshold ratio for the retention check.
 * @returns detached policy fields.
 */
function normalizePolicy(source, name, thresholdRatio) {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    throw new TypeError(`${name} must be an object`)
  }
  const policy = {}
  const hasRatio = present(source.retainRatio)
  const hasTokens = present(source.retainTokens)
  if (hasRatio && hasTokens) {
    throw new TypeError(`${name}: retainRatio and retainTokens are mutually exclusive`)
  }
  if (present(source.thresholdRatio)) {
    policy.thresholdRatio = requireRatio(source.thresholdRatio, `${name}.thresholdRatio`, 1)
  }
  if (present(source.headroomTokens)) {
    policy.headroomTokens = requireInteger(source.headroomTokens, `${name}.headroomTokens`)
  }
  if (hasRatio) policy.retainRatio = requireRatio(source.retainRatio, `${name}.retainRatio`, 1)
  if (hasTokens) policy.retainTokens = requireInteger(source.retainTokens, `${name}.retainTokens`)
  const hasProvider = present(source.summarizationProvider)
  const hasModel = present(source.summarizationModel)
  if (hasProvider !== hasModel) {
    throw new TypeError(`${name}: summarizationProvider and summarizationModel must be set together as an empty or non-empty pair`)
  }
  if (hasProvider) {
    if (typeof source.summarizationProvider !== 'string' || typeof source.summarizationModel !== 'string') {
      throw new TypeError(`${name}: summarizationProvider and summarizationModel must be strings`)
    }
    if ((source.summarizationProvider.length === 0) !== (source.summarizationModel.length === 0)) {
      throw new TypeError(`${name}: summarizationProvider and summarizationModel must be set together as an empty or non-empty pair`)
    }
    policy.summarizationProvider = source.summarizationProvider
    policy.summarizationModel = source.summarizationModel
  }
  if (present(source.maxTokens)) {
    policy.maxTokens = requireInteger(source.maxTokens, `${name}.maxTokens`, { positive: true })
  }
  if (present(source.compactionRetries)) {
    policy.compactionRetries = requireInteger(source.compactionRetries, `${name}.compactionRetries`)
  }
  if (present(source.maxOverflowRetries)) {
    policy.maxOverflowRetries = requireInteger(source.maxOverflowRetries, `${name}.maxOverflowRetries`)
  }
  const ratio = policy.retainRatio
  if (ratio !== undefined && ratio >= thresholdRatio) {
    throw new TypeError(`${name}: retainRatio (${ratio}) must be less than the resolved thresholdRatio (${thresholdRatio})`)
  }
  return policy
}

/** Validate, detach, and reject duplicate exact-target overrides. */
function normalizeModelPolicies(source, thresholdRatio, globalMaxTokensExplicit) {
  if (source === undefined) return []
  if (!Array.isArray(source)) throw new TypeError('modelPolicies must be an array')
  const seen = new Set()
  const policies = source.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new TypeError(`modelPolicies[${index}] must be an object`)
    }
    for (const key of Object.keys(entry)) {
      if (!MODEL_POLICY_KEYS.includes(key)) {
        throw new TypeError(`modelPolicies[${index}]: unknown key "${key}"`)
      }
    }
    if (typeof entry.provider !== 'string' || entry.provider.length === 0) {
      throw new TypeError(`modelPolicies[${index}].provider must be a non-empty string`)
    }
    if (typeof entry.model !== 'string' || entry.model.length === 0) {
      throw new TypeError(`modelPolicies[${index}].model must be a non-empty string`)
    }
    const key = `${entry.provider}\u0000${entry.model}`
    if (seen.has(key)) {
      throw new TypeError(`modelPolicies: duplicate model policy for ${entry.provider}/${entry.model}`)
    }
    seen.add(key)
    const resolvedThreshold = present(entry.thresholdRatio) ? entry.thresholdRatio : thresholdRatio
    const policy = normalizePolicy(entry, `modelPolicies[${index}]`, resolvedThreshold)
    // Native rule: with no explicit global maxTokens, a policy-level headroom
    // becomes that policy's summary output cap. Preserve it here so the routed
    // policy resolves exactly like the native engine.
    if (policy.maxTokens === undefined && !globalMaxTokensExplicit && policy.headroomTokens !== undefined) {
      if (!(policy.headroomTokens > 0)) {
        throw new TypeError(
          `modelPolicies[${index}].maxTokens is required when its headroomTokens is 0: the native engine needs a positive summary output cap`,
        )
      }
      policy.maxTokens = policy.headroomTokens
    }
    return { provider: entry.provider, model: entry.model, ...policy }
  })
  return policies
}

/**
 * Read the live (or plain) configuration as one normalized, detached snapshot.
 *
 * Missing fields take the documented defaults; present values are validated
 * against the same boundaries as {@link Config} and never silently coerced.
 * Cross-field conflicts throw `TypeError` with an actionable message.
 *
 * @param config - live row config (volatile fields unwrap) or a plain object.
 * @returns frozen normalized configuration.
 * @throws {TypeError} for an invalid or conflicting configuration.
 */
export function readConfig(config) {
  const source = config ?? {}

  const mode = fieldOf(source, 'mode') ?? DEFAULTS.mode
  if (!MODES.includes(mode)) {
    throw new TypeError(`mode must be one of ${MODES.join(', ')}, got ${String(mode)}`)
  }
  const auto = fieldOf(source, 'auto') ?? DEFAULTS.auto
  if (typeof auto !== 'boolean') throw new TypeError(`auto must be a boolean, got ${String(auto)}`)

  const thresholdRatio = requireRatio(
    fieldOf(source, 'thresholdRatio') ?? DEFAULTS.thresholdRatio,
    'thresholdRatio',
    1,
  )
  const headroomTokens = requireInteger(
    fieldOf(source, 'headroomTokens') ?? DEFAULTS.headroomTokens,
    'headroomTokens',
  )

  const retainRatioValue = fieldOf(source, 'retainRatio')
  const retainTokensValue = fieldOf(source, 'retainTokens')
  const hasRatio = present(retainRatioValue)
  const hasTokens = present(retainTokensValue)
  if (hasRatio && hasTokens) {
    throw new TypeError('retainRatio and retainTokens are mutually exclusive; clear the one you are not using')
  }
  let retainRatio = null
  let retainTokens = null
  if (hasTokens) {
    retainTokens = requireInteger(retainTokensValue, 'retainTokens')
  } else {
    retainRatio = requireRatio(hasRatio ? retainRatioValue : DEFAULTS.retainRatio, 'retainRatio', 1)
  }
  if (retainRatio !== null && retainRatio >= thresholdRatio) {
    throw new TypeError(`retainRatio (${retainRatio}) must be less than thresholdRatio (${thresholdRatio})`)
  }

  const summarizationProvider = fieldOf(source, 'summarizationProvider') ?? ''
  const summarizationModel = fieldOf(source, 'summarizationModel') ?? ''
  if (typeof summarizationProvider !== 'string' || typeof summarizationModel !== 'string') {
    throw new TypeError('summarizationProvider and summarizationModel must be strings')
  }
  if ((summarizationProvider.length === 0) !== (summarizationModel.length === 0)) {
    throw new TypeError('summarizationProvider and summarizationModel must be set together as an empty or non-empty pair')
  }

  const reasoningEffort = fieldOf(source, 'reasoningEffort') ?? ''
  if (typeof reasoningEffort !== 'string') {
    throw new TypeError('reasoningEffort must be a string (empty means the selected summary model default)')
  }
  if (reasoningEffort.length > 0 && reasoningEffort.trim().length === 0) {
    throw new TypeError('reasoningEffort must be empty or an exact opaque model effort id')
  }

  const cachePriority = fieldOf(source, 'cachePriority') ?? DEFAULTS.cachePriority
  if (typeof cachePriority !== 'boolean') throw new TypeError(`cachePriority must be a boolean, got ${String(cachePriority)}`)

  const configuredMaxTokens = fieldOf(source, 'maxTokens')
  const globalMaxTokensExplicit = present(configuredMaxTokens)
  let maxTokens
  if (globalMaxTokensExplicit) {
    maxTokens = requireInteger(configuredMaxTokens, 'maxTokens', { positive: true })
  } else {
    if (headroomTokens <= 0) {
      throw new TypeError('maxTokens is required when headroomTokens is 0: the native engine needs a positive summary output cap')
    }
    maxTokens = headroomTokens
  }

  const compactionRetries = requireInteger(
    fieldOf(source, 'compactionRetries') ?? DEFAULTS.compactionRetries,
    'compactionRetries',
  )
  const maxOverflowRetries = requireInteger(
    fieldOf(source, 'maxOverflowRetries') ?? DEFAULTS.maxOverflowRetries,
    'maxOverflowRetries',
  )

  const modelPolicies = normalizeModelPolicies(
    fieldOf(source, 'modelPolicies'),
    thresholdRatio,
    globalMaxTokensExplicit,
  )

  return deepFreeze({
    mode,
    auto,
    thresholdRatio,
    headroomTokens,
    retainRatio,
    retainTokens,
    summarizationProvider,
    summarizationModel,
    reasoningEffort,
    cachePriority,
    maxTokens,
    compactionRetries,
    maxOverflowRetries,
    modelPolicies,
  })
}

/**
 * Project one normalized configuration onto the native engine config.
 *
 * Enhanced-only keys are stripped; `maxTokens` is already resolved (the native
 * default is the resolved headroom). The native config keys, their units, and
 * their meanings are unchanged.
 *
 * @param snapshot - normalized configuration from {@link readConfig}.
 * @returns native engine config.
 */
export function toNativeConfig(snapshot) {
  return {
    thresholdRatio: snapshot.thresholdRatio,
    headroomTokens: snapshot.headroomTokens,
    ...(snapshot.retainTokens !== null
      ? { retainTokens: snapshot.retainTokens }
      : { retainRatio: snapshot.retainRatio }),
    summarizationProvider: snapshot.summarizationProvider,
    summarizationModel: snapshot.summarizationModel,
    maxTokens: snapshot.maxTokens,
    compactionRetries: snapshot.compactionRetries,
    maxOverflowRetries: snapshot.maxOverflowRetries,
    modelPolicies: snapshot.modelPolicies.map((policy) => ({ ...policy })),
    auto: snapshot.auto,
  }
}

/** Whether two normalized configurations are identical. */
export function configEquals(left, right) {
  return isDeepStrictEqual(left, right)
}

/** Recursively freeze a plain JSON-shaped value. */
export function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

/** Read one field from a live config object (exported for the companion). */
export function readField(config, key) {
  return fieldOf(config, key)
}
