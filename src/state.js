/**
 * Read-only live-state collection shared by enhanced summaries and the
 * handoff continuation guard.
 *
 * Everything here is optional and failure-tolerant: a composition without the
 * native goal service, the todo projection, the job registry, or session
 * projections still compacts normally. The plugin never mutates goals, todos,
 * questions, jobs, or child agents.
 */

/** Read the goal with its exact live-agent identity, or a diagnostic. */
function readGoal(ctx, agent) {
  try {
    const goals = ctx.get('goals')
    if (goals === undefined) return { goal: null }
    const goal = goals.get(agent)
    if (goal === undefined) return { goal: null }
    return {
      goal: {
        id: goal.id,
        revision: goal.revision,
        objective: goal.objective,
        phase: goal.phase,
        roundsStarted: goal.roundsStarted,
        maxGoalRounds: goal.maxGoalRounds,
        ...(goal.blockedReason === undefined ? {} : { blockedReason: goal.blockedReason }),
      },
    }
  } catch (error) {
    return {
      goal: null,
      goalError: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Read the native todo projection from the owning session. */
function readTodos(ctx, agent) {
  try {
    const projections = ctx.get('sessionProjections')
    if (projections === undefined) return []
    const todos = projections.stateOf(agent.session, 'todos')
    return Array.isArray(todos) ? todos.map((todo) => ({ content: todo.content, status: todo.status })) : []
  } catch {
    return []
  }
}

/** Read pending user questions (all still-answerable entries, read-only). */
function readQuestions(ctx, agent) {
  try {
    const projections = ctx.get('sessionProjections')
    if (projections === undefined) return []
    const state = projections.stateOf(agent.session, 'userQuestions')
    const active = state?.questions?.active
    if (!Array.isArray(active)) return []
    return active.map((question) => ({
      callId: question.callId,
      state: question.state,
      questions: (Array.isArray(question.questions) ? question.questions : []).map((item) => ({
        id: item.id,
        question: item.question,
        ...(item.header === undefined ? {} : { header: item.header }),
      })),
    }))
  } catch {
    return []
  }
}

/** Read jobs owned by this exact session that are still running. */
export function readRunningJobs(ctx, agent) {
  try {
    const jobs = ctx.get('jobs')
    if (jobs === undefined) return []
    return jobs
      .list(agent.id)
      .filter(
        (job) =>
          job.owner === agent.id && (job.status === 'running' || job.status === 'stopping'),
      )
      .map((job) => ({ id: job.id, kind: job.kind, label: job.label, status: job.status }))
  } catch {
    return []
  }
}

/** Read live child agents of this agent that are currently running a turn. */
export function readRunningChildren(ctx, agent) {
  try {
    const agents = ctx.get('agents')
    if (agents === undefined) return []
    const all = agents.list()
    const byId = new Map(all.map((candidate) => [candidate.id, candidate]))
    const running = []
    for (const candidate of all) {
      if (candidate.id === agent.id || candidate.status !== 'running') continue
      let cursor = candidate
      let depth = 0
      let matched = false
      const seen = new Set()
      while (cursor !== undefined && depth < 64) {
        const parentId = cursor.session?.header?.parentSession
        if (parentId === undefined) break
        depth += 1
        if (parentId === agent.id) {
          matched = true
          break
        }
        if (seen.has(parentId)) break
        seen.add(parentId)
        cursor = byId.get(parentId)
      }
      if (matched) {
        running.push({
          id: candidate.id,
          depth,
          ...(candidate.session?.header?.agentPreset === undefined
            ? {}
            : { label: `child preset ${candidate.session.header.agentPreset}` }),
        })
      }
    }
    return running
  } catch {
    return []
  }
}

/**
 * Collect the authoritative state injected into an enhanced summary.
 * @param {object} ctx - engine context.
 * @param {object} agent - target live agent.
 * @returns {{goal: object|null, goalError?: string, todos: object[], questions: object[], jobs: object[], children: object[]}} state.
 */
export function collectAuthoritativeState(ctx, agent) {
  const { goal, goalError } = readGoal(ctx, agent)
  return {
    goal,
    ...(goalError === undefined ? {} : { goalError }),
    todos: readTodos(ctx, agent),
    questions: readQuestions(ctx, agent),
    jobs: readRunningJobs(ctx, agent),
    children: readRunningChildren(ctx, agent),
  }
}

/**
 * Reasons the handoff mode must NOT schedule an automatic continuation.
 * An empty array means continuing is allowed by the read-only state.
 *
 * @param {object} ctx - engine context.
 * @param {object} agent - target live agent.
 * @returns {{blockers: string[], state: object}} blockers plus collected state.
 */
export function handoffContinuationBlockers(ctx, agent) {
  const state = collectAuthoritativeState(ctx, agent)
  const blockers = []
  if (agent.status !== 'idle') blockers.push(`agent status is ${String(agent.status)}, not idle`)
  const inbox = agent.inbox
  if (inbox !== undefined && (inbox.nextTurn.length > 0 || inbox.nextStep.length > 0)) {
    blockers.push('the agent has queued input; that input owns the next turn')
  }
  if (state.goal !== null && (state.goal.phase === 'paused' || state.goal.phase === 'blocked')) {
    blockers.push(`the goal is ${state.goal.phase}; a handoff continuation must not resume it`)
  }
  if (state.questions.length > 0) blockers.push('a user question is still pending')
  if (state.jobs.length > 0) blockers.push('a background job owned by this session is still running')
  if (state.children.length > 0) blockers.push('a child agent is still running')
  return { blockers, state }
}
