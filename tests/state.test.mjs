import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  collectAuthoritativeState,
  handoffContinuationBlockers,
  readRunningChildren,
  readRunningJobs,
} from '../src/state.js'

function fakeCtx(services) {
  return {
    get: (name) => services[name],
  }
}

function fakeAgent({ id = 'agent-1', status = 'idle', parentSession, preset } = {}) {
  return {
    id,
    status,
    options: {},
    inbox: { nextTurn: [], nextStep: [] },
    session: { id, header: { ...(parentSession === undefined ? {} : { parentSession }), ...(preset === undefined ? {} : { agentPreset: preset }) } },
  }
}

test('collectAuthoritativeState reads goal, todos, questions, jobs and children without writes', () => {
  const agent = fakeAgent()
  const writes = []
  const ctx = fakeCtx({
    goals: {
      get: (target) => {
        assert.equal(target, agent)
        return {
          id: 'goal-1',
          revision: 2,
          objective: 'Ship S2',
          phase: 'active',
          roundsStarted: 1,
          maxGoalRounds: 5,
        }
      },
    },
    sessionProjections: {
      stateOf: (session, key) => {
        assert.equal(session, agent.session)
        if (key === 'todos') return [{ content: 'tests', status: 'in_progress' }]
        if (key === 'userQuestions') {
          return { questions: { active: [{ callId: 'c1', state: 'continued', questions: [{ id: 'q', question: 'ok?' }] }] } }
        }
        return undefined
      },
    },
    jobs: {
      list: () => [
        { id: 'job-1', kind: 'bash', label: 'npm test', owner: 'agent-1', status: 'running' },
        { id: 'job-2', kind: 'bash', label: 'done', owner: 'agent-1', status: 'completed' },
        { id: 'job-3', kind: 'bash', label: 'other', owner: 'agent-2', status: 'running' },
        { id: 'job-4', kind: 'bash', label: 'unowned', status: 'running' },
      ],
    },
    agents: { list: () => [agent] },
  })
  const state = collectAuthoritativeState(ctx, agent)
  assert.equal(state.goal.objective, 'Ship S2')
  assert.deepEqual(state.todos, [{ content: 'tests', status: 'in_progress' }])
  assert.equal(state.questions[0].callId, 'c1')
  assert.deepEqual(state.jobs.map((job) => job.id), ['job-1'])
  assert.deepEqual(state.children, [])
  assert.deepEqual(writes, [])
})

test('collectAuthoritativeState degrades to empty/unknown without optional services', () => {
  const agent = fakeAgent()
  const state = collectAuthoritativeState(fakeCtx({}), agent)
  assert.deepEqual(state, { goal: null, todos: [], questions: [], jobs: [], children: [] })
  const broken = collectAuthoritativeState(
    fakeCtx({
      goals: {
        get: () => {
          throw new Error('GOAL_AGENT_NOT_LIVE')
        },
      },
    }),
    agent,
  )
  assert.equal(broken.goal, null)
  assert.match(broken.goalError, /GOAL_AGENT_NOT_LIVE/)
})

test('readRunningChildren follows parentSession lineage and running status', () => {
  const root = fakeAgent({ id: 'root' })
  const child = fakeAgent({ id: 'child', status: 'running', parentSession: 'root' })
  const grandchild = fakeAgent({ id: 'grandchild', status: 'running', parentSession: 'child', preset: 'eng' })
  const idleChild = fakeAgent({ id: 'idle-child', parentSession: 'root' })
  const stranger = fakeAgent({ id: 'stranger', status: 'running', parentSession: 'elsewhere' })
  const ctx = fakeCtx({ agents: { list: () => [root, child, grandchild, idleChild, stranger] } })
  const running = readRunningChildren(ctx, root)
  assert.deepEqual(running.map((entry) => [entry.id, entry.depth]), [
    ['child', 1],
    ['grandchild', 2],
  ])
  assert.match(running[1].label, /eng/)
})

test('readRunningJobs filters by owner and live status', () => {
  const agent = fakeAgent({ id: 'owner' })
  const ctx = fakeCtx({
    jobs: {
      list: () => [
        { id: 'a', owner: 'owner', status: 'running', kind: 'bash', label: 'a' },
        { id: 'b', owner: 'owner', status: 'stopping', kind: 'bash', label: 'b' },
        { id: 'c', owner: 'owner', status: 'failed', kind: 'bash', label: 'c' },
        { id: 'd', owner: 'other', status: 'running', kind: 'bash', label: 'd' },
        { id: 'e', status: 'running', kind: 'bash', label: 'e' },
      ],
    },
  })
  assert.deepEqual(readRunningJobs(ctx, agent).map((job) => job.id), ['a', 'b'])
})

test('handoffContinuationBlockers allows an idle, quiet agent', () => {
  const agent = fakeAgent()
  const ctx = fakeCtx({ agents: { list: () => [agent] } })
  assert.deepEqual(handoffContinuationBlockers(ctx, agent).blockers, [])
})

test('handoffContinuationBlockers refuses every documented unsafe state', () => {
  const base = fakeAgent()
  const cases = [
    {
      name: 'running',
      agent: { ...base, status: 'running' },
      services: { agents: { list: () => [] } },
      expected: /not idle/,
    },
    {
      name: 'queued input',
      agent: { ...base, inbox: { nextTurn: [{}], nextStep: [] } },
      services: { agents: { list: () => [] } },
      expected: /queued input/,
    },
    {
      name: 'paused goal',
      agent: base,
      services: {
        agents: { list: () => [] },
        goals: {
          get: () => ({ objective: 'x', phase: 'paused', roundsStarted: 1, maxGoalRounds: 2 }),
        },
      },
      expected: /goal is paused/,
    },
    {
      name: 'pending question',
      agent: base,
      services: {
        agents: { list: () => [] },
        sessionProjections: {
          stateOf: (_, key) =>
            key === 'userQuestions'
              ? { questions: { active: [{ callId: 'c', state: 'open', questions: [] }] } }
              : undefined,
        },
      },
      expected: /question is still pending/,
    },
    {
      name: 'running job',
      agent: base,
      services: {
        agents: { list: () => [] },
        jobs: { list: () => [{ id: 'j', owner: base.id, status: 'running', kind: 'bash', label: 'x' }] },
      },
      expected: /background job/,
    },
    {
      name: 'running child',
      agent: base,
      services: {
        agents: {
          list: () => [base, fakeAgent({ id: 'child', status: 'running', parentSession: base.id })],
        },
      },
      expected: /child agent is still running/,
    },
  ]
  for (const item of cases) {
    const ctx = fakeCtx(item.services)
    assert.match(handoffContinuationBlockers(ctx, item.agent).blockers.join('; '), item.expected, item.name)
  }
})
