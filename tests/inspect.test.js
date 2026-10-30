import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Session } from '@deepseek-ai/dsh-session'
import { readConfig } from '../src/config.js'
import { buildBudgetPreview, NATIVE_CHECKPOINT_FRAMING_TOKENS } from '../src/inspect.js'

function fixture(config = {}, tokens = [20, 300, 100, 150], capacity = 1000) {
  const session = Session.create('budget-preview-test')
  tokens.forEach((_, index) => session.append(index === 0 ? 'system/message' : 'user/message', {
    content: [{ type: 'text', text: index === 0 ? 'System' : 'Message ' + index }],
  }, { surfaceOp: 'append' }))
  const nodes = session.surface.nodes.map((seq, index) => ({ seq, tokens: tokens[index] }))
  return buildBudgetPreview({ session,
    events: [...session.snapshotEvents(), { type: 'request/header', data: { header: { config: { provider: 'p', model: 'm', maxTokens: 100 } } } }],
    activeConfig: readConfig({ headroomTokens: 100, maxTokens: 50, retainTokens: 160, ...config }),
    modelInfo: capacity === null ? undefined : { context: { contextWindow: capacity } },
    measurement: { nodes, totalTokens: tokens.reduce((sum, value) => sum + value, 0) },
  })
}

test('diagnostics distinguish ratio slack, conversation output reserve, and additional headroom', () => {
  const ratio = fixture({ thresholdRatio: .5 })
  assert.equal(ratio.budget.messageBudgetTokens, 900)
  assert.equal(ratio.budget.pressureBudgetTokens, 800)
  assert.equal(ratio.budget.thresholdTokens, 500)
  assert.equal(ratio.budget.reservedCompletionTokens, 100)
  assert.equal(ratio.budget.headroomTokens, 100)
  assert.equal(1000 - ratio.budget.thresholdTokens, 500)
  assert.notEqual(1000 - ratio.budget.thresholdTokens, ratio.budget.headroomTokens + ratio.budget.reservedCompletionTokens)
  const pressure = fixture({ headroomTokens: 500 })
  assert.equal(pressure.budget.thresholdTokens, 400)
  assert.equal(pressure.budget.ratioThresholdTokens, 800)
})

test('real native selection reports actual whole-node retained tail and complete replacement bound', () => {
  const { budget, preview } = fixture()
  assert.equal(budget.retainTokens, 160)
  assert.equal(preview.retainedTokens, 250)
  assert.equal(preview.replacedTokens, 300)
  assert.equal(preview.rangeStart, 1)
  assert.equal(preview.rangeEnd, 1)
  assert.equal(preview.beforeTokens, budget.fixedTokens + preview.replacedTokens + preview.retainedTokens)
  assert.equal(preview.afterUpperBoundTokens, budget.fixedTokens + preview.retainedTokens + budget.summaryMaxTokens + NATIVE_CHECKPOINT_FRAMING_TOKENS)
  assert.ok(NATIVE_CHECKPOINT_FRAMING_TOKENS > 0)
  assert.match(preview.reason, /below the automatic trigger/)
})

test('zero retention still follows native final-message safety and no range produces no fabricated upper bound', () => {
  const zero = fixture({ retainTokens: 0 })
  assert.equal(zero.preview.retainedTokens, 150)
  const none = fixture({}, [20, 50])
  assert.equal(none.preview.rangeStart, null)
  assert.equal(none.preview.afterUpperBoundTokens, null)
  assert.equal(none.preview.retainedTokens, undefined)
})

test('unknown model capacity and incompatible effective retention remain unavailable', () => {
  const unknown = fixture({}, undefined, null)
  assert.equal(unknown.budget.contextWindow, null)
  assert.equal(unknown.budget.thresholdTokens, null)
  assert.equal(unknown.preview.afterUpperBoundTokens, null)
  const invalid = fixture({ headroomTokens: 750, retainTokens: 160 })
  assert.equal(invalid.budget.thresholdTokens, null)
  assert.equal(invalid.preview.rangeStart, null)
  assert.match(invalid.diagnostics.join(' '), /must be less than threshold tokens/)
})
