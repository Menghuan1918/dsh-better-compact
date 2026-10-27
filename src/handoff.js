/**
 * Per-attempt temporary handoff files.
 *
 * The file is written under the operating system temp directory, in a fresh
 * directory per attempt, with owner-only permissions, then read back and
 * compared byte-for-byte. A failure at any step throws, so the native
 * transaction never installs a checkpoint that points at an unverified file.
 *
 * The file is a convenience copy only: the same Markdown body is embedded in
 * the native checkpoint replacement by the engine. Deleting the file therefore
 * does not break replay, and there is deliberately no cleanup scheduler or
 * sidecar index here.
 */

import { mkdtemp, readFile, stat, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Directory prefix for every attempt. */
export const HANDOFF_DIR_PREFIX = 'dsh-better-compact-'
/** File mode: owner read/write only. */
export const HANDOFF_FILE_MODE = 0o600
/** Directory mode: owner access only. */
export const HANDOFF_DIR_MODE = 0o700

/**
 * Sanitize a session id into a path-safe, still-recognizable component.
 * @param {string} sessionId - raw session id.
 * @returns {string} path-safe id.
 */
export function safeSessionComponent(sessionId) {
  const text = String(sessionId ?? 'session').replace(/[^A-Za-z0-9._-]/g, '_')
  return text.slice(0, 80).length > 0 ? text.slice(0, 80) : 'session'
}

/**
 * Create the attempt directory and the exact target path. Exposed so the
 * engine can embed the real path in the document before the write; callers
 * that already have a body can pass it straight to {@link writeHandoffFile}.
 */
export async function prepareHandoffFile(input = {}) {
  const attemptId = input.attemptId ?? randomUUID()
  const createdAt = input.createdAt ?? new Date().toISOString()
  const directory = await mkdtemp(join(tmpdir(), HANDOFF_DIR_PREFIX))
  await chmod(directory, HANDOFF_DIR_MODE)
  const stamp = createdAt.replace(/[:.]/g, '-')
  const path = join(directory, `${safeSessionComponent(input.sessionId)}-${stamp}-${attemptId}.md`)
  return { directory, path, attemptId, createdAt }
}

/**
 * Write one handoff Markdown document, verify permissions and content by
 * reading it back, and return the exact path that can be shown to the user.
 *
 * @param {object} input - write inputs.
 * @param {string} input.sessionId - owning session identity.
 * @param {string} [input.body] - complete Markdown document.
 * @param {(path: string) => string} [input.makeBody] - body factory receiving the real path (wins over `body`).
 * @param {string} [input.attemptId] - attempt correlation id (a UUID by default).
 * @param {string} [input.createdAt] - ISO timestamp used in the file name.
 * @returns {Promise<{path: string, directory: string, bytes: number, attemptId: string, body: string}>} verified file facts.
 * @throws {Error} when the directory, write, permission, or read-back check fails.
 */
export async function writeHandoffFile(input) {
  const prepared = await prepareHandoffFile(input)
  const body = typeof input.makeBody === 'function' ? input.makeBody(prepared.path) : input.body
  if (typeof body !== 'string' || body.trim().length === 0) {
    throw new Error('handoff: refusing to write an empty document')
  }
  try {
    await writeFile(prepared.path, body, { encoding: 'utf8', mode: HANDOFF_FILE_MODE, flag: 'wx' })
    await chmod(prepared.path, HANDOFF_FILE_MODE)
    const info = await stat(prepared.path)
    if (!info.isFile()) throw new Error(`handoff file ${prepared.path} is not a regular file`)
    if ((info.mode & 0o777) !== HANDOFF_FILE_MODE) {
      throw new Error(
        `handoff file ${prepared.path} has mode ${(info.mode & 0o777).toString(8)}; expected 600 (owner-only)`,
      )
    }
    const readBack = await readFile(prepared.path, 'utf8')
    if (readBack !== body) {
      throw new Error(`handoff file ${prepared.path} did not read back identically; refusing to install the checkpoint`)
    }
    return { ...prepared, bytes: Buffer.byteLength(body, 'utf8'), body }
  } catch (error) {
    // The attempt directory is left for debugging; no global cleanup scheduler
    // is introduced, and the session checkpoint is not installed by the caller.
    throw new Error(
      `handoff: could not write and verify ${prepared.path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}
