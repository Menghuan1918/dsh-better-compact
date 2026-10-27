/**
 * Read-only model-route projection for the S3 settings page.
 *
 * The visual form needs an *allowed candidate* list for the summary
 * provider/model pair and, when the host can resolve it, the reasoning efforts
 * each route advertises. The host's optional `subagentModelSelection` service
 * already owns that allow-list (the same one the task/subagent tools use), so
 * this route reports it instead of introducing a second catalog or probing
 * providers.
 *
 * This is metadata only: no provider I/O, no CLI invocation, no model
 * enumeration, and no write path. A missing service or an unresolved model
 * capability yields the documented `{ enabled: false, routes: [] }` /
 * `{ efforts: [], defaultEffort: '' }` shape, which tells the form to keep its
 * free-text fields and mark the capability as unknown.
 */

/** Exact read-only models route pathname. */
export const MODELS_PATH = '/better-compact/api/models'

/** Whether a value is a plain object (not an array/null). */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read one optional host service without failing the route. */
function service(ctx, name) {
  try {
    return ctx.get(name)
  } catch {
    return undefined
  }
}

/**
 * Project the host's allowed model routes with their advertised efforts.
 *
 * Mirrors the small `collectTierRoutes` pattern in `dsh-better-subagent`:
 * `subagentModelSelection.current().allowedModels` is the candidate source and
 * `ctx.llm.resolveModelInfo(provider, model)` supplies the opaque effort ids.
 * A failed per-route capability lookup only empties that route's effort list;
 * it never hides the route or invents an effort.
 *
 * @param {object} ctx - host companion context.
 * @returns {Promise<{enabled: boolean, routes: Array<{provider: string, model: string, efforts: string[], defaultEffort: string}>}>}
 */
export async function collectModelRoutes(ctx) {
  let selection
  try {
    selection = service(ctx, 'subagentModelSelection')?.current?.()
  } catch {
    selection = undefined
  }
  if (!isRecord(selection) || !Array.isArray(selection.allowedModels)) {
    return { enabled: false, routes: [] }
  }

  const llm = service(ctx, 'llm')
  const seen = new Set()
  const routes = []
  for (const entry of selection.allowedModels) {
    if (
      !isRecord(entry) ||
      typeof entry.provider !== 'string' ||
      entry.provider.length === 0 ||
      typeof entry.model !== 'string' ||
      entry.model.length === 0
    ) {
      continue
    }
    const key = `${entry.provider}\u0000${entry.model}`
    if (seen.has(key)) continue
    seen.add(key)

    let efforts = []
    let defaultEffort = ''
    if (llm !== undefined && typeof llm.resolveModelInfo === 'function') {
      try {
        const info = await llm.resolveModelInfo(entry.provider, entry.model)
        const reasoning = info?.reasoning
        efforts = Array.isArray(reasoning?.efforts)
          ? reasoning.efforts
              .map((effort) => effort?.id)
              .filter((id) => typeof id === 'string' && id !== '')
          : []
        defaultEffort = efforts.includes(reasoning?.defaultEffort) ? reasoning.defaultEffort : ''
      } catch {
        // Capability metadata is optional; the route remains a valid candidate
        // and the UI shows "unknown" instead of fabricating an effort.
        efforts = []
        defaultEffort = ''
      }
    }
    routes.push({ provider: entry.provider, model: entry.model, efforts, defaultEffort })
  }
  return { enabled: selection.enabled === true, routes }
}
