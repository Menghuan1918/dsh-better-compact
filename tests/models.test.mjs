import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, handleModels, INSPECT_PATH, MODELS_PATH } from '../src/index.js'
import { collectModelRoutes } from '../src/models.js'

function fakeRequest({ method = 'GET', url = MODELS_PATH } = {}) {
  return { method, url, headers: {} }
}

function fakeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(body = '') {
      this.body = body
      this.ended = true
    },
  }
}

const allowFence = { requestRejection: () => undefined }

function ctxWith({ selection, llm, connection } = {}) {
  const calls = { current: 0, resolveModelInfo: [] }
  return {
    calls,
    ctx: {
      get(name) {
        if (name === 'subagentModelSelection') {
          if (selection === undefined) return undefined
          return {
            current: () => {
              calls.current += 1
              return typeof selection === 'function' ? selection() : selection
            },
          }
        }
        if (name === 'llm') return llm
        if (name === 'connection') return connection
        return undefined
      },
    },
  }
}

test('models route is disabled without the host allowed-model service', async () => {
  const { ctx } = ctxWith()
  assert.deepEqual(await collectModelRoutes(ctx), { enabled: false, routes: [] })

  const broken = ctxWith({
    selection: () => {
      throw new Error('selection unavailable')
    },
  })
  assert.deepEqual(await collectModelRoutes(broken.ctx), { enabled: false, routes: [] })

  for (const malformed of [null, {}, { allowedModels: 'nope' }, { enabled: true }]) {
    const { ctx: malformedCtx } = ctxWith({ selection: malformed })
    assert.deepEqual(await collectModelRoutes(malformedCtx), { enabled: false, routes: [] })
  }
})

test('models route enriches allowed candidates with advertised efforts only', async () => {
  const selection = {
    enabled: true,
    allowedModels: [
      { provider: 'prov', model: 'good' },
      { provider: 'prov', model: 'no-metadata' },
      { provider: 'prov', model: 'good' },
      { provider: '', model: 'invalid' },
      'not-an-object',
    ],
  }
  const { ctx } = ctxWith({
    selection,
    llm: {
      resolveModelInfo: async (provider, model) => {
        if (model === 'no-metadata') throw new Error('no adapter model info')
        return {
          provider,
          id: model,
          reasoning: {
            efforts: [{ id: 'low' }, { id: 'high' }, { id: '' }, {}],
            defaultEffort: 'high',
          },
        }
      },
    },
  })
  assert.deepEqual(await collectModelRoutes(ctx), {
    enabled: true,
    routes: [
      { provider: 'prov', model: 'good', efforts: ['low', 'high'], defaultEffort: 'high' },
      { provider: 'prov', model: 'no-metadata', efforts: [], defaultEffort: '' },
    ],
  })
})

test('models route keeps candidates when capability metadata or the llm service is absent', async () => {
  const { ctx } = ctxWith({
    selection: { enabled: false, allowedModels: [{ provider: 'p', model: 'm' }] },
    llm: {
      resolveModelInfo: async () => ({
        reasoning: { efforts: [{ id: 'medium' }], defaultEffort: 'not-advertised' },
      }),
    },
  })
  assert.deepEqual(await collectModelRoutes(ctx), {
    enabled: false,
    routes: [{ provider: 'p', model: 'm', efforts: ['medium'], defaultEffort: '' }],
  })

  const noLlm = ctxWith({
    selection: { enabled: true, allowedModels: [{ provider: 'p', model: 'm' }] },
  })
  assert.deepEqual(await collectModelRoutes(noLlm.ctx), {
    enabled: true,
    routes: [{ provider: 'p', model: 'm', efforts: [], defaultEffort: '' }],
  })
})

test('models handler returns read-only JSON with no-store and ignores the query', async () => {
  const { ctx } = ctxWith({
    selection: { enabled: true, allowedModels: [{ provider: 'p', model: 'm' }] },
    llm: { resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'low' }], defaultEffort: 'low' } }) },
    connection: allowFence,
  })
  const res = fakeResponse()
  await handleModels(ctx, fakeRequest({ url: `${MODELS_PATH}?ignored=1` }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.match(res.headers['content-type'], /application\/json/)
  assert.deepEqual(JSON.parse(res.body), {
    enabled: true,
    routes: [{ provider: 'p', model: 'm', efforts: ['low'], defaultEffort: 'low' }],
  })
})

test('models handler applies the host fence before any model work and is GET-only', async () => {
  for (const status of [401, 403]) {
    const { ctx, calls } = ctxWith({
      selection: { enabled: true, allowedModels: [{ provider: 'p', model: 'm' }] },
      llm: { resolveModelInfo: async () => assert.fail('fenced request must not resolve a model') },
      connection: { requestRejection: () => status },
    })
    const res = fakeResponse()
    await handleModels(ctx, fakeRequest({ method: 'POST' }), res)
    assert.equal(res.statusCode, status)
    assert.equal(res.body, '')
    assert.equal(res.headers['cache-control'], 'no-store')
    assert.equal(res.headers['content-type'], undefined)
    assert.equal(calls.current, 0)
  }

  const method = ctxWith({
    selection: { enabled: true, allowedModels: [] },
    connection: allowFence,
  })
  const res = fakeResponse()
  await handleModels(method.ctx, fakeRequest({ method: 'POST' }), res)
  assert.equal(res.statusCode, 405)
  assert.equal(res.headers.allow, 'GET')
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.equal(method.calls.current, 0)
})

test('models handler fails closed when the connection fence disappears or throws', async () => {
  const missing = ctxWith({
    selection: { enabled: true, allowedModels: [{ provider: 'p', model: 'm' }] },
  })
  const res = fakeResponse()
  await handleModels(missing.ctx, fakeRequest(), res)
  assert.equal(res.statusCode, 503)
  assert.match(res.body, /MODELS_UNAVAILABLE/)
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.equal(missing.calls.current, 0)

  const throwing = ctxWith({
    connection: {
      requestRejection: () => {
        throw new Error('fence exploded')
      },
    },
  })
  const thrown = fakeResponse()
  await handleModels(throwing.ctx, fakeRequest(), thrown)
  assert.equal(thrown.statusCode, 503)
  assert.match(thrown.body, /CONNECTION_FENCE_UNAVAILABLE/)
})

test('apply registers both read-only routes only when webserver and fence exist', () => {
  const registered = []
  const warnings = []
  const makeCtx = (connection) => ({
    provide: () => undefined,
    inject(names, callback) {
      if (names.includes('webServer')) {
        callback({
          webServer: {
            register: (route) => {
              registered.push(route)
              return () => undefined
            },
          },
          connection,
          logger: { warn: (message) => warnings.push(message) },
          effect: (fn) => {
            fn()
          },
        })
      }
    },
    effect: (fn) => {
      fn()
    },
    logger: { warn: (message) => warnings.push(message) },
    fiber: {},
  })

  apply(makeCtx(undefined), {})
  assert.deepEqual(registered, [])
  assert.ok(warnings.some((message) => /read-only API routes disabled/.test(message)))

  apply(makeCtx(allowFence), {})
  assert.deepEqual(
    registered.map((route) => ({ kind: route.kind, path: route.path })),
    [
      { kind: 'exact', path: INSPECT_PATH },
      { kind: 'exact', path: MODELS_PATH },
    ],
  )
  assert.deepEqual(
    registered.map((route) => typeof route.handler),
    ['function', 'function'],
  )
})
