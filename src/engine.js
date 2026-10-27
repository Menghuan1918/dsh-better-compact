/**
 * dsh-better-compact engine — one native-compatible compaction provider.
 *
 * This class extends `BasicCompactionEngine` and customizes only its public
 * `summarize()` hook (plus the manual entry's post-success continuation and a
 * cross-realm guard). Selection, retention, the durable compaction transaction,
 * locking, flush, overflow recovery, and retry bounds all stay in the inherited
 * native implementation: successful compactions still produce exactly the
 * native `compaction/start` → `compaction/summary` → checkpoint replacement →
 * `compaction/end` sequence.
 *
 * The enhanced modes reuse the native one-shot request shape (replayed
 * system/tool/history prefix + a final user instruction) so the provider's warm
 * prefix stays reusable; only the instruction, authoritative state, reasoning
 * effort, and post-output validation differ. Native mode delegates to the
 * inherited implementation untouched.
 */

import z from '@deepseek-ai/schemastery'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { ManualCompactionError } from '@deepseek-ai/dsh-compaction'
import {
  BlockAssembler,
  LlmError,
  contentHasImage,
  createUserMessage,
  errorChain,
} from '@deepseek-ai/dsh-llm'
import { estimateMessage, estimateToolsTokens } from '@deepseek-ai/dsh-token-meter/estimate'
import { configEquals, deepFreeze, toNativeConfig } from './config.js'
import { BudgetConfigError, resolveTargetPolicy, routedTarget } from './budget.js'
import {
  assertSummaryStructure,
  buildInstruction,
  composeHandoffDocument,
  continuationText,
  redactContentBlocks,
  redactSecrets,
  renderStateBlock,
} from './prompts.js'
import { writeHandoffFile } from './handoff.js'
import { collectAuthoritativeState, handoffContinuationBlockers } from './state.js'
import {
  activeSummaryMode,
  lastCompactionFailure,
  markSummaryEnd,
  markSummaryStart,
  recordCompactionFailure,
  recordContinuationOutcome,
} from './live.js'
import { serviceIdentity } from './identity.js'

/** Empty engine row config: every setting lives on the host companion row. */
const EMPTY_CONFIG = z.object({})

/** Verified handoff path per session, consumed by the manual entry point. */
const handoffBySession = new Map()
/** Manual compactions that already scheduled their one continuation. */
const continuedCompactions = new Set()

/** Keep process-local auxiliary maps bounded. */
function remember(map, key, value) {
  map.delete(key)
  map.set(key, value)
  while (map.size > 200) map.delete(map.keys().next().value)
}

/** Whether an error is a cancellation/abort rather than a content failure. */
function isCancellation(error) {
  const code = typeof error?.code === 'string' ? error.code : ''
  const message = typeof error?.message === 'string' ? error.message : String(error)
  return /abort|cancel/i.test(code) || /abort|cancel/i.test(message)
}

/** Map a terminal summarization finish to the native fail-closed error. */
function finishError(finish) {
  switch (finish.kind) {
    case 'error':
    case 'aborted':
      return new LlmError(finish.failure.message, finish.failure.code, finish.failure)
    case 'max-tokens': {
      const error = new Error('summarization truncated at the token cap (incomplete checkpoint)')
      error.code = 'MAX_TOKENS'
      return error
    }
    default:
      return undefined
  }
}

/** Classify a failure for the inspect status vocabulary. */
function classifyFailure(error) {
  if (error instanceof ManualCompactionError) {
    if (error.code === 'cancelled') return 'cancelled'
    if (error.code === 'persistence') return 'persistence-error'
    return 'failed'
  }
  return isCancellation(error) ? 'cancelled' : 'failed'
}

/** Build the target-resolution failure used when no route exists. */
function noTargetError() {
  return new LlmError(
    'no provider/model available for summarization: set both summarizationProvider and summarizationModel, route one request, or set both AgentOptions fields',
    'BETTER_COMPACT_ROUTE',
  )
}

export class BetterCompactEngine extends BasicCompactionEngine {
  static inject = [...BasicCompactionEngine.inject, 'betterCompactConfig']
  static Config = EMPTY_CONFIG
  /** Marker used by tests and diagnostics; never a behavioral branch. */
  static betterCompactEngine = true

  /**
   * @param {object} ctx - engine context.
   * @param {object} [rowConfig] - engine row config (always empty in shipped patches).
   */
  constructor(ctx, rowConfig = {}) {
    const companion = ctx.get('betterCompactConfig')
    if (companion === undefined) {
      throw new Error(
        'dsh-better-compact/engine: the host companion row "dsh-better-compact" is not mounted; the engine cannot read its configuration snapshot',
      )
    }
    const snapshot = companion.snapshot()
    super(ctx, toNativeConfig(snapshot))
    /** Frozen load-time configuration actually in force. */
    this.snapshot = snapshot
    /** Enhanced mode in force for this engine instance. */
    this.mode = snapshot.mode
    /** True when this row config is the shipped empty config. */
    this.rowConfigEmpty = Object.keys(rowConfig ?? {}).length === 0
  }

  /**
   * Summarize the replayed conversation region.
   * Native mode delegates entirely to the inherited implementation.
   */
  async summarize(input, agent, signal) {
    // Native attempts are marked too, so inspect can distinguish a live
    // in-flight attempt from an orphaned durable bracket.
    markSummaryStart(agent.session, this.mode)
    try {
      if (this.mode === 'native') return await super.summarize(input, agent, signal)
      return await this._summarizeEnhanced(input, agent, signal)
    } finally {
      markSummaryEnd(agent.session.id)
    }
  }

  /**
   * Automatic pressure/overflow entry. A Web session that selected a preset
   * gets its own isolated `compaction` service, and that preset engine receives
   * the same agent-scoped events. The host-plane engine must stay out of the
   * way instead of double-compacting; a preset with no compaction group has no
   * preset service and correctly falls back to this row.
   */
  async compactIfNeeded(agent, trigger, signal) {
    if (this._supersededByPreset(agent)) return null
    try {
      return await super.compactIfNeeded(agent, trigger, signal)
    } catch (error) {
      recordCompactionFailure(agent.session, classifyFailure(error), errorChain(error))
      throw error
    }
  }

  /**
   * Manual idle compaction. On a live successful handoff compaction it
   * schedules exactly one ordinary same-session follow-up, subject to the
   * documented read-only safety checks.
   */
  async compactNow(agent, signal, sourceCommandId) {
    try {
      const result = await super.compactNow(agent, signal, sourceCommandId)
      if (result !== null) {
        if (this.mode === 'handoff') {
          await this._maybeContinue(agent, result, signal)
        } else {
          handoffBySession.delete(agent.session.id)
        }
      }
      return result
    } catch (error) {
      if (!(error instanceof ManualCompactionError && error.code === 'busy')) {
        recordCompactionFailure(agent.session, classifyFailure(error), errorChain(error))
      }
      throw error
    }
  }

  /** Whether a preset-owned engine supersedes this host-plane instance. */
  _supersededByPreset(agent) {
    let presets
    try {
      presets = this.ctx.get('agentPresets')
    } catch {
      return false
    }
    if (presets === undefined) return false
    try {
      const mounted = presets.serviceFor(agent, 'compaction')
      return mounted !== undefined && serviceIdentity(mounted) !== serviceIdentity(this)
    } catch {
      return false
    }
  }

  /** Resolve the summary route exactly like the native engine. */
  _resolveRoute(agent) {
    const snapshot = this.snapshot
    const conversationTarget = routedTarget(agent.session) ?? routeFromAgentOptions(agent)
    const policy = conversationTarget === undefined
      ? {
          summarizationProvider: snapshot.summarizationProvider,
          summarizationModel: snapshot.summarizationModel,
          maxTokens: snapshot.maxTokens,
        }
      : resolveTargetPolicy(snapshot, conversationTarget)
    const configured = policy.summarizationProvider.length > 0
      ? { provider: policy.summarizationProvider, model: policy.summarizationModel }
      : undefined
    const latest = routedTarget(agent.session)
    const target = configured ?? latest ?? routeFromAgentOptions(agent)
    if (target === undefined) throw noTargetError()
    return { target, policy }
  }

  /** Validate the saved effort against the exact summary model's capabilities. */
  _resolveEffort(info) {
    const effort = this.snapshot.reasoningEffort
    if (effort.length === 0) return undefined
    const reasoning = info.reasoning
    if (reasoning === undefined || !reasoning.efforts.some((candidate) => candidate.id === effort)) {
      throw new LlmError(
        `provider "${info.provider}" model "${info.id}" does not support reasoning effort "${effort}"; choose a supported effort or clear reasoningEffort (no substitution is performed)`,
        'UNSUPPORTED_REASONING_EFFORT',
      )
    }
    return effort
  }

  /** Estimate the auxiliary request size under the fixed token-meter heuristic. */
  _estimateRequest(input, instruction, effortIgnored) {
    let tokens = 0
    for (const message of input.messages) tokens += estimateMessage(message)
    tokens += estimateMessage({ role: 'user', content: [{ type: 'text', text: instruction }] })
    if (this.snapshot.cachePriority && input.tools !== undefined) {
      tokens += estimateToolsTokens({ tools: input.tools })
    }
    return tokens
  }

  /**
   * Choose an instruction that fits the model context, keeping the goal state
   * before optional todos/questions/jobs, and failing loud when even the empty
   * state request does not fit.
   */
  _chooseInstruction(input, state, info, maxTokens) {
    const contextWindow = info.context?.contextWindow
    const full = renderStateBlock(state, this.mode)
    const goalOnly = renderStateBlock(
      { goal: state.goal, ...(state.goalError === undefined ? {} : { goalError: state.goalError }) },
      this.mode,
    )
    const candidates = [
      { block: full, stateOmitted: false },
      { block: goalOnly, stateOmitted: false },
      { block: { text: '', trimmed: false, omitted: [] }, stateOmitted: true },
    ]
    if (contextWindow === undefined) {
      return buildInstruction(this.mode, full)
    }
    for (const candidate of candidates) {
      const instruction = buildInstruction(this.mode, candidate.block, {
        stateOmitted: candidate.stateOmitted,
      })
      const estimated = this._estimateRequest(input, instruction)
      if (estimated + maxTokens <= contextWindow) return instruction
    }
    throw new LlmError(
      `the summary request does not fit ${info.provider}/${info.id}: the replayed conversation plus maxTokens ${maxTokens} exceeds the ${contextWindow}-token context window; compact a smaller span, lower maxTokens, or choose a larger summary model`,
      'BETTER_COMPACT_BUDGET',
    )
  }

  /** Enhanced-mode summarization (goal or handoff). */
  async _summarizeEnhanced(input, agent, signal) {
    const { target, policy } = this._resolveRoute(agent)
    const maxTokens = policy.maxTokens
    const info = await this.ctx.llm.resolveModelInfo(target.provider, target.model, signal)
    const effort = this._resolveEffort(info)
    const state = collectAuthoritativeState(this.ctx, agent)
    const instruction = this._chooseInstruction(input, state, info, maxTokens)
    const finalMessage = deepFreeze({
      role: 'user',
      content: [{ type: 'text', text: instruction }],
    })
    const messages = [...input.messages, finalMessage]
    const options = {
      provider: target.provider,
      model: target.model,
      messages,
      maxTokens,
      sessionId: agent.session.id,
      purpose: 'compaction',
      ...(effort === undefined ? {} : { reasoningEffort: effort }),
      ...(signal === undefined ? {} : { signal }),
    }
    if (this.snapshot.cachePriority) {
      options.toolHistory = agent.session.toolHistory()
      if (input.tools !== undefined) options.tools = [...input.tools]
    }
    const assembler = new BlockAssembler()
    for await (const chunk of this.ctx.llm.stream(options)) assembler.push(chunk)
    const error = finishError(assembler.finish)
    if (error !== undefined) throw error
    const rawOutput = assembler.blocks()
    if (contentHasImage(rawOutput)) {
      throw new LlmError('compaction summary cannot contain image output', 'UNSUPPORTED_CONTENT')
    }
    const textBlocks = rawOutput.filter((block) => block.type === 'text')
    const text = textBlocks.map((block) => block.text).join('\n')
    assertSummaryStructure(text, this.mode)

    let finalText = text
    if (this.mode === 'handoff') {
      const redacted = redactSecrets(text)
      const createdAt = new Date().toISOString()
      const written = await writeHandoffFile({
        sessionId: agent.session.id,
        createdAt,
        makeBody: (path) =>
          composeHandoffDocument({
            body: redacted,
            path,
            sessionId: agent.session.id,
            createdAt,
          }),
      })
      remember(handoffBySession, agent.session.id, { path: written.path, bytes: written.bytes })
      finalText = written.body
    }

    return {
      summary: [{ type: 'text', text: finalText }],
      // The provider output is persisted on compaction/summary and rendered by
      // the trajectory UI. Handoff output must be redacted there too, not only
      // in the visible checkpoint summary.
      rawOutput: this.mode === 'handoff' ? redactContentBlocks(rawOutput) : rawOutput,
      llmStreamCall: true,
      provider: target.provider,
      model: target.model,
      maxTokens,
      ...(assembler.usage === undefined ? {} : { usage: assembler.usage }),
    }
  }

  /** Schedule the one documented continuation after a successful manual handoff. */
  async _maybeContinue(agent, result, signal) {
    const attempt = handoffBySession.get(agent.session.id) ?? null
    handoffBySession.delete(agent.session.id)
    if (continuedCompactions.has(result.compactionId)) return
    const record = (status, blockers) =>
      recordContinuationOutcome(agent.session.id, {
        compactionId: result.compactionId,
        status,
        blockers,
      })
    if (signal !== undefined && signal.aborted) {
      record('skipped', ['the manual compaction request was cancelled'])
      this.ctx.logger.info('better-compact: handoff continuation skipped because the request was cancelled')
      return
    }
    if (this.ctx.get('agents')?.get(agent.id) !== agent) {
      record('skipped', ['the agent is no longer live'])
      this.ctx.logger.warn('better-compact: handoff continuation skipped because the agent is no longer live')
      return
    }
    const { blockers } = handoffContinuationBlockers(this.ctx, agent)
    if (blockers.length > 0) {
      record('skipped', blockers)
      this.ctx.logger.info(`better-compact: handoff continuation not scheduled (${blockers.join('; ')}); the handoff checkpoint and file remain available`)
      return
    }
    try {
      agent.followup(
        createUserMessage({
          content: [{ type: 'text', text: continuationText(result, attempt?.path ?? null) }],
          source: { kind: 'user' },
        }),
      )
      continuedCompactions.add(result.compactionId)
      while (continuedCompactions.size > 200) {
        continuedCompactions.delete(continuedCompactions.values().next().value)
      }
      record('scheduled', [])
    } catch (error) {
      record('skipped', [`could not queue the continuation: ${errorChain(error)}`])
      this.ctx.logger.warn(`better-compact: could not queue the handoff continuation: ${errorChain(error)}`)
      return
    }
    try {
      await this.ctx.sessions.flush(agent.session)
    } catch (error) {
      this.ctx.logger.warn(
        `better-compact: the handoff continuation was queued but its inbox splice could not be flushed: ${errorChain(error)}; the turn may still start in this process`,
      )
    }
  }

  /** Test/inspection helper: the mode this exact engine instance holds. */
  get activeMode() {
    return this.mode
  }

  /** Test/inspection helper: last process-observed failure for a session. */
  failureFor(sessionId) {
    return lastCompactionFailure(sessionId)
  }

  /** Test/inspection helper: whether a live summary attempt owns a session. */
  activeSummaryFor(sessionId) {
    return activeSummaryMode(sessionId)
  }

  /** Test helper: compare the frozen snapshot with a candidate config. */
  snapshotEquals(candidate) {
    return configEquals(this.snapshot, candidate)
  }
}

/** Fall back to the AgentOptions pair when no request was routed yet. */
function routeFromAgentOptions(agent) {
  const provider = agent.options?.provider
  const model = agent.options?.model
  if (typeof provider !== 'string' || provider.length === 0) return undefined
  if (typeof model !== 'string' || model.length === 0) return undefined
  return { provider, model }
}

/** Re-exported for tests that assert the budget error type. */
export { BudgetConfigError }

export default BetterCompactEngine
