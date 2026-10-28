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
        label: 'DSH 原生',
        description: '原生摘要与 checkpoint；近期原文保留。',
        caption: '原生决定摘要请求；增强 effort / 缓存项不适用。',
      }),
      goal: Object.freeze({
        label: 'Goal 增强',
        badge: '默认',
        description: '结合权威 Goal / Todo 生成交接摘要，不接管目标。',
        caption: '无 Goal 也可运行；只读目标，不修改轮次或完成状态。',
      }),
      handoff: Object.freeze({
        label: '文件 Handoff',
        badge: null,
        description: '临时文件交接，正文入原生记录，可在同会话继续。',
        caption: '不新建会话或历史库；文件不是唯一恢复来源。',
      }),
    })
    /** One-line summary used by the Plugins page before opening the row. */
    const SUMMARY =
      '原生 / Goal 增强 / 文件 Handoff 压缩，附只读诊断。'
    /** Strategy disclaimer required on the mode cards. */
    const STRATEGY_NOTE =
      '策略示意，非实时 token 流或缓存命中率。'
    /** Native-mode applicability copy required by the spec. */
    const NATIVE_NOT_APPLICABLE = '不适用：由原生实现决定'
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
        errors.push({ field: 'mode', message: '请选择一种压缩模式。' })
      }

      const thresholdRatio = parseNumberInput(draft.thresholdRatio)
      const thresholdValid =
        thresholdRatio !== null &&
        !Number.isNaN(thresholdRatio) &&
        thresholdRatio > 0 &&
        thresholdRatio < 1
      if (!thresholdValid) {
        errors.push({ field: 'thresholdRatio', message: '自动压缩阈值（thresholdRatio）必须大于 0 且小于 1。' })
      }

      const headroom = parseIntegerInput(draft.headroomTokens)
      const headroomValid = headroom !== null && !Number.isNaN(headroom) && headroom >= 0
      if (!headroomValid) {
        errors.push({ field: 'headroomTokens', message: '额外预留（headroomTokens）必须为非负整数。' })
      }

      if (draft.retainMode === 'tokens') {
        const retainTokens = parseIntegerInput(draft.retainTokens)
        if (retainTokens === null || Number.isNaN(retainTokens) || retainTokens < 0) {
          errors.push({ field: 'retainTokens', message: '保留 token 数必须为非负整数。' })
        }
      } else if (draft.retainRatio !== '') {
        const retainRatio = parseNumberInput(draft.retainRatio)
        if (retainRatio === null || Number.isNaN(retainRatio) || retainRatio <= 0 || retainRatio >= 1) {
          errors.push({ field: 'retainRatio', message: '保留比例必须大于 0 且小于 1。' })
        } else if (thresholdValid && retainRatio >= thresholdRatio) {
          errors.push({ field: 'retainRatio', message: '保留比例必须低于自动压缩阈值。' })
        }
      }

      if ((draft.provider === '') !== (draft.model === '')) {
        errors.push({
          field: 'summarizationModel',
          message: '摘要 provider / model 必须成对填写，或同时留空以跟随会话。',
        })
      }

      if (draft.maxTokens === '') {
        if (headroom === 0) {
          errors.push({
            field: 'maxTokens',
            message: 'headroomTokens 为 0 时必须填写 maxTokens：原生引擎需要正数摘要输出上限。',
          })
        }
      } else {
        const maxTokens = parseIntegerInput(draft.maxTokens)
        if (maxTokens === null || Number.isNaN(maxTokens) || maxTokens <= 0) {
          errors.push({ field: 'maxTokens', message: '摘要输出上限（maxTokens）必须为正整数。' })
        }
      }

      const compactionRetries = parseIntegerInput(draft.compactionRetries)
      if (compactionRetries === null || Number.isNaN(compactionRetries) || compactionRetries < 0) {
        errors.push({ field: 'compactionRetries', message: '压力残留重试（compactionRetries）必须为非负整数。' })
      }
      const maxOverflowRetries = parseIntegerInput(draft.maxOverflowRetries)
      if (maxOverflowRetries === null || Number.isNaN(maxOverflowRetries) || maxOverflowRetries < 0) {
        errors.push({ field: 'maxOverflowRetries', message: '超限恢复次数（maxOverflowRetries）必须为非负整数。' })
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
              `模型 ${draft.provider}/${draft.model} 未声明支持思考强度 "${draft.effort}"。` +
              '请选择支持的强度，或明确清空以使用摘要模型默认值。',
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
        `摘要路由 "${draft.provider}/${draft.model}" 不在宿主候选列表中。` +
        '当前值已保留；候选列表仅为宿主元数据，不是摘要路由的硬限制。' +
        '请确认当前会话能使用此路由、选择候选，或清空两项以跟随会话。'
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

    // Shared SVG primitives keep arrow tips on node boundaries, not near them.
    function DiagramNode(props) {
      const { id, x, y, width, height, lines, tone = '' } = props
      return h('g', null,
        h('rect', { 'data-node': id, className: 'dsh-bc-node ' + tone, x, y, width, height, rx: 4 }),
        lines.map((line, index) => h('text', {
          key: index, x: x + width / 2, y: y + height / 2 + 4 + (index - (lines.length - 1) / 2) * 14,
          textAnchor: 'middle',
        }, line)),
      )
    }

    function DiagramEdge(props) {
      return h('path', { className: 'dsh-bc-edge', 'data-from': props.from, 'data-to': props.to,
        d: props.d, markerEnd: 'url(#' + props.marker + ')' })
    }

    function StrategySvg(props) {
      return h('svg', { className: 'dsh-bc-diagram', viewBox: '0 0 180 170', role: 'img',
        'data-diagram': props.mode, 'aria-label': props.label },
        h('title', null, props.label),
        h('defs', null, h('marker', { id: props.marker, viewBox: '0 0 6 6', refX: 6, refY: 3,
          markerWidth: 6, markerHeight: 6, orient: 'auto', markerUnits: 'userSpaceOnUse' },
          h('path', { d: 'M0 0 L6 3 L0 6 Z', fill: 'currentColor' }))),
        h(DiagramNode, { id: 'fixed', x: 2, y: 2, width: 176, height: 22, lines: ['固定提示 / 工具前缀'], tone: 'dsh-bc-node-dashed' }),
        props.children,
      )
    }

    function NativeDiagram() {
      const marker = 'bc-native-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
      return h(StrategySvg, { mode: 'native', marker,
        label: 'DSH 原生：较早历史经原生压缩生成原生摘要，近期原文保留，组成原生 checkpoint；固定提示与工具前缀独立。' },
        h(DiagramNode, { id: 'history', x: 2, y: 38, width: 96, height: 28, lines: ['较早历史'] }),
        h(DiagramNode, { id: 'recent', x: 108, y: 38, width: 70, height: 28, lines: ['近期原文'] }),
        h(DiagramEdge, { from: 'history', to: 'summary', d: 'M50 66 L50 96', marker }),
        h(DiagramEdge, { from: 'recent', to: 'tail', d: 'M143 66 L143 96', marker }),
        h('text', { x: 6, y: 85 }, '原生压缩'),
        h(DiagramNode, { id: 'summary', x: 2, y: 96, width: 96, height: 28, lines: ['原生摘要'], tone: 'dsh-bc-node-accent' }),
        h(DiagramNode, { id: 'tail', x: 108, y: 96, width: 70, height: 28, lines: ['原文保留'], tone: 'dsh-bc-node-strong' }),
        h(DiagramEdge, { from: 'summary', to: 'checkpoint', d: 'M50 124 L50 144', marker }),
        h(DiagramEdge, { from: 'tail', to: 'checkpoint', d: 'M143 124 L143 144', marker }),
        h(DiagramNode, { id: 'checkpoint', x: 2, y: 144, width: 176, height: 24, lines: ['原生 checkpoint'] }),
      )
    }

    function GoalDiagram() {
      const marker = 'bc-goal-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
      return h(StrategySvg, { mode: 'goal', marker,
        label: 'Goal 增强：较早历史与只读权威 Goal / Todo 合流，生成目标、约束、进展、下一步摘要；近期原文保留，不修改目标或轮次。' },
        h(DiagramNode, { id: 'history', x: 2, y: 38, width: 76, height: 36, lines: ['较早历史'] }),
        h(DiagramNode, { id: 'authority', x: 88, y: 38, width: 90, height: 36, lines: ['Goal / Todo', '权威状态·只读'], tone: 'dsh-bc-node-dashed' }),
        h(DiagramEdge, { from: 'history', to: 'summary', d: 'M40 74 L40 88 L54 88 L54 102', marker }),
        h(DiagramEdge, { from: 'authority', to: 'summary', d: 'M133 74 L133 88 L54 88 L54 102', marker }),
        h(DiagramNode, { id: 'summary', x: 2, y: 102, width: 104, height: 40, lines: ['目标·约束', '进展·下一步'], tone: 'dsh-bc-node-accent' }),
        h(DiagramNode, { id: 'tail', x: 116, y: 102, width: 62, height: 40, lines: ['近期原文', '保留'], tone: 'dsh-bc-node-strong' }),
        h('text', { x: 90, y: 164, textAnchor: 'middle' }, '写入原生记录 · 不接管目标'),
      )
    }

    function HandoffDiagram() {
      const marker = 'bc-handoff-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
      return h(StrategySvg, { mode: 'handoff', marker,
        label: '文件 Handoff：对话与状态生成本次临时交接文件，正文写入原生事件，再在同会话继续；近期原文保留。文件不是唯一恢复来源。' },
        h(DiagramNode, { id: 'history', x: 2, y: 38, width: 64, height: 36, lines: ['对话', '与状态'] }),
        h(DiagramNode, { id: 'file', x: 88, y: 38, width: 90, height: 36, lines: ['临时文件', '本次交接'], tone: 'dsh-bc-node-dashed' }),
        h(DiagramEdge, { from: 'history', to: 'file', d: 'M66 56 L88 56', marker }),
        h(DiagramEdge, { from: 'file', to: 'summary', d: 'M133 74 L133 86 L54 86 L54 100', marker }),
        h(DiagramNode, { id: 'summary', x: 2, y: 100, width: 104, height: 36, lines: ['原生事件', '保存交接正文'], tone: 'dsh-bc-node-accent' }),
        h(DiagramNode, { id: 'tail', x: 116, y: 100, width: 62, height: 36, lines: ['近期原文', '保留'], tone: 'dsh-bc-node-strong' }),
        h(DiagramEdge, { from: 'summary', to: 'continuation', d: 'M54 136 L54 146', marker }),
        h(DiagramNode, { id: 'continuation', x: 2, y: 146, width: 176, height: 22, lines: ['同会话继续 · 不新建会话'] }),
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
            ? h('span', { className: 'dsh-bc-selected-tag', 'data-bc-selected-tag': 'true' }, '已选')
            : null,
        ),
        h('p', { className: 'dsh-bc-mode-description' }, meta.description),
        h('div', { className: 'dsh-bc-diagram-wrap' }, h(Diagram)),
        props.pending
          ? h(
              'p',
              { className: 'dsh-bc-mode-pending', 'data-bc-mode-pending': 'true' },
              '与运行模式不同；保存后重载 profile 生效。',
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
          { className: 'dsh-bc-modes', role: 'radiogroup', 'aria-label': '压缩模式', 'data-bc': 'mode-cards' },
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
        h('div', { className: 'dsh-bc-strategy-foot' },
          h('p', { className: 'dsh-bc-caption', 'data-bc': 'strategy-note' }, STRATEGY_NOTE),
          h('details', { className: 'dsh-bc-explanation' }, h('summary', null, '模式说明'),
            MODES.map((mode) => h('p', { key: mode, className: 'dsh-bc-caption' }, MODE_META[mode].label + '：' + MODE_META[mode].caption))),
        ),
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
          label: '模型容量不足',
          hint: '请调整摘要模型 / 上下文容量，或降低 maxTokens。',
        }
      }
      if (/leaving no pressure budget/i.test(text)) {
        return {
          label: '额外预留与输出预留占满窗口',
          hint: '请降低 headroomTokens / maxTokens，或选择更大窗口的模型。',
        }
      }
      if (/must be less than threshold tokens/i.test(text)) {
        return {
          label: '保留预算与触发线冲突',
          hint: '请降低保留预算或提高阈值比例。',
        }
      }
      if (/no safe compactable range/i.test(text)) {
        return {
          label: /system prompt|retained tail|tool-call/i.test(text) ? '固定前缀 / 近期保留未留出安全区间' : '无安全可压缩区间',
          hint: '请降低保留预算 / 阈值，或等待更多可压缩历史。',
        }
      }
      if (/no routed request/i.test(text)) {
        return {
          label: '尚无模型路由请求',
          hint: '请先在会话中发送请求，或显式配置摘要 provider / model。',
        }
      }
      if (/no context capacity/i.test(text) || /model metadata is unavailable/i.test(text)) {
        return {
          label: '模型容量未知（unknown）',
          hint: '请检查该路由模型的适配器元数据。',
        }
      }
      if (/below the automatic trigger/i.test(text)) {
        return { label: '尚未到达自动触发线（提示）', hint: null }
      }
      if (/automatic compaction is disabled/i.test(text)) {
        return { label: '自动压缩已关闭（提示）', hint: '可在高级选项中开启自动压缩。' }
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
        { name: 'budget', title: '上下文预算与保留范围', aside: sessionControl },
        h(
          'div',
          { className: 'dsh-bc-budget-facts' },
          h(Row, { label: '模型窗口', value: windowText }),
          h(Row, { label: '当前上下文', value: currentText, help: `Measurement: ${measurement}` }),
          h(Row, { label: '固定提示 / 工具前缀', value: fixedText }),
          h(Row, { label: '配置阈值比例（草稿）', value: thresholdRatio }),
          h(Row, { label: '运行触发线', value: thresholdText }),
          h(Row, { label: '运行保留预算', value: retainText }),
          h(Row, { label: '摘要输出上限（maxTokens）', value: summaryText }),
        ),
        h(
          'p',
          { className: 'dsh-bc-caption' },
          '触发线 = min(窗口 × 阈值比例, 窗口 − 输出预留 − headroom)。诊断未单独提供输出预留与 headroom 的分项，运行触发线已计入两者。',
        ),
        h(Field, {
          name: 'thresholdRatio',
          label: '自动压缩阈值（thresholdRatio）',
          help: '填写 0～1 之间的比例；运行触发线还受输出预留与 headroom 约束。',
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
              '此会话使用其他压缩引擎，不绘制预算与预览。以下配置仍适用于使用本插件的会话。',
            )
          : inspectError !== null && inspectError !== undefined
            ? h('p', { className: 'dsh-bc-error', role: 'alert' }, `只读诊断失败：${inspectError}。预算未知（unknown），表单仍可编辑。`)
            : emptySession
              ? h('p', { className: 'dsh-bc-unknown', 'data-bc': 'budget-empty' }, '请选择会话以读取预算与安全切点；当前仅显示插件状态，数值 unknown。')
              : inspectLoading
                ? h('p', { className: 'dsh-bc-note', role: 'status' }, '正在读取会话预算…')
                : segments === null
                  ? h(
                      'p',
                      { className: 'dsh-bc-unknown', 'data-bc': 'budget-incomplete' },
                      '预算数据不完整或不可用（unknown），不绘制虚构分布。',
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
                          { key: 'fixed', label: '固定前缀', tokens: segments.fixed, tone: 'fixed' },
                          { key: 'history', label: '较早历史（可压缩）', tokens: segments.earlier, tone: 'history' },
                          { key: 'tail', label: '近期保留原文', tokens: segments.retain, tone: 'tail' },
                          { key: 'free', label: '未用窗口', tokens: Math.max(0, segments.windowTokens - segments.current), tone: 'free' },
                        ],
                      }),
                      h(TokenLegend, {
                        name: 'budget-legend',
                        items: [
                          { key: 'fixed', label: '固定前缀', tokens: segments.fixed, tone: 'fixed' },
                          { key: 'history', label: '较早历史', tokens: segments.earlier, tone: 'history' },
                          { key: 'tail', label: '近期保留原文', tokens: segments.retain, tone: 'tail' },
                          { key: 'reserve', label: '输出 / 额外预留区（触发线 → 窗口末端）', tokens: null, tone: 'reserve' },
                        ],
                      }),
                      h(
                        'p',
                        { className: 'dsh-bc-caption' },
                        `触发线：${tokensText(budget.thresholdTokens)}；当前：${tokensText(segments.current)}。触发线后的区域为输出与额外预留，不是可自由压缩空间。`,
                      ),
                    ),
        h(
          'div',
          { className: 'dsh-bc-retention' },
          h('h4', { className: 'dsh-bc-h4' }, '近期原文保留范围'),
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
              h('span', null, '按可用窗口比例'),
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
              h('span', null, '按 token 数'),
            ),
          ),
          draft.retainMode === 'ratio'
            ? h(Field, {
                name: 'retainRatio',
                label: '保留比例（retainRatio）',
                help:
                  h('span', { 'data-bc': 'retention-source' }, draft.retainRatio !== ''
                    ? `${draft.retainRatio === String(props.stateValue?.retainRatio) ? '已保存（宿主表单）' : '草稿'}：${ratioText(Number(draft.retainRatio))}；保存将清除 retainTokens。`
                    : activeConfig !== null && typeof activeConfig.retainRatio === 'number'
                      ? `留空继承。当前运行值 ${ratioText(activeConfig.retainRatio)}（来源 activeConfig）；重载后按新配置重新解析，不保证仍是此值。`
                      : '留空继承；当前有效默认值 unknown（诊断未返回 activeConfig），不填入演示值。'),
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
                        : '继承引擎默认值',
                    disabled,
                    onChange: (event) => props.onDraft({ retainRatio: event.target.value }),
                  }),
              })
            : h(Field, {
                name: 'retainTokens',
                label: '保留 token 数（retainTokens）',
                help: '近期原文的绝对 token 预算；保存将清除 retainRatio。',
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
              h('strong', null, '自动压力压缩：'),
              `按运行保留预算（${retainText}）保留近期原文，并按原生工具配对边界对齐。`,
            ),
            h(
              'li',
              null,
              h('strong', null, '手动压缩 / 上下文超限恢复：'),
              '使用更激进的安全区间（原生手动 / overflow 使用 retainTokens = 0），可能少于配置保留量。',
            ),
            h('li', null, '近期保留是预算，不是永久 pin；实际安全切点可不同于预算，但仍保持工具调用 / 结果配对。'),
          ),
        ),
        h(
          'div',
          { className: 'dsh-bc-preview' },
          h('h4', { className: 'dsh-bc-h4' }, '只读安全切点与组成'),
          engineApplies === false
            ? h('p', { className: 'dsh-bc-note' }, '该会话使用其他压缩引擎，不绘制预览。')
            : inspectError !== null && inspectError !== undefined
              ? h('p', { className: 'dsh-bc-note' }, '诊断失败，预览不可用。')
              : emptySession
                ? h('p', { className: 'dsh-bc-unknown' }, '未选择会话，当前无可计算切点。')
                : preview === null || preview === undefined
                  ? h('p', { className: 'dsh-bc-unknown' }, '该会话当前无可计算切点。')
                  : hasSafeCut
                    ? h(
                        'p',
                        { className: 'dsh-bc-strong', 'data-bc': 'safe-cut' },
                        `安全切点候选：surface seq ${previewStart}–${previewEnd}；压缩前 ${tokensText(preview.beforeTokens)}；` +
                          `压缩后预算上界估算 ${preview.afterUpperBoundTokens === null ? 'unknown' : `≤ ${tokensText(preview.afterUpperBoundTokens)}`}.`,
                      )
                    : h(
                        'p',
                        { className: 'dsh-bc-unknown', 'data-bc': 'no-safe-cut' },
                        `当前无可计算切点。${typeof preview.reason === 'string' && preview.reason.length > 0 ? preview.reason : '原生选区未返回区间。'}`,
                      ),
          h(ReasonList, { reasons }),
          segments !== null
            ? h(
                'div',
                { className: 'dsh-bc-composition' },
                h('h5', { className: 'dsh-bc-h5' }, '压缩前后组成'),
                h('p', { className: 'dsh-bc-caption' }, '压缩前：固定前缀 + 较早历史 + 近期原文；压缩后：固定前缀 + 摘要输出预算 + 近期原文。'),
                h('p', { className: 'dsh-bc-strong', 'data-bc': 'before-label' }, '压缩前（当前上下文）'),
                h(TokenBar, {
                  name: 'before-bar',
                  scale: segments.scale,
                  ariaLabel: `Before compaction: fixed prefix ${tokensText(segments.fixed)}, earlier history ${tokensText(segments.earlier)}, retained tail ${tokensText(segments.retain)}.`,
                  segments: [
                    { key: 'fixed', label: '固定前缀', tokens: segments.fixed, tone: 'fixed' },
                    { key: 'history', label: '较早历史', tokens: segments.earlier, tone: 'history' },
                    { key: 'tail', label: '近期原文', tokens: segments.retain, tone: 'tail' },
                  ],
                }),
                h('p', { className: 'dsh-bc-strong', 'data-bc': 'after-label' }, '压缩后（预算上界估算）'),
                h(TokenBar, {
                  name: 'after-bar',
                  scale: segments.scale,
                  ariaLabel: `After compaction upper bound: fixed prefix ${tokensText(segments.fixed)}, summary output budget ${tokensText(segments.summary)}, retained tail ${tokensText(segments.retain)}.`,
                  segments: [
                    { key: 'fixed', label: '固定前缀', tokens: segments.fixed, tone: 'fixed' },
                    { key: 'summary', label: '摘要输出预算', tokens: segments.summary, tone: 'summary' },
                    { key: 'tail', label: '近期原文', tokens: segments.retain, tone: 'tail' },
                  ],
                }),
                h(TokenLegend, {
                  name: 'composition-legend',
                  items: [
                    { key: 'fixed', label: '固定前缀', tokens: segments.fixed, tone: 'fixed' },
                    { key: 'summary', label: '摘要输出预算', tokens: segments.summary, tone: 'summary' },
                    { key: 'tail', label: '近期原文', tokens: segments.retain, tone: 'tail' },
                  ],
                }),
                h(
                  'p',
                  { className: 'dsh-bc-caption' },
                  'afterUpperBoundTokens 仅为预算上界估算（含摘要输出预算与原生 checkpoint 结构），不是生成摘要长度预测。近期原文按运行保留预算展示，实际安全切点可能不同。',
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
          ? '跟随当前会话'
          : draft.provider === '' || draft.model === ''
            ? '请成对填写 provider / model'
            : `${draft.provider}/${draft.model}`
      const summaryEffort = nativeMode
        ? NATIVE_NOT_APPLICABLE
        : draft.effort === ''
          ? '摘要模型默认值（留空）'
          : draft.effort

      return h(
        Section,
        { name: 'model', title: '摘要模型与思考强度' },
        h(Field, {
          name: 'summaryRoute', label: '摘要模型',
          help: '仅选择摘要路由，不修改主会话模型；候选来自宿主，实际可用性仍由会话决定。',
          children: (id) => h('select', {
            id, name: 'summaryRoute', className: 'dsh-bc-input',
            value: draft.provider === '' && draft.model === '' ? '' : route === undefined ? 'custom' : JSON.stringify([draft.provider, draft.model]),
            disabled: props.disabled,
            onChange: (event) => {
              if (event.target.value === 'custom') return
              const [provider, model] = event.target.value === '' ? ['', ''] : JSON.parse(event.target.value)
              props.onDraft({ provider, model })
            },
          },
            h('option', { value: '' }, '跟随当前会话'),
            routes.map((entry) => h('option', { key: JSON.stringify([entry.provider, entry.model]), value: JSON.stringify([entry.provider, entry.model]) }, entry.provider + ' / ' + entry.model)),
            h('option', { value: 'custom', disabled: true }, draft.provider || draft.model ? '自定义 / 当前值：' + summaryRoute : '自定义：展开下方输入'),
          ),
        }),
        h('details', { className: 'dsh-bc-explanation', open: route === undefined && (draft.provider !== '' || draft.model !== '') },
          h('summary', null, '自定义 Provider / Model 与当前值'),
        h(
          'div',
          { className: 'dsh-bc-summary-line', 'data-bc': 'model-summary' },
          h('span', { className: 'dsh-bc-strong' }, `摘要模型: ${summaryRoute}`),
          h('span', { className: 'dsh-bc-caption' }, `思考强度：${summaryEffort}`),
        ),
        h(
          'p',
          { className: 'dsh-bc-caption' },
          'provider / model 成对保存，留空跟随会话；effort 留空使用摘要模型自身默认值，不无条件继承主模型。',
        ),
        h(
          'div',
          { className: 'dsh-bc-grid' },
          h(Field, {
            name: 'summarizationProvider',
            label: '摘要 Provider',
            help: '可自定义；与 model 一起留空即跟随会话。',
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
            label: '摘要模型',
            help: '与 provider 成对保存；清空任一项会清空两者。',
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
        ),
        h(
          'div',
          { className: 'dsh-bc-effort' },
          route !== undefined && route.efforts.length > 0
            ? h(Field, {
                name: 'reasoningEffort',
                label: '思考强度',
                help: nativeMode
                  ? NATIVE_NOT_APPLICABLE
                  : draft.effort === ''
                    ? '留空使用摘要模型的默认强度。'
                    : '候选来自所选模型能力。',
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
                    h('option', { value: '' }, '摘要模型默认值（留空）'),
                    route.efforts.map((effort) =>
                      h('option', { key: effort, value: effort }, effort === route.defaultEffort ? `${effort} （模型默认）` : effort),
                    ),
                    draft.effort !== '' && !route.efforts.includes(draft.effort)
                      ? h('option', { value: draft.effort }, `${draft.effort} （当前值；未声明支持）`)
                      : null,
                  ),
              })
            : h(Field, {
                name: 'reasoningEffort',
                label: '思考强度',
                help: nativeMode
                  ? NATIVE_NOT_APPLICABLE
                  : modelsStatus === 'error'
                    ? '模型能力不可用；可自定义，实际请求可能被拒绝。'
                    : '此路由能力 unknown；可自定义或留空。',
                error: props.fieldError('reasoningEffort'),
                children: (id) =>
                  h('input', {
                    id,
                    name: 'reasoningEffort',
                    className: 'dsh-bc-input',
                    type: 'text',
                    value: draft.effort,
                    disabled: effortLocked,
                    placeholder: nativeMode ? NATIVE_NOT_APPLICABLE : '摘要模型默认值（留空）',
                    autoComplete: 'off',
                    onChange: (event) => props.onDraft({ effort: event.target.value }),
                  }),
              }),
          nativeMode
            ? h('p', { className: 'dsh-bc-note', 'data-bc': 'effort-native' }, `思考强度: ${NATIVE_NOT_APPLICABLE}. 保留当前值供切回增强模式。`)
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
            ? h('p', { className: 'dsh-bc-note', role: 'status' }, '正在读取宿主模型候选…')
            : modelsStatus === 'error'
              ? h(
                  'p',
                  { className: 'dsh-bc-note', 'data-bc': 'models-error' },
                  `宿主候选元数据不可用：${modelsError}。仍可自定义 provider / model；能力未知（unknown）。`,
                )
              : modelsEnabled !== true
                ? h(
                    'p',
                    { className: 'dsh-bc-note', 'data-bc': 'models-unavailable' },
                    '宿主未启用候选服务；可自定义，模型能力与实际可用性 unknown。',
                  )
                : h(
                    'details',
                    { className: 'dsh-bc-candidate-details' },
                    h('summary', null, `宿主提供的模型候选（${routes.length}）`),
                    routes.length === 0
                      ? h('p', { className: 'dsh-bc-note' }, '宿主未提供候选；可自定义。')
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
                      '候选不保证当前会话可用；此只读页不验证凭据或容量。',
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
        { name: 'cache', title: '缓存优先' },
        h(Toggle, {
          name: 'cachePriority',
          label: CACHE_PRIORITY_COPY,
          checked: props.draft.cachePriority,
          disabled: props.disabled || nativeMode,
          onChange: (checked) => props.onDraft({ cachePriority: checked }),
          help:
            '增强摘要保留正常提示 / 工具 / 历史前缀，将动态指令放在末尾以尽可能复用缓存。',
          note: nativeMode
            ? `${NATIVE_NOT_APPLICABLE}. 保留增强配置供切回。`
            : null,
        }),
        h(
          'details',
          { className: 'dsh-bc-explanation' },
          h('summary', null, '缓存边界说明'),
          h('p', { className: 'dsh-bc-caption' }, '切换摘要 provider / model 可能减少前缀复用。'),
          h('p', { className: 'dsh-bc-caption' }, 'replacement 改变旧前缀；保留原文不等于保留旧 KV。'),
          h('p', { className: 'dsh-bc-caption' }, '不保证无损 KV 或零缓存损失；只有 provider 返回 usage 才展示实测。'),
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
        h('summary', null, '高级选项'),
        h(
          'div',
          { className: 'dsh-bc-details-body' },
          h(Toggle, {
            name: 'auto',
            label: '自动阈值 / 超限压缩',
            checked: draft.auto,
            disabled,
            onChange: (checked) => props.onDraft({ auto: checked }),
            help: '关闭后停止自动阈值 / 超限压缩；手动 /compact 仍可用。',
          }),
          h(
            'div',
            { className: 'dsh-bc-grid' },
            h(Field, {
              name: 'headroomTokens',
              label: '额外预留（headroomTokens）',
              help: '路由输出预留之外的额外空间，非负整数。',
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
              label: '摘要输出上限（maxTokens）',
              help: '正整数，与输入共用窗口；留空跟随有效 headroom。',
              error: props.fieldError('maxTokens'),
              children: (id) =>
                h('input', {
                  id,
                  name: 'maxTokens',
                  className: 'dsh-bc-input dsh-bc-mono',
                  type: 'text',
                  inputMode: 'numeric',
                  value: draft.maxTokens,
                  placeholder: '继承 headroomTokens',
                  disabled,
                  onChange: (event) => props.onDraft({ maxTokens: event.target.value }),
                }),
            }),
            h(Field, {
              name: 'compactionRetries',
              label: '压力残留重试（compactionRetries）',
              help: '压缩成功后仍有压力时的额外次数；不是网络重试。',
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
              label: '超限恢复次数（maxOverflowRetries）',
              help: 'provider 确认上下文超限后的有界恢复次数；0 表示关闭，与压缩后压力残留重试分开。',
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
            h('h4', { className: 'dsh-bc-h4' }, '按模型覆盖（只读）'),
            policies.length === 0
              ? h('p', { className: 'dsh-bc-note' }, '未配置按模型覆盖；路由继承全局值。')
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
            '不提供交接目录、独立压缩历史、后台记忆或 sidecar 数据库。交接文件位于系统临时目录，不是唯一恢复来源。',
          ),
        ),
      )
    }

    // ── status section ────────────────────────────────────────────────────

    const STATUS_LABELS = Object.freeze({
      running: '进行中',
      completed: '已完成',
      failed: '生成失败',
      cancelled: '已取消',
      'persistence-error': '持久化失败',
    })

    /** One-line engine ownership statement. */
    function engineNote(engine) {
      if (engine === null || engine === undefined) return '引擎归属未知（unknown；未选择会话）。'
      if (engine.inspectApplies === false) {
        return `此会话使用其他压缩引擎（归属：${engine.owner}）。本页模式与预算不适用，不绘制虚构预算 / 预览；下方仍展示会话真实原生事件。`
      }
      if (engine.owner === 'unknown') {
        return `无法确认此会话引擎归属（${engine.owner}）。预算 / 预览基于本插件运行配置，仅作配置诊断，不代表已观测的引擎状态。`
      }
      return `压缩引擎：${engine.owner}。预算 / 预览基于本插件配置；诊断只读。`
    }

    /** The status of the last real native compaction bracket. */
    function LastCompaction(props) {
      const record = props.record
      if (record === null || record === undefined) {
        return h('p', { className: 'dsh-bc-unknown', 'data-bc': 'last-compaction-empty' }, props.emptyText)
      }
      const status = STATUS_LABELS[record.status] ?? '未知状态（unknown）'
      const cacheRead = typeof record.cacheReadTokens === 'number' ? record.cacheReadTokens : null
      const cacheWrite = typeof record.cacheWriteTokens === 'number' ? record.cacheWriteTokens : null
      const cacheRows = [
        cacheRead === null
          ? null
          : h(Row, { key: 'cache-read', label: '缓存读取 token（实测）', value: tokensText(cacheRead) }),
        cacheWrite === null
          ? null
          : h(Row, { key: 'cache-write', label: '缓存写入 token（实测）', value: tokensText(cacheWrite) }),
      ].filter((row) => row !== null)
      return h(
        'div',
        { className: 'dsh-bc-status-record', 'data-bc': 'last-compaction', 'data-status': record.status ?? 'unknown' },
        h('p', { className: `dsh-bc-status-line dsh-bc-status-${record.status ?? 'unknown'}`, 'data-bc': 'last-compaction-status' }, `${status} · ${record.trigger === 'manual' ? '手动' : record.trigger === 'automatic' ? '自动' : '触发原因未知（unknown）'}`),
        h(
          'div',
          { className: 'dsh-bc-status-grid' },
          h(Row, { label: '触发原因', value: record.trigger === 'manual' ? '手动' : record.trigger === 'automatic' ? '自动' : '未知（unknown）' }),
          h(Row, { label: '状态', value: status }),
          h(Row, { label: '历史模式', value: typeof record.mode === 'string' ? record.mode : '未知（unknown；原生记录无法证明）' }),
          h(Row, { label: '耗时', value: durationText(record.durationMs) }),
          h(Row, { label: '压缩前 token（已替换区）', value: tokensText(record.beforeTokens) }),
          h(Row, { label: '压缩后 checkpoint 估算', value: tokensText(record.afterTokens) }),
          ...cacheRows,
        ),
        cacheRows.length === 0
          ? h('p', { className: 'dsh-bc-caption' }, '缓存用量未知（unknown）：provider 未报告本次缓存 token；缺失不等于 0，不估算节省率。')
          : null,
        h(
          'p',
          { className: 'dsh-bc-caption' },
          '费用未知（unknown；诊断无价格数据）。token 来自原生事件 / usage；缺失字段不使用当前配置补造。',
        ),
        record.status === 'persistence-error'
          ? h(
              'p',
              { className: 'dsh-bc-error', role: 'alert', 'data-bc': 'persistence-error' },
              'checkpoint 替换可能已持久化，但会话保存失败；并非普通成功，也不是全部回滚。',
            )
          : null,
        record.status === 'failed'
          ? h(
              'p',
              { className: 'dsh-bc-note' },
              '本次生成失败，未安装 checkpoint；这不代表会话此前没有持久化变更。',
            )
          : null,
        record.status === 'cancelled'
          ? h('p', { className: 'dsh-bc-note' }, '本次已取消，未安装 checkpoint。')
          : null,
        record.status === 'running'
          ? h('p', { className: 'dsh-bc-note' }, '本进程正在生成摘要（内存态），不代表历史记录已完成。')
          : null,
        record.error === null || record.error === undefined
          ? null
          : h('p', { className: 'dsh-bc-error', 'data-bc': 'last-compaction-error' }, `原生记录错误：${record.error}`),
      )
    }

    /** 最近一次原生压缩, handoff continuation, diagnostics and engine ownership. */
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
        { name: 'status', title: '最近一次原生压缩' },
        h('p', { className: 'dsh-bc-caption' }, '只读展示原生事件与 usage，缺失字段为 unknown。'),
        h('p', { className: 'dsh-bc-note', 'data-bc': 'engine-note' }, engineNote(engine)),
        inspectError !== null && inspectError !== undefined
          ? h('p', { className: 'dsh-bc-error', role: 'alert', 'data-bc': 'inspect-error' }, `${inspectError}。表单仍可编辑，仅只读状态受影响。`)
          : null,
        sessionId === ''
          ? h('p', { className: 'dsh-bc-unknown', 'data-bc': 'status-empty' }, '尚未选择会话；选择后查看最近原生压缩记录。')
          : inspectLoading
            ? h('p', { className: 'dsh-bc-note', role: 'status' }, '正在读取原生压缩状态…')
            : h(LastCompaction, {
                record,
                emptyText: engineApplies === false
                  ? '该会话原生事件中未找到压缩记录。'
                  : '该会话暂无压缩记录。',
              }),
        continuation === null || continuation === undefined
          ? null
          : h(
              'div',
              { className: 'dsh-bc-continuation', 'data-bc': 'handoff-continuation', 'data-status': continuation.status },
              h('h4', { className: 'dsh-bc-h4' }, 'Handoff 续作'),
              h(
                'p',
                { className: 'dsh-bc-strong' },
                continuation.status === 'scheduled'
                  ? '已调度：本次手动 Handoff 成功后，排入一次同会话普通续作。'
                  : '已跳过：未调度自动续作，等待用户或阻塞条件解除。',
              ),
              Array.isArray(continuation.blockers) && continuation.blockers.length > 0
                ? h(
                    'ul',
                    { className: 'dsh-bc-bullets' },
                    continuation.blockers.map((blocker, index) => h('li', { key: `${index}-${blocker}` }, String(blocker))),
                  )
                : null,
              h('p', { className: 'dsh-bc-caption' }, '历史重放、刷新页面或重载插件不会再次调度续作。'),
            ),
        reasons.length > 0
          ? h(
              'div',
              { className: 'dsh-bc-diagnostics', 'data-bc': 'diagnostics' },
              h('h4', { className: 'dsh-bc-h4' }, '诊断原因'),
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
          h('label', { htmlFor: id, className: 'dsh-bc-label' }, '诊断会话'),
          h(
            'select',
            {
              id,
              name: 'inspectSession',
              className: 'dsh-bc-input',
              value: selectedId,
              onChange: (event) => onSelect(event.target.value),
            },
            h('option', { value: '' }, '仅插件状态（不选会话）'),
            entries.map((entry) =>
              h('option', { key: entry.id, value: entry.id }, `${entry.title}${entry.running ? ' · 运行中' : ''} — ${entry.id}`),
            ),
          ),
        ),
        h(
          'p',
          { className: 'dsh-bc-caption' },
          !listAvailable
            ? '会话列表不可用，仅显示插件状态。'
            : listError !== null && listError !== undefined
              ? `会话列表不可用（${typeof listError.message === 'string' ? listError.message : 'error'}），仅显示插件状态。`
              : entries.length === 0
                ? phase === 'pending'
                  ? '正在加载会话…'
                  : '暂无会话，仅显示插件状态。'
                : '只读诊断，不触发压缩、LLM、CLI 或文件写入。',
        ),
        h(
          'div',
          { className: 'dsh-bc-session-actions' },
          h(
            'button',
            { type: 'button', className: 'dsh-bc-btn', onClick: onRefresh, disabled: refresh === true },
            refresh === true ? '读取中…' : '刷新诊断',
          ),
        ),
      )
    }

    // ── active config banner + save footer ───────────────────────────────

    function ActiveConfigBanner(props) {
      const active = props.activeConfig
      const unknown = active === null || active === undefined
      const status = props.requiresReload === true
        ? '已保存配置待重载 profile'
        : props.requiresReload === false ? '已保存配置与运行快照一致' : '运行快照 unknown，暂无法比较'
      return h('div', {
        className: 'dsh-bc-banner' + (props.requiresReload === true ? ' dsh-bc-banner-warn' : ''),
        'data-bc': 'active-config',
        'data-requires-reload': props.requiresReload === true ? 'true' : props.requiresReload === false ? 'false' : 'unknown',
      },
        h('p', { className: 'dsh-bc-banner-title' },
          (props.dirty ? '有未保存草稿 · ' : '') + status + (unknown ? '' : ' · 运行：' + (MODE_META[active.mode]?.label ?? active.mode))),
        h('details', { className: 'dsh-bc-explanation' },
          h('summary', null, '运行快照与生效方式'),
          unknown ? h('p', { className: 'dsh-bc-caption' }, 'activeConfig unknown（只读诊断未返回）。')
            : h('div', { className: 'dsh-bc-status-grid' },
              h(Row, { label: '运行模式', value: active.mode }),
              h(Row, { label: '运行摘要路由', value: active.summarizationProvider || active.summarizationModel ? active.summarizationProvider + '/' + active.summarizationModel : '跟随会话' }),
              h(Row, { label: '运行思考强度', value: active.mode === 'native' ? NATIVE_NOT_APPLICABLE : active.reasoningEffort || '摘要模型默认值' }),
              h(Row, { label: '运行缓存优先', value: active.mode === 'native' ? NATIVE_NOT_APPLICABLE : active.cachePriority ? '开启' : '关闭' }),
              h(Row, { label: '运行阈值', value: ratioText(active.thresholdRatio) }),
              h(Row, { label: '运行保留量', value: typeof active.retainTokens === 'number' ? tokensText(active.retainTokens) : ratioText(active.retainRatio) }),
            ),
          h('p', { className: 'dsh-bc-caption' }, '编辑只是草稿；保存走宿主 revision / CAS。保存后重启 DSH / 重载 profile 才应用，刷新网页不重载引擎。'),
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
            '已保存，需重载 profile。重启 DSH 才更新运行快照，刷新网页不生效。',
          ),
        )
      }
      if (saveState.kind === 'rejected') {
        messages.push(
          h(
            'p',
            { key: 'rejected', className: 'dsh-bc-error', role: 'alert', 'data-bc': 'save-rejected' },
            '宿主拒绝保存（revision 冲突或值被拒绝）。草稿保留且未应用；请重新读取宿主值并对比，不会静默覆盖。',
          ),
        )
      }
      if (saveState.kind === 'transport') {
        messages.push(
          h(
            'p',
            { key: 'transport', className: 'dsh-bc-error', role: 'alert', 'data-bc': 'save-transport' },
            `保存请求失败：${saveState.message}。未保存，草稿已保留。`,
          ),
        )
      }
      if (saveState.kind === 'invalid' || errors.length > 0) {
        const list = saveState.kind === 'invalid' && Array.isArray(saveState.errors) ? saveState.errors : errors
        messages.push(
          h(
            'div',
            { key: 'invalid', className: 'dsh-bc-error', role: 'alert', 'data-bc': 'save-invalid' },
            h('p', null, '请先修正标记字段：'),
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
                '宿主配置已更新，当前草稿存在 revision 冲突；请重新读取宿主值并对比，不会覆盖较新配置。',
              )
            : null,
          !writable
            ? h('p', { className: 'dsh-bc-note', 'data-bc': 'read-only' }, '只读：宿主不接受写入；仍可查看设置与诊断。')
            : null,
          h(
            'p',
            { className: 'dsh-bc-caption', 'data-bc': 'revision' },
            `草稿基于 revision ${revision === null || revision ===undefined ? 'unknown' : String(revision)}；每次保存只提交一个预期 revision。`,
          ),
        ),
        h(
          'div',
          { className: 'dsh-bc-actions' },
          h('button', { type: 'button', className: 'dsh-bc-btn', onClick: onReload, disabled: savingNow }, '重新读取宿主值'),
          h(
            'button',
            { type: 'button', className: 'dsh-bc-btn dsh-bc-btn-primary', onClick: onSave, disabled: saveDisabled, 'data-bc': 'save-button' },
            savingNow ? '保存中…' : '保存设置',
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
        h('h2', { className: 'dsh-bc-title' }, '上下文压缩'),
        h('p', { className: 'dsh-bc-caption' }, '选择压缩策略并编辑草稿；保存后需重载 profile 生效。'),
      )

      if (formStatus === 'missing' || formStatus === 'loading') {
        return h(
          'div',
          { className: 'dsh-bc-page', 'data-better-compact': 'page' },
          pageStyle,
          title,
          h('div', { className: 'dsh-bc-section' }, h('p', { className: 'dsh-bc-note', role: 'status' }, formStatus === 'loading' ? '正在读取配置…' : '等待宿主配置表单…')),
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
            h('p', { className: 'dsh-bc-note', 'data-bc': 'form-unavailable' }, '宿主未提供可编辑表单，不填造默认值。'),
            h(ActiveConfigBanner, { activeConfig, requiresReload, dirty }),
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
      // 诊断原因 render in the status section; the budget panel shows the
      // preview reason only when it is not already one of those diagnostics, so
      // the same backend message never appears twice.
      const budgetReasons = previewReason !== null && !diagnostics.includes(previewReason) ? [previewReason] : []

      return h(
        'div',
        { className: 'dsh-bc-page', 'data-better-compact': 'page' },
        pageStyle,
        title,
        h(ActiveConfigBanner, { activeConfig, requiresReload, dirty }),
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
          stateValue: state.value,
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
.dsh-bc-page{display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;min-width:0;container-type:inline-size;container-name:better-compact;overflow-wrap:anywhere}
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
.dsh-bc-modes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.dsh-bc-mode{position:relative;display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);cursor:pointer;min-width:0;transition:background-color 120ms ease,border-color 120ms ease}
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
.dsh-bc-diagram{display:block;width:100%;max-width:180px;height:auto;margin:0 auto;color:var(--dsw-alias-label-secondary)}
.dsh-bc-diagram text{fill:currentColor;font-family:inherit;font-size:11px}
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
.dsh-bc-strategy-foot{display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:8px}
.dsh-bc-explanation{min-width:0;font-size:12px;line-height:18px}
.dsh-bc-explanation>summary{cursor:pointer;color:var(--dsw-alias-label-secondary)}
.dsh-bc-explanation[open]>summary{margin-bottom:6px}
.dsh-bc-explanation>summary:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.dsh-bc-explanation .dsh-bc-caption+.dsh-bc-caption{margin-top:4px}
@container better-compact (max-width:634px){.dsh-bc-modes{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.dsh-bc-mode{padding:8px;gap:6px}.dsh-bc-mode-title{font-size:12px}.dsh-bc-mode-description{font-size:11px;line-height:15px;min-height:45px}.dsh-bc-diagram{max-width:180px}.dsh-bc-grid,.dsh-bc-status-grid{grid-template-columns:1fr}}
@container better-compact (max-width:560px){.dsh-bc-modes{grid-template-columns:1fr}.dsh-bc-mode-description{min-height:0}.dsh-bc-section{padding:12px}.dsh-bc-row{gap:8px}.dsh-bc-row-label,.dsh-bc-row-value{flex:1;min-width:0}.dsh-bc-session-row .dsh-bc-input{flex-basis:100%}}
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
