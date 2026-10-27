/**
 * Process-local observations about in-flight compaction attempts.
 *
 * The native session log is the durable authority for completed, failed, and
 * orphaned brackets. Two facts cannot be recovered from the log after the
 * fact: whether an unmatched `compaction/start` still belongs to a live
 * in-memory attempt, and whether a replacement that did append failed its
 * durability checkpoint. The engine reports those facts here for the inspect
 * route; the map is deliberately process-local and has no durability claim.
 *
 * The map lives at module scope in one package copy. The host companion and
 * the engine import the same module, so they share it; a duplicated package
 * (for example a second explicit bundle source) has its own map, which only
 * loses these two optimistic facts, never correctness of the persisted log.
 */

/** @type {Map<string, {compactionId: string, startedAt: number}>} */
const activeSummaries = new Map()
/** @type {Map<string, {compactionId: string | null, status: string, message: string}>} */
const lastFailures = new Map()

/** Find the latest unmatched `compaction/start` in a session log. */
export function findOpenCompaction(session) {
  if (session === undefined) return undefined
  for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
    const event = session.eventAt(seq)
    if (event === undefined) continue
    if (event.type === 'compaction/start') return event
    if (event.type === 'compaction/end') return undefined
  }
  return undefined
}

/** Find the compaction id of the newest bracket in a session log. */
export function findLatestCompactionId(session) {
  if (session === undefined) return null
  for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
    const event = session.eventAt(seq)
    if (event === undefined) continue
    if (event.type === 'compaction/start' || event.type === 'compaction/end') {
      return event.data.compactionId ?? null
    }
  }
  return null
}

/**
 * Mark the beginning of one summarization attempt. Called from the engine's
 * summary hook, which runs while the native `compaction/start` bracket is open.
 */
export function markSummaryStart(session, mode) {
  const open = findOpenCompaction(session)
  if (open === undefined) return
  activeSummaries.set(session.id, {
    compactionId: open.data.compactionId,
    startedAt: Date.now(),
    mode,
  })
}

/** Mark the end of one summarization attempt (success or failure). */
export function markSummaryEnd(sessionId) {
  activeSummaries.delete(sessionId)
}

/** Whether a live in-memory summarization attempt owns this compaction id. */
export function isSummaryActive(sessionId, compactionId) {
  return activeSummaries.get(sessionId)?.compactionId === compactionId
}

/** Mode of the live attempt, when one is active (used for diagnostics only). */
export function activeSummaryMode(sessionId) {
  return activeSummaries.get(sessionId)?.mode ?? null
}

/** Record one classified manual/automatic failure for inspect. */
export function recordCompactionFailure(session, status, message, compactionId) {
  if (session === undefined) return
  const id = compactionId ?? findLatestCompactionId(session)
  lastFailures.set(session.id, {
    compactionId: id,
    status,
    message: typeof message === 'string' ? message : String(message),
  })
}

/** Read the last process-observed failure for one session. */
export function lastCompactionFailure(sessionId) {
  return lastFailures.get(sessionId)
}

/** Test-only reset; keeps unit tests independent. */
export function resetLiveRegistry() {
  activeSummaries.clear()
  lastFailures.clear()
}
