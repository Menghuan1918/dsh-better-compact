import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  GOAL_SECTIONS,
  HANDOFF_SECTIONS,
  HANDOFF_TITLE,
  assertSummaryStructure,
  buildInstruction,
  composeHandoffDocument,
  continuationText,
  detectSummaryMode,
  goalInstruction,
  handoffInstruction,
  redactSecrets,
  renderStateBlock,
} from '../src/prompts.js'

const validGoal = ['# Goal checkpoint', ...GOAL_SECTIONS.map((heading) => `${heading}\n- fact`)].join('\n')
const validHandoff = [HANDOFF_TITLE, ...HANDOFF_SECTIONS.map((heading) => `${heading}\n- fact`)].join('\n')

test('goal and handoff instructions contain the exact required structure', () => {
  const goal = goalInstruction()
  for (const heading of GOAL_SECTIONS) assert.ok(goal.includes(heading), heading)
  const handoff = handoffInstruction()
  for (const heading of HANDOFF_SECTIONS) assert.ok(handoff.includes(heading), heading)
  assert.ok(handoff.includes(HANDOFF_TITLE))
  assert.ok(handoff.includes('must not invoke them without authorization'))
  assert.ok(goal.includes('Never mark incomplete work complete'))
})

test('renderStateBlock includes authoritative goal, todos, questions, jobs and children', () => {
  const block = renderStateBlock(
    {
      goal: {
        objective: 'Ship S2',
        phase: 'active',
        roundsStarted: 2,
        maxGoalRounds: 8,
        blockedReason: undefined,
      },
      todos: [
        { content: 'Write tests', status: 'completed' },
        { content: 'Run smoke', status: 'in_progress' },
      ],
      questions: [
        { callId: 'call-1', state: 'continued', questions: [{ id: 'q1', question: 'Which provider?' }] },
      ],
      jobs: [{ id: 'bash-1', kind: 'bash', label: 'npm test', status: 'running' }],
      children: [{ id: 'child-1', depth: 1, label: 'child preset better-compact' }],
    },
    'goal',
  )
  assert.match(block.text, /phase active, rounds 2\/8/)
  assert.match(block.text, /Ship S2/)
  assert.match(block.text, /\[completed\] Write tests/)
  assert.match(block.text, /\[in_progress\] Run smoke/)
  assert.match(block.text, /callId call-1 \(continued\): Which provider\?/)
  assert.match(block.text, /bash-1 \(bash, running\): npm test/)
  assert.match(block.text, /child-1 \(depth 1\)/)
  assert.equal(block.trimmed, false)
})

test('renderStateBlock warns about paused goals and missing goal state', () => {
  const paused = renderStateBlock(
    { goal: { objective: 'Paused objective', phase: 'paused', roundsStarted: 1, maxGoalRounds: 2 } },
    'goal',
  )
  assert.match(paused.text, /Do not resume it, re-arm it, or claim completion/)
  const none = renderStateBlock({ goal: null }, 'goal')
  assert.match(none.text, /No authoritative goal is set/)
  const unavailable = renderStateBlock({ goal: null, goalError: 'not live' }, 'goal')
  assert.match(unavailable.text, /Goal state unavailable: not live/)
})

test('renderStateBlock caps pathological lists and reports omission', () => {
  const todos = Array.from({ length: 45 }, (_, index) => ({ content: `todo ${index}`, status: 'pending' }))
  const block = renderStateBlock({ goal: null, todos }, 'goal')
  assert.equal(block.trimmed, true)
  assert.deepEqual(block.omitted, ['5 additional todos'])
  assert.match(block.text, /\(5 more todos omitted\)/)
})

test('buildInstruction appends authoritative state at the end and notes omissions', () => {
  const state = renderStateBlock({ goal: null, todos: [{ content: 'x', status: 'pending' }] }, 'goal')
  const full = buildInstruction('goal', state)
  assert.ok(full.startsWith(goalInstruction()))
  assert.ok(full.indexOf('## Authoritative state at compaction time') > full.indexOf('## Next Actions'))
  assert.match(full, /\[pending\] x/)
  const omitted = buildInstruction('goal', state, { stateOmitted: true })
  assert.match(omitted, /Authoritative state was omitted because the summary request does not fit/)
})

test('assertSummaryStructure is fail-closed but does not invent facts', () => {
  assert.doesNotThrow(() => assertSummaryStructure(validGoal, 'goal'))
  assert.doesNotThrow(() => assertSummaryStructure(validHandoff, 'handoff'))
  assert.throws(() => assertSummaryStructure('', 'goal'), /empty/)
  assert.throws(() => assertSummaryStructure('# only a title', 'goal'), /missing required sections/)
  assert.throws(
    () => assertSummaryStructure(validHandoff.replace(HANDOFF_TITLE, '# Something else'), 'handoff'),
    /missing required sections|must start with/,
  )
})

test('detectSummaryMode proves only known structures', () => {
  assert.equal(detectSummaryMode(validGoal), 'goal')
  assert.equal(detectSummaryMode(validHandoff), 'handoff')
  assert.equal(
    detectSummaryMode('## Primary Request and Intent\nx\n## Critical Context\ny'),
    'native',
  )
  assert.equal(detectSummaryMode('some old summary without headings'), null)
  assert.equal(detectSummaryMode(undefined), null)
})

test('redactSecrets removes recognizable credentials and leaves normal text', () => {
  const raw = [
    'key sk-abcdefghijklmnopqrstuvwx and token ghp_abcdefghijklmnopqrstuvwxyz0123',
    'aws AKIAABCDEFGHIJKLMNOP',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz.1234',
    'password="hunter2hunter2"',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----',
    'normal text: file /tmp/x and error ENOENT',
  ].join('\n')
  const redacted = redactSecrets(raw)
  assert.equal(redacted.includes('sk-abcdefghijklmnopqrstuvwx'), false)
  assert.equal(redacted.includes('ghp_abcdefghijklmnopqrstuvwxyz0123'), false)
  assert.equal(redacted.includes('AKIAABCDEFGHIJKLMNOP'), false)
  assert.equal(redacted.includes('abcdefghijklmnopqrstuvwxyz.1234'), false)
  assert.equal(redacted.includes('hunter2hunter2'), false)
  assert.equal(redacted.includes('MIIE...'), false)
  assert.match(redacted, /\[REDACTED PRIVATE KEY\]/)
  assert.match(redacted, /normal text: file \/tmp\/x and error ENOENT/)
})

test('composeHandoffDocument carries the real path and a single title', () => {
  const document = composeHandoffDocument({
    body: `${HANDOFF_TITLE}\n\n## Current State\n- x`,
    path: '/tmp/dsh-better-compact-abc/session.md',
    createdAt: '2026-10-28T00:00:00.000Z',
    sessionId: 'session-1',
  })
  assert.equal(document.startsWith(`${HANDOFF_TITLE}\n`), true)
  assert.equal(document.match(/# Session Handoff/g).length, 1)
  assert.match(document, /Handoff file: \/tmp\/dsh-better-compact-abc\/session\.md/)
  assert.match(document, /Session: session-1/)
  assert.match(document, /self-contained|convenience copy/)
  assert.match(document, /## Current State/)
})

test('continuationText is an ordinary same-session instruction', () => {
  const text = continuationText({ shadowedSeqs: [1, 2, 3] }, '/tmp/handoff.md')
  assert.match(text, /Continue the same task in this session/)
  assert.match(text, /\/tmp\/handoff\.md/)
  assert.match(text, /Do not create or switch sessions/)
  assert.match(text, /3 history items/)
})
