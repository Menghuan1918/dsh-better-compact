import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import yaml from 'js-yaml'

const root = new URL('..', import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))

/** Loader patch files use DSH's `!!js` expression tag; keep it as inert data. */
const jsExprType = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  construct: (data) => ({ __jsExpr: data }),
})
const patchSchema = yaml.DEFAULT_SCHEMA.extend([jsExprType])
const loadPatch = (url) => yaml.load(readFileSync(url, 'utf8'), { schema: patchSchema })

const cordis = loadPatch(new URL('cordis.patch.yml', root))
const preset = loadPatch(new URL('presets/better-compact.patch.yml', root))

test('package metadata matches the published contract', () => {
  assert.equal(pkg.name, 'dsh-better-compact')
  assert.equal(pkg.version, '0.1.0')
  assert.equal(pkg.license, 'GPL-3.0-or-later')
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.repository.url, 'git+https://github.com/Menghuan1918/dsh-better-compact.git')
  assert.equal(pkg.engines.node, '^22.19.0 || >=24.0.0')
  assert.equal(pkg.engines.dsh, '>=0.2.1-rc.2 <0.3.0')
  assert.equal(pkg.main, 'src/index.js')
  assert.deepEqual(pkg.exports, {
    '.': './src/index.js',
    './engine': './src/engine.js',
    './client': './src/client.js',
    './package.json': './package.json',
  })
  assert.deepEqual(pkg.dsh.bundle.patch, [
    './cordis.patch.yml',
    './presets/better-compact.patch.yml',
  ])
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.deepEqual(pkg.dsh.client.inject, [
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-api-session-controller',
  ])
})

test('the published file whitelist ships source, preset, docs and licences only', () => {
  assert.deepEqual(pkg.files, [
    'src',
    'presets',
    'docs',
    'cordis.patch.yml',
    'README.md',
    'LICENSE',
    'third-party',
  ])
  for (const forbidden of ['docs/specs', 'node_modules', '.worktrees', 'scripts', 'tests']) {
    assert.equal(pkg.files.includes(forbidden), false, forbidden)
  }
  assert.equal(existsSync(new URL('LICENSE', root)), true)
  assert.equal(existsSync(new URL('third-party/NOTICE', root)), true)
  assert.equal(existsSync(new URL('third-party/LICENSE-MIT-dsh', root)), true)
})

test('standalone bundle patch disables native compaction and inserts two stable rows', () => {
  assert.deepEqual(cordis[0], { id: 'compaction-basic', disabled: true })
  assert.equal(cordis.length, 2)
  const rows = cordis[1].insert
  assert.deepEqual(rows, [
    { id: 'dsh-better-compact', name: 'dsh-better-compact' },
    { id: 'dsh-better-compact-engine', name: 'dsh-better-compact/engine' },
  ])
  // command-compact and the tool-result pruner are deliberately untouched.
  for (const row of cordis) {
    assert.notEqual(row.id, 'command-compact')
    assert.notEqual(row.id, 'tool-result-pruner')
  }
})

test('better-compact preset keeps the standard composition except its engine row', () => {
  assert.equal(preset.length, 1)
  const row = preset[0].insert[0]
  assert.equal(row.id, 'preset-better-compact')
  assert.equal(row.name, '@deepseek-ai/dsh-agent-preset')
  assert.equal(row.config.id, 'better-compact')
  assert.equal(row.config.order, 2)
  assert.equal(row.config.name, 'Better Compact')
  assert.equal(typeof row.config.description, 'string')
  assert.ok(row.config.description.length > 0)
  const groups = row.config.plugins
  const compaction = groups.find((plugin) => plugin.id === 'compaction')
  assert.ok(compaction)
  assert.deepEqual(compaction.isolate, { compaction: true, toolResultPruner: true })
  assert.deepEqual(compaction.config.map((plugin) => plugin.id), [
    'dsh-better-compact-engine',
    'command-compact',
    'tool-result-pruner',
  ])
  assert.equal(compaction.config[0].name, 'dsh-better-compact/engine')
  assert.equal(
    compaction.config.some((plugin) => plugin.name === '@deepseek-ai/dsh-compaction-basic'),
    false,
  )
  const delegation = groups.find((plugin) => plugin.id === 'delegation')
  assert.ok(delegation)
  assert.equal(delegation.config.some((plugin) => plugin.id === 'tool-subagent'), true)
})

test('the preset is a verbatim installed-standard copy with one row replaced', (t) => {
  const dshRoot = process.env.DSH_PACKAGE_ROOT
  if (!dshRoot) {
    t.skip('set DSH_PACKAGE_ROOT to compare against the installed standard preset')
    return
  }
  const standardPath = join(dirname(dshRoot), 'dsh-web-app', 'presets', 'standard.patch.yml')
  if (!existsSync(standardPath)) {
    t.skip(`installed standard preset not found at ${standardPath}`)
    return
  }
  const standard = loadPatch(standardPath)
  const expected = structuredClone(standard)
  const expectedRow = expected[0].insert[0]
  expectedRow.id = 'preset-better-compact'
  expectedRow.config.id = 'better-compact'
  expectedRow.config.order = 2
  expectedRow.config.name = 'Better Compact'
  expectedRow.config.description = preset[0].insert[0].config.description
  const expectedCompaction = expectedRow.config.plugins.find((plugin) => plugin.id === 'compaction')
  const engineRow = expectedCompaction.config.find((plugin) => plugin.id === 'compaction-basic')
  engineRow.id = 'dsh-better-compact-engine'
  engineRow.name = 'dsh-better-compact/engine'
  delete engineRow.config
  assert.deepEqual(preset, expected)
})

test('release workflow uses OIDC trusted publishing with no token', () => {
  const workflow = readFileSync(new URL('.github/workflows/release.yml', root), 'utf8')
  assert.match(workflow, /release:\s*\n\s*types: \[published\]/)
  assert.match(workflow, /id-token: write/)
  assert.match(workflow, /npm publish --provenance --access public/)
  assert.match(workflow, /v\$\{version\}.*GITHUB_REF_NAME/s)
  assert.equal(workflow.includes('NPM_TOKEN'), false)
  assert.equal(workflow.includes('NODE_AUTH_TOKEN'), false)
})

test('tracked files contain no design specs or temp artifacts', () => {
  const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: new URL('.', root),
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
  assert.ok(tracked.length > 0)
  for (const path of tracked) {
    assert.equal(/10-28-better-plugins|\.worktrees\/|node_modules\//.test(path), false, path)
  }
  assert.ok(tracked.includes('src/index.js'))
  assert.ok(tracked.includes('cordis.patch.yml'))
  assert.ok(tracked.includes('presets/better-compact.patch.yml'))
  // package manifest is also a parsed object, guards accidental JSON corruption
  assert.equal(manifest.name, 'dsh-better-compact')
})
