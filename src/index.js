/**
 * dsh-better-compact — HOST COMPANION row.
 *
 * This row owns no compaction service. It provides:
 *   1. the volatile configuration schema (`Config`, re-exported for the
 *      Loader) and the `betterCompactConfig` service with both the live value
 *      (`current()`) and the frozen load-time snapshot (`snapshot()`) that the
 *      engine actually holds;
 *   2. the read-only GET `/better-compact/api/inspect` route on the Host
 *      webserver, behind the Host connection trust fence when that service is
 *      present; and
 *   3. the browser module package entry (`./client`), mounted by the client
 *      module loader from `dsh.client` in package.json.
 *
 * The engine row (`dsh-better-compact/engine`) reads the snapshot through this
 * service. It never re-registers compaction, goal, session, or history state.
 */

import { Config, ENTRY_ID, PACKAGE_NAME, ROW_CONFIG_KEYS, deepFreeze, readConfig } from './config.js'
import { INSPECT_PATH, InspectError, inspectPlugin } from './inspect.js'

export { Config } from './config.js'
export {
  APOLLO_LEGACY_ROW_CONFIG_KEY,
  APOLLO_ROW_CONFIG_KEY,
  ENGINE_ENTRY_ID,
  MODES,
  ROW_CONFIG_KEY,
  ROW_CONFIG_KEYS,
} from './config.js'

/** Cordis function-plugin name (also the client module identity). */
export const name = PACKAGE_NAME

/** Maximum accepted `sessionId` query value length. */
const MAX_SESSION_ID_LENGTH = 256

/** JSON response; live facts are never cacheable. */
function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** Method-not-allowed response for the read-only route. */
function sendMethodNotAllowed(res, allow) {
  res.statusCode = 405
  res.setHeader('allow', allow)
  res.setHeader('cache-control', 'no-store')
  res.end()
}

/** Bad-query response. */
function sendBadQuery(res, message) {
  sendJson(res, 400, { code: 'INVALID_QUERY', message })
}

/**
 * Parse the optional `sessionId` query.
 * @returns {{sessionId: string | null} | {error: string}} parsed query.
 */
function parseQuery(req) {
  let url
  try {
    url = new URL(String(req.url ?? '/'), 'http://localhost')
  } catch {
    return { error: 'the request URL could not be parsed' }
  }
  const params = url.searchParams
  for (const key of params.keys()) {
    if (key !== 'sessionId') return { error: `unknown query parameter "${key}"; only "sessionId" is accepted` }
  }
  const values = params.getAll('sessionId')
  if (values.length > 1) return { error: 'sessionId may be supplied at most once' }
  if (values.length === 0) return { sessionId: null }
  const sessionId = values[0]
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    return { error: 'sessionId must be a non-empty string' }
  }
  if (sessionId.length > MAX_SESSION_ID_LENGTH) {
    return { error: `sessionId is longer than the ${MAX_SESSION_ID_LENGTH}-character limit` }
  }
  return { sessionId }
}

/**
 * One inspect request. Read-only: no LLM generation, compaction, CLI, goal
 * change, or file write is performed here or in `inspectPlugin`.
 *
 * Exported as a test seam for the Host-fence (401/403) and wire-validation
 * branches; production only reaches it through the registered GET route.
 */
export async function handleInspect(ctx, companion, req, res) {
  // Host trust fence. It is the composition's authenticated/trusted Web
  // boundary (Host/Origin fence + browser authentication); this plugin adds no
  // write API, cross-origin allowance, or trust switch of its own.
  const connection = (() => {
    try {
      return ctx.get('connection')
    } catch {
      return undefined
    }
  })()
  if (typeof connection?.requestRejection !== 'function') {
    // Fail closed. The route is only registered when the Host connection fence
    // exists, and a service that disappears later must not expose unauthenticated
    // session reads.
    sendJson(res, 503, {
      code: 'INSPECT_UNAVAILABLE',
      message: 'the host connection trust fence is unavailable; the inspect route is disabled',
    })
    return
  }
  let rejection
  try {
    rejection = connection.requestRejection(req)
  } catch (error) {
    sendJson(res, 503, {
      code: 'CONNECTION_FENCE_UNAVAILABLE',
      message: `the host connection fence failed: ${error instanceof Error ? error.message : String(error)}`,
    })
    return
  }
  if (rejection !== undefined) {
    res.statusCode = rejection
    res.setHeader('cache-control', 'no-store')
    res.end()
    return
  }
  if (req.method !== 'GET') {
    sendMethodNotAllowed(res, 'GET')
    return
  }
  const query = parseQuery(req)
  if ('error' in query) {
    sendBadQuery(res, query.error)
    return
  }
  try {
    const payload = await inspectPlugin(ctx, companion, query.sessionId)
    sendJson(res, 200, payload)
  } catch (error) {
    if (error instanceof InspectError) {
      sendJson(res, error.status, { code: error.code, message: error.message })
      return
    }
    sendJson(res, 500, {
      code: 'INSPECT_FAILED',
      message: `inspection failed: ${error instanceof Error ? error.message : String(error)}`,
    })
  }
}

/**
 * Mount the companion row.
 * @param {object} ctx - host context.
 * @param {object} [config] - live volatile row configuration.
 * @throws when the configuration is invalid; the Loader reports the failed row.
 */
export function apply(ctx, config = {}) {
  // Validate at load and freeze the exact snapshot the engine will use. A
  // later settings save updates the volatile references (current()), not this
  // snapshot: the running engine keeps one coherent configuration and the
  // inspect route reports `requiresReload`.
  const snapshot = deepFreeze(readConfig(config))
  const companion = Object.freeze({
    snapshot: () => snapshot,
    current: () => readConfig(config),
    rowId: ENTRY_ID,
    packageName: PACKAGE_NAME,
  })
  ctx.provide('betterCompactConfig', companion)

  // The full S3 visual page owns its settings form; suppress the generic
  // auto-generated page for this row (the volatile fields still drive the
  // native settings ledger and CAS revisions).
  ctx.inject(['settings'], (inner) => {
    try {
      const dispose = inner.settings.configure({ auto: false }, ctx.fiber)
      inner.effect(() => dispose, 'dsh-better-compact: settings presentation')
    } catch (error) {
      inner.logger?.warn?.(`dsh-better-compact: could not configure the settings page: ${String(error)}`)
    }
  })

  // Optional Web surface: headless compositions have no webserver and no
  // connection fence, so the inspect route is simply not registered. Waiting
  // for both services makes "no connection" fail closed instead of exposing an
  // unauthenticated read route.
  ctx.inject(['webServer', 'connection'], (inner) => {
    if (typeof inner.connection?.requestRejection !== 'function') {
      inner.logger?.warn?.('dsh-better-compact: inspect route disabled because the Host connection fence is unavailable')
      return
    }
    inner.effect(
      () =>
        inner.webServer.register({
          kind: 'exact',
          path: INSPECT_PATH,
          handler: (req, res) => handleInspect(inner, companion, req, res),
        }),
      `dsh-better-compact: GET ${INSPECT_PATH}`,
    )
  })
}

export default { name, apply, Config }
