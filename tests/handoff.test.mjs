import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  HANDOFF_DIR_PREFIX,
  HANDOFF_FILE_MODE,
  prepareHandoffFile,
  safeSessionComponent,
  writeHandoffFile,
} from '../src/handoff.js'

test('writeHandoffFile writes an owner-only file under the OS temp dir and reads it back', async () => {
  const created = []
  try {
    const written = await writeHandoffFile({
      sessionId: 'session-abc/../x',
      body: '# Handoff\n\ncontent',
      makeBody: (path) => `# Handoff\n\nactual path: ${path}\n`,
    })
    created.push(written.directory)
    assert.ok(written.path.startsWith(tmpdir()))
    assert.ok(written.path.includes(HANDOFF_DIR_PREFIX))
    const info = await stat(written.path)
    assert.equal(info.isFile(), true)
    assert.equal(info.mode & 0o777, HANDOFF_FILE_MODE)
    const readBack = await readFile(written.path, 'utf8')
    assert.equal(readBack, written.body)
    assert.match(readBack, new RegExp(`actual path: ${written.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    assert.equal(written.bytes, Buffer.byteLength(written.body, 'utf8'))
  } finally {
    for (const directory of created) await rm(directory, { recursive: true, force: true })
  }
})

test('each attempt gets its own directory and path', async () => {
  const a = await prepareHandoffFile({ sessionId: 'same' })
  const b = await prepareHandoffFile({ sessionId: 'same' })
  try {
    assert.notEqual(a.directory, b.directory)
    assert.notEqual(a.path, b.path)
    assert.equal(a.directory.startsWith(tmpdir()), true)
  } finally {
    await rm(a.directory, { recursive: true, force: true })
    await rm(b.directory, { recursive: true, force: true })
  }
})

test('an empty body and an invalid session component are handled predictably', async () => {
  await assert.rejects(() => writeHandoffFile({ sessionId: 's', body: '   ' }), /empty document/)
  assert.equal(safeSessionComponent('a/b c'), 'a_b_c')
  assert.equal(safeSessionComponent(''), 'session')
  assert.equal(safeSessionComponent('x'.repeat(200)).length, 80)
})

test('prepareHandoffFile returns an explicit timestamp usable in the document', async () => {
  const prepared = await prepareHandoffFile({
    sessionId: 's',
    createdAt: '2026-10-28T01:02:03.456Z',
    attemptId: 'attempt-1',
  })
  try {
    assert.match(prepared.path, /attempt-1\.md$/)
    assert.match(prepared.path, /2026-10-28T01-02-03-456Z/)
    assert.equal(prepared.createdAt, '2026-10-28T01:02:03.456Z')
  } finally {
    await rm(prepared.directory, { recursive: true, force: true })
  }
})
