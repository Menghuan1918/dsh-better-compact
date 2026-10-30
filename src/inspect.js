/**
 * Read-only inspection projection for the GET route and the S3 UI contract.
 *
 * This module performs no LLM generation, no compaction, no CLI call, no temp
 * file write, and no goal/session mutation. It prices the session through the
 * singleton `ctx.tokenMeter`, projects the last native compaction bracket from
 * real log events/usage, mirrors the native safe-cut selection for the preview,
 * and reports unknown values as `null` (never 0, never a fabricated
 * percentage).
 *
 * Cold sessions are read through `ctx.sessionQuery.observeSession` and replayed
 * into a detached `Session` for the same meter; a failure to reconstruct one is
 * reported as an unavailable measurement, not as a different algorithm.
 */

import { Session } from '@deepseek-ai/dsh-session'
import {
  ROLE_OVERHEAD,
  estimateContent,
  estimateMessage,
  estimateToolsTokens,
} from '@deepseek-ai/dsh-token-meter/estimate'
import { configEquals } from './config.js'
import { isBetterCompactEngine, serviceIdentity } from './identity.js'
import {
  fixedPrefixTokens,
  measurementKind,
  resolveCompactSpec,
  resolveTargetPolicy,
  selectCompactableRange,
  targetFromHeader,
} from './budget.js'
import { detectSummaryMode } from './prompts.js'
import {
  continuationOutcome,
  isSummaryActive,
  lastBudgetFallback,
  lastCompactionFailure,
} from './live.js'

/** Exact inspect route pathname. */
export const INSPECT_PATH = '/better-compact/api/inspect'

/**
 * Native checkpoint framing reproduced only to price the replacement upper
 * bound: the preamble + `<compacted-summary>` tags wrap every native summary
 * message. Adapted from DeepSeek Harness (MIT; see `third-party/NOTICE`).
 */
const NATIVE_CHECKPOINT_PREAMBLE =
  'This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.'

/** Fixed replacement framing tokens included in the preview upper bound. */
export const NATIVE_CHECKPOINT_FRAMING_TOKENS =
  estimateContent([
    { type: 'text', text: `${NATIVE_CHECKPOINT_PREAMBLE}\n\n<compacted-summary>` },
    { type: 'text', text: '</compacted-summary>' },
  ]) + ROLE_OVERHEAD

/** Structured failure the HTTP layer maps to a status. */
export class InspectError extends Error {
  /**
   * @param {number} status - HTTP status.
   * @param {string} code - stable machine code.
   * @param {string} message - human-readable detail.
   */
  constructor(status, code, message) {
    super(message)
    this.name = 'InspectError'
    this.status = status
    this.code = code
  }
}

/** Read one optional service without failing inspection. */
function service(ctx, name) {
  try {
    return ctx.get(name)
  } catch {
    return undefined
  }
}

/** Build the stable inspect payload for a resolved session. */
function emptyPayload(activeConfig, requiresReload, sessionId = null) {
  return {
    activeConfig,
    requiresReload,
    sessionId,
    engine: null,
    diagnostics: [],
    budget: null,
    preview: null,
    lastCompaction: null,
    handoffContinuation: null,
  }
}

/**
 * Determine which compaction engine actually serves a session, so inspect
 * never presents better-compact's configuration/budget for a session running
 * another preset's native engine.
 *
 * @returns {{owner: 'host'|'better-compact-preset'|'foreign-preset'|'unknown', inspectApplies: boolean, reason: string|null}}
 */
function engineOwnership(ctx, resolved) {
  if (resolved.agent === undefined) {
    return {
      owner: 'unknown',
      inspectApplies: true,
      reason: resolved.session === null
        ? 'no live agent or replayable session is available; engine ownership cannot be proven'
        : 'the session is not live; engine ownership cannot be proven, so budget/preview use the active configuration',
    }
  }
  let presets
  try {
    presets = ctx.get('agentPresets')
  } catch {
    presets = undefined
  }
  let mounted
  if (presets !== undefined && typeof presets.serviceFor === 'function') {
    try {
      mounted = presets.serviceFor(resolved.agent, 'compaction')
    } catch {
      mounted = undefined
    }
  }
  if (mounted !== undefined) {
    if (isBetterCompactEngine(mounted)) {
      return { owner: 'better-compact-preset', inspectApplies: true, reason: null }
    }
    return {
      owner: 'foreign-preset',
      inspectApplies: false,
      reason:
        'the session preset owns a different compaction engine (' +
        `${serviceIdentity(mounted)?.constructor?.name ?? 'unknown'}); better-compact configuration and budget preview do not apply to it`,
    }
  }
  let hostEngine
  try {
    hostEngine = ctx.get('compaction')
  } catch {
    hostEngine = undefined
  }
  if (hostEngine !== undefined && isBetterCompactEngine(hostEngine)) {
    return { owner: 'host', inspectApplies: true, reason: null }
  }
  return {
    owner: 'unknown',
    inspectApplies: true,
    reason: 'no better-compact engine is mounted for this session; budget/preview use the active plugin configuration',
  }
}

/** Collect the session's own log events without mutating it. */
function eventsOf(session) {
  const events = []
  for (let seq = 0; seq < session.seq; seq += 1) {
    const event = session.eventAt(seq)
    if (event !== undefined) events.push(event)
  }
  return events
}

/** Find the latest request header event in a log. */
function latestHeader(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === 'request/header') return events[index].data.header
  }
  return undefined
}

/** Project one compaction summary's text from its blocks. */
function summaryText(summary) {
  if (!Array.isArray(summary)) return ''
  return summary
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

/**
 * Project the latest native compaction attempt from real events.
 *
 * Status vocabulary is `running | completed | failed | cancelled |
 * persistence-error`. `running` is claimed only for a live in-memory summary
 * attempt; an unmatched start with no live attempt is reported as failed, never
 * as an imaginary active process. A durability checkpoint failure after a
 * successful append is only knowable from this process's own observation; the
 * persisted log alone looks completed. Unknown fields are null.
 *
 * @param {readonly object[]} events - session events in seq order.
 * @param {string} sessionId - owning session identity.
 * @param {object} [options] - projection options.
 * @param {Function} [options.estimate] - message estimator (defaults to the token-meter one).
 * @returns {object | null} projected record, or null with no compaction.
 */
export function projectLastCompaction(events, sessionId, options = {}) {
  const estimate = options.estimate ?? estimateMessage
  let latestStart
  const summaries = new Map()
  const ends = new Map()
  const replacements = new Map()
  for (const event of events) {
    switch (event.type) {
      case 'compaction/start':
        latestStart = event
        break
      case 'compaction/summary':
        summaries.set(event.data.compactionId, event)
        break
      case 'compaction/end':
        ends.set(event.data.compactionId, event)
        break
      case 'user/message':
        if (event.data.source?.kind === 'compact-checkpoint') {
          replacements.set(event.data.source.compactionId, event)
        }
        break
      default:
        break
    }
  }
  if (latestStart === undefined) return null
  const id = latestStart.data.compactionId
  const summary = summaries.get(id)
  const end = ends.get(id)
  const replacement = replacements.get(id)
  const observedFailure = lastCompactionFailure(sessionId)
  const failureMatches = observedFailure?.compactionId === id

  let status
  if (end === undefined) {
    status = isSummaryActive(sessionId, id) ? 'running' : 'failed'
  } else if (failureMatches && observedFailure.status === 'persistence-error') {
    status = 'persistence-error'
  } else if (end.data.error !== undefined) {
    status = /abort|cancel/i.test(end.data.error) ? 'cancelled' : 'failed'
  } else {
    status = 'completed'
  }

  const mode = summary === undefined ? null : detectSummaryMode(summaryText(summary.data.summary))
  const error =
    end?.data.error ??
    (failureMatches && status !== 'completed' ? observedFailure.message : undefined) ??
    null

  return {
    id,
    trigger: latestStart.data.turn === null ? 'manual' : 'automatic',
    status,
    mode,
    beforeTokens: summary?.data.shadowedTokenCount ?? null,
    afterTokens: replacement === undefined ? null : estimate(replacement.data),
    durationMs: end === undefined ? null : end.time - latestStart.time,
    cacheReadTokens: summary?.data.usage?.cacheReadTokens ?? null,
    cacheWriteTokens: summary?.data.usage?.cacheWriteTokens ?? null,
    error,
  }
}

/**
 * Build the budget/preview section for one session.
 * @param {object} input - resolved inspection inputs.
 * @returns {{budget: object, preview: object|null, diagnostics: string[]}} sections.
 */
export function buildBudgetPreview(input) {
  const { session, events, activeConfig } = input
  const header = latestHeader(events)
  const target = targetFromHeader(header)
  const diagnostics = []
  const info = input.modelInfo
  const measurement = input.measurement
  const toolsTokens = estimateToolsTokens(header)
  const contextWindow = info?.context?.contextWindow ?? null
  let spec
  let policy
  let budgetReason
  if (target === undefined) {
    budgetReason = 'no routed request exists yet, so the pressure threshold cannot be resolved; send one request or configure summarizationProvider/Model'
  } else if (contextWindow === null) {
    budgetReason =
      input.modelInfoError ??
      `no context capacity is known for ${target.provider}/${target.model}; configure contextWindow on that adapter model`
  } else {
    policy = resolveTargetPolicy(activeConfig, target)
    const reserved = header?.config?.maxTokens ?? info?.defaultMaxTokens ?? 0
    try {
      spec = resolveCompactSpec(policy, contextWindow, reserved)
    } catch (error) {
      budgetReason = error instanceof Error ? error.message : String(error)
    }
  }
  if (budgetReason !== undefined) diagnostics.push(budgetReason)

  const reservedCompletion = target === undefined ? null : header?.config?.maxTokens ?? info?.defaultMaxTokens ?? 0
  const budget = {
    target: target ?? null,
    contextWindow,
    reservedCompletionTokens: reservedCompletion,
    messageBudgetTokens: contextWindow === null || reservedCompletion === null ? null : contextWindow - reservedCompletion,
    headroomTokens: policy?.headroomTokens ?? null,
    pressureBudgetTokens: policy === undefined || contextWindow === null || reservedCompletion === null ? null : contextWindow - reservedCompletion - policy.headroomTokens,
    ratioThresholdTokens: policy === undefined || contextWindow === null ? null : Math.floor(contextWindow * policy.thresholdRatio),
    currentTokens: measurement?.totalTokens ?? null,
    measurement: measurementKind(measurement),
    fixedTokens:
      session !== null && measurement !== undefined
        ? fixedPrefixTokens(session, measurement, toolsTokens)
        : null,
    thresholdTokens: spec?.thresholdTokens ?? null,
    retainTokens: spec?.retainTokens ?? null,
    summaryMaxTokens: policy?.maxTokens ?? activeConfig.maxTokens,
  }

  if (session === null || measurement === undefined) {
    return {
      budget,
      preview: null,
      diagnostics: [
        ...diagnostics,
        measurement === undefined ? 'token measurement is unavailable for this session' : 'session surface is unavailable; token measurement could not be projected',
      ],
    }
  }

  let range = null
  let selectionError
  if (budgetReason === undefined) {
    try {
      range = selectCompactableRange(session, measurement, spec.retainTokens)
    } catch (error) {
      selectionError = error instanceof Error ? error.message : String(error)
    }
  }

  if (budgetReason !== undefined || selectionError !== undefined) {
    if (selectionError !== undefined) diagnostics.push(selectionError)
    return {
      budget,
      preview: {
        beforeTokens: measurement.totalTokens,
        afterUpperBoundTokens: null,
        rangeStart: null,
        rangeEnd: null,
        reason: budgetReason ?? selectionError,
      },
      diagnostics,
    }
  }

  if (range === null) {
    return {
      budget,
      preview: {
        beforeTokens: measurement.totalTokens,
        afterUpperBoundTokens: null,
        rangeStart: null,
        rangeEnd: null,
        reason:
          'no safe compactable range: the session has no older balanced span left after the system prompt and retained tail, or every candidate would split a tool-call/result pair',
      },
      diagnostics,
    }
  }

  const surface = session.surface.nodes
  const endIndex = surface.indexOf(range.end)
  let tailTokens = 0
  if (endIndex >= 0) {
    for (let index = endIndex + 1; index < measurement.nodes.length; index += 1) {
      tailTokens += measurement.nodes[index].tokens
    }
  }
  const afterUpperBoundTokens =
    (budget.fixedTokens ?? 0) + tailTokens + spec.maxTokens + NATIVE_CHECKPOINT_FRAMING_TOKENS
  const belowTrigger =
    measurement.totalTokens >= spec.thresholdTokens
      ? null
      : `current ${measurement.totalTokens} tokens are below the automatic trigger ${spec.thresholdTokens}; this is the candidate range, not a running compaction`
  const autoDisabled =
    activeConfig.auto === false
      ? 'automatic compaction is disabled (auto=false); this preview is informational only'
      : null
  const reason =
    belowTrigger === null && autoDisabled === null
      ? null
      : [belowTrigger, autoDisabled].filter((part) => part !== null).join('; ')
  return {
    budget,
    preview: {
      beforeTokens: measurement.totalTokens,
      afterUpperBoundTokens,
      retainedTokens: tailTokens,
      replacedTokens: measurement.totalTokens - (budget.fixedTokens ?? 0) - tailTokens,
      checkpointFramingTokens: NATIVE_CHECKPOINT_FRAMING_TOKENS,
      rangeStart: range.start,
      rangeEnd: range.end,
      reason,
    },
    diagnostics,
  }
}

/** Map a session-query failure to an inspect error. */
function mapSessionQueryError(error) {
  const code = typeof error?.code === 'string' ? error.code : ''
  if (code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
    return new InspectError(404, 'SESSION_NOT_FOUND', `session "${error.sessionId ?? ''}" was not found or is not visible to this host`.trim())
  }
  if (code === 'SESSION_QUERY_PERSISTENCE_FAILED') {
    return new InspectError(503, 'SESSION_QUERY_UNAVAILABLE', `session persistence is unavailable: ${error.message}`)
  }
  if (code === 'SESSION_QUERY_ABORTED') {
    return new InspectError(503, 'INSPECTION_ABORTED', String(error.message))
  }
  return new InspectError(503, 'SESSION_QUERY_UNAVAILABLE', `session inspection failed: ${error instanceof Error ? error.message : String(error)}`)
}

/**
 * Resolve a live or cold session into a replay object plus its events.
 * @returns {Promise<{session: object|null, events: readonly object[], agent: object|undefined, cold: boolean}>}
 */
async function resolveSession(ctx, sessionId) {
  const agents = service(ctx, 'agents')
  const liveAgent = agents?.get(sessionId)
  if (liveAgent !== undefined) {
    return { session: liveAgent.session, events: eventsOf(liveAgent.session), agent: liveAgent, cold: false }
  }
  const sessions = service(ctx, 'sessions')
  const liveSession = sessions?.get(sessionId)
  if (liveSession !== undefined) {
    return { session: liveSession, events: eventsOf(liveSession), agent: undefined, cold: false }
  }
  const sessionQuery = service(ctx, 'sessionQuery')
  if (sessionQuery === undefined) {
    throw new InspectError(
      503,
      'SESSION_QUERY_UNAVAILABLE',
      'this host has no session-query service, so a non-live session cannot be inspected; the live session remains inspectable',
    )
  }
  let observation
  try {
    observation = await sessionQuery.observeSession(sessionId)
  } catch (error) {
    throw mapSessionQueryError(error)
  }
  try {
    const events = [...observation.events]
    let session = null
    try {
      const projections = sessions?.messageProjections ?? []
      session = Session.create(
        observation.header.id,
        observation.events,
        observation.header,
        observation.inheritedEventCount,
        projections,
      )
    } catch {
      session = null
    }
    return { session, events, agent: undefined, cold: true }
  } finally {
    try {
      observation[Symbol.dispose]?.()
    } catch {
      // A failed lease release must not turn a successful read into an error.
    }
  }
}

/**
 * Build the complete inspect payload.
 *
 * @param {object} ctx - host companion context.
 * @param {object} companion - `betterCompactConfig` provider.
 * @param {string | null} sessionId - optional requested session id.
 * @returns {Promise<object>} response payload.
 */
export async function inspectPlugin(ctx, companion, sessionId = null) {
  const activeConfig = companion.snapshot()
  let requiresReload
  try {
    requiresReload = !configEquals(companion.current(), activeConfig)
  } catch {
    // A saved value that no longer normalizes is still "different from the
    // active snapshot"; the running engine keeps its frozen configuration.
    requiresReload = true
  }
  if (sessionId === null) return emptyPayload(activeConfig, requiresReload)

  const resolved = await resolveSession(ctx, sessionId)
  const events = resolved.events
  const lastCompaction = projectLastCompaction(events, sessionId)
  const engine = engineOwnership(ctx, resolved)
  const handoffContinuation = continuationOutcome(sessionId)
  if (!engine.inspectApplies) {
    return {
      activeConfig,
      requiresReload,
      sessionId,
      engine,
      diagnostics: [engine.reason].filter((value) => value !== null),
      budget: null,
      preview: null,
      lastCompaction,
      handoffContinuation,
    }
  }
  const tokenMeter = service(ctx, 'tokenMeter')
  let measurement
  let measurementFailure
  if (resolved.session !== null && tokenMeter !== undefined) {
    try {
      measurement = tokenMeter.measure(resolved.session)
    } catch (error) {
      measurementFailure = error instanceof Error ? error.message : String(error)
    }
  }

  const header = latestHeader(events)
  const target = targetFromHeader(header)
  let info
  let modelInfoError
  if (target !== undefined) {
    const llm = service(ctx, 'llm')
    if (llm !== undefined) {
      try {
        info = await llm.resolveModelInfo(target.provider, target.model)
      } catch (error) {
        modelInfoError = `model metadata is unavailable for ${target.provider}/${target.model}: ${error instanceof Error ? error.message : String(error)}`
        measurementFailure ??= modelInfoError
      }
    }
  }

  const sections = buildBudgetPreview({
    ctx,
    session: resolved.session,
    events,
    activeConfig,
    measurement,
    modelInfo: info,
    modelInfoError,
  })
  const diagnostics = [...sections.diagnostics]
  if (measurementFailure !== undefined) diagnostics.push(measurementFailure)
  const fallback = lastBudgetFallback(sessionId)
  if (fallback !== null) {
    diagnostics.push(
      `the last enhanced summary omitted authoritative state to fit the model budget: ${fallback.omitted.join('; ')}`,
    )
  }
  if (engine.reason !== null) diagnostics.push(engine.reason)

  return {
    activeConfig,
    requiresReload,
    sessionId,
    engine,
    diagnostics: [...new Set(diagnostics.filter((entry) => typeof entry === 'string' && entry.length > 0))],
    budget: sections.budget,
    preview: sections.preview,
    lastCompaction,
    handoffContinuation,
  }
}
