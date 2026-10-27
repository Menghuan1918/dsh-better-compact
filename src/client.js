/**
 * dsh-better-compact — zero-build browser half (S3 visual settings page).
 *
 * The stable entry is registered under the canonical row key and both Apollo
 * alias keys so standalone and Apollo assemblies share one implementation.
 * The page is embedded in the Host's existing `plugins.row.config` slot: the
 * Host owns the configuration form (`form.state` + `form.mutate` CAS) and this
 * module renders the visual editor around it.
 *
 * Hard constraints:
 *   - only React is required (no Apollo import, no chart library, no build);
 *   - the only network calls are read-only GETs to the same-origin
 *     `/better-compact/api/inspect` and `/better-compact/api/models`;
 *   - saving goes exclusively through `form.mutate(ops, revision)` — there is
 *     no plugin-owned write HTTP route;
 *   - token numbers, safe cuts, and the trigger come from the inspect payload;
 *     this module never re-implements the compaction/token algorithm;
 *   - host theme tokens are used for both light and dark surfaces.
 *
 * Strategy diagrams are schematics, not live token flows. Unknown values are
 * shown as unknown; they are never rendered as 0 or a fabricated percentage.
 */

window.__ModuleLoader__.load({
  id: 'dsh-better-compact',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')
    const { createElement: h, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } = React

    /** Must stay in sync with src/config.js. */
    const ROW_KEYS = Object.freeze([
      'dsh-better-compact#dsh-better-compact',
      '@menghuan1918/dsh-apollo#dsh-better-compact',
      'dsh-apollo#dsh-better-compact',
    ])
    /** Slot namespace name. */
    const SLOT = 'plugins.row.config'
    /** Read-only host endpoints. */
    const INSPECT_PATH = '/better-compact/api/inspect'
    const MODELS_PATH = '/better-compact/api/models'
    /** Stable modes; the server remains the validation authority. */
    const MODES = Object.freeze(['native', 'goal', 'handoff'])
    const MODE_META = Object.freeze({
      native: Object.freeze({
        label: 'DSH native',
        description: 'Inherited native summarizer and native checkpoint. No goal read, no handoff file.',
        caption: 'The native implementation chooses its own summary request shape; enhanced effort and cache controls are not applicable.',
      }),
      goal: Object.freeze({
        label: 'Goal-enhanced',
        badge: 'Default',
        description: 'Adds the current authoritative goal/todo as read-only input to a continuation-oriented summary. It never takes over the goal lifecycle.',
        caption: 'Runs with or without a goal. Authority state is an extra input; it is not modified, resumed, or marked complete.',
      }),
      handoff: Object.freeze({
        label: 'File handoff',
        badge: null,
        description: 'Writes this attempt’s temporary Markdown handoff file, stores the same body in native events, then may continue the same session.',
        caption: 'No new session and no handoff history database. The file is a convenience copy, not the only recovery source.',
      }),
    })
    /** One-line summary used by the Plugins page before opening the row. */
    const SUMMARY =
      'Native, goal-aware, or file-handoff compaction checkpoints with a read-only inspect API.'
    /** Strategy disclaimer required on the mode cards. */
    const STRATEGY_NOTE =
      'Strategy schematic, not a live token flow or cache hit rate. Diagrams explain when each strategy reads or retains content; they do not report measured tokens or cache savings.'
    /** Native-mode applicability copy required by the spec. */
    const NATIVE_NOT_APPLICABLE = 'not applicable: the native implementation decides'
    /** Exact cache-priority copy required by the spec. */
    const CACHE_PRIORITY_COPY = '优先复用缓存（尽可能保留 KV Cache 前缀）'
    /** Empty session-list snapshot (stable identity for useSyncExternalStore). */
    const EMPTY_SESSION_LIST = Object.freeze({
      ids: Object.freeze([]),
      byId: Object.freeze({}),
      phase: 'ready',
      projectionsBySession: Object.freeze({}),
    })

    // ── formatting helpers ────────────────────────────────────────────────

    /** Group an integer with commas without depending on the runtime locale. */
    function groupDigits(value) {
      return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    }

    /** Human token value; `null`/undefined is unknown, never 0. */
    function tokensText(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown'
      const rounded = Math.round(value)
      return `${groupDigits(rounded)} tokens`
    }

    /** Plain integer text; `null`/undefined is unknown. */
    function numberText(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown'
      return groupDigits(Math.round(value))
    }

    /** Ratio text as a percentage; unknown stays unknown. */
    function ratioText(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown'
      return `${Math.round(value * 10000) / 100}%`
    }

    /** Duration text; unknown stays unknown. */
    function durationText(value) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'unknown'
      if (value < 1000) return `${Math.round(value)} ms`
      return `${Math.round(value / 100) / 10} s`
    }

    /** One-line error message. */
    function errorMessage(error) {
      if (error instanceof Error) return error.message
      return String(error)
    }

    /** Percentage of a scale, clamped to 0..100 for rendering only. */
    function percentOf(value, scale) {
      if (typeof value !== 'number' || !Number.isFinite(value) || typeof scale !== 'number' || scale <= 0) return null
      return Math.max(0, Math.min(100, (value / scale) * 100))
    }

    /** Render an unknown token value without inventing a number. */
    function valueOrUnknown(value, formatter) {
      return value === null || value === undefined ? 'unknown' : formatter(value)
    }

    // ── form draft ────────────────────────────────────────────────────────

    /** Convert one accepted form value into the editable draft (strings). */
    function draftFromValue(value) {
      const source = value !== null && typeof value === 'object' ? value : {}
      const hasRetainTokens = source.retainTokens !== undefined && source.retainTokens !== null
      return {
        mode: typeof source.mode === 'string' ? source.mode : '',
        provider: typeof source.summarizationProvider === 'string' ? source.summarizationProvider : '',
        model: typeof source.summarizationModel === 'string' ? source.summarizationModel : '',
        effort: typeof source.reasoningEffort === 'string' ? source.reasoningEffort : '',
        thresholdRatio: typeof source.thresholdRatio === 'number' ? String(source.thresholdRatio) : '',
        headroomTokens: typeof source.headroomTokens === 'number' ? String(source.headroomTokens) : '',
        retainMode: hasRetainTokens ? 'tokens' : 'ratio',
        retainRatio: typeof source.retainRatio === 'number' ? String(source.retainRatio) : '',
        retainTokens: hasRetainTokens ? String(source.retainTokens) : '',
        cachePriority: source.cachePriority === true,
        auto: source.auto === true,
        maxTokens: typeof source.maxTokens === 'number' ? String(source.maxTokens) : '',
        compactionRetries: typeof source.compactionRetries === 'number' ? String(source.compactionRetries) : '',
        maxOverflowRetries: typeof source.maxOverflowRetries === 'number' ? String(source.maxOverflowRetries) : '',
      }
    }

    /** Compare two drafts field by field (strings/booleans only). */
    function equalDraft(left, right) {
      if (left === null || right === null) return left === right
      const keys = Object.keys(left)
      if (keys.length !== Object.keys(right).length) return false
      for (const key of keys) {
        if (left[key] !== right[key]) return false
      }
      return true
    }

    /** Parse a numeric input; empty is null, invalid is NaN. */
    function parseNumberInput(text) {
      const trimmed = String(text).trim()
      if (trimmed === '') return null
      const value = Number(trimmed)
      return Number.isFinite(value) ? value : Number.NaN
    }

    /** Parse an integer input; empty is null, invalid is NaN. */
    function parseIntegerInput(text) {
      const value = parseNumberInput(text)
      return value === null ? null : Number.isInteger(value) ? value : Number.NaN
    }

    /**
     * Validate the editable draft before a save. The Host schema remains the
     * final authority; this catches the fields the page can reason about so a
     * user does not have to round-trip a rejected save.
     *
     * @returns {Array<{field: string, message: string}>}
     */
    function validateDraft(draft) {
      const errors = []
      if (!MODES.includes(draft.mode)) {
        errors.push({ field: 'mode', message: 'Select one of the three compaction modes.' })
      }

      const thresholdRatio = parseNumberInput(draft.thresholdRatio)
      const thresholdValid =
        thresholdRatio !== null &&
        !Number.isNaN(thresholdRatio) &&
        thresholdRatio > 0 &&
        thresholdRatio < 1
      if (!thresholdValid) {
        errors.push({ field: 'thresholdRatio', message: 'Threshold ratio must be a number between 0 and 1 (exclusive).' })
      }

      const headroom = parseIntegerInput(draft.headroomTokens)
      const headroomValid = headroom !== null && !Number.isNaN(headroom) && headroom >= 0
      if (!headroomValid) {
        errors.push({ field: 'headroomTokens', message: 'Headroom tokens must be an integer of 0 or more.' })
      }

      if (draft.retainMode === 'tokens') {
        const retainTokens = parseIntegerInput(draft.retainTokens)
        if (retainTokens === null || Number.isNaN(retainTokens) || retainTokens < 0) {
          errors.push({ field: 'retainTokens', message: 'Retention tokens must be an integer of 0 or more.' })
        }
      } else if (draft.retainRatio !== '') {
        const retainRatio = parseNumberInput(draft.retainRatio)
        if (retainRatio === null || Number.isNaN(retainRatio) || retainRatio <= 0 || retainRatio >= 1) {
          errors.push({ field: 'retainRatio', message: 'Retention ratio must be a number between 0 and 1 (exclusive).' })
        } else if (thresholdValid && retainRatio >= thresholdRatio) {
          errors.push({ field: 'retainRatio', message: 'Retention ratio must be lower than the threshold ratio.' })
        }
      }

      if ((draft.provider === '') !== (draft.model === '')) {
        errors.push({
          field: 'summarizationModel',
          message: 'Summary provider and model must be set together, or both left empty to follow the session.',
        })
      }

      if (draft.maxTokens === '') {
        if (headroom === 0) {
          errors.push({
            field: 'maxTokens',
            message: 'Max tokens is required when headroom tokens is 0: the native engine needs a positive summary output cap.',
          })
        }
      } else {
        const maxTokens = parseIntegerInput(draft.maxTokens)
        if (maxTokens === null || Number.isNaN(maxTokens) || maxTokens <= 0) {
          errors.push({ field: 'maxTokens', message: 'Max tokens must be a positive integer.' })
        }
      }

      const compactionRetries = parseIntegerInput(draft.compactionRetries)
      if (compactionRetries === null || Number.isNaN(compactionRetries) || compactionRetries < 0) {
        errors.push({ field: 'compactionRetries', message: 'Compaction retries must be an integer of 0 or more.' })
      }
      const maxOverflowRetries = parseIntegerInput(draft.maxOverflowRetries)
      if (maxOverflowRetries === null || Number.isNaN(maxOverflowRetries) || maxOverflowRetries < 0) {
        errors.push({ field: 'maxOverflowRetries', message: 'Max overflow retries must be an integer of 0 or more.' })
      }
      return errors
    }

    /**
     * Validate a known-incompatible effort. The allowed-candidate list is host
     * metadata (the subagent model allow-list), not a hard restriction on the
     * summary route, so a route outside that list is only marked as a warning —
     * never silently deleted and never a blocked save. Native mode does not
     * apply enhanced effort at all.
     */
    function validateModelSelection(draft, routes, routesKnown) {
      if (draft.mode === 'native' || draft.provider === '' || draft.model === '' || !routesKnown) return []
      const route = routes.find((entry) => entry.provider === draft.provider && entry.model === draft.model)
      if (route === undefined) return []
      if (draft.effort !== '' && route.efforts.length > 0 && !route.efforts.includes(draft.effort)) {
        return [
          {
            field: 'reasoningEffort',
            message:
              `Reasoning effort "${draft.effort}" is not advertised by ${draft.provider}/${draft.model}. ` +
              'Choose an advertised effort or clear the field to use the model default.',
          },
        ]
      }
      return []
    }

    /** Non-blocking marker for a saved route outside the candidate metadata. */
    function routeCandidateWarning(draft, routes, routesKnown) {
      if (draft.provider === '' || draft.model === '' || !routesKnown) return null
      if (routes.some((entry) => entry.provider === draft.provider && entry.model === draft.model)) return null
      return (
        `Summary route "${draft.provider}/${draft.model}" is not in the host’s allowed candidate list. ` +
        'The saved value is kept: the candidate list is host metadata, not a hard restriction on the summary route. ' +
        'Verify that this route is usable for the current session, choose a listed route, or clear both fields to follow the session.'
      )
    }

    /** The allowed route matching the draft, when the catalog is known. */
    function routeForDraft(draft, routes) {
      return routes.find((entry) => entry.provider === draft.provider && entry.model === draft.model)
    }

    /**
     * Build one atomic mutation from the draft. Only fields the page owns are
     * written; `modelPolicies` is deliberately never touched. Retention writes
     * always clear the other form so a hidden ratio/token conflict cannot
     * survive a save.
     */
    function buildOps(draft, value) {
      const current = value !== null && typeof value === 'object' ? value : {}
      const ops = []
      const setIfChanged = (path, next, previous) => {
        if (next !== previous) ops.push({ op: 'set', path, value: next })
      }
      setIfChanged(['mode'], draft.mode, current.mode)
      if (
        draft.provider !== (typeof current.summarizationProvider === 'string' ? current.summarizationProvider : '') ||
        draft.model !== (typeof current.summarizationModel === 'string' ? current.summarizationModel : '')
      ) {
        ops.push({ op: 'set', path: ['summarizationProvider'], value: draft.provider })
        ops.push({ op: 'set', path: ['summarizationModel'], value: draft.model })
      }
      setIfChanged(
        ['reasoningEffort'],
        draft.effort,
        typeof current.reasoningEffort === 'string' ? current.reasoningEffort : '',
      )
      setIfChanged(['thresholdRatio'], Number(draft.thresholdRatio), current.thresholdRatio)
      setIfChanged(['headroomTokens'], Number(draft.headroomTokens), current.headroomTokens)

      if (draft.retainMode === 'tokens') {
        ops.push({ op: 'unset', path: ['retainRatio'] })
        ops.push({ op: 'set', path: ['retainTokens'], value: Number(draft.retainTokens) })
      } else {
        ops.push({ op: 'unset', path: ['retainTokens'] })
        if (draft.retainRatio === '') {
          if (current.retainRatio !== undefined) ops.push({ op: 'unset', path: ['retainRatio'] })
        } else {
          ops.push({ op: 'set', path: ['retainRatio'], value: Number(draft.retainRatio) })
        }
      }

      setIfChanged(['cachePriority'], draft.cachePriority, current.cachePriority)
      setIfChanged(['auto'], draft.auto, current.auto)
      if (draft.maxTokens === '') {
        if (current.maxTokens !== undefined) ops.push({ op: 'unset', path: ['maxTokens'] })
      } else {
        setIfChanged(['maxTokens'], Number(draft.maxTokens), current.maxTokens)
      }
      setIfChanged(['compactionRetries'], Number(draft.compactionRetries), current.compactionRetries)
      setIfChanged(['maxOverflowRetries'], Number(draft.maxOverflowRetries), current.maxOverflowRetries)
      return ops
    }

    // ── read-only HTTP + session selection ────────────────────────────────

    /** GET one read-only JSON endpoint; never sends a write verb. */
    async function getJson(path, signal) {
      const fetcher = typeof fetch === 'function' ? fetch : undefined
      if (fetcher === undefined) throw new Error('HTTP fetch is unavailable in this client')
      const response = await fetcher(path, {
        method: 'GET',
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        ...(signal === undefined || signal === null ? {} : { signal }),
      })
      let payload
      try {
        payload = await response.json()
      } catch {
        payload = undefined
      }
      if (!response.ok) {
        const message =
          payload !== undefined && payload !== null && typeof payload.message === 'string'
            ? payload.message
            : `HTTP ${response.status}`
        throw new Error(message)
      }
      if (payload === undefined || payload === null || typeof payload !== 'object') {
        throw new Error('the read-only response was not JSON')
      }
      return payload
    }

    /**
     * Fetch one read-only endpoint and abort the previous request when the key
     * or refresh token changes. A stale response never overwrites a newer one.
     */
    function useReadOnlyJson(key, refreshToken) {
      const [state, setState] = useState({ key: null, status: 'idle', payload: null, error: null })
      useEffect(() => {
        if (key === null) {
          setState({ key: null, status: 'idle', payload: null, error: null })
          return undefined
        }
        const controller = typeof AbortController === 'function' ? new AbortController() : null
        let cancelled = false
        setState((previous) => ({
          key,
          status: previous.key === key && previous.payload !== null ? 'refreshing' : 'loading',
          payload: previous.key === key ? previous.payload : null,
          error: null,
        }))
        getJson(key, controller === null ? undefined : controller.signal).then(
          (payload) => {
            if (cancelled) return
            setState({ key, status: 'ready', payload, error: null })
          },
          (error) => {
            if (cancelled || (controller !== null && controller.signal.aborted)) return
            setState((previous) => ({
              key,
              status: 'error',
              payload: previous.key === key ? previous.payload : null,
              error: errorMessage(error),
            }))
          },
        )
        return () => {
          cancelled = true
          if (controller !== null) controller.abort()
        }
      }, [key, refreshToken])
      if (state.key !== key) {
        return {
          key,
          status: key === null ? 'idle' : 'loading',
          payload: null,
          error: null,
        }
      }
      return state
    }

    /** Subscribe to the client sessions-list snapshot store. */
    function useSessionList(sessions) {
      const store = sessions !== null && sessions !== undefined ? sessions.list : undefined
      const subscribe = useCallback(
        (onChange) => {
          if (store === undefined || typeof store.subscribe !== 'function') return () => undefined
          return store.subscribe(onChange)
        },
        [store],
      )
      const getSnapshot = useCallback(() => {
        if (store === undefined || typeof store.getSnapshot !== 'function') return EMPTY_SESSION_LIST
        try {
          const snapshot = store.getSnapshot()
          return snapshot === null || snapshot === undefined ? EMPTY_SESSION_LIST : snapshot
        } catch {
          return EMPTY_SESSION_LIST
        }
      }, [store])
      return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    }

    /** Flatten the session-list snapshot into ordered picker rows. */
    function sessionEntries(list) {
      const byId = list !== null && list !== undefined && typeof list.byId === 'object' && list.byId !== null ? list.byId : {}
      const ids = Array.isArray(list?.ids) ? list.ids : Object.keys(byId)
      return ids
        .map((id) => {
          const row = byId[id]
          const title =
            row !== null && row !== undefined && typeof row.displayTitle === 'string' && row.displayTitle.length > 0
              ? row.displayTitle
              : id
          return { id, title, running: row !== undefined && row !== null && row.running === true }
        })
        .filter((entry) => typeof entry.id === 'string' && entry.id.length > 0)
    }

    // ── strategy diagrams (one distinct drawing per mode) ─────────────────

    /** Traditional native compaction: earlier history becomes the native summary. */
    function NativeDiagram() {
      return h(
        'svg',
        {
          className: 'dsh-bc-diagram',
          viewBox: '0 0 260 148',
          role: 'img',
          'data-diagram': 'native',
          'aria-label':
            'DSH native strategy. Earlier history goes through the native summarizer into a native summary. Recent verbatim messages are retained in the native tail. The result is a native checkpoint stored as native events.',
        },
        h('title', null, 'DSH native compaction strategy'),
        h('rect', { className: 'dsh-bc-node', x: 4, y: 8, width: 108, height: 30, rx: 5 }),
        h('text', { x: 58, y: 27, textAnchor: 'middle' }, 'earlier history'),
        h('rect', { className: 'dsh-bc-node', x: 148, y: 8, width: 108, height: 30, rx: 5 }),
        h('text', { x: 202, y: 27, textAnchor: 'middle' }, 'recent verbatim'),
        h('path', { className: 'dsh-bc-edge', d: 'M58 38v14m-4-5 4 5 4-5' }),
        h('text', { className: 'dsh-bc-diagram-note', x: 64, y: 52 }, 'native summarizer'),
        h('path', { className: 'dsh-bc-edge', d: 'M202 38v14m-4-5 4 5 4-5' }),
        h('text', { className: 'dsh-bc-diagram-note', x: 208, y: 52 }, 'native tail'),
        h('rect', { className: 'dsh-bc-node dsh-bc-node-accent', x: 4, y: 60, width: 108, height: 30, rx: 5 }),
        h('text', { x: 58, y: 79, textAnchor: 'middle' }, 'native summary'),
        h('rect', { className: 'dsh-bc-node dsh-bc-node-strong', x: 148, y: 60, width: 108, height: 30, rx: 5 }),
        h('text', { x: 202, y: 79, textAnchor: 'middle' }, 'retained verbatim'),
        h('path', { className: 'dsh-bc-edge', d: 'M58 90v12h72' }),
        h('path', { className: 'dsh-bc-edge', d: 'M136 102h72v-12' }),
        h('rect', { className: 'dsh-bc-node dsh-bc-node-accent', x: 4, y: 106, width: 252, height: 26, rx: 5 }),
        h('text', { x: 130, y: 123, textAnchor: 'middle' }, 'native checkpoint · native start → summary → replacement → end'),
        h('text', { className: 'dsh-bc-diagram-note', x: 130, y: 143, textAnchor: 'middle' }, 'native semantics are inherited; no goal read, no temp file'),
      )
    }

    /** Goal-enhanced compaction: authoritative state is an additional input. */
    function GoalDiagram() {
      return h(
        'svg',
        {
          className: 'dsh-bc-diagram',
          viewBox: '0 0 260 148',
          role: 'img',
          'data-diagram': 'goal',
          'aria-label':
            'Goal-enhanced strategy. Earlier history and the external authoritative goal and todo are combined into a goal, constraints, progress and next-step summary. Recent verbatim messages stay retained. The goal is read-only: it is not resumed, completed, or reset.',
        },
        h('title', null, 'Goal-enhanced compaction strategy'),
        h('rect', { className: 'dsh-bc-node', x: 4, y: 8, width: 96, height: 30, rx: 5 }),
        h('text', { x: 52, y: 27, textAnchor: 'middle' }, 'earlier history'),
        h('rect', { className: 'dsh-bc-node dsh-bc-node-dashed', x: 112, y: 8, width: 144, height: 30, rx: 5 }),
        h('text', { x: 184, y: 23, textAnchor: 'middle' }, 'authoritative goal / todo'),
        h('text', { className: 'dsh-bc-diagram-note', x: 184, y: 34, textAnchor: 'middle' }, 'read-only input, not owned'),
        h('path', { className: 'dsh-bc-edge', d: 'M52 38v12h78' }),
        h('path', { className: 'dsh-bc-edge', d: 'M184 38v12h-54' }),
        h('rect', { className: 'dsh-bc-node dsh-bc-node-accent', x: 4, y: 58, width: 160, height: 34, rx: 5 }),
        h('text', { x: 84, y: 72, textAnchor: 'middle' }, 'goal · constraints · progress'),
        h('text', { x: 84, y: 85, textAnchor: 'middle' }, 'next step · exact references'),
        h('rect', { className: 'dsh-bc-node dsh-bc-node-strong', x: 176, y: 58, width: 80, height: 34, rx: 5 }),
        h('text', { x: 216, y: 72, textAnchor: 'middle' }, 'recent'),
        h('text', { x: 216, y: 85, textAnchor: 'middle' }, 'verbatim'),
        h('text', { className: 'dsh-bc-diagram-note', x: 216, y: 100, textAnchor: 'middle' }, 'retained verbatim'),
        h('path', { className: 'dsh-bc-edge', d: 'M84 92v14h52' }),
        h('rect', { className: 'dsh-bc-node dsh-bc-node-accent', x: 4, y: 110, width: 160, height: 24, rx: 5 }),
        h('text', { x: 84, y: 126, textAnchor: 'middle' }, 'native checkpoint replacement'),
        h('text', { className: 'dsh-bc-diagram-note', x: 130, y: 145, textAnchor: 'middle' }, 'goal stays authoritative; summaries do not reset it or rounds'),
      )
    }

    /** File-handoff compaction: temp file first, body stored in native events. */
    function HandoffDiagram() {
      return h(
        'svg',
        {
          className: 'dsh-bc-diagram',
          viewBox: '0 0 260 148',
          role: 'img',
          'data-diagram': 'handoff',
          'aria-label':
            'File handoff strategy. The conversation and authoritative state produce a per-attempt temporary Markdown handoff file. Native events store the same handoff body, so the native checkpoint remains self-contained. A successful manual run may schedule one same-session continuation. Recent verbatim messages are retained.',
        },
        h('title', null, 'File handoff compaction strategy'),
        h('rect', { className: 'dsh-bc-node', x: 4, y: 6, width: 82, height: 28, rx: 5 }),
        h('text', { x: 45, y: 24, textAnchor: 'middle' }, 'conversation'),
        h('text', { className: 'dsh-bc-diagram-note', x: 45, y: 43, textAnchor: 'middle' }, '+ authoritative state'),
        h('path', { className: 'dsh-bc-edge', d: 'M88 20h16m-5-4 5 4-5 4' }),
        h('path', { className: 'dsh-bc-node dsh-bc-node-dashed', d: 'M110 6h132l10 10v36H110z' }),
        h('path', { className: 'dsh-bc-edge', d: 'M242 6v10h10' }),
        h('text', { x: 176, y: 26, textAnchor: 'middle' }, 'temporary handoff file'),
        h('text', { className: 'dsh-bc-diagram-note', x: 176, y: 38, textAnchor: 'middle' }, 'per attempt · OS temp · owner-only'),
        h('path', { className: 'dsh-bc-edge', d: 'M176 52v10m-4-5 4 5 4-5' }),
        h('rect', { className: 'dsh-bc-node dsh-bc-node-accent', x: 4, y: 66, width: 132, height: 28, rx: 5 }),
        h('text', { x: 70, y: 84, textAnchor: 'middle' }, 'native events store body'),
        h('rect', { className: 'dsh-bc-node dsh-bc-node-strong', x: 148, y: 66, width: 108, height: 28, rx: 5 }),
        h('text', { x: 202, y: 84, textAnchor: 'middle' }, 'recent verbatim retained'),
        h('path', { className: 'dsh-bc-edge', d: 'M70 94v14h66' }),
        h('rect', { className: 'dsh-bc-node dsh-bc-node-accent', x: 4, y: 108, width: 132, height: 26, rx: 5 }),
        h('text', { x: 70, y: 125, textAnchor: 'middle' }, 'same-session continuation'),
        h('text', { className: 'dsh-bc-diagram-note', x: 196, y: 125, textAnchor: 'middle' }, 'no new session'),
        h('text', { className: 'dsh-bc-diagram-note', x: 130, y: 145, textAnchor: 'middle' }, 'file is a convenience copy; checkpoint body is self-contained'),
      )
    }

    const DIAGRAMS = Object.freeze({ native: NativeDiagram, goal: GoalDiagram, handoff: HandoffDiagram })

    // ── generic UI primitives ─────────────────────────────────────────────

    /** A labelled field; children is a render function receiving the input id. */
    function Field(props) {
      const rawId = useId()
      const id = `dsh-bc-${props.name}-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
      return h(
        'div',
        { className: 'dsh-bc-field' },
        h('label', { htmlFor: id, className: 'dsh-bc-label' }, props.label),
        props.children(id),
        props.help === undefined || props.help === null ? null : h('p', { className: 'dsh-bc-help' }, props.help),
        props.error === undefined || props.error === null
          ? null
          : h('p', { className: 'dsh-bc-error', role: 'alert', 'data-bc-error': props.name }, props.error),
      )
    }

    /** A section surface with a heading. */
    function Section(props) {
      return h(
        'section',
        { className: 'dsh-bc-section', 'data-bc-section': props.name },
        h(
          'div',
          { className: 'dsh-bc-section-head' },
          h('h3', { className: 'dsh-bc-h3' }, props.title),
          props.aside === undefined || props.aside === null ? null : props.aside,
        ),
        props.children,
      )
    }

    /** A definition row with a tabular value. */
    function Row(props) {
      return h(
        'div',
        { className: 'dsh-bc-row' },
        h('div', { className: 'dsh-bc-row-label' }, h('span', null, props.label), props.help ? h('p', { className: 'dsh-bc-help' }, props.help) : null),
        h('span', { className: props.mono === false ? 'dsh-bc-row-value' : 'dsh-bc-row-value dsh-bc-mono' }, props.value),
      )
    }

    /** One mode card with its own diagram and radio semantics. */
    function ModeCard(props) {
      const meta = MODE_META[props.mode]
      const Diagram = DIAGRAMS[props.mode]
      const onKeyDown = (event) => {
        if (props.disabled) return
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault()
          props.onSelect(props.mode)
          return
        }
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault()
          props.onMove(1)
          return
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault()
          props.onMove(-1)
          return
        }
        if (event.key === 'Home') {
          event.preventDefault()
          props.onMoveTo(0)
          return
        }
        if (event.key === 'End') {
          event.preventDefault()
          props.onMoveTo(MODES.length - 1)
        }
      }
      return h(
        'div',
        {
          ref: props.cardRef,
          className: 'dsh-bc-mode',
          role: 'radio',
          'aria-checked': props.selected,
          'aria-disabled': props.disabled ? true : undefined,
          tabIndex: props.selected && !props.disabled ? 0 : -1,
          'data-mode': props.mode,
          'data-selected': props.selected ? 'true' : 'false',
          onClick: () => {
            if (!props.disabled) props.onSelect(props.mode)
          },
          onKeyDown,
        },
        h(
          'div',
          { className: 'dsh-bc-mode-head' },
          h('span', { className: 'dsh-bc-radio-dot', 'aria-hidden': 'true' }),
          h('span', { className: 'dsh-bc-mode-title' }, meta.label),
          meta.badge === undefined || meta.badge === null ? null : h('span', { className: 'dsh-bc-tag' }, meta.badge),
          props.selected
            ? h('span', { className: 'dsh-bc-selected-tag', 'data-bc-selected-tag': 'true' }, '✓ Selected')
            : null,
        ),
        h('p', { className: 'dsh-bc-mode-description' }, meta.description),
        h('div', { className: 'dsh-bc-diagram-wrap' }, h(Diagram)),
        h('p', { className: 'dsh-bc-caption' }, meta.caption),
        props.pending
          ? h(
              'p',
              { className: 'dsh-bc-mode-pending', 'data-bc-mode-pending': 'true' },
              'Selected or saved mode differs from the active engine snapshot — reload the profile to apply.',
            )
          : null,
      )
    }

    /** Three selectable mode cards with an accessible radiogroup. */
    function ModeCards(props) {
      const cardRefs = useRef({})
      const focusCard = (mode) => {
        const node = cardRefs.current[mode]
        if (node !== null && node !== undefined && typeof node.focus === 'function') {
          try {
            node.focus()
          } catch {
            // A detached/limited renderer has no focusable DOM node.
          }
        }
      }
      const choose = (mode) => {
        if (props.disabled) return
        props.onChange(mode)
        focusCard(mode)
      }
      const move = (delta) => {
        if (props.disabled) return
        const index = MODES.indexOf(props.value)
        choose(MODES[(index + delta + MODES.length) % MODES.length])
      }
      return h(
        'div',
        null,
        h(
          'div',
          { className: 'dsh-bc-modes', role: 'radiogroup', 'aria-label': 'Compaction mode', 'data-bc': 'mode-cards' },
          MODES.map((mode) =>
            h(ModeCard, {
              key: mode,
              mode,
              selected: props.value === mode,
              disabled: props.disabled,
              pending:
                props.activeMode !== null &&
                props.activeMode !== undefined &&
                props.value === mode &&
                props.activeMode !== mode,
              onSelect: choose,
              onMove: move,
              onMoveTo: (index) => choose(MODES[index]),
              cardRef: (node) => {
                cardRefs.current[mode] = node
              },
            }),
          ),
        ),
        h('p', { className: 'dsh-bc-caption', 'data-bc': 'strategy-note' }, STRATEGY_NOTE),
      )
    }

    /** Checkbox row with a label and explanation. */
    function Toggle(props) {
      const rawId = useId()
      const id = `dsh-bc-toggle-${props.name}-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
      return h(
        'div',
        { className: 'dsh-bc-field' },
        h(
          'label',
          { className: 'dsh-bc-check', htmlFor: id },
          h('input', {
            id,
            name: props.name,
            type: 'checkbox',
            checked: props.checked === true,
            disabled: props.disabled === true,
            onChange: (event) => props.onChange(event.target.checked),
            'aria-describedby': undefined,
          }),
          h('span', null, h('span', { className: 'dsh-bc-label' }, props.label)),
        ),
        props.help === undefined || props.help === null ? null : h('p', { className: 'dsh-bc-help' }, props.help),
        props.note === undefined || props.note === null ? null : h('p', { className: 'dsh-bc-note' }, props.note),
      )
    }

    /** Classify an inspect budget/diagnostic reason and point at the controls. */
    function classifyReason(text) {
      if (typeof text !== 'string' || text.length === 0) return null
      if (/leaving no message budget/i.test(text)) {
        return {
          label: 'Capacity too small',
          hint: 'Adjust the summary model/context capacity or lower maxTokens.',
        }
      }
      if (/leaving no pressure budget/i.test(text)) {
        return {
          label: 'Headroom and output reserve fill the window',
          hint: 'Lower headroomTokens or maxTokens, or choose a larger-context model.',
        }
      }
      if (/must be less than threshold tokens/i.test(text)) {
        return {
          label: 'Retention conflicts with the trigger',
          hint: 'Lower the retention budget or raise the threshold ratio.',
        }
      }
      if (/no safe compactable range/i.test(text)) {
        return {
          label: /system prompt|retained tail|tool-call/i.test(text) ? 'Fixed prefix / retained tail leaves no safe range' : 'No safe compactable range',
          hint: 'Lower the retention budget or threshold, or wait for more compactable history.',
        }
      }
      if (/no routed request/i.test(text)) {
        return {
          label: 'No routed request',
          hint: 'Send one request in the session or configure an explicit summary provider/model.',
        }
      }
      if (/no context capacity/i.test(text) || /model metadata is unavailable/i.test(text)) {
        return {
          label: 'Model capacity unknown',
          hint: 'Check the adapter metadata for the routed model.',
        }
      }
      if (/below the automatic trigger/i.test(text)) {
        return { label: 'Below the automatic trigger (informational)', hint: null }
      }
      if (/automatic compaction is disabled/i.test(text)) {
        return { label: 'Automatic compaction is off (informational)', hint: 'Enable automatic compaction in Advanced settings.' }
      }
      return null
    }

    /** Render deduplicated reasons with actionable hints. */
    function ReasonList(props) {
      const seen = new Set()
      const items = []
      for (const raw of props.reasons ?? []) {
        if (typeof raw !== 'string' || raw.length === 0 || seen.has(raw)) continue
        seen.add(raw)
        items.push({ raw, classified: classifyReason(raw) })
      }
      if (items.length === 0) return null
      return h(
        'ul',
        { className: 'dsh-bc-reasons', 'data-bc': 'reasons' },
        items.map((item) =>
          h(
            'li',
            { key: item.raw, className: 'dsh-bc-reason' },
            item.classified === null ? null : h('strong', null, `${item.classified.label}: `),
            h('span', null, item.raw),
            item.classified !== null && item.classified.hint !== null && item.classified.hint !== undefined
              ? h('p', { className: 'dsh-bc-hint' }, item.classified.hint)
              : null,
          ),
        ),
      )
    }

    /** One proportional bar with a trigger marker and an optional reserve zone. */
    function TokenBar(props) {
      const scale = props.scale
      const segments = (props.segments ?? []).filter(
        (segment) => typeof segment.tokens === 'number' && Number.isFinite(segment.tokens) && segment.tokens > 0,
      )
      const triggerLeft = percentOf(props.triggerTokens, scale)
      const currentLeft = percentOf(props.currentTokens, scale)
      const reserveLeft = percentOf(props.triggerTokens, scale)
      const reserveWidth =
        typeof props.windowTokens === 'number' && Number.isFinite(props.windowTokens) && reserveLeft !== null
          ? Math.max(0, percentOf(props.windowTokens, scale) - reserveLeft)
          : null
      if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) {
        return h('p', { className: 'dsh-bc-unknown' }, 'unknown — not enough values to draw a distribution')
      }
      return h(
        'div',
        {
          className: 'dsh-bc-bar',
          role: 'img',
          'aria-label': props.ariaLabel,
          'data-bc': props.name,
          title: props.ariaLabel,
        },
        h(
          'div',
          { className: 'dsh-bc-bar-track' },
          segments.map((segment) =>
            h('div', {
              key: segment.key,
              className: `dsh-bc-bar-seg dsh-bc-seg-${segment.tone ?? 'free'}`,
              style: { width: `${percentOf(segment.tokens, scale)}%` },
            }),
          ),
        ),
        reserveWidth !== null && reserveWidth > 0 && reserveLeft !== null
          ? h('div', {
              className: 'dsh-bc-reserve-zone',
              style: { left: `${reserveLeft}%`, width: `${reserveWidth}%` },
              'aria-hidden': 'true',
            })
          : null,
        triggerLeft !== null
          ? h('div', {
              className: 'dsh-bc-trigger',
              style: { left: `${triggerLeft}%` },
              'aria-hidden': 'true',
              'data-bc-trigger': 'true',
            })
          : null,
        currentLeft !== null
          ? h('div', {
              className: 'dsh-bc-current-line',
              style: { left: `${currentLeft}%` },
              'aria-hidden': 'true',
              'data-bc-current': 'true',
            })
          : null,
      )
    }

    /** Legend for one bar. */
    function TokenLegend(props) {
      return h(
        'ul',
        { className: 'dsh-bc-legend', 'data-bc': props.name },
        (props.items ?? []).map((item) =>
          h(
            'li',
            { key: item.key },
            h('span', { className: `dsh-bc-swatch dsh-bc-swatch-${item.tone ?? 'free'}`, 'aria-hidden': 'true' }),
            h(
              'span',
              null,
              typeof item.tokens === 'number'
                ? `${item.label}: ${tokensText(item.tokens)}`
                : `${item.label} (not separately reported)`,
            ),
          ),
        ),
      )
    }

    /** Build the value segments for the budget composition. */
    function budgetSegments(budget) {
      if (budget === null || budget === undefined) return null
      const windowTokens = budget.contextWindow
      const current = budget.currentTokens
      const fixed = budget.fixedTokens
      const retain = budget.retainTokens
      const summary = budget.summaryMaxTokens
      if (
        typeof windowTokens !== 'number' ||
        typeof current !== 'number' ||
        typeof fixed !== 'number' ||
        typeof retain !== 'number' ||
        typeof summary !== 'number'
      ) {
        return null
      }
      const earlier = Math.max(0, current - fixed - retain)
      return {
        windowTokens,
        current,
        fixed,
        retain,
        summary,
        earlier,
        scale: Math.max(windowTokens, current, fixed + retain + summary, 1),
      }
    }

    // ── budget / retention section ────────────────────────────────────────

    function BudgetSection(props) {
      const { draft, activeConfig, budget, preview, reasons, engineApplies, sessionId, inspectLoading, inspectError, sessionControl } = props
      const disabled = props.disabled
      const thresholdRatio =
        draft.thresholdRatio !== ''
          ? draft.thresholdRatio
          : activeConfig !== null && typeof activeConfig.thresholdRatio === 'number'
            ? String(activeConfig.thresholdRatio)
            : 'unknown'
      const segments = engineApplies === false ? null : budgetSegments(budget)
      const previewStart = preview !== null && preview !== undefined ? preview.rangeStart : null
      const previewEnd = preview !== null && preview !== undefined ? preview.rangeEnd : null
      const hasSafeCut = typeof previewStart === 'number' && typeof previewEnd === 'number'
      const windowText = valueOrUnknown(budget?.contextWindow, tokensText)
      const currentText = valueOrUnknown(budget?.currentTokens, tokensText)
      const fixedText = valueOrUnknown(budget?.fixedTokens, tokensText)
      const thresholdText = valueOrUnknown(budget?.thresholdTokens, tokensText)
      const retainText = valueOrUnknown(budget?.retainTokens, tokensText)
      const summaryText = valueOrUnknown(budget?.summaryMaxTokens, tokensText)
      const measurement =
        budget === null || budget === undefined
          ? 'unknown'
          : budget.measurement === 'measured'
            ? 'measured (provider usage anchor)'
            : budget.measurement === 'estimated'
              ? 'estimated (fixed heuristic)'
              : 'unavailable'
      const emptySession = sessionId === ''

      return h(
        Section,
        { name: 'budget', title: 'Context budget and retention', aside: sessionControl },
        h(
          'div',
          { className: 'dsh-bc-budget-facts' },
          h(Row, { label: 'Context window', value: windowText }),
          h(Row, { label: 'Current tokens', value: currentText, help: `Measurement: ${measurement}` }),
          h(Row, { label: 'Fixed system/tools prefix', value: fixedText }),
          h(Row, { label: 'Configured threshold ratio', value: thresholdRatio }),
          h(Row, { label: 'Effective automatic trigger', value: thresholdText }),
          h(Row, { label: 'Effective retained tail budget', value: retainText }),
          h(Row, { label: 'Summary output cap (maxTokens)', value: summaryText }),
        ),
        h(
          'p',
          { className: 'dsh-bc-caption' },
          'The trigger is min(window × thresholdRatio, window − output reserve − headroom). The exact output-reserve/headroom split is not exposed by the read-only payload; the effective trigger already includes both. Headroom is configured below; the routed output reserve belongs to the session request.',
        ),
        h(Field, {
          name: 'thresholdRatio',
          label: 'Threshold ratio',
          help: 'Request-pressure fraction in (0, 1). The effective trigger above also accounts for the routed output reserve and headroom.',
          error: props.fieldError('thresholdRatio'),
          children: (id) =>
            h('input', {
              id,
              name: 'thresholdRatio',
              className: 'dsh-bc-input dsh-bc-mono',
              type: 'text',
              inputMode: 'decimal',
              value: draft.thresholdRatio,
              disabled,
              onChange: (event) => props.onDraft({ thresholdRatio: event.target.value }),
            }),
        }),
        engineApplies === false
          ? h(
              'p',
              { className: 'dsh-bc-note', 'data-bc': 'budget-not-applicable' },
              'Budget and preview are not drawn: this session runs a different compaction engine. The mode, threshold and retention controls below still configure this plugin for sessions that use it.',
            )
          : inspectError !== null && inspectError !== undefined
            ? h('p', { className: 'dsh-bc-error', role: 'alert' }, `Read-only inspection failed: ${inspectError}. Budget values are unknown; the form remains editable.`)
            : emptySession
              ? h('p', { className: 'dsh-bc-unknown', 'data-bc': 'budget-empty' }, 'Select a session to view measured budget values and the current safe cut. Plugin state is shown without a session.')
              : inspectLoading
                ? h('p', { className: 'dsh-bc-note', role: 'status' }, 'Reading the session budget…')
                : segments === null
                  ? h(
                      'p',
                      { className: 'dsh-bc-unknown', 'data-bc': 'budget-incomplete' },
                      'Budget incomplete or unavailable — some values are unknown, so no token distribution is drawn.',
                    )
                  : h(
                      'div',
                      { className: 'dsh-bc-bar-block' },
                      h(TokenBar, {
                        name: 'budget-window-bar',
                        scale: segments.scale,
                        windowTokens: segments.windowTokens,
                        triggerTokens: budget.thresholdTokens,
                        currentTokens: segments.current,
                        ariaLabel:
                          `Context budget: window ${tokensText(segments.windowTokens)}; current ${tokensText(segments.current)}; ` +
                          `fixed prefix ${tokensText(segments.fixed)}; earlier history ${tokensText(segments.earlier)}; ` +
                          `retained tail ${tokensText(segments.retain)}; effective trigger ${tokensText(budget.thresholdTokens)}. ` +
                          'The zone from the trigger to the window end is output reserve plus headroom.',
                        segments: [
                          { key: 'fixed', label: 'Fixed prefix', tokens: segments.fixed, tone: 'fixed' },
                          { key: 'history', label: 'Earlier history (compactable)', tokens: segments.earlier, tone: 'history' },
                          { key: 'tail', label: 'Retained recent tail', tokens: segments.retain, tone: 'tail' },
                          { key: 'free', label: 'Unused window', tokens: Math.max(0, segments.windowTokens - segments.current), tone: 'free' },
                        ],
                      }),
                      h(TokenLegend, {
                        name: 'budget-legend',
                        items: [
                          { key: 'fixed', label: 'Fixed prefix', tokens: segments.fixed, tone: 'fixed' },
                          { key: 'history', label: 'Earlier history', tokens: segments.earlier, tone: 'history' },
                          { key: 'tail', label: 'Retained recent tail', tokens: segments.retain, tone: 'tail' },
                          { key: 'reserve', label: 'Reserve/headroom zone (trigger → window end)', tokens: null, tone: 'reserve' },
                        ],
                      }),
                      h(
                        'p',
                        { className: 'dsh-bc-caption' },
                        `Trigger line: ${tokensText(budget.thresholdTokens)}. Current marker at ${tokensText(segments.current)}. The band after the trigger is output reserve plus headroom, not free compaction space.`,
                      ),
                    ),
        h(
          'div',
          { className: 'dsh-bc-retention' },
          h('h4', { className: 'dsh-bc-h4' }, 'Recent tail retention (mutually exclusive forms)'),
          h(
            'div',
            { className: 'dsh-bc-retention-forms', role: 'radiogroup', 'aria-label': 'Retention budget form' },
            h(
              'label',
              { className: 'dsh-bc-retention-option' },
              h('input', {
                type: 'radio',
                name: 'retainMode',
                value: 'ratio',
                checked: draft.retainMode === 'ratio',
                disabled,
                onChange: () => props.onRetentionMode('ratio'),
              }),
              h('span', null, 'Ratio of the usable window'),
            ),
            h(
              'label',
              { className: 'dsh-bc-retention-option' },
              h('input', {
                type: 'radio',
                name: 'retainMode',
                value: 'tokens',
                checked: draft.retainMode === 'tokens',
                disabled,
                onChange: () => props.onRetentionMode('tokens'),
              }),
              h('span', null, 'Absolute tokens'),
            ),
          ),
          draft.retainMode === 'ratio'
            ? h(Field, {
                name: 'retainRatio',
                label: 'Retain ratio',
                help:
                  draft.retainRatio === '' && activeConfig !== null && typeof activeConfig.retainRatio === 'number'
                    ? `Empty keeps the engine default; the active snapshot resolves to ${ratioText(activeConfig.retainRatio)}.`
                    : 'A fraction of the usable window. Saving this form clears retainTokens.',
                error: props.fieldError('retainRatio'),
                children: (id) =>
                  h('input', {
                    id,
                    name: 'retainRatio',
                    className: 'dsh-bc-input dsh-bc-mono',
                    type: 'text',
                    inputMode: 'decimal',
                    value: draft.retainRatio,
                    placeholder:
                      activeConfig !== null && typeof activeConfig.retainRatio === 'number'
                        ? String(activeConfig.retainRatio)
                        : 'engine default',
                    disabled,
                    onChange: (event) => props.onDraft({ retainRatio: event.target.value }),
                  }),
              })
            : h(Field, {
                name: 'retainTokens',
                label: 'Retain tokens',
                help: 'Absolute recent-tail budget. Saving this form clears retainRatio.',
                error: props.fieldError('retainTokens'),
                children: (id) =>
                  h('input', {
                    id,
                    name: 'retainTokens',
                    className: 'dsh-bc-input dsh-bc-mono',
                    type: 'text',
                    inputMode: 'numeric',
                    value: draft.retainTokens,
                    disabled,
                    onChange: (event) => props.onDraft({ retainTokens: event.target.value }),
                  }),
              }),
          h(
            'ul',
            { className: 'dsh-bc-bullets', 'data-bc': 'retention-compare' },
            h(
              'li',
              null,
              h('strong', null, 'Automatic pressure: '),
              `keeps up to the resolved recent-tail budget (${retainText}) and aligns the cut to native tool-pairing boundaries.`,
            ),
            h(
              'li',
              null,
              h('strong', null, 'Manual compact / context-overflow recovery: '),
              'uses a more aggressive safe span (the native engine uses retainTokens = 0 for manual/overflow), so it may keep less than the configured budget.',
            ),
            h('li', null, 'The recent tail is a budget, not a permanent pin: the actual safe cut may differ from the budget while keeping tool-call/result pairs intact.'),
          ),
        ),
        h(
          'div',
          { className: 'dsh-bc-preview' },
          h('h4', { className: 'dsh-bc-h4' }, 'Read-only safe cut and composition'),
          engineApplies === false
            ? h('p', { className: 'dsh-bc-note' }, 'No preview is drawn for a session owned by a different compaction engine.')
            : inspectError !== null && inspectError !== undefined
              ? h('p', { className: 'dsh-bc-note' }, 'Preview unavailable because inspection failed.')
              : emptySession
                ? h('p', { className: 'dsh-bc-unknown' }, 'No session selected — no computable safe cut.')
                : preview === null || preview === undefined
                  ? h('p', { className: 'dsh-bc-unknown' }, 'No computable safe cut is available for this session.')
                  : hasSafeCut
                    ? h(
                        'p',
                        { className: 'dsh-bc-strong', 'data-bc': 'safe-cut' },
                        `Safe cut candidate: surface seq ${previewStart}–${previewEnd}; before ${tokensText(preview.beforeTokens)}; ` +
                          `after upper bound ${preview.afterUpperBoundTokens === null ? 'unknown' : `≤ ${tokensText(preview.afterUpperBoundTokens)}`}.`,
                      )
                    : h(
                        'p',
                        { className: 'dsh-bc-unknown', 'data-bc': 'no-safe-cut' },
                        `No computable safe cut. ${typeof preview.reason === 'string' && preview.reason.length > 0 ? preview.reason : 'The native selection returned no range.'}`,
                      ),
          h(ReasonList, { reasons }),
          segments !== null
            ? h(
                'div',
                { className: 'dsh-bc-composition' },
                h('h5', { className: 'dsh-bc-h5' }, 'Before / after composition'),
                h('p', { className: 'dsh-bc-caption' }, 'Before: fixed prefix + earlier history + recent verbatim. After: fixed prefix + summary output budget + recent verbatim.'),
                h('p', { className: 'dsh-bc-strong', 'data-bc': 'before-label' }, 'Before (current surface)'),
                h(TokenBar, {
                  name: 'before-bar',
                  scale: segments.scale,
                  ariaLabel: `Before compaction: fixed prefix ${tokensText(segments.fixed)}, earlier history ${tokensText(segments.earlier)}, retained tail ${tokensText(segments.retain)}.`,
                  segments: [
                    { key: 'fixed', label: 'Fixed prefix', tokens: segments.fixed, tone: 'fixed' },
                    { key: 'history', label: 'Earlier history', tokens: segments.earlier, tone: 'history' },
                    { key: 'tail', label: 'Retained tail', tokens: segments.retain, tone: 'tail' },
                  ],
                }),
                h('p', { className: 'dsh-bc-strong', 'data-bc': 'after-label' }, 'After upper bound (estimate)'),
                h(TokenBar, {
                  name: 'after-bar',
                  scale: segments.scale,
                  ariaLabel: `After compaction upper bound: fixed prefix ${tokensText(segments.fixed)}, summary output budget ${tokensText(segments.summary)}, retained tail ${tokensText(segments.retain)}.`,
                  segments: [
                    { key: 'fixed', label: 'Fixed prefix', tokens: segments.fixed, tone: 'fixed' },
                    { key: 'summary', label: 'Summary output budget', tokens: segments.summary, tone: 'summary' },
                    { key: 'tail', label: 'Retained tail', tokens: segments.retain, tone: 'tail' },
                  ],
                }),
                h(TokenLegend, {
                  name: 'composition-legend',
                  items: [
                    { key: 'fixed', label: 'Fixed prefix', tokens: segments.fixed, tone: 'fixed' },
                    { key: 'summary', label: 'Summary output budget', tokens: segments.summary, tone: 'summary' },
                    { key: 'tail', label: 'Retained tail', tokens: segments.retain, tone: 'tail' },
                  ],
                }),
                h(
                  'p',
                  { className: 'dsh-bc-caption' },
                  'afterUpperBoundTokens is a budget upper-bound estimate (it includes the summary output budget and native checkpoint framing), not a prediction of the generated summary length. The retained tail is the resolved retention budget; the actual safe cut may differ.',
                ),
              )
            : null,
        ),
      )
    }

    // ── model / effort section ────────────────────────────────────────────

    function ModelSection(props) {
      const { draft, routes, modelsStatus, modelsEnabled, modelsError, route } = props
      const nativeMode = draft.mode === 'native'
      const effortLocked = props.disabled || nativeMode
      const providerOptions = [...new Set(routes.map((entry) => entry.provider))]
      const modelOptions = [
        ...new Set(
          routes
            .filter((entry) => draft.provider === '' || entry.provider === draft.provider)
            .map((entry) => entry.model),
        ),
      ]
      const providerListId = `dsh-bc-providers-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
      const modelListId = `dsh-bc-models-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
      const summaryRoute =
        draft.provider === '' && draft.model === ''
          ? 'follow the session route (empty provider/model pair)'
          : draft.provider === '' || draft.model === ''
            ? 'incomplete pair — set provider and model together'
            : `${draft.provider}/${draft.model}`
      const summaryEffort = nativeMode
        ? NATIVE_NOT_APPLICABLE
        : draft.effort === ''
          ? 'model default (empty)'
          : draft.effort

      return h(
        Section,
        { name: 'model', title: 'Summary model and reasoning effort' },
        h(
          'div',
          { className: 'dsh-bc-summary-line', 'data-bc': 'model-summary' },
          h('span', { className: 'dsh-bc-strong' }, `Summary model: ${summaryRoute}`),
          h('span', { className: 'dsh-bc-caption' }, `Effort: ${summaryEffort}`),
        ),
        h(
          'p',
          { className: 'dsh-bc-caption' },
          'An empty provider/model pair follows the session route. An explicit pair is saved atomically and never changes the main session model. An empty effort means the selected summary model’s own default, not an unconditional inheritance from the main model.',
        ),
        h(
          'div',
          { className: 'dsh-bc-grid' },
          h(Field, {
            name: 'summarizationProvider',
            label: 'Summary provider',
            help: 'Empty with an empty model follows the session. Use a host-allowed candidate or free text.',
            error: props.fieldError('summarizationProvider'),
            children: (id) =>
              h('input', {
                id,
                name: 'summarizationProvider',
                className: 'dsh-bc-input',
                type: 'text',
                list: providerListId,
                value: draft.provider,
                disabled: props.disabled,
                autoComplete: 'off',
                onChange: (event) => props.onProvider(event.target.value),
              }),
          }),
          h(Field, {
            name: 'summarizationModel',
            label: 'Summary model',
            help: 'Saved together with the provider; cleared together with the provider.',
            error: props.fieldError('summarizationModel'),
            children: (id) =>
              h('input', {
                id,
                name: 'summarizationModel',
                className: 'dsh-bc-input',
                type: 'text',
                list: modelListId,
                value: draft.model,
                disabled: props.disabled,
                autoComplete: 'off',
                onChange: (event) => props.onModel(event.target.value),
              }),
          }),
          h('datalist', { id: providerListId }, providerOptions.map((provider) => h('option', { key: provider, value: provider }))),
          h('datalist', { id: modelListId }, modelOptions.map((model) => h('option', { key: model, value: model }))),
        ),
        h(
          'div',
          { className: 'dsh-bc-effort' },
          route !== undefined && route.efforts.length > 0
            ? h(Field, {
                name: 'reasoningEffort',
                label: 'Reasoning effort',
                help: nativeMode
                  ? NATIVE_NOT_APPLICABLE
                  : draft.effort === ''
                    ? 'Empty uses the selected model’s default effort.'
                    : 'Must be an effort the selected model advertises.',
                error: props.fieldError('reasoningEffort'),
                children: (id) =>
                  h(
                    'select',
                    {
                      id,
                      name: 'reasoningEffort',
                      className: 'dsh-bc-input',
                      value: draft.effort,
                      disabled: effortLocked,
                      onChange: (event) => props.onDraft({ effort: event.target.value }),
                    },
                    h('option', { value: '' }, 'Model default (empty)'),
                    route.efforts.map((effort) =>
                      h('option', { key: effort, value: effort }, effort === route.defaultEffort ? `${effort} (model default)` : effort),
                    ),
                    draft.effort !== '' && !route.efforts.includes(draft.effort)
                      ? h('option', { value: draft.effort }, `${draft.effort} (saved; not advertised)`)
                      : null,
                  ),
              })
            : h(Field, {
                name: 'reasoningEffort',
                label: 'Reasoning effort',
                help: nativeMode
                  ? NATIVE_NOT_APPLICABLE
                  : modelsStatus === 'error'
                    ? 'Model capability metadata is unavailable; free text remains available and may be rejected by the engine.'
                    : 'Capability unknown for this route: free-text effort, or leave empty for the model default.',
                error: props.fieldError('reasoningEffort'),
                children: (id) =>
                  h('input', {
                    id,
                    name: 'reasoningEffort',
                    className: 'dsh-bc-input',
                    type: 'text',
                    value: draft.effort,
                    disabled: effortLocked,
                    placeholder: nativeMode ? NATIVE_NOT_APPLICABLE : 'model default (empty)',
                    autoComplete: 'off',
                    onChange: (event) => props.onDraft({ effort: event.target.value }),
                  }),
              }),
          nativeMode
            ? h('p', { className: 'dsh-bc-note', 'data-bc': 'effort-native' }, `Reasoning effort: ${NATIVE_NOT_APPLICABLE}. The saved value is kept for switching back.`)
            : null,
        ),
        props.routeWarning === null || props.routeWarning === undefined
          ? null
          : h(
              'p',
              { className: 'dsh-bc-error', role: 'alert', 'data-bc': 'route-warning' },
              props.routeWarning,
            ),
        h(
          'div',
          { className: 'dsh-bc-candidates' },
          modelsStatus === 'loading' || modelsStatus === 'refreshing'
            ? h('p', { className: 'dsh-bc-note', role: 'status' }, 'Reading host-allowed summary-model candidates…')
            : modelsStatus === 'error'
              ? h(
                  'p',
                  { className: 'dsh-bc-note', 'data-bc': 'models-error' },
                  `Allowed candidate metadata unavailable: ${modelsError}. Free-text provider/model remains available; capabilities are unknown.`,
                )
              : modelsEnabled !== true
                ? h(
                    'p',
                    { className: 'dsh-bc-note', 'data-bc': 'models-unavailable' },
                    'The Host’s allowed-model selection service is not enabled. Free-text provider/model is used; discovered and currently usable routes are unknown.',
                  )
                : h(
                    'details',
                    { className: 'dsh-bc-candidate-details' },
                    h('summary', null, `Allowed candidates from the host model selection (${routes.length})`),
                    routes.length === 0
                      ? h('p', { className: 'dsh-bc-note' }, 'The host allows no candidate routes.')
                      : h(
                          'ul',
                          { className: 'dsh-bc-candidate-list' },
                          routes.map((entry) =>
                            h(
                              'li',
                              { key: `${entry.provider}/${entry.model}` },
                              h('span', { className: 'dsh-bc-strong' }, `${entry.provider}/${entry.model}`),
                              h(
                                'span',
                                { className: 'dsh-bc-caption' },
                                entry.efforts.length === 0
                                  ? ' · efforts: unknown'
                                  : ` · efforts: ${entry.efforts.join(', ')}${entry.defaultEffort === '' ? '' : ` (default ${entry.defaultEffort})`}`,
                              ),
                            ),
                          ),
                        ),
                    h(
                      'p',
                      { className: 'dsh-bc-caption' },
                      'This is the discovered/allowed candidate set; it is not a promise that the current session can use a route. Credentials, capacity, and session availability are not verified by this read-only page.',
                    ),
                  ),
        ),
      )
    }

    // ── cache section ─────────────────────────────────────────────────────

    function CacheSection(props) {
      const nativeMode = props.draft.mode === 'native'
      return h(
        Section,
        { name: 'cache', title: 'Cache priority' },
        h(Toggle, {
          name: 'cachePriority',
          label: CACHE_PRIORITY_COPY,
          checked: props.draft.cachePriority,
          disabled: props.disabled || nativeMode,
          onChange: (checked) => props.onDraft({ cachePriority: checked }),
          help:
            'When enabled, the enhanced summary request keeps the conversation’s normal system/tools/history prefix so the provider can reuse its prompt cache; the instruction and volatile goal state go at the end.',
          note: nativeMode
            ? `${NATIVE_NOT_APPLICABLE}. The saved enhanced value is kept for switching back.`
            : null,
        }),
        h(
          'ul',
          { className: 'dsh-bc-bullets' },
          h('li', null, 'Changing the summary provider or model can lose prefix reuse. That is a real trade-off, not a cost this plugin can hide.'),
          h('li', null, 'A compaction replacement changes the old prefix; retained tail text does not preserve the old KV cache.'),
          h('li', null, 'This is a best-effort preference, not a claim of lossless KV reuse or zero cache loss. Cache hits are only shown when the provider reports real usage.'),
        ),
      )
    }

    // ── advanced section ──────────────────────────────────────────────────

    function AdvancedSection(props) {
      const { draft, stateValue, disabled } = props
      const policies = Array.isArray(stateValue?.modelPolicies) ? stateValue.modelPolicies : []
      return h(
        'details',
        { className: 'dsh-bc-details', 'data-bc': 'advanced' },
        h('summary', null, 'Advanced settings'),
        h(
          'div',
          { className: 'dsh-bc-details-body' },
          h(Toggle, {
            name: 'auto',
            label: 'Automatic pressure and overflow compaction',
            checked: draft.auto,
            disabled,
            onChange: (checked) => props.onDraft({ auto: checked }),
            help: 'When off, automatic pressure/overflow compaction stops; manual /compact still works.',
          }),
          h(
            'div',
            { className: 'dsh-bc-grid' },
            h(Field, {
              name: 'headroomTokens',
              label: 'Headroom tokens',
              help: 'Non-negative extra pressure headroom beyond the routed output reservation.',
              error: props.fieldError('headroomTokens'),
              children: (id) =>
                h('input', {
                  id,
                  name: 'headroomTokens',
                  className: 'dsh-bc-input dsh-bc-mono',
                  type: 'text',
                  inputMode: 'numeric',
                  value: draft.headroomTokens,
                  disabled,
                  onChange: (event) => props.onDraft({ headroomTokens: event.target.value }),
                }),
            }),
            h(Field, {
              name: 'maxTokens',
              label: 'Summary max tokens',
              help: 'Positive summary output cap, counted with input against the model window. Empty follows the resolved headroom.',
              error: props.fieldError('maxTokens'),
              children: (id) =>
                h('input', {
                  id,
                  name: 'maxTokens',
                  className: 'dsh-bc-input dsh-bc-mono',
                  type: 'text',
                  inputMode: 'numeric',
                  value: draft.maxTokens,
                  placeholder: 'follows headroomTokens',
                  disabled,
                  onChange: (event) => props.onDraft({ maxTokens: event.target.value }),
                }),
            }),
            h(Field, {
              name: 'compactionRetries',
              label: 'Compaction retries',
              help: 'Extra attempts when pressure remains after a successful compaction. This is not a general network retry count.',
              error: props.fieldError('compactionRetries'),
              children: (id) =>
                h('input', {
                  id,
                  name: 'compactionRetries',
                  className: 'dsh-bc-input dsh-bc-mono',
                  type: 'text',
                  inputMode: 'numeric',
                  value: draft.compactionRetries,
                  disabled,
                  onChange: (event) => props.onDraft({ compactionRetries: event.target.value }),
                }),
            }),
            h(Field, {
              name: 'maxOverflowRetries',
              label: 'Max overflow retries',
              help: 'Bounded recoveries after a provider-confirmed context overflow. 0 disables overflow recovery. Separate from post-compaction pressure retries.',
              error: props.fieldError('maxOverflowRetries'),
              children: (id) =>
                h('input', {
                  id,
                  name: 'maxOverflowRetries',
                  className: 'dsh-bc-input dsh-bc-mono',
                  type: 'text',
                  inputMode: 'numeric',
                  value: draft.maxOverflowRetries,
                  disabled,
                  onChange: (event) => props.onDraft({ maxOverflowRetries: event.target.value }),
                }),
            }),
          ),
          h(
            'div',
            { className: 'dsh-bc-policies', 'data-bc': 'model-policies' },
            h('h4', { className: 'dsh-bc-h4' }, 'Per-model policies (read-only)'),
            policies.length === 0
              ? h('p', { className: 'dsh-bc-note' }, 'No per-model overrides are configured; routes inherit the global values.')
              : h(
                  'ul',
                  { className: 'dsh-bc-policy-list' },
                  policies.map((policy, index) => {
                    const overrides = Object.keys(policy)
                      .filter((key) => key !== 'provider' && key !== 'model')
                      .map((key) => `${key}=${JSON.stringify(policy[key])}`)
                    return h(
                      'li',
                      { key: `${policy.provider}/${policy.model}/${index}` },
                      h('span', { className: 'dsh-bc-strong' }, `${policy.provider}/${policy.model}`),
                      h('span', { className: 'dsh-bc-caption' }, overrides.length === 0 ? ' · inherits everything' : ` · ${overrides.join(', ')}`),
                    )
                  }),
                ),
            h(
              'p',
              { className: 'dsh-bc-caption' },
              'These overrides are preserved as-is. Saving the global form never rewrites or drops modelPolicies, and this version has no rule editor.',
            ),
          ),
          h(
            'p',
            { className: 'dsh-bc-caption' },
            'No handoff-directory, compaction-history, memory, or sidecar database controls are provided. Handoff files live under the OS temporary directory and are not the only recovery source.',
          ),
        ),
      )
    }

    // ── status section ────────────────────────────────────────────────────

    const STATUS_LABELS = Object.freeze({
      running: 'Running',
      completed: 'Completed',
      failed: 'Failed',
      cancelled: 'Cancelled',
      'persistence-error': 'Persistence error',
    })

    /** One-line engine ownership statement. */
    function engineNote(engine) {
      if (engine === null || engine === undefined) return 'Engine ownership: unknown (no session selected).'
      if (engine.inspectApplies === false) {
        return `This session runs a different compaction engine (owner: ${engine.owner}). Mode and budget settings on this page do not apply to it; no fake budget or preview is drawn, and the recorded compaction below still comes from the session’s real native events.`
      }
      if (engine.owner === 'unknown') {
        return `Engine ownership could not be proven for this session (${engine.owner}). Budget and preview use this plugin’s active configuration; treat them as configuration diagnostics, not observed engine state.`
      }
      return `Compaction engine: ${engine.owner}. Budget and preview use this plugin’s configuration; inspection is read-only.`
    }

    /** The status of the last real native compaction bracket. */
    function LastCompaction(props) {
      const record = props.record
      if (record === null || record === undefined) {
        return h('p', { className: 'dsh-bc-unknown', 'data-bc': 'last-compaction-empty' }, props.emptyText)
      }
      const status = STATUS_LABELS[record.status] ?? 'Unknown status'
      const cacheRead = typeof record.cacheReadTokens === 'number' ? record.cacheReadTokens : null
      const cacheWrite = typeof record.cacheWriteTokens === 'number' ? record.cacheWriteTokens : null
      const cacheRows = [
        cacheRead === null
          ? null
          : h(Row, { key: 'cache-read', label: 'Cache read tokens (reported)', value: tokensText(cacheRead) }),
        cacheWrite === null
          ? null
          : h(Row, { key: 'cache-write', label: 'Cache write tokens (reported)', value: tokensText(cacheWrite) }),
      ].filter((row) => row !== null)
      return h(
        'div',
        { className: 'dsh-bc-status-record', 'data-bc': 'last-compaction', 'data-status': record.status ?? 'unknown' },
        h('p', { className: `dsh-bc-status-line dsh-bc-status-${record.status ?? 'unknown'}`, 'data-bc': 'last-compaction-status' }, `${status} · ${record.trigger === 'manual' ? 'manual' : record.trigger === 'automatic' ? 'automatic' : 'unknown trigger'}`),
        h(
          'div',
          { className: 'dsh-bc-status-grid' },
          h(Row, { label: 'Trigger', value: record.trigger === 'manual' ? 'manual' : record.trigger === 'automatic' ? 'automatic' : 'unknown' }),
          h(Row, { label: 'Status', value: status }),
          h(Row, { label: 'Mode', value: typeof record.mode === 'string' ? record.mode : 'unknown (not provable from the record)' }),
          h(Row, { label: 'Duration', value: durationText(record.durationMs) }),
          h(Row, { label: 'Shadowed tokens (before)', value: tokensText(record.beforeTokens) }),
          h(Row, { label: 'Checkpoint estimate (after)', value: tokensText(record.afterTokens) }),
          ...cacheRows,
        ),
        cacheRows.length === 0
          ? h('p', { className: 'dsh-bc-caption' }, 'Cache usage: unknown. The provider did not report cache tokens for this attempt; absence is not zero and no savings rate is estimated.')
          : null,
        h(
          'p',
          { className: 'dsh-bc-caption' },
          'Cost: unknown (the inspect projection carries no pricing data). Token counts come from recorded native events/usage; missing fields are not filled from the current configuration.',
        ),
        record.status === 'persistence-error'
          ? h(
              'p',
              { className: 'dsh-bc-error', role: 'alert', 'data-bc': 'persistence-error' },
              'The checkpoint replacement may already be durable, but saving the session failed. This is not a clean success and not a full rollback.',
            )
          : null,
        record.status === 'failed'
          ? h(
              'p',
              { className: 'dsh-bc-note' },
              'This attempt did not install a checkpoint. A failure does not prove the session had no earlier durable changes.',
            )
          : null,
        record.status === 'cancelled'
          ? h('p', { className: 'dsh-bc-note' }, 'This attempt was cancelled. No checkpoint was installed for it.')
          : null,
        record.status === 'running'
          ? h('p', { className: 'dsh-bc-note' }, 'A live in-memory summary attempt is in flight in this process; it is not historical proof of completion.')
          : null,
        record.error === null || record.error === undefined
          ? null
          : h('p', { className: 'dsh-bc-error', 'data-bc': 'last-compaction-error' }, `Recorded error: ${record.error}`),
      )
    }

    /** Recent native compaction, handoff continuation, diagnostics and engine ownership. */
    function StatusSection(props) {
      const { sessionId, engine, engineApplies, record, continuation, diagnostics, inspectError, inspectLoading } = props
      const reasons = []
      const seen = new Set()
      for (const entry of diagnostics ?? []) {
        if (typeof entry !== 'string' || entry.length === 0 || seen.has(entry)) continue
        seen.add(entry)
        reasons.push(entry)
      }
      return h(
        Section,
        { name: 'status', title: 'Recent native compaction' },
        h('p', { className: 'dsh-bc-caption' }, 'This refresh performs no compaction, LLM call, CLI call, or file write. The status below is projected from real native events and provider usage only.'),
        h('p', { className: 'dsh-bc-note', 'data-bc': 'engine-note' }, engineNote(engine)),
        inspectError !== null && inspectError !== undefined
          ? h('p', { className: 'dsh-bc-error', role: 'alert', 'data-bc': 'inspect-error' }, `${inspectError}. The form remains editable; only the read-only status is affected.`)
          : null,
        sessionId === ''
          ? h('p', { className: 'dsh-bc-unknown', 'data-bc': 'status-empty' }, 'No session selected. Select one above to inspect its recent native compaction; plugin state is shown without a session.')
          : inspectLoading
            ? h('p', { className: 'dsh-bc-note', role: 'status' }, 'Reading the session’s native compaction status…')
            : h(LastCompaction, {
                record,
                emptyText: engineApplies === false
                  ? 'No recorded compaction was found in this session’s native events.'
                  : 'No compaction has been recorded for this session yet.',
              }),
        continuation === null || continuation === undefined
          ? null
          : h(
              'div',
              { className: 'dsh-bc-continuation', 'data-bc': 'handoff-continuation', 'data-status': continuation.status },
              h('h4', { className: 'dsh-bc-h4' }, 'Handoff continuation'),
              h(
                'p',
                { className: 'dsh-bc-strong' },
                continuation.status === 'scheduled'
                  ? 'Scheduled — one ordinary same-session continuation was queued by a successful live manual handoff.'
                  : 'Skipped — no automatic continuation was scheduled; waiting for the user or a gate to clear.',
              ),
              Array.isArray(continuation.blockers) && continuation.blockers.length > 0
                ? h(
                    'ul',
                    { className: 'dsh-bc-bullets' },
                    continuation.blockers.map((blocker, index) => h('li', { key: `${index}-${blocker}` }, String(blocker))),
                  )
                : null,
              h('p', { className: 'dsh-bc-caption' }, 'Replay, page refresh, or plugin reload cannot schedule another continuation.'),
            ),
        reasons.length > 0
          ? h(
              'div',
              { className: 'dsh-bc-diagnostics', 'data-bc': 'diagnostics' },
              h('h4', { className: 'dsh-bc-h4' }, 'Diagnostics'),
              h(ReasonList, { reasons }),
            )
          : null,
      )
    }

    // ── session picker ────────────────────────────────────────────────────

    function SessionPicker(props) {
      const rawId = useId()
      const id = `dsh-bc-session-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
      const { entries, selectedId, onSelect, listAvailable, phase, listError, refresh, onRefresh } = props
      return h(
        'div',
        { className: 'dsh-bc-session', 'data-bc': 'session-picker' },
        h(
          'div',
          { className: 'dsh-bc-session-row' },
          h('label', { htmlFor: id, className: 'dsh-bc-label' }, 'Inspect session'),
          h(
            'select',
            {
              id,
              name: 'inspectSession',
              className: 'dsh-bc-input',
              value: selectedId,
              onChange: (event) => onSelect(event.target.value),
            },
            h('option', { value: '' }, 'Plugin state only (no session)'),
            entries.map((entry) =>
              h('option', { key: entry.id, value: entry.id }, `${entry.title}${entry.running ? ' · running' : ''} — ${entry.id}`),
            ),
          ),
        ),
        h(
          'p',
          { className: 'dsh-bc-caption' },
          !listAvailable
            ? 'Session list unavailable; showing plugin state only.'
            : listError !== null && listError !== undefined
              ? `Session list unavailable (${typeof listError.message === 'string' ? listError.message : 'error'}); showing plugin state only.`
              : entries.length === 0
                ? phase === 'pending'
                  ? 'Loading sessions…'
                  : 'No sessions are available; showing plugin state only.'
                : 'The selected session is used only for read-only inspection. No compaction, LLM, CLI, or file write is triggered.',
        ),
        h(
          'div',
          { className: 'dsh-bc-session-actions' },
          h(
            'button',
            { type: 'button', className: 'dsh-bc-btn', onClick: onRefresh, disabled: refresh === true },
            refresh === true ? 'Reading…' : 'Refresh read-only data',
          ),
        ),
      )
    }

    // ── active config banner + save footer ───────────────────────────────

    function ActiveConfigBanner(props) {
      const active = props.activeConfig
      const requiresReload = props.requiresReload
      const unknown = active === null || active === undefined
      const activeRoute =
        unknown
          ? 'unknown'
          : active.summarizationProvider === '' && active.summarizationModel === ''
            ? 'follow session'
            : `${active.summarizationProvider}/${active.summarizationModel}`
      const activeEffort = unknown
        ? 'unknown'
        : active.mode === 'native'
          ? 'not applicable (native decides)'
          : active.reasoningEffort === ''
            ? 'model default'
            : active.reasoningEffort
      const activeCache = unknown
        ? 'unknown'
        : active.mode === 'native'
          ? 'not applicable (native decides)'
          : active.cachePriority === true
            ? 'on'
            : 'off'
      return h(
        'div',
        {
          className: `dsh-bc-banner${requiresReload === true ? ' dsh-bc-banner-warn' : ''}`,
          'data-bc': 'active-config',
          'data-requires-reload': requiresReload === true ? 'true' : requiresReload === false ? 'false' : 'unknown',
        },
        h(
          'p',
          { className: 'dsh-bc-banner-title' },
          requiresReload === true
            ? 'Saved configuration differs from the active engine snapshot — reload the profile to apply.'
            : requiresReload === false
              ? 'Saved values match the active engine snapshot.'
              : 'Active engine snapshot comparison is unavailable.',
        ),
        h(
          'p',
          { className: 'dsh-bc-caption' },
          unknown
            ? 'Active engine configuration: unknown (read-only inspection unavailable).'
            : `Active engine configuration: mode ${active.mode}; summary model ${activeRoute}; effort ${activeEffort}; cache priority ${activeCache}; threshold ratio ${active.thresholdRatio}; retain ${active.retainTokens !== null ? `${active.retainTokens} tokens` : `${active.retainRatio} ratio`}.`,
        ),
        h(
          'p',
          { className: 'dsh-bc-caption' },
          'Editing here changes the saved profile only. Restart the DSH process (reload the profile) to take a new engine snapshot; refreshing the web page does not reload the engine.',
        ),
      )
    }

    function SaveFooter(props) {
      const { saveState, errors, conflict, disabled, saving, writable, revision, onSave, onReload, dirty } = props
      const savingNow = saving || saveState.kind === 'saving'
      const saveDisabled = disabled || savingNow || conflict || !writable || !dirty || errors.length > 0
      const messages = []
      if (saveState.kind === 'saved') {
        messages.push(
          h(
            'p',
            { key: 'saved', className: 'dsh-bc-ok', role: 'status', 'data-bc': 'save-saved' },
            'Saved — reload profile. Restart the DSH process (reload the profile) to apply. Refreshing the web page does not reload the engine; the active snapshot above stays unchanged until then.',
          ),
        )
      }
      if (saveState.kind === 'rejected') {
        messages.push(
          h(
            'p',
            { key: 'rejected', className: 'dsh-bc-error', role: 'alert', 'data-bc': 'save-rejected' },
            'The Host refused the save (usually a revision conflict or a rejected value). The draft is kept and was not applied. Reload host values, compare, and retry; this page will not silently overwrite a newer configuration.',
          ),
        )
      }
      if (saveState.kind === 'transport') {
        messages.push(
          h(
            'p',
            { key: 'transport', className: 'dsh-bc-error', role: 'alert', 'data-bc': 'save-transport' },
            `The save request failed: ${saveState.message}. Nothing was saved; your draft is kept.`,
          ),
        )
      }
      if (saveState.kind === 'invalid' || errors.length > 0) {
        const list = saveState.kind === 'invalid' && Array.isArray(saveState.errors) ? saveState.errors : errors
        messages.push(
          h(
            'div',
            { key: 'invalid', className: 'dsh-bc-error', role: 'alert', 'data-bc': 'save-invalid' },
            h('p', null, 'Fix the highlighted fields before saving:'),
            h('ul', null, list.map((entry) => h('li', { key: entry }, entry))),
          ),
        )
      }
      return h(
        'footer',
        { className: 'dsh-bc-footer', 'data-bc': 'save-footer' },
        h(
          'div',
          { className: 'dsh-bc-footer-copy' },
          messages,
          conflict
            ? h(
                'p',
                { className: 'dsh-bc-error', role: 'alert', 'data-bc': 'revision-conflict' },
                'Configuration changed on the Host while this draft was open. Saving uses one expected revision, so it cannot silently overwrite the newer configuration. Reload host values to compare and continue.',
              )
            : null,
          !writable
            ? h('p', { className: 'dsh-bc-note', 'data-bc': 'read-only' }, 'Read-only: the Host document does not accept writes. Values remain visible and inspect stays usable.')
            : null,
          h(
            'p',
            { className: 'dsh-bc-caption', 'data-bc': 'revision' },
            `Draft based on revision ${revision === null || revision === undefined ? 'unknown' : String(revision)}; one expected revision is sent per save.`,
          ),
        ),
        h(
          'div',
          { className: 'dsh-bc-actions' },
          h('button', { type: 'button', className: 'dsh-bc-btn', onClick: onReload, disabled: savingNow }, 'Reload host values'),
          h(
            'button',
            { type: 'button', className: 'dsh-bc-btn dsh-bc-btn-primary', onClick: onSave, disabled: saveDisabled, 'data-bc': 'save-button' },
            savingNow ? 'Saving…' : 'Save settings',
          ),
        ),
      )
    }

    // ── page ──────────────────────────────────────────────────────────────

    function BetterCompactPage(props) {
      const form = props.form
      const state = form !== undefined && form !== null ? form.state : undefined
      const formStatus = state !== undefined && state !== null && typeof state.status === 'string' ? state.status : 'missing'
      const writable = state !== undefined && state !== null && state.writable === true
      const sessionList = useSessionList(props.sessions ?? null)
      const entries = useMemo(() => sessionEntries(sessionList), [sessionList])
      const [pickedId, setPickedId] = useState(null)
      const availableIds = useMemo(() => new Set(entries.map((entry) => entry.id)), [entries])
      const selectedId =
        pickedId === null ? (entries.length > 0 ? entries[0].id : '') : availableIds.has(pickedId) ? pickedId : ''
      const [refreshToken, setRefreshToken] = useState(0)
      const [draft, setDraft] = useState(() => (formStatus === 'ready' ? draftFromValue(state.value) : null))
      const [draftRevision, setDraftRevision] = useState(() => (formStatus === 'ready' ? state.revision ?? null : null))
      const baseValueRef = useRef(formStatus === 'ready' ? state.value ?? {} : null)
      const [conflict, setConflict] = useState(false)
      const [saveState, setSaveState] = useState({ kind: 'idle' })
      const [saving, setSaving] = useState(false)

      const pluginInspect = useReadOnlyJson(INSPECT_PATH, refreshToken)
      const sessionPath = selectedId === '' ? null : `${INSPECT_PATH}?sessionId=${encodeURIComponent(selectedId)}`
      const sessionInspect = useReadOnlyJson(sessionPath, refreshToken)
      const modelsInspect = useReadOnlyJson(MODELS_PATH, refreshToken)

      // Keep one draft store. Adopt Host changes only while the user has no
      // staged edits; otherwise expose an explicit revision conflict instead of
      // overwriting either side.
      useEffect(() => {
        if (formStatus !== 'ready' || state === undefined || state === null) return
        const value = state.value ?? {}
        const revision = state.revision ?? null
        if (draft === null) {
          baseValueRef.current = value
          setDraft(draftFromValue(value))
          setDraftRevision(revision)
          return
        }
        if (revision === draftRevision) return
        const incoming = draftFromValue(value)
        const untouched = equalDraft(draft, draftFromValue(baseValueRef.current ?? {}))
        if (equalDraft(draft, incoming) || untouched) {
          baseValueRef.current = value
          setDraft(incoming)
          setDraftRevision(revision)
          setConflict(false)
          return
        }
        setConflict(true)
      }, [formStatus, state, draft, draftRevision])

      const activePayload = pluginInspect.payload
      const dataPayload = selectedId === '' ? pluginInspect.payload : sessionInspect.payload
      const activeConfig = activePayload !== null && activePayload !== undefined ? activePayload.activeConfig ?? null : null
      const requiresReload =
        activePayload !== null && activePayload !== undefined && typeof activePayload.requiresReload === 'boolean'
          ? activePayload.requiresReload
          : null
      const inspectError =
        selectedId === ''
          ? pluginInspect.status === 'error'
            ? pluginInspect.error
            : null
          : sessionInspect.status === 'error'
            ? sessionInspect.error
            : pluginInspect.status === 'error'
              ? pluginInspect.error
              : null
      const inspectLoading =
        selectedId === ''
          ? pluginInspect.status === 'loading'
          : sessionInspect.status === 'loading'
      const engine = dataPayload !== null && dataPayload !== undefined ? dataPayload.engine ?? null : null
      const engineApplies = engine !== null && engine.inspectApplies === false ? false : null
      const budget = engineApplies === false ? null : dataPayload !== null && dataPayload !== undefined ? dataPayload.budget ?? null : null
      const preview = engineApplies === false ? null : dataPayload !== null && dataPayload !== undefined ? dataPayload.preview ?? null : null
      const lastCompaction = dataPayload !== null && dataPayload !== undefined ? dataPayload.lastCompaction ?? null : null
      const handoffContinuation =
        dataPayload !== null && dataPayload !== undefined ? dataPayload.handoffContinuation ?? null : null
      const diagnostics = dataPayload !== null && dataPayload !== undefined && Array.isArray(dataPayload.diagnostics) ? dataPayload.diagnostics : []

      const modelsReady = modelsInspect.status === 'ready' && modelsInspect.payload !== null && modelsInspect.payload !== undefined
      const rawRoutes = modelsReady && Array.isArray(modelsInspect.payload.routes) ? modelsInspect.payload.routes : []
      // Validate the read-only metadata once at this boundary; a malformed or
      // older route never crashes the page or becomes a fabricated effort.
      const routes = rawRoutes
        .filter(
          (entry) =>
            entry !== null &&
            typeof entry === 'object' &&
            typeof entry.provider === 'string' &&
            entry.provider.length > 0 &&
            typeof entry.model === 'string' &&
            entry.model.length > 0,
        )
        .map((entry) => ({
          provider: entry.provider,
          model: entry.model,
          efforts: Array.isArray(entry.efforts) ? entry.efforts.filter((effort) => typeof effort === 'string' && effort.length > 0) : [],
          defaultEffort: typeof entry.defaultEffort === 'string' ? entry.defaultEffort : '',
        }))
      const modelsEnabled = modelsReady && modelsInspect.payload.enabled === true
      const modelsError = modelsInspect.status === 'error' ? modelsInspect.error : null
      const currentValue = formStatus === 'ready' && state !== undefined && state !== null ? state.value ?? {} : {}
      const currentDraft = draftFromValue(currentValue)
      const dirty = draft !== null && !equalDraft(draft, currentDraft)
      const baseErrors = draft === null ? [] : validateDraft(draft)
      const modelErrors = draft === null ? [] : validateModelSelection(draft, routes, modelsReady && modelsEnabled === true)
      const errors = [...baseErrors.map((entry) => entry.message), ...modelErrors.map((entry) => entry.message)]
      const fieldError = (field) => {
        const found = [...baseErrors, ...modelErrors].find((entry) => entry.field === field)
        return found === undefined ? undefined : found.message
      }
      const draftRoute = draft === null ? undefined : routeForDraft(draft, routes)
      const routeWarning = draft === null ? null : routeCandidateWarning(draft, routes, modelsReady && modelsEnabled === true)
      const savingNow = saving || saveState.kind === 'saving'

      const updateDraft = (patch) => {
        setDraft((previous) => (previous === null ? previous : { ...previous, ...patch }))
        setSaveState({ kind: 'idle' })
      }

      const reloadHost = () => {
        if (formStatus !== 'ready' || state === undefined || state === null) return
        baseValueRef.current = state.value ?? {}
        setDraft(draftFromValue(state.value ?? {}))
        setDraftRevision(state.revision ?? null)
        setConflict(false)
        setSaveState({ kind: 'idle' })
      }

      const save = async () => {
        if (draft === null || !writable || savingNow) return
        if (conflict || (state.revision ?? null) !== draftRevision) {
          setConflict(true)
          return
        }
        if (equalDraft(draft, draftFromValue(state.value ?? {}))) {
          setSaveState({ kind: 'idle' })
          return
        }
        if (errors.length > 0) {
          setSaveState({ kind: 'invalid', errors })
          return
        }
        const ops = buildOps(draft, state.value ?? {})
        if (ops.length === 0) {
          setSaveState({ kind: 'idle' })
          return
        }
        if (typeof form.mutate !== 'function') {
          setSaveState({ kind: 'transport', message: 'the Host form does not expose mutate()' })
          return
        }
        setSaving(true)
        setSaveState({ kind: 'saving' })
        try {
          const accepted = await form.mutate(ops, draftRevision)
          if (accepted === false) {
            setSaveState({ kind: 'rejected' })
            setRefreshToken((token) => token + 1)
            return
          }
          setSaveState({ kind: 'saved' })
          setRefreshToken((token) => token + 1)
        } catch (error) {
          setSaveState({ kind: 'transport', message: errorMessage(error) })
        } finally {
          setSaving(false)
        }
      }

      const refresh = () => setRefreshToken((token) => token + 1)

      const pageStyle = h('style', { key: 'dsh-bc-style' }, STYLE)
      const title = h(
        'div',
        { className: 'dsh-bc-page-head', key: 'head' },
        h('h2', { className: 'dsh-bc-title' }, 'Compaction'),
        h('p', { className: 'dsh-bc-caption' }, 'Choose how this plugin summarizes history. The read-only panel below shows what the running engine can prove for one session.'),
      )

      if (formStatus === 'missing' || formStatus === 'loading') {
        return h(
          'div',
          { className: 'dsh-bc-page', 'data-better-compact': 'page' },
          pageStyle,
          title,
          h('div', { className: 'dsh-bc-section' }, h('p', { className: 'dsh-bc-note', role: 'status' }, formStatus === 'loading' ? 'Reading configuration…' : 'Waiting for the Host configuration form…')),
        )
      }

      if (formStatus !== 'ready' || state === null || state === undefined) {
        return h(
          'div',
          { className: 'dsh-bc-page', 'data-better-compact': 'page' },
          pageStyle,
          title,
          h(
            'div',
            { className: 'dsh-bc-section' },
            h('p', { className: 'dsh-bc-note', 'data-bc': 'form-unavailable' }, 'The Host does not expose an editable configuration form for this row. No values are invented here.'),
            h(ActiveConfigBanner, { activeConfig, requiresReload }),
          ),
          h(StatusSection, {
            sessionId: selectedId,
            engine,
            engineApplies,
            record: lastCompaction,
            continuation: handoffContinuation,
            diagnostics,
            inspectError,
            inspectLoading,
          }),
        )
      }

      const disabled = !writable || savingNow || formStatus !== 'ready'
      const activeMode = activeConfig !== null && activeConfig !== undefined && typeof activeConfig.mode === 'string' ? activeConfig.mode : null
      const previewReason =
        preview !== null && preview !== undefined && typeof preview.reason === 'string' && preview.reason.length > 0
          ? preview.reason
          : null
      // Diagnostics render in the status section; the budget panel shows the
      // preview reason only when it is not already one of those diagnostics, so
      // the same backend message never appears twice.
      const budgetReasons = previewReason !== null && !diagnostics.includes(previewReason) ? [previewReason] : []

      return h(
        'div',
        { className: 'dsh-bc-page', 'data-better-compact': 'page' },
        pageStyle,
        title,
        h(ActiveConfigBanner, { activeConfig, requiresReload }),
        h(ModeCards, {
          value: draft === null ? '' : draft.mode,
          activeMode,
          disabled,
          onChange: (mode) => updateDraft({ mode }),
        }),
        h(ModelSection, {
          draft: draft ?? draftFromValue({}),
          routes,
          modelsStatus: modelsInspect.status,
          modelsEnabled,
          modelsError,
          route: draftRoute,
          routeWarning,
          disabled,
          fieldError,
          onDraft: updateDraft,
          onProvider: (value) => updateDraft(value === '' ? { provider: '', model: '' } : { provider: value }),
          onModel: (value) => updateDraft(value === '' ? { provider: '', model: '' } : { model: value }),
        }),
        h(BudgetSection, {
          draft: draft ?? draftFromValue({}),
          activeConfig,
          budget,
          preview,
          reasons: budgetReasons,
          engineApplies,
          sessionId: selectedId,
          inspectLoading,
          inspectError,
          disabled,
          fieldError,
          onDraft: updateDraft,
          onRetentionMode: (mode) =>
            updateDraft(mode === 'tokens' ? { retainMode: 'tokens', retainRatio: '' } : { retainMode: 'ratio', retainTokens: '' }),
          sessionControl: h(SessionPicker, {
            entries,
            selectedId,
            onSelect: setPickedId,
            listAvailable: props.sessions !== null && props.sessions !== undefined,
            phase: sessionList !== null && sessionList !== undefined ? sessionList.phase : 'ready',
            listError: sessionList !== null && sessionList !== undefined ? sessionList.error : null,
            refresh: inspectLoading,
            onRefresh: refresh,
          }),
        }),
        h(CacheSection, { draft: draft ?? draftFromValue({}), disabled, onDraft: updateDraft }),
        h(AdvancedSection, { draft: draft ?? draftFromValue({}), stateValue: state.value ?? {}, disabled, fieldError, onDraft: updateDraft }),
        h(StatusSection, {
          sessionId: selectedId,
          engine,
          engineApplies,
          record: lastCompaction,
          continuation: handoffContinuation,
          diagnostics,
          inspectError,
          inspectLoading,
        }),
        h(SaveFooter, {
          saveState,
          errors,
          conflict,
          disabled,
          saving: savingNow,
          writable,
          revision: draftRevision,
          dirty,
          onSave: save,
          onReload: reloadHost,
        }),
      )
    }

    /** One stable row-config entry shared by every assembly key. */
    function BetterCompactConfigEntry(props) {
      if (props.view === 'summary') {
        return h('span', { 'data-better-compact': 'summary' }, SUMMARY)
      }
      return h(BetterCompactPage, { form: props.form, sessions: props.sessions ?? null })
    }

    /** Bind the Host sessions service once, for the registered page component. */
    function createConfigEntry(sessions) {
      return function BoundBetterCompactConfigEntry(props) {
        if (props.view === 'summary') {
          return h('span', { 'data-better-compact': 'summary' }, SUMMARY)
        }
        return h(BetterCompactPage, { form: props.form, sessions })
      }
    }

    // ── host theme styles ─────────────────────────────────────────────────

    const STYLE = `
.dsh-bc-page{display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;min-width:0}
.dsh-bc-page-head{display:flex;flex-direction:column;gap:2px}
.dsh-bc-title{margin:0;font-size:16px;font-weight:600;line-height:24px}
.dsh-bc-section{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);padding:14px;display:flex;flex-direction:column;gap:10px;min-width:0}
.dsh-bc-section-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap}
.dsh-bc-h3{margin:0;font-size:13.5px;font-weight:600;line-height:20px}
.dsh-bc-h4{margin:0;font-size:12.5px;font-weight:600;line-height:18px}
.dsh-bc-h5{margin:0;font-size:12px;font-weight:600;line-height:18px}
.dsh-bc-caption{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:17px}
.dsh-bc-note{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dsh-bc-unknown{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;border:.5px dashed var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);padding:8px 10px}
.dsh-bc-hint{margin:2px 0 0;color:var(--dsw-alias-label-secondary);font-size:11.5px}
.dsh-bc-error{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:18px}
.dsh-bc-ok{color:var(--dsw-alias-state-success-primary);margin:0;font-size:12px;line-height:18px}
.dsh-bc-strong{color:var(--dsw-alias-label-primary);font-weight:500}
.dsh-bc-mono{font-variant-numeric:tabular-nums;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace)}
.dsh-bc-modes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.dsh-bc-mode{position:relative;display:flex;flex-direction:column;gap:7px;padding:12px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);cursor:pointer;min-width:0;transition:background-color 120ms ease,border-color 120ms ease}
.dsh-bc-mode:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-bc-mode:active{background:var(--dsw-alias-interactive-bg-active)}
.dsh-bc-mode:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.dsh-bc-mode[aria-checked=true]{border-color:var(--dsw-alias-state-business-primary);box-shadow:inset 0 0 0 .5px var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-tertiary)}
.dsh-bc-mode[aria-disabled=true]{opacity:.62;cursor:not-allowed}
.dsh-bc-mode-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dsh-bc-mode-title{font-weight:600;font-size:13px}
.dsh-bc-radio-dot{width:13px;height:13px;border-radius:50%;border:1px solid var(--dsw-alias-border-l4);flex:none;position:relative;display:inline-block}
.dsh-bc-mode[aria-checked=true] .dsh-bc-radio-dot{border-color:var(--dsw-alias-state-business-primary)}
.dsh-bc-mode[aria-checked=true] .dsh-bc-radio-dot:after{content:"";position:absolute;inset:2.5px;border-radius:50%;background:var(--dsw-alias-state-business-primary)}
.dsh-bc-tag{font-size:10px;line-height:16px;padding:0 6px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dsh-bc-selected-tag{font-size:10px;line-height:16px;color:var(--dsw-alias-label-primary);border:.5px solid var(--dsw-alias-state-business-primary);border-radius:var(--dsw-radius-sm);padding:0 6px;white-space:nowrap}
.dsh-bc-mode-description{margin:0;color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:17px;min-height:52px}
.dsh-bc-mode-pending{margin:0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-primary);border-left:2px solid var(--dsw-alias-state-business-primary);padding-left:6px}
.dsh-bc-diagram-wrap{min-width:0}
.dsh-bc-diagram{display:block;width:100%;height:auto;color:var(--dsw-alias-label-secondary)}
.dsh-bc-diagram text{fill:currentColor;font-family:inherit;font-size:9px}
.dsh-bc-diagram .dsh-bc-diagram-note{fill:var(--dsw-alias-label-tertiary);font-size:8px}
.dsh-bc-diagram .dsh-bc-node{fill:var(--dsw-alias-bg-layer-2);stroke:var(--dsw-alias-border-l3);stroke-width:1}
.dsh-bc-diagram .dsh-bc-node-strong{fill:var(--dsw-alias-bg-layer-3);stroke:var(--dsw-alias-border-l4);stroke-width:1}
.dsh-bc-diagram .dsh-bc-node-accent{fill:var(--dsw-alias-state-business-tertiary);stroke:var(--dsw-alias-state-business-primary);stroke-width:1}
.dsh-bc-diagram .dsh-bc-node-dashed{fill:var(--dsw-alias-bg-layer-2);stroke:var(--dsw-alias-border-l4);stroke-width:1;stroke-dasharray:3 2}
.dsh-bc-diagram .dsh-bc-edge{stroke:currentColor;stroke-width:1;fill:none}
.dsh-bc-field{display:flex;flex-direction:column;gap:3px;min-width:0}
.dsh-bc-label{font-size:12.5px;font-weight:500;line-height:18px}
.dsh-bc-help{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsh-bc-input{box-sizing:border-box;width:100%;height:28px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;padding:0 8px;min-width:0}
.dsh-bc-input:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-bc-input:disabled{opacity:.6;cursor:not-allowed}
.dsh-bc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px}
.dsh-bc-summary-line{display:flex;flex-wrap:wrap;gap:4px 16px;align-items:baseline}
.dsh-bc-effort{display:flex;flex-direction:column;gap:4px}
.dsh-bc-check{display:flex;align-items:flex-start;gap:8px;cursor:pointer}
.dsh-bc-check input{margin:3px 0 0;accent-color:var(--dsw-alias-state-business-primary);flex:none}
.dsh-bc-row{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:6px 0;border-top:.5px solid var(--dsw-alias-border-l2)}
.dsh-bc-row:first-child{border-top:0}
.dsh-bc-row-label{display:flex;flex-direction:column;gap:0;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dsh-bc-row-value{text-align:right;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dsh-bc-budget-facts{display:flex;flex-direction:column}
.dsh-bc-bar-block{display:flex;flex-direction:column;gap:6px}
.dsh-bc-bar{position:relative;width:100%;height:22px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-3);overflow:hidden}
.dsh-bc-bar-track{display:flex;height:100%;width:100%}
.dsh-bc-bar-seg{height:100%;border-right:.5px solid var(--dsw-alias-border-l1);min-width:0}
.dsh-bc-bar-seg:last-child{border-right:0}
.dsh-bc-seg-fixed{background:var(--dsw-alias-label-caption);opacity:.55}
.dsh-bc-seg-history{background:var(--dsw-alias-state-business-primary);opacity:.38}
.dsh-bc-seg-tail{background:var(--dsw-alias-state-business-primary);opacity:.85}
.dsh-bc-seg-summary{background:repeating-linear-gradient(135deg,var(--dsw-alias-state-business-primary) 0 3px,transparent 3px 6px);opacity:.9}
.dsh-bc-seg-free{background:transparent}
.dsh-bc-reserve-zone{position:absolute;top:0;bottom:0;pointer-events:none;background:repeating-linear-gradient(135deg,var(--dsw-alias-border-l3) 0 2px,transparent 2px 5px);opacity:.6;border-left:.5px dashed var(--dsw-alias-border-l3)}
.dsh-bc-trigger{position:absolute;top:0;bottom:0;border-left:2px solid var(--dsw-alias-label-primary);pointer-events:none}
.dsh-bc-current-line{position:absolute;top:0;bottom:0;border-left:1px dashed var(--dsw-alias-label-secondary);pointer-events:none}
.dsh-bc-legend{display:flex;flex-wrap:wrap;gap:3px 14px;margin:0;padding:0;list-style:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.dsh-bc-legend li{display:inline-flex;align-items:center;gap:5px}
.dsh-bc-swatch{display:inline-block;width:10px;height:10px;border-radius:2px;border:.5px solid var(--dsw-alias-border-l3);flex:none}
.dsh-bc-swatch-fixed{background:var(--dsw-alias-label-caption);opacity:.6}
.dsh-bc-swatch-history{background:var(--dsw-alias-state-business-primary);opacity:.45}
.dsh-bc-swatch-tail{background:var(--dsw-alias-state-business-primary)}
.dsh-bc-swatch-summary{background:repeating-linear-gradient(135deg,var(--dsw-alias-state-business-primary) 0 3px,transparent 3px 6px)}
.dsh-bc-swatch-reserve{background:repeating-linear-gradient(135deg,var(--dsw-alias-border-l3) 0 2px,transparent 2px 5px)}
.dsh-bc-retention{display:flex;flex-direction:column;gap:7px;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:10px}
.dsh-bc-retention-forms{display:flex;flex-wrap:wrap;gap:6px 18px}
.dsh-bc-retention-option{display:inline-flex;align-items:center;gap:6px;font-size:12px;cursor:pointer}
.dsh-bc-retention-option input{accent-color:var(--dsw-alias-state-business-primary);margin:0}
.dsh-bc-preview{display:flex;flex-direction:column;gap:7px;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:10px}
.dsh-bc-composition{display:flex;flex-direction:column;gap:6px;border-top:.5px dashed var(--dsw-alias-border-l2);padding-top:8px}
.dsh-bc-reasons{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary)}
.dsh-bc-bullets{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:3px;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary)}
.dsh-bc-candidates{display:flex;flex-direction:column;gap:6px}
.dsh-bc-candidate-details{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);padding:6px 8px}
.dsh-bc-candidate-details>summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-bc-candidate-list,.dsh-bc-policy-list{margin:6px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:3px;font-size:11.5px;line-height:17px}
.dsh-bc-details{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);padding:0;min-width:0}
.dsh-bc-details>summary{cursor:pointer;padding:11px 14px;font-weight:600;font-size:13px}
.dsh-bc-details[open]>summary{border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dsh-bc-details-body{display:flex;flex-direction:column;gap:10px;padding:12px 14px}
.dsh-bc-policies{display:flex;flex-direction:column;gap:4px;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:9px}
.dsh-bc-status-record{display:flex;flex-direction:column;gap:6px}
.dsh-bc-status-line{display:inline-flex;align-self:flex-start;margin:0;padding:1px 8px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);font-size:12px;font-weight:500;line-height:18px;background:var(--dsw-alias-bg-layer-2)}
.dsh-bc-status-completed{color:var(--dsw-alias-state-success-secondary)}
.dsh-bc-status-failed,.dsh-bc-status-persistence-error{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.dsh-bc-status-cancelled,.dsh-bc-status-running{color:var(--dsw-alias-label-secondary)}
.dsh-bc-status-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 18px}
.dsh-bc-status-grid .dsh-bc-row{padding:4px 0}
.dsh-bc-continuation,.dsh-bc-diagnostics{display:flex;flex-direction:column;gap:5px;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:9px}
.dsh-bc-session{display:flex;flex-direction:column;gap:6px;min-width:0}
.dsh-bc-session-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.dsh-bc-session-row .dsh-bc-input{width:auto;min-width:min(260px,100%);max-width:100%;flex:1 1 240px}
.dsh-bc-session-actions{display:flex;gap:6px;flex-wrap:wrap}
.dsh-bc-btn{box-sizing:border-box;height:28px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:18px;padding:0 12px;cursor:pointer;white-space:nowrap}
.dsh-bc-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-bc-btn:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}
.dsh-bc-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-bc-btn:disabled{opacity:.5;cursor:not-allowed}
.dsh-bc-btn-primary{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}
.dsh-bc-btn-primary:hover:not(:disabled){background:var(--dsw-alias-state-business-primary)}
.dsh-bc-footer{position:static;display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);padding:12px 14px}
.dsh-bc-footer-copy{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1 1 280px}
.dsh-bc-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.dsh-bc-banner{display:flex;flex-direction:column;gap:4px;border-left:2px solid var(--dsw-alias-state-business-primary);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);padding:8px 10px}
.dsh-bc-banner-warn{border-left-color:var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-state-warn-tertiary)}
.dsh-bc-banner-title{margin:0;font-size:12px;line-height:18px;font-weight:500}
@media (max-width:760px){.dsh-bc-modes{grid-template-columns:1fr}.dsh-bc-mode-description{min-height:0}.dsh-bc-diagram{max-width:420px;margin:0 auto}}
@media (max-width:600px){.dsh-bc-grid,.dsh-bc-status-grid{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){.dsh-bc-page *{transition:none!important;animation:none!important}.dsh-bc-mode:active{background:var(--dsw-alias-bg-layer-1)}}
`

    /** Services this client half consumes. */
    const inject = ['slots', 'sessions']

    /** Register the same row page under every assembly key. */
    function apply(ctx) {
      const sessions = ctx.sessions ?? null
      const Entry = createConfigEntry(sessions)
      ctx.effect(
        () =>
          ctx.slots.inject(SLOT, () => {
            const disposers = ROW_KEYS.map((key) => ctx.slots.register({ name: SLOT, key }, Entry))
            return () => {
              for (const dispose of disposers) dispose()
            }
          }),
        'dsh-better-compact: row config entry',
      )
    }

    exports.inject = inject
    exports.apply = apply
    exports.ROW_CONFIG_KEYS = ROW_KEYS
    exports.BetterCompactConfigEntry = BetterCompactConfigEntry
    exports.createConfigEntry = createConfigEntry
    return module.exports
  },
})
