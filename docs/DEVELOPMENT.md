# dsh-better-compact — development guide

For maintainers, source installers, and people debugging host compatibility.
Everyday usage is in [README](../README.md). The design specs that drove this
implementation are deliberately **not** in this repository; do not add them to
commits, docs, or the npm package.

## Status and compatibility

- Package version: `0.1.0`.
- Verified DSH build: `0.2.1-rc.2`; `engines.dsh` is
  `>=0.2.1-rc.2 <0.3.0`. That range admits later RCs but is not a per-version
  verification promise.
- Node.js `^22.19.0 || >=24.0.0`.
- Pure ESM, no build step, no generated assets.
- The visual settings page is implemented as the zero-build browser half and
  covered by `react-test-renderer` component tests with a fake Host form. A
  visual/keyboard acceptance pass in the current GUI was **not** performed here;
  that belongs to S4.

## Repository layout

| Path | Responsibility |
| --- | --- |
| [package.json](../package.json) | npm metadata, exports, peers, `dsh.bundle.patch`, `dsh.client`. |
| [cordis.patch.yml](../cordis.patch.yml) | Standalone composition: disable host `compaction-basic`, insert host companion + host-plane engine rows. |
| [presets/better-compact.patch.yml](../presets/better-compact.patch.yml) | Selectable Web preset: pinned rc.2 `standard` copy with the compaction group's engine swapped. |
| [src/index.js](../src/index.js) | Host companion row: volatile `Config`, `betterCompactConfig` service, settings policy, GET inspect route, test seam for the fence. |
| [src/engine.js](../src/engine.js) | `BetterCompactEngine extends BasicCompactionEngine`: enhanced `summarize()`, preset-supersede guard, manual handoff continuation, failure classification. |
| [src/config.js](../src/config.js) | Single source of truth for defaults, schema, normalization, native projection, row keys. |
| [src/budget.js](../src/budget.js) | Clearly marked adapter re-implementing the native capacity/retention/selection formulas and fixed-prefix pricing. |
| [src/prompts.js](../src/prompts.js) | Goal/handoff instructions, authoritative-state rendering, output structure check, mode detection, conservative redaction, handoff document/continuation text. |
| [src/state.js](../src/state.js) | Read-only goal/todo/question/job/child collection and continuation blockers. |
| [src/handoff.js](../src/handoff.js) | Per-attempt temp directory/path, owner-only write, permission stat, byte-for-byte read-back. |
| [src/live.js](../src/live.js) | Process-local "summary in flight", classified-failure, and handoff-continuation outcome observations for inspect only; no durable claim. |
| [src/identity.js](../src/identity.js) | Unwraps cordis service proxies (`symbols.original`) so preset-owned engines can be compared and recognized. |
| [src/inspect.js](../src/inspect.js) | Live/cold session inspection, budget/preview construction, `lastCompaction` projection, inspect error taxonomy. |
| [src/models.js](../src/models.js) | Read-only projection of the host's allowed summary-model candidates and their advertised efforts. |
| [src/client.js](../src/client.js) | Zero-build visual settings page: three strategy diagrams, model/effort, budget/retention, cache, advanced options, native status, session picker, Host-form save. Registers the stable row-config keys. |
| [scripts/runtime-smoke.mjs](../scripts/runtime-smoke.mjs) | Four-boot real-profile smoke with a temp DSH home and scripted adapter. |
| [tests/](../tests) | `node:test` unit/component tests; no browser build. |
| [third-party/](../third-party) | MIT notice/license for adapted DSH material. |

## Install for development

```sh
npm install
DSH_PACKAGE_ROOT="/path/to/node_modules/@deepseek-ai/dsh" npm test
```

`npm install` installs the declared peer range (the same packages the host
provides at runtime) plus test-only React/js-yaml. Tests import the public peer
packages directly.

Install this checkout into a throwaway profile to try it interactively:

```sh
dsh plugin --profile <profile> add /absolute/path/to/dsh-better-compact
# restart the DSH process for the new profile wiring
```

Inside the Web UI choose the **Better Compact** preset for the session (or set
it as the default). Headless/TUI profiles use the host-plane engine directly.

## Architecture decisions

These are host-driven and should not be "simplified" without re-verifying the
installed build:

1. **Two rows, one package.** `dsh-better-compact` is the host companion (config
   schema/service/inspect/client), `dsh-better-compact/engine` is the compaction
   provider. The companion never registers `ctx.compaction`; the engine never
   owns UI/config parsing.
2. **One provider per realm.** `BasicCompactionEngine` provides the
   `compaction` service. Web presets isolate that service per agent; the
   `better-compact` preset mounts our engine inside the same group as
   `command-compact` and `tool-result-pruner`.
3. **Host-plane engine guard.** The standalone bundle also inserts a host-plane
   engine for headless/TUI. Agent events are delivered to untagged root
   listeners, so in Web the host engine would otherwise see every preset agent.
   `compactIfNeeded` compares `ctx.agentPresets.serviceFor(agent,'compaction')`
   with itself and returns `null` when a preset owns the engine. Cordis wraps
   services in proxies, so identity is compared through
   `symbols.original`; a raw `!==` check wrongly treats a preset engine as
   "another" engine.
4. **Frozen snapshot + live current.** The Loader's volatile config fields make
   saves live without remounting. The engine intentionally does not follow them:
   load-time snapshot keeps one coherent strategy. `inspect` compares the saved
   value with the snapshot and returns `requiresReload`.
5. **Only `summarize()` is subclassed.** Selection, retention, pricing, locking,
   the bracket transaction, flush, overflow recovery, and retry loops stay in
   the inherited engine. Enhanced modes re-implement only the auxiliary
   LLM request shape (adapted from `summarizeWithLlm`, MIT) so they can change
   the instruction, add authoritative state, pass an explicit reasoning effort,
   and validate output before installation.
6. **Windows temp files cannot prove POSIX modes.** `%TEMP%` is the per-user
   boundary, Node's `stat.mode` on Windows only reflects the read-only
   attribute, and an ACL check would need a native module. The handoff writer
   therefore verifies `0600` on POSIX and skips only that assertion on
   `win32`, keeping the byte-for-byte read-back and per-attempt directory. The
   platform and stat call are injectable test seams.
7. **Inspect must name the engine it is looking at.** A Web session can run a
   preset-owned native engine (the shipped `standard` preset). `serviceFor`
   plus `symbols.original` distinguishes host, our preset, and a foreign preset;
   foreign sessions get `engine.inspectApplies: false` with `budget`/`preview`
   null while `lastCompaction` still comes from their real events.
8. **The inspect route fails closed.** It is registered only when both
   `webServer` and `connection` exist; if the fence service disappears the
   handler returns 503. The smoke mints a real Connection session cookie and
   exercises the route through the real auth path (401 unauthenticated).
9. **The preview upper bound includes native framing.** `NATIVE_CHECKPOINT_FRAMING_TOKENS`
   prices the native preamble and `<compacted-summary>` tags so
   `afterUpperBoundTokens` is a true upper bound; the text is reproduced only
   for pricing (MIT notice), never used to write checkpoints.
10. **The native formulas are mirrored in one adapter.** DSH's installed build is
   bundled and does not export `resolveCompactSpec`, `resolveTargetPolicy`, or
   `selectCompactableRange`. `src/budget.js` reproduces them for the inspect
   preview and the summary budget. The smoke asserts the preview cut against the
   actual `shadowedRange` of a real automatic compaction; when changing the DSH
   baseline, re-check those formulas first.
11. **No new session events, no second history, no write API.** Successful work
   produces the native compaction events/replacement; inspect is a GET projection
   over those events plus the singleton token meter.
12. **Handoff body is the checkpoint summary.** The temp file and checkpoint share
   the exact same Markdown body. That makes file deletion harmless for replay and
   avoids a sidecar index. Continuation is triggered by the live manual call,
   never by observing an event, so replay cannot reschedule it.
13. **The visual page reads over GET and writes only through the Host form.**
    `/better-compact/api/models` is a metadata projection of the optional host
    `subagentModelSelection` service plus `llm.resolveModelInfo` efforts; it is
    not a second model catalog, performs no provider/CLI I/O, and returns
    `{enabled:false,routes:[]}` when the service is absent. The page's only
    write path is `form.mutate(ops, expectedRevision)`; revision conflicts are
    surfaced explicitly and transport failures keep the draft. Session selection
    comes from the client `sessions` list store, so the row page never invents a
    session id. Strategy SVGs are schematics; token/budget/status numbers come
    only from inspect and unknown values stay unknown.

## Test coverage

`npm test` runs `node --test` over:

- `config.test.mjs` — schema defaults, volatile fields, normalization, all
  cross-field conflicts, unknown top-level/policy key rejection,
  native-projection stripping, policy-level headroom semantics, stable keys.
- `budget.test.mjs` — exact native threshold/retention arithmetic, per-target
  overrides, capacity/retention errors, safe-cut tail retention, tool-pairing
  boundaries, fixed-prefix pricing.
- `prompts.test.mjs` — required sections, state rendering/caps, omission notes,
  structure rejection, mode detection, redaction patterns, handoff document
  composition, continuation text.
- `handoff.test.mjs` — temp directory/file uniqueness, POSIX `0600` and
  Windows synthetic-mode paths, read-back verification, empty-body rejection,
  path-safe session ids, explicit timestamps.
- `engine.test.mjs` — frozen snapshot, missing companion error, native delegation
  and native in-flight summary marking, goal state + effort + cache-shape
  request, unsupported effort, truncation / malformed-output rejection, handoff
  file embedding and rawOutput redaction, ordered budget fallback (todos first,
  then pending facts, then goal-only) with disclosure/omission recording, route
  resolution, supersede identity, exactly-one continuation and blockers,
  continuation outcome recording.
- `state.test.mjs` — read-only goal/todo/question/job/child collection and every
  continuation blocker.
- `inspect.test.mjs` — `lastCompaction` status/trigger/mode projection (including
  recorded-error surfacing on an open bracket), budget/preview math with native
  framing, null-not-zero semantics, engine ownership for host/preset/foreign/
  cold sessions, handoff-continuation exposure, diagnostics for token-meter
  failure and summary-budget omissions, live read-only behavior, 404/503
  mapping, cold `observeSession` path.
- `fence.test.mjs` — 401/403 ordering, missing-fence 503, registration waiting
  for both webServer and connection, 400/405, documented response shape and
  no-store.
- `models.test.mjs` — absent/allowed/malformed catalogs, per-route capability
  failure, fence ordering before model work, GET-only 405, no-store JSON, and
  both routes being registered only with webserver+fence.
- `client.test.mjs` — module identity, alias keys, slot registration, summary
  copy, section order, three distinct diagrams, radiogroup/keyboard/disabled
  semantics, pending active-mode flags, native "not applicable" controls,
  model/effort incompatibility and pair clearing, unknown capability,
  retention switching, save ops/revision, success/reload copy, conflict,
  refused/transport errors, unknown vs measured budget, framing labels, reason
  classification, completed/cache-unknown/persistence-error statuses, handoff
  continuation, deduped diagnostics, foreign-engine suppression, session
  selection/stale abort/empty state, inspect failure still editable, host theme
  tokens/reduced motion/labelled controls, and no client-side token counting.
- `package.test.mjs` — npm contract, file whitelist, patch structure, verbatim
  standard-preset copy (when `DSH_PACKAGE_ROOT` is set), release workflow, and
  tracked-file hygiene.

Run with the baseline preset comparison enabled:

```sh
DSH_PACKAGE_ROOT="/Users/<you>/Library/Application Support/dsh-tauri/dependencies/dsh/node_modules/@deepseek-ai/dsh" npm test
```

## Real-profile smoke

```sh
DSH_PACKAGE_ROOT="/path/to/node_modules/@deepseek-ai/dsh" npm run smoke
```

What it does:

1. Creates a temp `DSH_HOME` and an `it` profile from the installed
   `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless` bundles plus this
   package. Only shipped files are copied, with `@deepseek-ai` symlinked to the
   runtime; no repo `node_modules` or design docs are used.
2. Disables the headless startup/runner rows, inserts a workspace row, the
   model-selection settings row, an agent-preset registry, and a real
   `@deepseek-ai/dsh-host-webserver` on port 0.
3. Registers a scripted LLM adapter (`it-noop/noop`) with
   `contextWindow: 30000`, `defaultMaxTokens: 64`, reasoning efforts
   `low`/`high`, and special handling for `purpose: 'compaction'` and
   `'session-title'`.
4. Boot 1 — goal mode, auto on:
   auto pressure compaction and native event sequence; authenticated inspect
   over HTTP (401 unauthenticated, 400/404/405/no-store); the models route over
   the same fence with the real allowed-model catalog and advertised efforts
   (401 unauthenticated, 405 write verb, no-store); preview range equals the
   actual native `shadowedRange`; read-only checks; goal state in the
   instruction; failure keeps the durable surface and turn; recovery; manual
   failure mapping; manual no-op; settings save → `requiresReload` → active
   snapshot unchanged.
5. Boot 2 — handoff mode, auto off (reloaded): manual `/compact` writes the
   temp file, the summary/rawOutput/replacement/file contain no planted secret,
   exactly one same-session follow-up is scheduled and visible in inspect;
   effort/cache-priority request shape; delete file + flush; paused goal blocks
   continuation but still commits the checkpoint; a real `standard` preset
   session is reported as a foreign engine; an injected `session/flush`
   listener failure at the compaction durability checkpoint →
   `persistence-error` (the real JSONL writer still runs, so this is an
   aggregate flush failure, not a simulated disk failure); real in-flight abort
   → `cancelled`; simulated `compaction/end` append failure → `failed` with the
   recorded error; a real timed pending question, real running job, and real
   running child each skip continuation and expose blockers; save
   `auto: true`. Manual handoff continuation is exercised on the host-plane
   engine; the preset engine automatic path is covered separately, and the
   preset manual path runs the same engine code.
6. Boot 3 — handoff mode, auto on: automatic handoff compaction adds no turn;
   the `better-compact` preset provides an isolated engine and produces exactly
   one compaction (no host double-compaction); save `mode: native`.
7. Boot 4 — native mode: cold inspect of the persisted handoff session (mode
   `handoff`), replay after the file was deleted, and native auto compaction with
   the inherited summarizer, no effort override, and native request shape.

`BETTER_COMPACT_KEEP_SMOKE_HOME=1` keeps the temp home for post-mortem; the
session log is zstd-compressed (`session.v4.jsonl.zstd`) and the profile
`cordis.patch.yml` shows what the settings service persisted. The smoke never
touches the user's real profile or the running GUI.

## Debugging notes

- The Plugins row page is the visual editor. It saves through the Host
  configForms revision/CAS path and shows "saved — reload profile"; restart the
  DSH process to apply. If the page itself is unavailable or you prefer files,
  edit the `dsh-better-compact` row in the profile's `cordis.patch.yml` and
  restart the profile.
- If the visual page says model capability is unknown, the host has no
  `subagentModelSelection` service or the adapter has no reasoning metadata.
  Free-text provider/model/effort still works; the models route intentionally
  does not probe providers or CLI catalogs.
- The session picker auto-selects the first client session and can switch to
  plugin state only. It only calls the GET inspect route; a page refresh or a
  picker change never triggers compaction, an LLM call, a CLI call, or a file
  write.
- A revision conflict in the page means the Host configuration changed while
  the draft was open; use "Reload host values" and re-apply. A transport error
  keeps the draft and is not a successful save.
- Native mode disables the enhanced effort/cache controls while keeping their
  saved values; switching back to goal/handoff re-enables them. Do not expect
  the native summarizer to apply those values.
- `ctx.compaction` must be a `BetterCompactEngine`. If it is absent, the bundle
  row was not selected or the row failed to load; read the Loader diagnostic.
- If Web sessions do not use the plugin, check the selected preset. Shipped
  presets own their compaction engine; only `better-compact` contains ours.
- If `requiresReload` stays false after a save, the save did not change a
  volatile field (or the row is not addressable); check
  `ctx.settings.describe()` for the `dsh-better-compact` namespace/revision.
- The native `todos` projection resets on every `turn/start`. Automatic
  pressure compaction runs at that boundary, so it usually has no todo list;
  manual idle compaction sees the previous turn's list. This is host behavior,
  not a missing read path.
- Unknown configuration keys are rejected at load, including keys inside a
  `modelPolicies` entry. The error names the key and the supported set; a
  manual YAML typo should fail the row, not be ignored.
- If an enhanced summary request cannot fit all authoritative state, the
  instruction contains a `## Budget note` and inspect `diagnostics` reports what
  was omitted. The fallback order is: drop todos (keep pending
  questions/jobs/children), then goal-only, then no state.
- If enhanced summaries fail with `BETTER_COMPACT_BUDGET`, the replayed span plus
  `maxTokens` does not fit `contextWindow`; this is explicit rather than a silent
  truncation. Use a larger model, lower `maxTokens`, or compact earlier.
- If a manual handoff reports `ManualCompactionError('summary')`, inspect the
  session log's `compaction/end.error`. Common causes: provider failure,
  truncation at the cap, missing required sections, handoff file write/read-back
  failure, or the framed summary not being smaller than the shadowed span.
- The inspect route is read-only and fails closed: no `connection` service means
  no route. Smoke HTTP uses a real `/connect` cookie; a 401 usually means the
  cookie was not minted or the profile restarted.
- `engine.owner`/`inspectApplies` distinguishes the serving engine. A Web session
  on the `standard` preset correctly reports a foreign engine and no
  budget/preview; that is not a missing backend.
- Windows handoff writes skip the POSIX `0600` assertion (Node synthesizes
  `stat.mode` there). The read-back check still runs; see `handoff.test.mjs`.
- Do not add mutating verbs to inspect; settings writes go through the host
  `settings`/configForms pipeline only.

## Inspect and models contract notes for the visual settings page

The read-only payload is the shared contract the visual settings page renders; treat these as stable:

- Keys: `activeConfig`, `requiresReload`, `sessionId`, `engine`, `diagnostics`,
  `budget`, `preview`, `lastCompaction`, `handoffContinuation`.
- `diagnostics` is always a `string[]` (empty when nothing is wrong). It carries
  token-meter or model-info failures, budget-capacity reasons, the last summary's
  budget omission (`recordBudgetFallback`), and the engine-applicability reason.
  Render it as an informational/error list; it is not a second metric system.
- `engine.owner`/`inspectApplies` decide whether the budget/preview sections are
  meaningful for this session. A foreign preset session returns
  `budget: null`/`preview: null`; do not draw a fake threshold or percentage.
- `handoffContinuation` is process-local (`null` on a cold/restarted process) and
  reports `scheduled` or `skipped` plus blockers for the last manual handoff.
- Unknown values stay `null`; `measurement` distinguishes `measured` (provider
  usage anchor), `estimated` (fixed heuristic), and `unavailable`.
- `afterUpperBoundTokens` includes the summary output budget and
  `NATIVE_CHECKPOINT_FRAMING_TOKENS`; keep calling it an upper-bound estimate.
- Saving still goes through `ctx.settings`/configForms revision CAS; this API is
  GET-only and must not gain a write verb for UI convenience.
- `GET /better-compact/api/models` shares the same fence and is also GET-only.
  It returns `{enabled, routes:[{provider,model,efforts,defaultEffort}]}` from
  the optional `subagentModelSelection.current().allowedModels` catalog enriched
  with `llm.resolveModelInfo` reasoning efforts; absent service/catalog is
  `{enabled:false,routes:[]}`. The list is candidate metadata — the page keeps a
  saved route outside it visible and marked rather than deleting it.
- The client uses the client `sessions` service list store (`ids`/`byId`) to
  pick one session for `?sessionId=`, aborts stale requests, and keeps the form
  editable when inspect fails. It never invents a session id.

## Updating the DSH baseline

1. Read the installed `@deepseek-ai/dsh-compaction-basic` source and re-check
   `resolveCompactSpec`, `resolveTargetPolicy`, `selectCompactableRange`,
   `summarizeWithLlm`, `frameSummary`, and the manual/overflow retain rules
   against `src/budget.js` / `src/engine.js`.
2. Refresh `presets/better-compact.patch.yml` from the new
   `@deepseek-ai/dsh-web-app/presets/standard.patch.yml` and change only the
   preset identity/metadata and the compaction group engine row. The package
   test compares it against the installed standard preset while
   `DSH_PACKAGE_ROOT` points at that install.
3. Re-check the Web composition: which rows are preset-owned/disabled and
   whether the preset group still isolates `compaction`/`toolResultPruner`.
4. Re-run unit tests and the smoke; then check the current GUI/URL only as part
   of the S4 integration task.

## Known unverified areas

- Real-model summary fidelity and adherence (controlled scripted output only).
- Real provider cache-read/write hits and cost effects.
- Reasoning-effort quality (capability validation is tested; model behavior is
  not).
- A current-GUI visual/keyboard acceptance pass of the visual settings page
  (component tests only here; the running-GUI check belongs to S4).
- Apollo combination/loading matrix and migration (S4).
