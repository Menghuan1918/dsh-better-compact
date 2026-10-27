import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as React from 'react'
import TestRenderer from 'react-test-renderer'

const { createElement: h } = React
const act = TestRenderer.act ?? TestRenderer.default?.act
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const SOURCE = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')

function loadClient() {
  const registrations = []
  new Function('window', SOURCE)({
    __ModuleLoader__: { load: (entry) => registrations.push(entry) },
  })
  assert.equal(registrations.length, 1)
  const exports = new Function(
    'require',
    'return (' + registrations[0].factory.toString() + ')(require)',
  )((specifier) => {
    if (specifier === 'react') return React
    throw new Error('unexpected external require: ' + specifier)
  })
  return { entry: registrations[0], exports }
}

function makeSlots() {
  const watchers = new Map()
  const registrations = []
  return {
    registrations,
    injected: [],
    inject(name, callback) {
      this.injected.push(name)
      const set = watchers.get(name) ?? new Set()
      watchers.set(name, set)
      set.add(callback)
      return () => set.delete(callback)
    },
    register(options, component) {
      const record = { options, component }
      registrations.push(record)
      return () => {
        const at = registrations.indexOf(record)
        if (at >= 0) registrations.splice(at, 1)
      }
    },
    declare(name) {
      const disposers = []
      for (const callback of [...(watchers.get(name) ?? [])]) {
        const dispose = callback()
        if (typeof dispose === 'function') disposers.push(dispose)
      }
      watchers.set(name, new Set(disposers))
      return disposers
    },
  }
}

test('client module identity, exports and slot registration stay stable', () => {
  const { entry, exports } = loadClient()
  assert.equal(entry.id, 'dsh-better-compact')
  assert.deepEqual(exports.inject, ['slots'])
  assert.deepEqual(exports.ROW_CONFIG_KEYS, [
    'dsh-better-compact#dsh-better-compact',
    '@menghuan1918/dsh-apollo#dsh-better-compact',
    'dsh-apollo#dsh-better-compact',
  ])
  const slots = makeSlots()
  const cleanups = []
  const ctx = {
    slots,
    effect(fn, label) {
      assert.equal(typeof label, 'string')
      const dispose = fn()
      cleanups.push(dispose)
      return () => undefined
    },
  }
  exports.apply(ctx)
  assert.deepEqual(slots.injected, ['plugins.row.config'])
  const disposers = slots.declare('plugins.row.config')
  assert.equal(slots.registrations.length, 3)
  assert.deepEqual(
    slots.registrations.map((record) => record.options.key),
    exports.ROW_CONFIG_KEYS,
  )
  for (const record of slots.registrations) {
    assert.equal(record.component, exports.BetterCompactConfigEntry)
  }
  for (const dispose of disposers) dispose()
  assert.equal(slots.registrations.length, 0)
  for (const cleanup of cleanups) cleanup()
})

test('summary slot renders the stable one-line description', () => {
  const { exports } = loadClient()
  let tree
  act(() => {
    tree = TestRenderer.create(h(exports.BetterCompactConfigEntry, { view: 'summary' }))
  })
  const text = JSON.stringify(tree.toJSON())
  assert.match(text, /Native, goal-aware, or file-handoff/)
  act(() => tree.unmount())
})

test('page slot is read-only and says saving requires a profile reload', () => {
  const { exports } = loadClient()
  const value = {
    mode: 'goal',
    auto: true,
    thresholdRatio: 0.8,
    headroomTokens: 65536,
    retainRatio: 0.16,
    cachePriority: true,
  }
  let tree
  act(() => {
    tree = TestRenderer.create(
      h(exports.BetterCompactConfigEntry, {
        view: 'page',
        form: { state: { status: 'ready', writable: true, revision: 3, value } },
      }),
    )
  })
  const json = JSON.stringify(tree.toJSON())
  assert.match(json, /restart the DSH profile/)
  assert.match(json, /mode: goal/)
  assert.match(json, /headroomTokens: 65536/)
  assert.match(json, /cachePriority: true/)
  assert.equal(json.includes('"input"'), false)
  assert.equal(json.includes('"button"'), false)
  act(() => tree.unmount())

  act(() => {
    tree = TestRenderer.create(h(exports.BetterCompactConfigEntry, { view: 'page' }))
  })
  assert.match(JSON.stringify(tree.toJSON()), /Waiting for the Host configuration form/)
  act(() => tree.unmount())

  act(() => {
    tree = TestRenderer.create(
      h(exports.BetterCompactConfigEntry, {
        view: 'page',
        form: {
          state: {
            status: 'ready',
            writable: true,
            revision: 4,
            value: { mode: 'native', auto: true, reasoningEffort: 'high', cachePriority: false },
          },
        },
      }),
    )
  })
  const nativeJson = JSON.stringify(tree.toJSON())
  assert.match(nativeJson, /reasoningEffort: not applicable in native mode/)
  assert.match(nativeJson, /cachePriority: not applicable in native mode/)
  assert.doesNotMatch(nativeJson, /reasoningEffort: high/)
  act(() => tree.unmount())
})
