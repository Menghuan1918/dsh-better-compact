# dsh-better-compact

Independent DSH compaction plugin. It keeps the native checkpoint transaction and
adds two continuation-oriented summarization modes: **goal** (default) and
**file handoff**, plus an embedded visual settings page and a read-only
inspect/models API. It does not need Apollo, a second history database, or a
custom write API.

- Package: `dsh-better-compact` `0.1.1`
- License: GPL-3.0-or-later (adapted DSH material remains MIT; see
  [third-party/NOTICE](third-party/NOTICE))
- Host baseline: DSH `>=0.2.1-rc.2 <0.3.0` (`0.2.1-rc.2` is the verified build)
- Node.js: `^22.19.0 || >=24.0.0`
- Pure ESM, no build step.

## What it changes

`BasicCompactionEngine` remains the owner of token measurement, safe-cut
selection, tool-pairing boundaries, retention, locking, retries, overflow
recovery, the durable `compaction/start → compaction/summary → checkpoint
replacement → compaction/end` sequence, and manual `/compact`. This package
only customizes its public `summarize()` hook and the post-success manual
continuation:

| Mode | Summary input | Output |
| --- | --- | --- |
| `native` | The installed native summarizer, unchanged. | Native checkpoint; no goal read, no temp file. |
| `goal` (default) | Replayed conversation + current authoritative goal/todo/questions/running jobs/children. | Structured continuation checkpoint. |
| `handoff` | Same authoritative state. | A per-attempt temporary Markdown handoff file plus the same Markdown body embedded in the native checkpoint; after a successful live **manual** compaction one ordinary same-session follow-up may be scheduled. |

All modes share native selection, retention, pricing, and durability. No mode
creates a new session, answers a pending question, or changes goal state.

## Install

Standalone (no Apollo):

```sh
dsh plugin --profile <profile> add dsh-better-compact@0.1.1
```

From GitHub main (secondary entry point):

```sh
dsh plugin --profile <profile> add github:Menghuan1918/dsh-better-compact
```

After installing or changing a load-time setting, **restart the DSH profile**
(restart the DSH process). Refreshing the Web page only reloads the UI; it does
not replace a running engine. See [apply-on-reload](#apply-on-reload).

### Configuring in the Web UI

In the Web Plugins page, open the `dsh-better-compact` row. Its page is the
visual settings editor described in [Visual settings page](#visual-settings-page):
three strategy cards, summary model/effort, the budget and retention
visualization, cache priority, collapsible advanced options, and the recent
native compaction status. It is embedded in the Host's existing config slot and
saves through the Host configForms revision/CAS path.

The same values can still be edited manually in the profile's
`cordis.patch.yml` (the same file the Host settings service writes); restart
the profile after either kind of change:

```yaml
- id: dsh-better-compact
  config:
    mode: handoff          # native | goal | handoff
    auto: true
    thresholdRatio: 0.8
    headroomTokens: 65536
    retainRatio: 0.16
    maxTokens: 65536
```

`retainTokens` replaces `retainRatio` (never set both). Omitted fields take the
documented defaults and the page shows those effective values rather than
hard-coded sketch numbers.

### Web: select the `better-compact` preset

The shipped Web composition disables the host-plane compaction rows and mounts
compaction inside each **agent preset**. A bundle patch cannot edit preset
rows, so this package ships its own selectable preset:

- choose **Better Compact** when creating a session, or set it as the default
  preset in **Settings → General → Agent preset**;
- other presets keep their own native compaction engine; the host-plane engine
  detects a preset-owned engine and stays out of the way rather than
  double-compacting.

The preset is a verbatim copy of the installed DSH `0.2.1-rc.2` `standard`
preset with exactly one row changed inside the compaction group
(`compaction-basic` → `dsh-better-compact/engine`). If upstream changes its
standard preset, this copy must be refreshed for that host version; it is not a
dynamic reference. The copy is a known rc.2-era limitation, not a claim that
preset composition is stable across DSH releases.

### Headless / TUI / non-preset compositions

There are no agent presets to mount, so the host-plane engine row is the active
compaction provider. `/compact`, automatic pressure, and overflow recovery work
there without selecting a preset. The inspect HTTP route is absent in headless
compositions (no webserver); that is expected and does not affect compaction.

### Apollo

Apollo will declare the same stable rows (`dsh-better-compact` companion row and
`dsh-better-compact/engine` engine row) inside its `eng` / `eng-ptc` presets.
The browser half registers the same config page under all three row keys, so
standalone and Apollo assemblies share one implementation:

- `dsh-better-compact#dsh-better-compact`
- `@menghuan1918/dsh-apollo#dsh-better-compact`
- `dsh-apollo#dsh-better-compact`

Do not install both bundle sources merely to enable compaction; only one explicit
entry is recommended.

## Visual settings page

The browser half is a zero-build React closure loaded by the Host module loader
(`id: dsh-better-compact`, only `require('react')`). It registers one component
under the canonical row key and both Apollo aliases, so standalone and Apollo
assemblies share the same page and the same Host form. The page never imports
Apollo, never adds a chart/build dependency, and only performs read-only GETs to
`/better-compact/api/inspect` and `/better-compact/api/models`.

### Layout and modes

The order is overview first, advanced collapsed: three mode cards, summary
model/effort, context budget and retention, cache priority, advanced settings,
then recent native compaction status. Each card has its own inline SVG strategy
diagram, not a shared picture or an icon:

| Card | What the diagram shows |
| --- | --- |
| DSH native | Earlier history → native summary; recent verbatim stays retained; result is the native checkpoint. |
| Goal-enhanced (default) | Earlier history **plus** the external authoritative goal/todo → goal/constraints/progress/next summary; recent verbatim retained; goal stays read-only. |
| File handoff | Conversation/state → this attempt's temporary handoff file → native events store the same body → same-session continuation; recent verbatim retained. |

The cards are one `role="radiogroup"`; each card is a `role="radio"` with
`aria-checked`, mouse and keyboard selection (Arrow keys, Home/End, Space/Enter),
focus-visible styling, and a disabled state. Selection is not conveyed by color
alone: the selected card also shows a "✓ Selected" tag and a filled radio dot.
The section is labelled "strategy schematic, not a live token flow or cache hit
rate". If the selected/saved mode differs from the active engine snapshot, the
card and the active-config banner say a profile reload is required.

### Session selection and read-only status

The row page has no session prop, so the page uses the client `sessions` service
snapshot (`ids`/`byId`) to offer a picker. It auto-selects the first available
session, can switch back to **Plugin state only (no session)**, and never invents
a session id. The selected id becomes `?sessionId=` on the inspect GET; changing
the selection aborts the stale request. The page renders the native
`lastCompaction` projection (trigger, status, duration, before/after tokens,
mode, real cache usage, error), `handoffContinuation` (scheduled/skipped plus
blockers and "waiting for the user"), and deduplicated `diagnostics`. It also
names the serving engine: for a foreign-preset session it says a different
compaction engine runs and does not draw a fake budget/preview, while still
showing that session's real compaction record. Unknown values stay unknown; only
provider-reported cache usage is shown, never an estimated savings rate.

### Model, effort, budget, cache, and advanced fields

- **Model/effort.** An empty provider/model pair follows the session; an
  explicit pair is saved atomically and never changes the main session model. A
  model that is not in the host's allowed candidate list is kept and marked
  (the list is host metadata, not a silent replacement rule), and a known
  unsupported effort is marked as an error. An empty effort means the selected
  model's default. Candidate metadata comes from
  [GET /better-compact/api/models](#read-only-inspect-and-models-api); when it
  is unavailable the page says capability is unknown and keeps free-text
  provider/model/effort available.
- **Native mode.** Enhanced reasoning effort and cache priority are visible but
  disabled with "not applicable: the native implementation decides"; the saved
  enhanced values are kept for switching back and are not claimed to have
  applied.
- **Budget/retention.** The diagram uses `inspect.budget` only: context window,
  current tokens, fixed system/tools prefix, earlier-history region, retained
  tail, the configured `thresholdRatio` plus the effective `thresholdTokens`,
  and the output-reserve/headroom zone after the trigger. It states that the
  exact output-reserve/headroom split is not exposed by the payload. Retention
  is either a ratio or absolute tokens (saving one writes the other as an
  unset op); the resolved safe cut comes from `inspect.preview` or the page says
  "no computable safe cut". Automatic pressure retention is contrasted with the
  more aggressive manual/overflow span, and the retained tail is called a
  budget, not a permanent pin. The before/after composition and
  `afterUpperBoundTokens` are labelled an upper-bound estimate, not a prediction.
  Capacity, fixed-prefix, retention-vs-trigger, and no-safe-region diagnostics
  name the control to adjust.
- **Cache priority.** The switch copy is exactly
  "优先复用缓存（尽可能保留 KV Cache 前缀）". The explanation covers prefix reuse,
  model-switch cost, and prefix invalidation after a replacement; it never claims
  lossless KV reuse or zero cache loss.
- **Advanced.** `auto`, `headroomTokens`, `maxTokens`, `compactionRetries`
  (post-compaction pressure retries) and `maxOverflowRetries` (context-overflow
  recoveries) are editable with the two retry meanings stated separately.
  Effective `modelPolicies` are shown read-only; the global form never writes or
  drops them. There are no handoff-directory, compaction-history, memory, or
  sidecar controls.

### Saving and apply-on-reload

The page edits one local draft and saves only through
`form.mutate(ops, expectedRevision)` — one atomic mutation per save, one
expected revision, no plugin-owned write route. It respects the Host form's
loading/unavailable/read-only state. If the Host revision changes while the
draft has staged edits, the page raises an explicit conflict and disables save
with a "reload host values" action; it does not silently overwrite the newer
configuration. A refused save or a transport error keeps the draft and never
shows success. On success the page says **saved — reload profile** and explains
that refreshing the web page does not reload the engine: restart the DSH process
to apply the new snapshot.

### Accessibility and known limits

Neutral host surfaces and thin borders are used, with a single accent plus state
colors only for errors/warnings, tabular numerals, and visible units. The layout
stacks vertically on narrow screens; the SVGs remain readable; light/dark
surfaces come from host theme tokens; `prefers-reduced-motion` disables
transitions. Every control has an accessible label and the diagrams have
equivalent text. The page is covered by React component tests
(`react-test-renderer`, fake form/fetch), not by a current-GUI visual check;
that acceptance belongs to S4. The strategy drawings are illustrations of
semantics and are not evidence of a live token flow, cache hit rate, or a
successful compaction.

## Configuration

The host companion row `dsh-better-compact` owns the schema. Native key names,
units, and meanings are preserved from `@deepseek-ai/dsh-compaction-basic`
`0.2.1-rc.2`; enhanced-only keys are stripped before the native base sees them.

| Key | Default | Constraint / meaning |
| --- | --- | --- |
| `mode` | `goal` | `native` / `goal` / `handoff`. |
| `auto` | `true` | Turns automatic pressure/overflow recovery on or off; manual `/compact` still works. |
| `thresholdRatio` | `0.8` | Request-pressure fraction in `(0, 1)`; the trigger is `floor(min(W × ratio, W − O − headroom))`. |
| `headroomTokens` | `65536` | Non-negative extra pressure headroom beyond the routed output reservation `O`. |
| `retainRatio` / `retainTokens` | ratio `0.16` | Mutually exclusive recent-tail budgets; absolute tokens must be below the resolved trigger. Exactly one form is stored. |
| `summarizationProvider` / `summarizationModel` | both `""` | Empty pair = inherited route (latest routed request, then AgentOptions). Non-empty pair must be set together. |
| `reasoningEffort` | `""` | Empty = the selected summary model's own default. Non-empty must be an effort id that model actually advertises. |
| `cachePriority` | `true` | Prefer keeping the conversation's system/tools/history prefix so the auxiliary call is a genuine prefix; `false` sends a leaner request without tool declarations. |
| `maxTokens` | follows resolved `headroomTokens` | Positive summary output cap, counted with input against the model context window. |
| `compactionRetries` | `1` | Extra attempts when pressure remains after a successful compaction (not a network retry count). |
| `maxOverflowRetries` | `1` | Bounded provider-confirmed context-overflow recoveries; `0` disables recovery. |
| `modelPolicies` | `[]` | Exact `{provider, model, ...native partial policy}` overrides with native semantics; no visual rule editor in this version. |

The unresolved checks are enforced at load/reload and by the visual settings form:
mutually exclusive retention forms, an empty/non-empty summarization pair,
`retainRatio < thresholdRatio`, positive output caps, duplicate/unknown model
policies, zero headroom without an explicit `maxTokens`, and positive integer
counts. Unknown **top-level** keys and unknown keys inside a `modelPolicies`
entry are rejected at load with the offending key and the supported key list, so
a typo in the manual `cordis.patch.yml` path cannot be silently ignored.
Invalid saved values fail the row reload with an actionable message instead of
silently coercing.

### Apply-on-reload

All fields are **volatile**: the native settings service can save them without
remounting the row, and revision/CAS prevents silent overwrites. The engine
therefore takes one frozen snapshot at load:

- `activeConfig` in the inspect response is what the running engine holds;
- `requiresReload` becomes `true` when the saved value differs from that
  snapshot;
- a save **never** reconfigures a running engine;
- restart the DSH profile to take the new snapshot.

This is the closest honest mapping to DSH 0.2.1-rc.2, which has no host "saved
but requires reload" state of its own.

### Reasoning effort and cache priority

- `native` mode reports these options as **not applicable**: the inherited
  native summarizer decides its own request shape. Saved enhanced values are
  kept for switching back.
- In `goal`/`handoff`, a non-empty effort is validated against
  `ctx.llm.resolveModelInfo()` for the exact summary model. An unsupported id is
  rejected before provider I/O; it is never replaced by `off`/`high`/another
  model. Unknown capability is treated as unsupported for an explicit value.
- `cachePriority: true` reuses the native prefix shape (system prompt, tool
  schema/tool history, shadowed messages, then the instruction at the end).
  `cachePriority: false` omits tool declarations and tool history; it is not a
  promise that the provider disables its cache.
- Changing the summary model/provider can invalidate the warm prefix; that is a
  real trade-off, not a cost this plugin can hide.

### Capacity and budget diagnostics

The summary request is bounded by the actual selected model route:

- trigger/retention follow the native formulas exactly; no second token unit is
  introduced;
- the auxiliary request is priced with the same fixed estimator
  (`estimateMessage` / `estimateToolsTokens`);
- if the full authoritative state does not fit, the state is reduced in a fixed
  order — drop the usually-large todo list first while keeping pending
  questions/jobs/running children, then goal-only, then no state — and the
  instruction carries an explicit `## Budget note` naming exactly what was
  omitted. The omission is also exposed in inspect `diagnostics`;
- if even the state-free request cannot fit, the attempt fails with
  `BETTER_COMPACT_BUDGET` and an actionable message (compact a smaller span,
  lower `maxTokens`, or choose a larger model). The plugin never silently
  truncates or shrinks history.

### Retention reality

`retainRatio`/`retainTokens` apply to the **automatic pressure** path only.
Native manual `compactNow` and context-overflow recovery deliberately use
`retainTokens = 0` (maximal balanced reduction), unchanged from the installed
engine. The retained tail is a budget, not a permanent pin: overflow recovery may
choose a more aggressive safe span. The preview in the inspect API mirrors the
automatic pressure rule; it does not promise the manual/overflow range.

## Modes in detail

### `goal` (default)

The summarizer reads the live authoritative goal (`ctx.goals.get(agent)` when
present), the current todo projection, pending user questions, jobs owned by the
session, and running child agents; all are read-only and optional. The
instruction asks for:

- current goal and unresolved user requests;
- constraints, preferences, and approved boundaries;
- decisions and reasons;
- completed / in progress / blocked work;
- verified vs unverified results;
- exact artifacts, files, commands, errors, identifiers;
- next actions.

Rules enforced by the prompt and output check: newer history outranks older
checkpoints; prior checkpoint goal state is not authoritative; incomplete work
must not be marked complete; pending questions/jobs/children are facts to wait
for, not things to answer/stop; secrets should be redacted; exact identifiers
should be preserved; output must contain every required section. The check is a
degenerate/truncation guard, **not** proof that no fact was lost.

If no goal service or no goal exists, compaction still runs normally; the
prompt explicitly says not to infer a goal from old checkpoint text. The native
`todo` projection is turn-scoped (`turn/start` resets it), so an automatic
pressure compaction at the start of a turn usually has no todo list to inject;
manual idle compaction normally sees the previous turn's list. No workaround
copies the list into another store.

### `handoff`

The model writes a handoff document for another agent continuing *this same
session*, with the same authority rules plus a `Suggested Skills` section that
is advisory only. Then:

1. a fresh per-attempt directory is created under the OS temp directory
   (`os.tmpdir()`, so Unix `TMPDIR` or `/tmp`);
2. the final document — including the **actual** file path, session id, and
   creation time in a deterministic header — is written with owner-only
   permissions, read back byte-for-byte, and verified by platform:
   on POSIX the file must report mode `0600` with a `0700` attempt directory;
   Windows has no POSIX mode bits (`stat.mode` only reflects the read-only
   attribute), so the POSIX assertion is skipped there and the proof is the
   per-user OS temp directory plus the exact read-back. An ACL check is not
   practical with Node's standard library and is not claimed;
3. the same document is returned as the summary body, so the native checkpoint
   replacement is self-contained; deleting the file later does not break replay;
4. if and only if this was a live, successful **manual** `compactNow`, the agent
   was idle with no queued input, the goal is not paused/blocked, and there is no
   pending user question, running job, or running child agent, exactly one
   ordinary follow-up is enqueued through the native same-agent input mechanism
   (`agent.followup(createUserMessage(...))`).

The continuation never resumes/rearms a goal, answers a question, starts a
required turn during an in-flight turn, creates/switches a session, or uses a
sidecar. A replay, page refresh, or plugin reload cannot re-trigger it because
the trigger is the live manual call, not a session event. If the process dies
between a successful commit and enqueue, the checkpoint is already durable but
the continuation is not; that gap is real and is not claimed atomic. The user
can continue manually in the same session.

Handoff files are not scheduled for cleanup; they live with the OS temp
directory. They are a convenience copy, never the only recovery source. Secret
redaction is conservative pattern matching (`sk-*`, GitHub/Slack/AWS/Google
tokens, bearer tokens, private-key blocks, assignment-style passwords/secrets);
it cannot recognize every credential format.

## Failure, cancellation, and recovery

| Situation | Behavior |
| --- | --- |
| Automatic pressure summary fails before replacement | Warning; the latest durable surface is kept (pruning or an earlier replacement may already have landed) and the turn continues. A later turn may compact successfully. |
| Manual summary fails | The native command reports a `ManualCompactionError`-based error (`could not produce a useful summary`); the attempt is recorded; no checkpoint is installed. |
| Provider-confirmed context overflow | Native bounded recovery (`maxOverflowRetries`); on failure the real request error is preserved. |
| Replacement appended, durability flush fails | Native `ManualCompactionError('persistence')`: history may have changed but saving failed; no rollback is claimed. `lastCompaction.status` is `persistence-error` when this process observed it. |
| `compaction/end` cannot be appended | Native commit-stage failure: the summary/replacement may already be durable while the bracket stays open; the command reports “did not finish cleanly”. Inspect reports `failed` with the recorded error; no rollback or fake `completed` is claimed. |
| Cancellation / pending user / paused goal | Summarization or continuation stops; no goal is revived; no question is answered for the user. |
| No safe useful range | Native no-op/`null` with a reason; no fake checkpoint. |
| Invalid model/effort/capacity | Actionable error; never a silent native or model fallback. |
| Empty/truncated/degenerate enhanced output | Rejected before installation (`BETTER_COMPACT_STRUCTURE`, `MAX_TOKENS`); the native error path applies. |

Enhanced modes never fall back to native mode automatically. Native mode itself
is the inherited implementation, byte-compatible with the same native config.
As the design requires: an external native recovery listener
(`compaction/summary-error`) may already have written durable changes before a
later failure; "automatic compaction failed" therefore never means "the session
has no side effects". Inspect preserves the recorded attempt and its error
instead of claiming a clean rollback.

## Read-only inspect and models API

`GET /better-compact/api/inspect`, optional `?sessionId=<id>`.

`GET /better-compact/api/models` (no session) returns the host's allowed
candidate routes with their advertised reasoning efforts:

```json
{
  "enabled": true,
  "routes": [{ "provider": "p", "model": "m", "efforts": ["low", "high"], "defaultEffort": "low" }]
}
```

The models projection reads the optional host `subagentModelSelection` service's
`current().allowedModels` and enriches each entry with
`ctx.llm.resolveModelInfo(provider, model).reasoning.efforts`. It is metadata
only: no provider I/O, no CLI call, and no model enumeration happens on page
load. If the service is absent or has no catalog the response is
`{ "enabled": false, "routes": [] }`; a failed per-route capability lookup only
empties that route's `efforts`, and the visual page falls back to free-text
provider/model/effort with an "unknown" capability note. The list is the host's
allowed-candidate metadata, not proof that a route is usable in the current
session.

Both routes are registered only when **both** a Host webserver and the Host
`connection` trust fence exist. A webserver without the fence fails closed: the
routes are not registered and an already-registered handler returns 503 if the
fence disappears. Every request passes `connection.requestRejection(req)`
(401/403); only `GET` is accepted (405), the inspect query is validated (400 for
unknown/duplicate/empty `sessionId`), an unknown/invisible session is 404, and
every JSON response carries `cache-control: no-store`. The models route is
session-free and ignores query parameters. There is no write API, no cross-origin
allowance, and no plugin-owned trust switch. The visual settings page uses these
payloads as its only source of truth for token/session/status values.

Response fields (unknown values are `null`, never `0`):

| Field | Meaning |
| --- | --- |
| `activeConfig` | The frozen configuration this engine instance holds. No credentials. |
| `requiresReload` | Saved value differs from `activeConfig` (including a saved value that no longer normalizes). |
| `sessionId` | Echo of the requested session, or `null` without one. |
| `diagnostics` | Always an array of read-only strings for the visual settings page. It carries token-meter/model-info failures, budget-capacity reasons, last-summary budget omissions, and the engine-applicability reason (empty when everything is available). |
| `engine` | `null` without a session, else `{owner, inspectApplies, reason}`. `owner` is `host`, `better-compact-preset`, `foreign-preset`, or `unknown`. A **foreign preset** (the shipped Web `standard` preset, for example) runs its own native engine, so `inspectApplies: false`, `budget`/`preview` are `null`, and `lastCompaction` is still projected from that session's real events. A cold/non-live session cannot prove ownership and is reported `unknown` with the active configuration. |
| `budget` | `null` without a session, else `{contextWindow, currentTokens, measurement, fixedTokens, thresholdTokens, retainTokens, summaryMaxTokens}`. `measurement` is `measured` (provider-usage anchor), `estimated` (fixed heuristic), or `unavailable`. |
| `preview` | `null` without a usable session, else `{beforeTokens, afterUpperBoundTokens, rangeStart, rangeEnd, reason}`. `rangeStart`/`rangeEnd` are native surface seqs from the automatic-pressure safe-cut rule; `afterUpperBoundTokens` includes the summary output budget and is an upper-bound estimate, not a prediction. `reason` explains below-trigger/no-range/unavailable. |
| `lastCompaction` | `null` when no compaction exists, else `{id, trigger, status, mode, beforeTokens, afterTokens, durationMs, cacheReadTokens, cacheWriteTokens, error}` projected only from real events/usage. |
| `handoffContinuation` | `null` until this process makes a manual handoff continuation decision, else `{compactionId, status: 'scheduled'\|'skipped', blockers, at}`. `blockers` names queued input, paused/blocked goal, pending question, running job, running child, cancellation, or a queue failure so the visual settings page can show why nothing continued. |

`lastCompaction` rules:

- `trigger`: `manual` for a standalone (`turn: null`) compaction, `automatic`
  for a turn-owned one; the log cannot distinguish pressure from overflow, so
  both are `automatic`.
- `status`: `running | completed | failed | cancelled | persistence-error`.
  `running` is claimed only for a live in-memory summary attempt; an orphaned
  unmatched start is reported as `failed`, not as a phantom active process.
  `cancelled` is recognized from the recorded abort/cancel error.
  `persistence-error` is only knowable from this process's own observation after
  a successful append failed its flush; the persisted log alone looks
  completed.
- `mode` is `native`/`goal`/`handoff` only when the checkpoint's structure
  proves it; older/foreign records are `null`.
- A recorded commit/append failure on an open bracket is surfaced in `error`
  rather than reported as a silent `failed` with `error: null`.
- `cacheReadTokens`/`cacheWriteTokens` are reported only when the summary event
  carried real provider usage; absence is not zero. No “savings percentage” is
  fabricated.

Read-only guarantee: inspection performs no LLM generation, no compaction, no
CLI call, no temp-file write, and no goal/session mutation. Cold sessions are
read through `ctx.sessionQuery.observeSession` and replayed into a detached
`Session` for the same singleton token meter; if that reconstruction or the
meter fails, the affected numbers are unavailable rather than computed by a
second algorithm.

## Host drift and limitations (DSH 0.2.1-rc.2)

- Web compaction is **preset-owned**; the bundle cannot replace it globally.
  The host-plane engine exists for headless/TUI and for presets without a
  compaction group, and detects preset-owned engines to avoid double work.
- There is no host reload state. Saving is volatile and immediate; load-time
  snapshot changes need a profile restart.
- The shipped `preset-better-compact` is a pinned copy of the rc.2 standard
  preset. Re-verify/refresh it when changing DSH baseline.
- The inspect API has no separate authentication beyond the Host trust fence.
- One compaction provider per context/realm only. Do not mount a second
  compaction engine row beside this package; two explicit bundles are not
  recommended.

## Licensing

The package is GPL-3.0-or-later. Small substantive parts adapted from the MIT
DeepSeek Harness packages (budget formulas, summarization request shape, verbose
preset copy) remain under MIT; copyright and license text are preserved in
[third-party/LICENSE-MIT-dsh](third-party/LICENSE-MIT-dsh) and described in
[third-party/NOTICE](third-party/NOTICE). The goal/handoff prompt text is new;
pi-atlas, xbot, OpenCode, and Codex are cited design references, not copied
source.

## Verification status

Verified in this repository (see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)):

- unit tests (`node --test`) for config validation/defaults, native budget
  formulas and safe-cut selection, prompt/state/redaction, handoff file
  permissions/read-back, engine routing/effort/failure/continuation gating,
  inspect projection/null semantics/fence, models-route projection/fence,
  preset copy, and the visual client's mode cards, model/effort, budget,
  retention, save/revision/conflict/transport, status and accessibility states
  with fake form/fetch;
- a real-profile smoke with a temp `DSH_HOME`, scripted LLM adapter, real
  AgentLoop/session log/token meter/commands/settings/config-editor/webserver,
  real Connection authentication, real job registry, and real child agents:
  automatic pressure, manual `/compact`, native event sequence, authenticated
  inspect over HTTP (401/400/404/405/no-store), the models route over the same
  fence and its real allowed-model catalog (401/405/no-store), failure/recovery,
  handoff file + redacted raw output + one continuation + replay after file
  deletion, a real standard-preset foreign-engine session, injected
  durability-flush failure (`session/flush` listener; the real JSONL writer still
  runs), in-flight cancellation, commit-stage append failure, pending-
  question/job/child continuation gates, preset isolation/no double-compaction,
  and save → reload → `activeConfig` update. Manual handoff continuation is
  exercised on the host-plane engine; the preset engine's automatic path is
  covered, and the preset manual path shares the same engine code. Run the exact
  commands for the current test counts.

The current build was verified with **115 unit/component tests** and **45
real-profile smoke checks** at commit time; always prefer the fresh command
output over these numbers.

**Not verified here:** real-model summary fidelity, reasoning-effort quality,
provider cache-read/write hit rates against a real provider, and a visual/
keyboard acceptance pass in the current GUI. The visual settings behavior above
is covered by React component tests and the backend routes by the real-profile
smoke; the current GUI/URL check belongs to S4. Do not infer GUI acceptance from
the controlled-provider or component tests.
