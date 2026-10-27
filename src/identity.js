/**
 * Cordis service identity helpers.
 *
 * Cordis wraps registered services in proxies. The retained-composition lookup
 * (`agentPresets.serviceFor`) returns the raw implementation value, so comparing
 * it to a service accessor with `!==` can wrongly report "another provider".
 * `symbols.original` unwraps the proxy to the implementation for identity
 * comparison only; callers still use the proxy for normal calls.
 */

import { symbols } from '@deepseek-ai/cordis'

/**
 * Read the underlying implementation of a possibly proxied service.
 * @param {unknown} value - service proxy, raw implementation, or undefined.
 * @returns {unknown} the comparable implementation identity.
 */
export function serviceIdentity(value) {
  return value?.[symbols.original] ?? value
}

/**
 * Whether a service value is this package's enhanced compaction engine.
 * @param {unknown} value - service value to inspect.
 * @returns {boolean} true for a `BetterCompactEngine` implementation.
 */
export function isBetterCompactEngine(value) {
  const implementation = serviceIdentity(value)
  return implementation?.constructor?.betterCompactEngine === true
}
