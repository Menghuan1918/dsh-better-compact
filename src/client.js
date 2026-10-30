/**
 * dsh-better-compact — zero-build browser settings.
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
 *   - measured counts and safe cuts come from inspect; draft-only budget
 *     arithmetic uses the inspected model capacity and conversation reservation;
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
        label: '原生',
        description: '历史摘要与近期原文',
        caption: '摘要请求由原生引擎处理。',
      }),
      goal: Object.freeze({
        label: '目标增强',
        description: '结合目标与任务生成摘要',
        caption: '目标与任务作为摘要输入；没有目标时也可压缩。',
      }),
      handoff: Object.freeze({
        label: '文件交接',
        description: '保存交接文件，在本会话继续',
        caption: '交接正文同时写入会话记录；手动压缩成功后可继续本会话。',
      }),
    })
    /** One-line summary used by the Plugins page before opening the row. */
    const SUMMARY =
      '压缩策略、上下文预算与会话诊断'
    /** Enhanced-only controls are inactive in native mode. */
    const NATIVE_NOT_APPLICABLE = '由原生引擎决定'
    const CACHE_PRIORITY_COPY = '优先复用提示缓存'
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
      if (typeof value !== 'number' || !Number.isFinite(value)) return '未知'
      const rounded = Math.round(value)
      return `${groupDigits(rounded)} tokens`
    }

    /** Ratio text as a percentage; unknown stays unknown. */
    function ratioText(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '未知'
      return `${Math.round(value * 10000) / 100}%`
    }

    /** Duration text; unknown stays unknown. */
    function durationText(value) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '未知'
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

    // ── form draft ────────────────────────────────────────────────────────

    /** Convert one accepted form value into the editable draft (strings). */
    const POLICY_NUMBERS = Object.freeze([
      ['thresholdRatio', '触发比例', true], ['headroomTokens', '额外余量'],
      ['maxTokens', '摘要输出上限'], ['compactionRetries', '压力残留重试'], ['maxOverflowRetries', '超限恢复次数'],
    ])
    const DEFAULT_RETAIN_RATIO = 0.16

    function policyDraft(value = {}) {
      const result = { provider: value.provider ?? '', model: value.model ?? '',
        retainMode: value.retainTokens != null ? 'tokens' : value.retainRatio != null ? 'ratio' : 'inherit',
        retainRatio: value.retainRatio != null ? String(value.retainRatio) : '',
        retainTokens: value.retainTokens != null ? String(value.retainTokens) : '',
        summaryMode: value.summarizationProvider === undefined ? 'inherit' : value.summarizationProvider === '' ? 'session' : 'custom',
        summarizationProvider: value.summarizationProvider ?? '', summarizationModel: value.summarizationModel ?? '' }
      for (const [key] of POLICY_NUMBERS) result[key] = value[key] == null ? '' : String(value[key])
      return result
    }

    function policyValue(draft) {
      const value = { provider: draft.provider, model: draft.model }
      for (const [key] of POLICY_NUMBERS) if (draft[key] !== '') value[key] = Number(draft[key])
      if (draft.retainMode === 'ratio' && draft.retainRatio !== '') value.retainRatio = Number(draft.retainRatio)
      if (draft.retainMode === 'tokens' && draft.retainTokens !== '') value.retainTokens = Number(draft.retainTokens)
      if (draft.summaryMode !== 'inherit') {
        value.summarizationProvider = draft.summaryMode === 'session' ? '' : draft.summarizationProvider
        value.summarizationModel = draft.summaryMode === 'session' ? '' : draft.summarizationModel
      }
      return value
    }

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
        policies: (Array.isArray(source.modelPolicies) ? source.modelPolicies : []).map(policyDraft),
        maxTokens: typeof source.maxTokens === 'number' ? String(source.maxTokens) : '',
        compactionRetries: typeof source.compactionRetries === 'number' ? String(source.compactionRetries) : '',
        maxOverflowRetries: typeof source.maxOverflowRetries === 'number' ? String(source.maxOverflowRetries) : '',
      }
    }

    /** Compare scalar fields and the ordered model-policy drafts. */
    function equalDraft(left, right) {
      if (left === null || right === null) return left === right
      const keys = Object.keys(left)
      if (keys.length !== Object.keys(right).length) return false
      for (const key of keys) {
        if (key === 'policies' ? JSON.stringify(left[key]) !== JSON.stringify(right[key]) : left[key] !== right[key]) return false
      }
      return true
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
      const add = (field, message) => errors.push({ field, message })
      if (!MODES.includes(draft.mode)) add('mode', '请选择压缩策略。')
      const validRatio = (value) => value !== '' && Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) < 1
      const validInt = (value, min = 0) => value !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= min
      if (!validRatio(draft.thresholdRatio)) add('thresholdRatio', '触发比例须大于 0% 且小于 100%。')
      if (!validInt(draft.headroomTokens)) add('headroomTokens', '额外余量须为非负安全整数。')
      const retainRatio = draft.retainRatio === '' ? DEFAULT_RETAIN_RATIO : Number(draft.retainRatio)
      if (draft.retainMode === 'tokens') {
        if (!validInt(draft.retainTokens)) add('retainTokens', '保留量须为非负安全整数。')
      } else if (!validRatio(String(retainRatio)) || retainRatio >= Number(draft.thresholdRatio)) {
        add('retainRatio', '保留比例须大于 0，且低于触发比例；留空使用 16%。')
      }
      if ((draft.provider === '') !== (draft.model === '')) add('summarizationModel', '服务商与摘要模型须成对填写。')
      if (draft.effort !== '' && draft.effort.trim() === '') add('reasoningEffort', '思考强度不能仅包含空格。')
      if (draft.maxTokens !== '' ? !validInt(draft.maxTokens, 1) : Number(draft.headroomTokens) === 0) {
        add('maxTokens', '摘要输出上限须为正安全整数；额外余量为 0 时须单独设置。')
      }
      for (const key of ['compactionRetries', 'maxOverflowRetries']) {
        if (!validInt(draft[key])) add(key, '重试次数须为非负安全整数。')
      }
      const seen = new Set()
      draft.policies.forEach((policy, index) => {
        const prefix = 'policies.' + index + '.'
        const identity = JSON.stringify([policy.provider, policy.model])
        if (!policy.provider || !policy.model) add(prefix + 'model', '请填写完整的服务商与模型。')
        else if (seen.has(identity)) add(prefix + 'model', '该模型已有覆盖规则。')
        seen.add(identity)
        for (const [key, label, ratio] of POLICY_NUMBERS) {
          if (policy[key] !== '' && !(ratio ? validRatio(policy[key]) : validInt(policy[key], key === 'maxTokens' ? 1 : 0))) {
            add(prefix + key, label + (ratio ? '须大于 0% 且小于 100%。' : '须为' + (key === 'maxTokens' ? '正' : '非负') + '安全整数。'))
          }
        }
        const threshold = Number(policy.thresholdRatio || draft.thresholdRatio)
        const ratio = policy.retainMode === 'ratio' ? Number(policy.retainRatio) : retainRatio
        if (policy.retainMode === 'tokens') {
          if (!validInt(policy.retainTokens)) add(prefix + 'retainTokens', '保留量须为非负安全整数。')
        } else if (policy.retainMode === 'ratio' || draft.retainMode === 'ratio') {
          if (!(ratio > 0 && ratio < threshold)) add(prefix + 'retainRatio', '有效保留比例须大于 0，且低于该规则的触发比例。')
        }
        if (policy.summaryMode === 'custom' && (!policy.summarizationProvider || !policy.summarizationModel)) {
          add(prefix + 'summarizationModel', '请填写完整的摘要服务商与模型。')
        }
        if (policy.maxTokens === '' && draft.maxTokens === '' && Number(policy.headroomTokens || draft.headroomTokens) === 0) {
          add(prefix + 'maxTokens', '余量为 0 时须设置摘要输出上限。')
        }
      })
      return errors
    }

    /**
     * Validate a known-incompatible effort. The allowed-candidate list is host
     * metadata (the subagent model allow-list), not a hard restriction on the
     * summary route, so a route outside that list is only marked as a warning —
     * never silently deleted and never a blocked save. Native mode does not
     * apply enhanced effort at all.
     */
    function validateModelSelection(draft, routes, routesKnown, target) {
      if (draft.mode === 'native' || draft.effort === '' || !routesKnown) return []
      const candidates = []
      if (draft.provider && draft.model) candidates.push({ provider: draft.provider, model: draft.model, field: 'reasoningEffort', label: '全局摘要模型' })
      draft.policies.forEach((policy, index) => {
        const provider = policy.summaryMode === 'custom' ? policy.summarizationProvider : policy.summaryMode === 'session' || !draft.provider ? policy.provider : draft.provider
        const model = policy.summaryMode === 'custom' ? policy.summarizationModel : policy.summaryMode === 'session' || !draft.model ? policy.model : draft.model
        candidates.push({ provider, model, field: 'policies.' + index + '.summarizationModel', label: '规则 ' + policy.provider + '/' + policy.model })
      })
      if (!draft.provider && target && !draft.policies.some((policy) => policy.provider === target.provider && policy.model === target.model)) {
        candidates.push({ ...target, field: 'reasoningEffort', label: '跟随会话的摘要模型' })
      }
      return candidates.flatMap((candidate) => {
        const route = routes.find((entry) => entry.provider === candidate.provider && entry.model === candidate.model)
        return route && !route.efforts.includes(draft.effort) ? [{ field: candidate.field,
          message: candidate.label + ' ' + candidate.provider + '/' + candidate.model + ' 未声明支持强度「' + draft.effort + '」，请调整全局思考强度或摘要模型。' }] : []
      })
    }

    /** Non-blocking marker for a saved route outside the candidate metadata. */
    function routeCandidateWarning(draft, routes, routesKnown) {
      if (draft.provider === '' || draft.model === '' || !routesKnown) return null
      if (routes.some((entry) => entry.provider === draft.provider && entry.model === draft.model)) return null
      return (
        `自定义模型 ${draft.provider}/${draft.model} 未列于宿主候选中，请确认会话可用。`
      )
    }

    /** The allowed route matching the draft, when the catalog is known. */
    function routeForDraft(draft, routes) {
      return routes.find((entry) => entry.provider === draft.provider && entry.model === draft.model)
    }

    /**
     * Build one atomic mutation from the draft. Only fields the page owns are
     * written; unchanged model policies are preserved. Retention writes
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
        if (current.maxTokens !== undefined && current.maxTokens !== null) ops.push({ op: 'unset', path: ['maxTokens'] })
      } else {
        setIfChanged(['maxTokens'], Number(draft.maxTokens), current.maxTokens)
      }
      setIfChanged(['compactionRetries'], Number(draft.compactionRetries), current.compactionRetries)
      setIfChanged(['maxOverflowRetries'], Number(draft.maxOverflowRetries), current.maxOverflowRetries)
      if (JSON.stringify(draft.policies) !== JSON.stringify(draftFromValue(current).policies)) {
        ops.push({ op: 'set', path: ['modelPolicies'], value: draft.policies.map(policyValue) })
      }
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
        h(DiagramNode, { id: 'checkpoint', x: 2, y: 144, width: 176, height: 24, lines: ['摘要记录'] }),
      )
    }

    function GoalDiagram() {
      const marker = 'bc-goal-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
      return h(StrategySvg, { mode: 'goal', marker,
        label: 'Goal 增强：较早历史与只读权威 Goal / Todo 合流，生成目标、约束、进展、下一步摘要；近期原文保留，不修改目标或轮次。' },
        h(DiagramNode, { id: 'history', x: 2, y: 38, width: 76, height: 36, lines: ['较早历史'] }),
        h(DiagramNode, { id: 'authority', x: 88, y: 38, width: 90, height: 36, lines: ['目标与任务', '权威状态'], tone: 'dsh-bc-node-dashed' }),
        h(DiagramEdge, { from: 'history', to: 'summary', d: 'M40 74 L40 88 L54 88 L54 102', marker }),
        h(DiagramEdge, { from: 'authority', to: 'summary', d: 'M133 74 L133 88 L54 88 L54 102', marker }),
        h(DiagramNode, { id: 'summary', x: 2, y: 102, width: 104, height: 40, lines: ['目标·约束', '进展·下一步'], tone: 'dsh-bc-node-accent' }),
        h(DiagramNode, { id: 'tail', x: 116, y: 102, width: 62, height: 40, lines: ['近期原文', '保留'], tone: 'dsh-bc-node-strong' }),
        h('text', { x: 90, y: 164, textAnchor: 'middle' }, '写入会话摘要记录'),
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
        h(DiagramNode, { id: 'continuation', x: 2, y: 146, width: 176, height: 22, lines: ['同会话继续'] }),
      )
    }

    const DIAGRAMS = Object.freeze({ native: NativeDiagram, goal: GoalDiagram, handoff: HandoffDiagram })

    // ── generic UI primitives ─────────────────────────────────────────────

    /** A labelled field; children is a render function receiving the input id. */
    function Field(props) {
      const id = 'dsh-bc-' + props.name + '-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
      return h('div', { className: 'dsh-bc-field' },
        h('label', { htmlFor: id, className: 'dsh-bc-label' }, props.label),
        props.children(id, { 'aria-invalid': props.error ? true : undefined, 'aria-describedby': props.error ? id + '-error' : props.help ? id + '-help' : undefined }),
        props.help ? h('p', { id: id + '-help', className: 'dsh-bc-help' }, props.help) : null,
        props.error ? h('p', { id: id + '-error', className: 'dsh-bc-error', role: 'alert', 'data-bc-error': props.name }, props.error) : null)
    }

    function NumberField(props) {
      const ratio = props.ratio === true
      const display = ratio && props.value !== '' ? String(Number((Number(props.value) * 100).toFixed(8))) : props.value
      return h(Field, { ...props, children: (id, aria) => h('div', { className: 'dsh-bc-number' },
        h('input', { ...aria, id, name: props.name, className: 'dsh-bc-input dsh-bc-mono', type: 'number',
          inputMode: ratio ? 'decimal' : 'numeric', min: props.min ?? 0, max: ratio ? 100 : undefined,
          step: ratio ? 'any' : 1, value: display, disabled: props.disabled, placeholder: props.placeholder,
          onChange: (event) => props.onChange(event.target.value === '' ? '' : ratio ? String(Number(event.target.value) / 100) : event.target.value) }),
        h('span', { className: 'dsh-bc-unit', 'aria-hidden': true }, ratio ? '%' : props.unit ?? 'tokens')) })
    }

    function Explain(props) {
      return h('details', { className: 'dsh-bc-explanation', open: props.open, 'data-bc': props.name },
        h('summary', null, props.title), h('div', { className: 'dsh-bc-explanation-body' }, props.children))
    }

    /** A compact help popover for rules that would otherwise become body copy. */
    function Help(props) {
      const label = props.label ?? '说明'
      return h(
        'details',
        { className: 'dsh-bc-help' },
        h(
          'summary',
          { 'aria-label': label, title: label },
          h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true },
            h('circle', { cx: 12, cy: 12, r: 9 }), h('path', { d: 'M9.7 9.2a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1.1.9-1.1 1.7v.3M12 17h.01' })),
        ),
        h('div', { className: 'dsh-bc-helpBody' }, props.children),
      )
    }

    /** Native select with a theme-aware chevron; the closed control carries the design. */
    function Select(props) {
      const { id, name, value, disabled, onChange, children, ariaLabel, ariaInvalid, describedBy } = props
      return h(
        'div',
        { className: 'dsh-bc-select' },
        h('select', {
          id,
          name,
          value,
          disabled,
          onChange,
          'aria-label': ariaLabel,
          'aria-invalid': ariaInvalid,
          'aria-describedby': describedBy,
        }, children),
        h('svg', { className: 'dsh-bc-chevron', width: 12, height: 12, viewBox: '0 0 12 12', fill: 'none', 'aria-hidden': true },
          h('path', { d: 'm3 4.5 3 3 3-3', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' })),
      )
    }

    function Metric(props) {
      return h('div', { className: 'dsh-bc-metric' + (props.primary ? ' dsh-bc-metric-primary' : '') }, h('span', { className: 'dsh-bc-caption' }, props.label),
        h('span', { className: 'dsh-bc-metric-value dsh-bc-mono', 'data-bc': props.name }, props.value))
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
          h('span', { className: 'dsh-bc-mode-indicator', 'aria-hidden': 'true' }),
          h('span', { className: 'dsh-bc-mode-title' }, meta.label),

        ),
        h('p', { className: 'dsh-bc-mode-description' }, meta.description),
        h('div', { className: 'dsh-bc-diagram-wrap' }, h(Diagram)),

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
        { className: 'dsh-bc-strategies' },
        h('h3', { className: 'dsh-bc-h3' }, '压缩策略'),
        h(
          'div',
          { className: 'dsh-bc-modes', role: 'radiogroup', 'aria-label': '压缩模式', 'data-bc': 'mode-cards' },
          MODES.map((mode) =>
            h(ModeCard, {
              key: mode,
              mode,
              selected: props.value === mode,
              disabled: props.disabled,
              onSelect: choose,
              onMove: move,
              onMoveTo: (index) => choose(MODES[index]),
              cardRef: (node) => {
                cardRefs.current[mode] = node
              },
            }),
          ),
        ),
        h('details', { className: 'dsh-bc-modeDetails', 'data-bc': 'mode-details' },
          h('summary', null, '策略说明'),
          MODES.map((mode) => h('p', { key: mode, className: 'dsh-bc-caption' }, MODE_META[mode].label + '：' + MODE_META[mode].caption))),
      )
    }

    /** A custom switch backed by a hidden checkbox (native semantics, non-native chrome). */
    function Toggle(props) {
      const rawId = useId()
      const id = `dsh-bc-toggle-${props.name}-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
      const hintId = props.help === undefined || props.help === null ? undefined : id + '-hint'
      return h(
        'div',
        { className: 'dsh-bc-toggle' + (props.block ? ' dsh-bc-toggle-block' : '') },
        h(
          'label',
          { className: 'dsh-bc-switch', htmlFor: id },
          h('input', {
            id,
            name: props.name,
            type: 'checkbox',
            checked: props.checked === true,
            disabled: props.disabled === true,
            onChange: (event) => props.onChange(event.target.checked),
            'aria-describedby': hintId,
          }),
          h('span', { className: 'dsh-bc-switchTrack', 'aria-hidden': true }, h('span', { className: 'dsh-bc-switchThumb' })),
          h('span', { className: 'dsh-bc-switchLabel' }, props.label),
        ),
        hintId === undefined ? null : h('p', { id: hintId, className: 'dsh-bc-helpText' }, props.help),
        props.note === undefined || props.note === null ? null : h('p', { className: 'dsh-bc-note' }, props.note),
      )
    }
    /** Classify an inspect budget/diagnostic reason and point at the controls. */
    function classifyReason(text) {
      if (typeof text !== 'string' || text.length === 0) return null
      if (/leaving no message budget/i.test(text)) {
        return {
          label: '模型容量不足',
          hint: '请降低主会话的输出预留，或选择更大窗口的会话模型。',
        }
      }
      if (/leaving no pressure budget/i.test(text)) {
        return {
          label: '额外预留与输出预留占满窗口',
          hint: '请降低额外余量或主会话的输出预留，或选择更大窗口的会话模型。',
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
          hint: '请先在会话中发送一次模型请求。',
        }
      }
      if (/no context capacity/i.test(text) || /model metadata is unavailable/i.test(text)) {
        return {
          label: '模型容量未知',
          hint: '请检查该路由模型的适配器元数据。',
        }
      }
      if (/below the automatic trigger/i.test(text)) {
        return { label: '尚未到达自动触发线（提示）', hint: null }
      }
      if (/automatic compaction is disabled/i.test(text)) {
        return { label: '自动压缩已关闭（提示）', hint: '可在上下文预算中开启自动压缩。' }
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
      if (!(props.scale > 0)) return null
      const markers = [['trigger', props.triggerTokens], ['current', props.currentTokens]]
      return h('div', { className: 'dsh-bc-bar-wrap' },
        h('div', { className: 'dsh-bc-bar', role: 'img', 'aria-label': props.ariaLabel, 'data-bc': props.name },
        h('div', { className: 'dsh-bc-bar-track' }, (props.segments ?? []).filter((segment) => segment.tokens > 0).map((segment) =>
          h('div', { key: segment.key, className: 'dsh-bc-bar-seg dsh-bc-seg-' + (segment.tone ?? 'free'),
            title: segment.label + ' · ' + tokensText(segment.tokens), style: { width: percentOf(segment.tokens, props.scale) + '%' } }))),
        markers.map(([name, value]) => typeof value === 'number' && Number.isFinite(value) ? h('div', {
          key: name, className: name === 'trigger' ? 'dsh-bc-trigger' : 'dsh-bc-current-line',
          style: { left: percentOf(value, props.scale) + '%' }, 'aria-hidden': true }) : null)),
        props.ticks ? h('div', { className: 'dsh-bc-bar-ticks', 'aria-hidden': true },
          [0, 0.25, 0.5, 0.75, 1].map((ratio) => h('span', { key: ratio }, ratio === 0 ? '0' : groupDigits(Math.round(props.scale * ratio))))) : null)
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
                : `${item.label}：未知`,
            ),
          ),
        ),
      )
    }

    /** Configuration arithmetic only. Counts and safe cuts remain server-owned. */
    function projectDraftBudget(draft, budget) {
      if (!budget?.target || !Number.isFinite(budget.contextWindow) || !Number.isFinite(budget.reservedCompletionTokens)) return null
      const policy = draft.policies.find((entry) => entry.provider === budget.target.provider && entry.model === budget.target.model)
      const chosen = (key) => policy && policy[key] !== '' ? Number(policy[key]) : Number(draft[key])
      const window = budget.contextWindow
      const reserved = budget.reservedCompletionTokens
      const message = window - reserved
      const headroom = chosen('headroomTokens')
      const ratio = chosen('thresholdRatio')
      const pressure = message - headroom
      const threshold = Math.floor(Math.min(window * ratio, pressure))
      const retainMode = policy && policy.retainMode !== 'inherit' ? policy.retainMode : draft.retainMode
      const retainSource = policy && policy.retainMode !== 'inherit' ? policy : draft
      const retain = retainMode === 'tokens' ? Number(retainSource.retainTokens) : Math.floor(message * (retainSource.retainRatio === '' ? DEFAULT_RETAIN_RATIO : Number(retainSource.retainRatio)))
      const summary = policy?.maxTokens !== undefined && policy.maxTokens !== '' ? Number(policy.maxTokens)
        : draft.maxTokens !== '' ? Number(draft.maxTokens) : headroom
      if (![window, reserved, message, headroom, ratio, threshold, retain, summary].every(Number.isFinite)) return null
      let error = null
      if (message <= 0) error = '会话输出预留已占满窗口，请调整会话模型的输出上限。'
      else if (pressure <= 0) error = '额外余量须小于消息预算 ' + tokensText(message) + '。'
      else if (retain >= threshold) error = '有效保留量 ' + tokensText(retain) + ' 须小于触发点 ' + tokensText(threshold) + '。'
      return { window, reserved, message, headroom, pressure, ratio, threshold, retain, summary, policy, error }
    }

    /** Ratio input with a slider and a live token readout. */
    function RatioControl(props) {
      const rawId = useId()
      const id = 'dsh-bc-ratio-' + rawId.replace(/[^a-zA-Z0-9_-]/g, '')
      const value = props.value === '' ? '' : String(Number((Number(props.value) * 100).toFixed(8)))
      const ratio = Math.max(0.01, Math.min(0.99, Number(props.value) || 0.01))
      return h(
        'div',
        { className: 'dsh-bc-ratio' },
        h(
          'div',
          { className: 'dsh-bc-ratioHead' },
          h('label', { className: 'dsh-bc-label', htmlFor: id }, props.label),
          h(
            'div',
            { className: 'dsh-bc-number dsh-bc-number-inline' },
            h('input', {
              id,
              name: props.name,
              className: 'dsh-bc-input dsh-bc-mono',
              type: 'number',
              inputMode: 'decimal',
              min: 1,
              max: 99,
              step: 'any',
              value,
              disabled: props.disabled,
              'aria-label': props.label,
              'aria-invalid': props.error ? true : undefined,
              onChange: (event) => props.onChange(event.target.value === '' ? '' : String(Number(event.target.value) / 100)),
            }),
            h('span', { className: 'dsh-bc-unit', 'aria-hidden': true }, '%'),
          ),
        ),
        h('input', {
          name: props.sliderName,
          type: 'range',
          className: 'dsh-bc-range',
          min: 0.01,
          max: 0.99,
          step: 0.01,
          'aria-label': props.label,
          'aria-valuetext': value === '' ? '未设置' : value + '%',
          value: ratio,
          disabled: props.disabled,
          style: { '--bc-range-progress': percentOf(ratio - 0.01, 0.98) + '%' },
          onChange: (event) => props.onChange(event.target.value),
        }),
        h('div', { className: 'dsh-bc-scale', 'aria-hidden': true }, h('span', null, '1%'), h('span', null, '50%'), h('span', null, '99%')),
        props.error ? h('p', { className: 'dsh-bc-error', role: 'alert' }, props.error) : null,
      )
    }

    /** Trigger policy and headroom: one visual control, one exact value. */
    function BudgetSection(props) {
      const { draft, disabled } = props
      const ratio = Number(draft.thresholdRatio)
      const trigger = props.projection && !props.projection.error ? tokensText(props.projection.threshold) : null
      return h(
        'section',
        { className: 'dsh-bc-card', 'data-bc-section': 'budget', 'data-bc': 'trigger-editor' },
        h(
          'div',
          { className: 'dsh-bc-cardHead' },
          h('div', { className: 'dsh-bc-titleRow' },
            h('h3', { className: 'dsh-bc-h3' }, '触发与余量'),
            h(Help, { label: '预算规则' },
              h('p', null, '触发点 = 向下取整 min(窗口 × 比例, 窗口 − 输出预留 − 额外余量)。'),
              h('p', null, '消息预算 = 窗口 − 输出预留；保留比例以消息预算为基数。'))),
          h(Toggle, { name: 'auto', label: '自动压缩', checked: draft.auto, disabled, onChange: (auto) => props.onDraft({ auto }) }),
        ),
        h(RatioControl, {
          name: 'thresholdRatio',
          sliderName: 'thresholdRatioSlider',
          label: '触发比例',
          value: draft.thresholdRatio,
          disabled: disabled || !draft.auto,
          error: props.fieldError('thresholdRatio'),
          onChange: (thresholdRatio) => props.onDraft({ thresholdRatio }),
        }),
        h('div', { className: 'dsh-bc-fieldRow' },
          h(NumberField, {
            name: 'headroomTokens',
            label: '额外余量',
            value: draft.headroomTokens,
            disabled,
            error: props.fieldError('headroomTokens'),
            onChange: (headroomTokens) => props.onDraft({ headroomTokens }),
          })),
        h('p', { className: 'dsh-bc-caption dsh-bc-mono', 'data-bc': 'trigger-readout' },
          trigger === null ? '触发点待诊断' : '触发点 ' + trigger + ' · 窗口比例 ' + ratioText(ratio)),
        !draft.auto ? h('p', { className: 'dsh-bc-statusLine' }, '自动压缩已关闭；手动压缩仍可用。') : null,
      )
    }

    /** Recent-tail retention form, with the ratio/token switch as segments. */
    function RetentionSection(props) {
      const { draft, disabled } = props
      return h(
        'section',
        { className: 'dsh-bc-card' },
        h(
          'div',
          { className: 'dsh-bc-cardHead' },
          h('h3', { className: 'dsh-bc-h3' }, '近期原文保留'),
          h(Help, { label: '保留规则' },
            h('p', null, '按完整消息、工具调用与结果边界对齐；实际保留可能多于预算。'),
            h('p', null, '留空使用 16%；有效保留量必须小于触发点。'))),
        h('fieldset', { className: 'dsh-bc-retainChoice', 'data-bc': 'retention-mode' },
          h('legend', { className: 'dsh-bc-srOnly' }, '保留方式'),
          h('div', { className: 'dsh-bc-segmented' }, [['ratio', '按比例'], ['tokens', '固定 tokens']].map(([value, label]) =>
            h('label', { key: value, className: 'dsh-bc-segment', 'data-checked': draft.retainMode === value },
              h('input', {
                type: 'radio', name: 'retainMode', value,
                checked: draft.retainMode === value, disabled,
                onChange: (event) => props.onRetentionMode(event.target.value),
              }),
              h('span', null, label))))),
        h('div', { className: 'dsh-bc-fieldRow' },
          draft.retainMode === 'ratio'
            ? h(NumberField, {
              name: 'retainRatio',
              label: '保留比例',
              ratio: true,
              value: draft.retainRatio,
              placeholder: '16',
              disabled,
              error: props.fieldError('retainRatio'),
              onChange: (retainRatio) => props.onDraft({ retainRatio }),
            })
            : h(NumberField, {
              name: 'retainTokens',
              label: '保留量',
              value: draft.retainTokens,
              disabled,
              error: props.fieldError('retainTokens'),
              onChange: (retainTokens) => props.onDraft({ retainTokens }),
            })),
        h('p', { className: 'dsh-bc-caption' }, draft.retainMode === 'ratio' ? '基数为窗口减去会话输出预留。' : '固定值按完整消息边界对齐。'),
      )
    }

    const MEASUREMENT_LABEL = Object.freeze({ measured: '实测', estimated: '估算' })

    /** Right-side live window and draft allocation. */
    function RuntimeRail(props) {
      const { budget, projection, engine, engineApplies, inspectError, inspectLoading, sessionId } = props
      const unavailable = engineApplies === false
        ? '此会话使用其他压缩引擎。'
        : inspectError !== null && inspectError !== undefined
          ? '诊断读取失败：' + inspectError
          : inspectLoading
            ? '读取诊断…'
            : sessionId === ''
              ? '选择会话以读取窗口。'
              : null
      return h(
        'aside',
        { className: 'dsh-bc-rail', 'aria-label': '实时窗口' },
        h(
          'section',
          { className: 'dsh-bc-panel', 'data-bc': 'budget-snapshot' },
          h('div', { className: 'dsh-bc-panelHead' },
            h('h3', { className: 'dsh-bc-h4' }, '上下文窗口'),
            budget !== null && budget !== undefined && MEASUREMENT_LABEL[budget.measurement]
              ? h('span', { className: 'dsh-bc-chip' }, MEASUREMENT_LABEL[budget.measurement])
              : null),
          unavailable !== null
            ? h('p', { className: unavailable.startsWith('诊断读取失败') ? 'dsh-bc-error' : 'dsh-bc-note', role: unavailable.startsWith('诊断读取失败') ? 'alert' : 'status', 'data-bc': engineApplies === false ? 'budget-not-applicable' : undefined }, unavailable)
            : h(React.Fragment, null,
              h('div', { className: 'dsh-bc-metrics dsh-bc-metrics-rail' },
                h(Metric, { label: '模型窗口', value: tokensText(budget?.contextWindow), name: 'context-window' }),
                h(Metric, { label: '当前上下文', value: tokensText(budget?.currentTokens), name: 'current-tokens', primary: true }),
                h(Metric, { label: '运行触发点', value: tokensText(budget?.thresholdTokens), name: 'runtime-trigger' })),
              Number.isFinite(budget?.currentTokens) && budget?.contextWindow > 0
                ? h(TokenBar, {
                  name: 'budget-window-bar',
                  scale: Math.max(budget.contextWindow, budget.currentTokens),
                  triggerTokens: budget.thresholdTokens,
                  currentTokens: budget.currentTokens,
                  ariaLabel: '当前上下文 ' + tokensText(budget.currentTokens) + '；运行触发点 ' + tokensText(budget.thresholdTokens) + '；窗口 ' + tokensText(budget.contextWindow),
                  segments: [{ key: 'used', label: '当前上下文', tokens: budget.currentTokens, tone: 'history' }],
                })
                : null,
              h('div', { className: 'dsh-bc-markerLegend', 'aria-hidden': true },
                h('span', null, h('i', { className: 'dsh-bc-key-trigger' }), '触发点'),
                h('span', null, h('i', { className: 'dsh-bc-key-current' }), '当前')),
              budget?.measurement === 'measured' ? h('p', { className: 'dsh-bc-caption' }, '用量基于服务商返回值校准') : null,
              h('p', { className: 'dsh-bc-caption' }, budget?.target ? budget.target.provider + '/' + budget.target.model : ''))),
        projection
          ? h(
            'section',
            { className: 'dsh-bc-panel', 'data-bc': 'draft-budget' },
            h('div', { className: 'dsh-bc-panelHead' },
              h('h3', { className: 'dsh-bc-h4' }, '编辑后预算'),
              projection.policy ? h('span', { className: 'dsh-bc-chip' }, '模型规则') : null),
            h('div', { className: 'dsh-bc-metrics dsh-bc-metrics-rail' },
              h(Metric, { label: '触发', value: tokensText(projection.threshold), name: 'draft-trigger' }),
              h(Metric, { label: '消息预算', value: tokensText(projection.message), name: 'draft-message-budget' }),
              h(Metric, { label: '保留', value: tokensText(projection.retain), name: 'draft-retain' })),
            projection.error
              ? h('p', { className: 'dsh-bc-error', role: 'alert', 'data-bc': 'budget-constraint' }, projection.error)
              : h(React.Fragment, null,
                h(TokenBar, {
                  name: 'draft-window-bar',
                  scale: projection.window,
                  triggerTokens: projection.threshold,
                  ariaLabel: '编辑后窗口分配：触发点 ' + tokensText(projection.threshold) + '，额外余量 ' + tokensText(projection.headroom) + '，会话输出预留 ' + tokensText(projection.reserved),
                  segments: [
                    { key: 'trigger', label: '触发前预算', tokens: projection.threshold, tone: 'history' },
                    { key: 'slack', label: '比例约束留下的空间', tokens: projection.pressure - projection.threshold, tone: 'free' },
                    { key: 'headroom', label: '额外余量', tokens: projection.headroom, tone: 'headroom' },
                    { key: 'output', label: '会话输出预留', tokens: projection.reserved, tone: 'fixed' },
                  ],
                }),
                h(TokenLegend, {
                  items: [
                    { key: 'trigger', label: '触发前', tokens: projection.threshold, tone: 'history' },
                    ...(projection.pressure > projection.threshold ? [{ key: 'slack', label: '留白', tokens: projection.pressure - projection.threshold, tone: 'free' }] : []),
                    { key: 'headroom', label: '余量', tokens: projection.headroom, tone: 'headroom' },
                    { key: 'output', label: '输出预留', tokens: projection.reserved, tone: 'fixed' },
                  ],
                })),
            h('p', { className: 'dsh-bc-caption' }, (projection.window * projection.ratio <= projection.pressure ? '由窗口比例限制' : '由输出预留与余量限制') + (projection.policy ? ' · 已合并模型规则' : '')))
          : unavailable === null && sessionId !== ''
            ? h('section', { className: 'dsh-bc-panel', 'data-bc': 'budget-incomplete-panel' },
              h('div', { className: 'dsh-bc-panelHead' }, h('h3', { className: 'dsh-bc-h4' }, '编辑后')),
              h('div', { className: 'dsh-bc-metrics dsh-bc-metrics-rail' },
                h(Metric, { label: '保留', value: tokensText(undefined), name: 'draft-retain' })),
              h('p', { className: 'dsh-bc-caption', 'data-bc': 'budget-incomplete' }, '预算分项不可用，暂无法计算编辑后的预算。'))
            : null,
      )
    }

    /** Before/after token composition from the live inspected preview. */
    function CompressionPreview(props) {
      const { budget, preview, engineApplies, inspectError, inspectLoading, sessionId, reasons } = props
      const available = !inspectError && !inspectLoading && engineApplies !== false && sessionId !== ''
      const current = available ? preview : null
      const hasCut = typeof current?.rangeStart === 'number' && typeof current?.rangeEnd === 'number'
      const hasParts = hasCut && [budget?.fixedTokens, current?.replacedTokens, current?.retainedTokens, current?.checkpointFramingTokens, budget?.summaryMaxTokens].every(Number.isFinite)
      const scale = hasParts ? Math.max(budget.contextWindow ?? 0, budget.currentTokens, current.afterUpperBoundTokens, 1) : null
      return h(
        'section',
        { className: 'dsh-bc-card dsh-bc-preview', 'data-bc': 'runtime-preview' },
        h(
          'div',
          { className: 'dsh-bc-cardHead' },
          h('div', { className: 'dsh-bc-previewTitle' },
            h('h3', { className: 'dsh-bc-h3' }, '压缩预览'),
            hasCut ? h('span', { className: 'dsh-bc-chip dsh-bc-mono' }, '选区 ' + current.rangeStart + '–' + current.rangeEnd) : null),
          h(Help, { label: '预览说明' },
            h('p', null, '来自运行配置的自动压缩候选，与未保存的编辑值独立。'),
            h('p', null, '压缩后上界含摘要封装，不是实际摘要长度预测。'),
            h('p', null, '手动 /compact 与超限恢复使用更激进的选区，实际原文可能更多。'))),
        hasCut ? h('p', { className: 'dsh-bc-caption dsh-bc-mono', 'data-bc': 'safe-cut' }, '选区 ' + current.rangeStart + '–' + current.rangeEnd + ' · 压缩后上界 ≤ ' + tokensText(current.afterUpperBoundTokens))
          : h('p', { className: 'dsh-bc-caption', 'data-bc': 'no-safe-cut' }, available ? '当前没有安全压缩选区。' : '读取有效会话诊断后查看选区。'),
        hasParts
          ? h('div', { className: 'dsh-bc-previewBody' },
            h('div', { className: 'dsh-bc-previewRow' },
              h('div', { className: 'dsh-bc-previewLabel' },
                h('span', null, '压缩前'),
                h('span', { className: 'dsh-bc-mono' }, tokensText(budget.currentTokens))),
              h(TokenBar, {
                name: 'before-bar',
                scale,
                ariaLabel: '固定前缀、可压缩消息与实际保留原文',
                segments: [
                  { key: 'fixed', label: '固定前缀', tokens: budget.fixedTokens, tone: 'fixed' },
                  { key: 'history', label: '可压缩消息', tokens: current.replacedTokens, tone: 'history' },
                  { key: 'tail', label: '实际保留原文', tokens: current.retainedTokens, tone: 'tail' },
                ],
              })),
            h('div', { className: 'dsh-bc-previewArrow', 'aria-hidden': true },
              h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
                h('path', { d: 'M12 4v14m-5-5 5 5 5-5' }))),
            h('div', { className: 'dsh-bc-previewRow' },
              h('div', { className: 'dsh-bc-previewLabel' },
                h('span', null, '压缩后上界'),
                h('span', { className: 'dsh-bc-mono' }, '≤ ' + tokensText(current.afterUpperBoundTokens))),
              h(TokenBar, {
                name: 'after-bar',
                scale,
                ariaLabel: '固定前缀、摘要预算与封装、实际保留原文',
                segments: [
                  { key: 'fixed', label: '固定前缀', tokens: budget.fixedTokens, tone: 'fixed' },
                  { key: 'summary', label: '摘要预算与封装', tokens: budget.summaryMaxTokens + current.checkpointFramingTokens, tone: 'summary' },
                  { key: 'tail', label: '实际保留原文', tokens: current.retainedTokens, tone: 'tail' },
                ],
              })),
            h(TokenLegend, {
              items: [
                { key: 'fixed', label: '固定前缀', tokens: budget.fixedTokens, tone: 'fixed' },
                { key: 'history', label: '可压缩消息', tokens: current.replacedTokens, tone: 'history' },
                { key: 'summary', label: '摘要与封装', tokens: budget.summaryMaxTokens + current.checkpointFramingTokens, tone: 'summary' },
                { key: 'tail', label: '实际保留', tokens: current.retainedTokens, tone: 'tail' },
              ],
            }),
            null)
          : null,
        available ? h(ReasonList, { reasons }) : null,
      )
    }

    /** Model route, effort, output cap and cache preference. */
    function ModelSection(props) {
      const { draft, routes, route, disabled } = props
      const native = draft.mode === 'native'
      const custom = !route && (draft.provider !== '' || draft.model !== '')
      const textField = (name, label, value, onChange) => h(Field, {
        name, label, error: props.fieldError(name),
        children: (id, aria) => h('input', { ...aria, id, name, className: 'dsh-bc-input', value, disabled, onChange: (event) => onChange(event.target.value) }),
      })
      return h(
        'section',
        { className: 'dsh-bc-card', 'data-bc-section': 'model' },
        h('div', { className: 'dsh-bc-cardHead' },
          h('h3', { className: 'dsh-bc-h3' }, '摘要生成'),
          h(Help, { label: '摘要规则' },
            h('p', null, '摘要模型只负责压缩，不改变主会话模型。'),
            h('p', null, '摘要输出上限与输入共用该模型窗口；过高无法容纳历史，过低可能截断。'))),
        h('div', { className: 'dsh-bc-grid' },
          h(Field, { name: 'summaryRoute', label: '摘要模型', error: props.fieldError('summarizationModel'), children: (id, aria) =>
            h(Select, {
              id, name: 'summaryRoute', value: custom ? 'custom' : draft.provider === '' ? '' : JSON.stringify([draft.provider, draft.model]), disabled,
              ariaInvalid: props.fieldError('summarizationModel') ? true : undefined,
              onChange: (event) => {
                if (event.target.value === 'custom') return
                const [provider, model] = event.target.value === '' ? ['', ''] : JSON.parse(event.target.value)
                props.onDraft({ provider, model })
              },
            },
            h('option', { value: '' }, '跟随会话模型'),
            routes.map((entry) => h('option', { key: JSON.stringify([entry.provider, entry.model]), value: JSON.stringify([entry.provider, entry.model]) }, entry.provider + '/' + entry.model)),
            custom ? h('option', { value: 'custom' }, draft.provider + '/' + draft.model) : null) }),
          h(Field, { name: 'reasoningEffort', label: '思考强度', error: props.fieldError('reasoningEffort'), children: (id, aria) =>
            route ? h(Select, {
              id, name: 'reasoningEffort', value: draft.effort, disabled: disabled || native,
              ariaInvalid: props.fieldError('reasoningEffort') ? true : undefined,
              onChange: (event) => props.onDraft({ effort: event.target.value }),
            },
            h('option', { value: '' }, native ? NATIVE_NOT_APPLICABLE : '模型默认'),
            route.efforts.map((effort) => h('option', { key: effort, value: effort }, effort)),
            draft.effort !== '' && !route.efforts.includes(draft.effort) ? h('option', { value: draft.effort }, draft.effort + ' · 未声明支持') : null)
              : h('input', {
                ...aria, id, name: 'reasoningEffort', className: 'dsh-bc-input', value: draft.effort, disabled: disabled || native,
                placeholder: native ? NATIVE_NOT_APPLICABLE : '模型默认；能力未知',
                onChange: (event) => props.onDraft({ effort: event.target.value }),
              }) }),
          h(NumberField, {
            name: 'maxTokens', label: '摘要输出上限', value: draft.maxTokens, min: 1, disabled, placeholder: draft.headroomTokens,
            error: props.fieldError('maxTokens'), onChange: (maxTokens) => props.onDraft({ maxTokens }),
          }),
          h(Toggle, {
            name: 'cachePriority', label: CACHE_PRIORITY_COPY, checked: draft.cachePriority, disabled: disabled || native, block: true,
            onChange: (cachePriority) => props.onDraft({ cachePriority }),
          })),
        h('details', { className: 'dsh-bc-customRoute', open: custom || undefined },
          h('summary', null, '自定义摘要路由'),
          h('div', { className: 'dsh-bc-grid' },
            textField('summarizationProvider', '服务商', draft.provider, props.onProvider),
            textField('summarizationModel', '模型', draft.model, props.onModel))),
        native ? h('p', { className: 'dsh-bc-caption' }, '原生模式由宿主决定思考强度与缓存优先。') : null,
        props.routeWarning ? h('p', { className: 'dsh-bc-note', 'data-bc': 'route-warning' }, props.routeWarning) : null,
        props.modelsStatus === 'loading' || props.modelsStatus === 'refreshing' ? h('p', { className: 'dsh-bc-caption', role: 'status' }, '读取模型列表…')
          : props.modelsStatus === 'error' ? h('p', { className: 'dsh-bc-note' }, '模型列表读取失败，可使用自定义模型。') : null,
      )
    }

    // ── advanced section ──────────────────────────────────────────────────

    function AdvancedSection(props) {
      const { draft, disabled } = props
      const updatePolicy = (index, patch) => props.onDraft({ policies: draft.policies.map((entry, i) => i === index ? { ...entry, ...patch } : entry) })
      const policyField = (index, key, label, ratio, placeholder) => h(NumberField, {
        name: 'policies.' + index + '.' + key, label, ratio, value: draft.policies[index][key], disabled: disabled || !draft.auto && (key === 'thresholdRatio' || key === 'compactionRetries' || key === 'maxOverflowRetries'),
        placeholder, error: props.fieldError('policies.' + index + '.' + key), onChange: (value) => updatePolicy(index, { [key]: value }) })
      const policyText = (index, key, label) => h(Field, { name: 'policies.' + index + '.' + key, label,
        error: props.fieldError('policies.' + index + '.' + key), children: (id, aria) => h('input', {
          ...aria, id, name: 'policies.' + index + '.' + key, className: 'dsh-bc-input', value: draft.policies[index][key], disabled,
          onChange: (event) => updatePolicy(index, { [key]: event.target.value }) }) })
      return h('details', { className: 'dsh-bc-details', 'data-bc': 'advanced' },
        h('summary', null, '高级设置'),
        h('div', { className: 'dsh-bc-details-body' },
          h('div', { className: 'dsh-bc-grid' },
            h(NumberField, { name: 'compactionRetries', label: '压力残留重试', unit: '次', value: draft.compactionRetries, disabled: disabled || !draft.auto,
              error: props.fieldError('compactionRetries'), onChange: (compactionRetries) => props.onDraft({ compactionRetries }) }),
            h(NumberField, { name: 'maxOverflowRetries', label: '超限恢复次数', unit: '次', value: draft.maxOverflowRetries, disabled: disabled || !draft.auto,
              error: props.fieldError('maxOverflowRetries'), onChange: (maxOverflowRetries) => props.onDraft({ maxOverflowRetries }) })),
          h(Explain, { title: '重试规则' },
            h('p', { className: 'dsh-bc-caption' }, '压力残留重试：压缩成功后仍有压力时的额外尝试次数，并非网络重试。超限恢复：服务商确认上下文超限后的恢复次数，0 为关闭；自动压缩关闭时不启用。')),
          h('div', { className: 'dsh-bc-subhead' }, h('h4', { className: 'dsh-bc-h4' }, '按模型覆盖'),
            h('button', { type: 'button', className: 'dsh-bc-btn', disabled, 'data-bc': 'add-policy',
              onClick: () => props.onDraft({ policies: [...draft.policies, policyDraft()] }) }, '添加规则')),
          draft.policies.length === 0 ? h('p', { className: 'dsh-bc-caption' }, '所有模型使用全局设置。') : null,
          draft.policies.map((policy, index) => h('details', { key: index, className: 'dsh-bc-policy', open: !policy.provider || !policy.model ? true : undefined, 'data-bc-policy': index },
            h('summary', { className: 'dsh-bc-mono' }, policy.provider && policy.model ? policy.provider + '/' + policy.model : '新规则'),
            h('div', { className: 'dsh-bc-policy-body' },
              h('div', { className: 'dsh-bc-grid' }, policyText(index, 'provider', '会话服务商'), policyText(index, 'model', '会话模型'),
                POLICY_NUMBERS.map(([key, label, ratio]) => h(React.Fragment, { key }, policyField(index, key, label, ratio,
                  ratio ? String(Number(draft[key]) * 100) : key === 'maxTokens' ? draft.maxTokens || policy.headroomTokens || draft.headroomTokens : draft[key]))),
                h(Field, { name: 'policies.' + index + '.retainMode', label: '原文保留方式', children: (id) => h('select', {
                  id, name: 'policies.' + index + '.retainMode', className: 'dsh-bc-input', value: policy.retainMode, disabled,
                  onChange: (event) => updatePolicy(index, { retainMode: event.target.value }) },
                  h('option', { value: 'inherit' }, '继承全局设置'), h('option', { value: 'ratio' }, '按消息预算比例'), h('option', { value: 'tokens' }, '固定 token 数')) }),
                policy.retainMode !== 'inherit' ? policyField(index, policy.retainMode === 'ratio' ? 'retainRatio' : 'retainTokens',
                  policy.retainMode === 'ratio' ? '保留比例' : '保留量', policy.retainMode === 'ratio') :
                  props.fieldError('policies.' + index + '.retainRatio') ? h('p', { className: 'dsh-bc-error', role: 'alert' }, props.fieldError('policies.' + index + '.retainRatio')) : null,
                h(Field, { name: 'policies.' + index + '.summaryMode', label: '摘要模型', children: (id) => h('select', {
                  id, name: 'policies.' + index + '.summaryMode', className: 'dsh-bc-input', value: policy.summaryMode, disabled,
                  onChange: (event) => updatePolicy(index, { summaryMode: event.target.value }) },
                  h('option', { value: 'inherit' }, '继承全局设置'), h('option', { value: 'session' }, '跟随会话模型'), h('option', { value: 'custom' }, '指定摘要模型')) }),
                policy.summaryMode === 'custom' ? h(React.Fragment, null,
                  policyText(index, 'summarizationProvider', '摘要服务商'), policyText(index, 'summarizationModel', '摘要模型')) : null),
              h('div', { className: 'dsh-bc-subhead' }, h('span', { className: 'dsh-bc-caption' }, '数值留空继承；模型名称精确匹配。'),
                h('button', { type: 'button', className: 'dsh-bc-btn dsh-bc-btn-remove', disabled, 'aria-label': '删除规则 ' + (index + 1),
                  onClick: () => props.onDraft({ policies: draft.policies.filter((_, i) => i !== index) }) }, '删除规则'))))),
          h(Explain, { title: '覆盖规则的生效方式' },
            h('p', { className: 'dsh-bc-caption' }, '规则匹配主会话的服务商与模型，不匹配摘要模型。空白数值继承全局；保留方式只能选择一种。每个模型只能有一条规则。'),
            h('p', { className: 'dsh-bc-caption' }, '全局未指定摘要输出上限时，规则的额外余量也作为该模型的摘要输出上限；若余量为 0，须显式设置正数输出上限。'))))
    }

    // ── status section ────────────────────────────────────────────────────

    const STATUS_LABELS = Object.freeze({
      running: '进行中',
      completed: '已完成',
      failed: '生成失败',
      cancelled: '已取消',
      'persistence-error': '持久化失败',
    })

    /** Only state what the engine ownership means for this page. */
    function engineNote(engine) {
      if (engine === null || engine === undefined) return '未选择会话。'
      if (engine.inspectApplies === false) return '此会话由其他压缩引擎接管（' + engine.owner + '）；预算与预览不适用。'
      if (engine.owner === 'unknown') return '引擎归属未确认；预算与预览仅作配置诊断。'
      return '压缩引擎：' + engine.owner + '。'
    }

    /** The status of the last real native compaction bracket. */
    function LastCompaction(props) {
      const record = props.record
      if (!record) return h('p', { className: 'dsh-bc-caption', 'data-bc': props.emptyName ?? 'last-compaction-empty' }, props.emptyText)
      return h('div', { className: 'dsh-bc-status-record', 'data-bc': 'last-compaction', 'data-status': record.status },
        h('p', { className: 'dsh-bc-status-line dsh-bc-status-' + record.status }, (STATUS_LABELS[record.status] ?? '未知') + ' · ' + (record.trigger === 'manual' ? '手动' : record.trigger === 'automatic' ? '自动' : '触发原因未知')),
        h('div', { className: 'dsh-bc-status-grid' },
          h(Row, { label: '压缩策略', value: MODE_META[record.mode]?.label ?? '未知' }),
          h(Row, { label: '耗时', value: durationText(record.durationMs) }),
          h(Row, { label: '已替换消息', value: tokensText(record.beforeTokens) }),
          h(Row, { label: '摘要消息估算', value: tokensText(record.afterTokens) }),
          h(Row, { label: '缓存读取', value: tokensText(record.cacheReadTokens) }),
          h(Row, { label: '缓存写入', value: tokensText(record.cacheWriteTokens) })),
        record.status === 'persistence-error' ? h('p', { className: 'dsh-bc-error', role: 'alert', 'data-bc': 'persistence-error' }, '摘要可能已写入，但会话保存失败。') : null,
        record.error ? h('p', { className: 'dsh-bc-error', role: 'alert' }, record.error) : null,
        h('p', { className: 'dsh-bc-caption' }, '未报告的数值显示为未知。'))
    }

    function StatusSection(props) {
      const reasons = [...new Set((props.diagnostics ?? []).filter((entry) => typeof entry === 'string' && entry !== ''))]
      return h('details', { className: 'dsh-bc-details', 'data-bc-section': 'status' },
        h('summary', null, '会话诊断'), h('div', { className: 'dsh-bc-details-body' },
          h('p', { className: 'dsh-bc-caption', 'data-bc': 'engine-note' }, engineNote(props.engine)),
          props.inspectError ? h('p', { className: 'dsh-bc-error', role: 'alert' }, props.inspectError)
            : props.inspectLoading ? h('p', { className: 'dsh-bc-note', role: 'status' }, '读取诊断…')
            : h(LastCompaction, { record: props.record, emptyName: props.sessionId === '' ? 'status-empty' : 'last-compaction-empty', emptyText: props.sessionId === '' ? '选择会话查看压缩记录。' : '此会话暂无压缩记录。' }),
          props.continuation ? h('div', { className: 'dsh-bc-continuation', 'data-bc': 'handoff-continuation' },
            h('h4', { className: 'dsh-bc-h4' }, '文件交接续作'),
            h('p', { className: 'dsh-bc-note' }, props.continuation.status === 'scheduled' ? '已安排一次同会话续作。' : '本次续作已跳过。'),
            props.continuation.blockers?.length ? h('ul', { className: 'dsh-bc-bullets' }, props.continuation.blockers.map((item, index) => h('li', { key: index }, item))) : null) : null,
          reasons.length ? h(Explain, { title: '诊断详情（' + reasons.length + '）' }, h(ReasonList, { reasons })) : null))
    }

    function SessionPicker(props) {
      const id = 'dsh-bc-session-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
      return h('div', { className: 'dsh-bc-session', 'data-bc': 'session-picker' },
        h('label', { htmlFor: id, className: 'dsh-bc-srOnly' }, '诊断会话'),
        h(Select, {
          id,
          name: 'inspectSession',
          value: props.selectedId,
          ariaLabel: '诊断会话',
          onChange: (event) => props.onSelect(event.target.value),
        },
        h('option', { value: '' }, props.phase === 'pending' ? '加载会话…' : '选择会话'),
        props.entries.map((entry) => h('option', { key: entry.id, value: entry.id }, entry.title + (entry.running ? ' · 运行中' : '')))),
        h('button', {
          type: 'button', className: 'dsh-bc-iconBtn', onClick: props.onRefresh, disabled: props.refresh,
          'aria-label': '刷新会话诊断', title: '刷新会话诊断',
        },
        h('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
          h('path', { d: 'M20 11a8 8 0 1 0-2.4 6M20 4v7h-7' }))),
        props.listError ? h('span', { className: 'dsh-bc-error' }, '会话列表读取失败') : null)
    }
    function ActiveConfigPill(props) {
      const active = props.activeConfig
      const pending = props.requiresReload === true
      const mode = active ? (MODE_META[active.mode]?.label ?? active.mode) : null
      const label = pending ? '已保存，待重载' : active ? '运行中' : '运行状态未知'
      const retain = active ? (active.retainTokens != null ? tokensText(active.retainTokens) : ratioText(active.retainRatio)) : null
      return h('span', {
        className: 'dsh-bc-pill',
        'data-bc': 'active-config',
        'data-tone': pending ? 'warn' : active ? 'live' : 'muted',
        'data-requires-reload': String(pending),
        title: pending ? '保存后需重启 DSH 或重载配置档' : undefined,
      },
        h('i', { className: 'dsh-bc-pillDot', 'aria-hidden': true }),
        h('span', null, label),
        mode !== null && !pending ? h('span', { className: 'dsh-bc-pillMode' }, mode) : null,
        retain !== null ? h('span', { className: 'dsh-bc-pillMeta dsh-bc-mono' }, '保留 ' + retain + ' · 触发 ' + ratioText(active.thresholdRatio)) : null)
    }

    function SaveFooter(props) {
      const saving = props.saving || props.saveState.kind === 'saving'
      const disabled = props.disabled || saving || props.conflict || !props.writable || !props.dirty || props.errors.length > 0
      const failure = props.saveState.kind === 'transport' ? '保存失败：' + props.saveState.message + '。草稿已保留。'
        : props.saveState.kind === 'rejected' ? '宿主拒绝保存，草稿已保留。请重新读取并核对配置。'
        : props.conflict ? '配置已被其他页面更新，请重新读取后编辑。' : null
      return h('footer', { className: 'dsh-bc-footer', 'data-bc': 'save-footer' },
        h('div', { className: 'dsh-bc-footer-copy' },
          failure ? h('p', { className: 'dsh-bc-error', role: 'alert', 'data-bc': props.conflict ? 'revision-conflict' : props.saveState.kind === 'rejected' ? 'save-rejected' : 'save-transport' }, failure)
            : h('p', { className: 'dsh-bc-note', role: 'status', 'data-bc': !props.writable ? 'read-only' : props.saveState.kind === 'saved' ? 'save-saved' : 'save-status' },
              !props.writable ? '只读' : props.saveState.kind === 'saved' ? '已保存，重载后生效；刷新网页不会更新运行引擎' : props.dirty ? '未保存' : ''),
          props.errors.length ? h(Explain, { title: '需修正 ' + props.errors.length + ' 项', open: true },
            h('ul', { className: 'dsh-bc-reasons' }, props.errors.map((message, index) => h('li', { key: index }, message)))) : null),
        h('div', { className: 'dsh-bc-actions' },
          h('button', { type: 'button', className: 'dsh-bc-btn', onClick: props.onReload, disabled: saving || (!props.dirty && !props.conflict) }, props.conflict ? '重新读取' : '放弃更改'),
          h('button', { type: 'button', className: 'dsh-bc-btn dsh-bc-btn-primary', onClick: props.onSave, disabled, 'data-bc': 'save-button' }, saving ? '保存中…' : '保存设置')))
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
          ? pluginInspect.status === 'loading' || pluginInspect.status === 'refreshing'
          : sessionInspect.status === 'loading' || sessionInspect.status === 'refreshing'
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
      const draftErrors = draft === null ? [] : validateDraft(draft)
      const projection = draft !== null && draftErrors.length === 0 && engineApplies !== false && inspectError === null && !inspectLoading ? projectDraftBudget(draft, budget) : null
      const baseErrors = [...draftErrors]
      if (projection?.error) {
        const index = projection.policy ? draft.policies.indexOf(projection.policy) : -1
        baseErrors.push({ field: (index < 0 ? '' : 'policies.' + index + '.') + (projection.pressure <= 0 ? 'headroomTokens' : projection.policy?.retainMode === 'tokens' || (!projection.policy || projection.policy.retainMode === 'inherit') && draft.retainMode === 'tokens' ? 'retainTokens' : 'retainRatio'), message: projection.error })
      }
      const modelErrors = draft === null ? [] : validateModelSelection(draft, routes, modelsReady && modelsEnabled === true, budget?.target)
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
      const sessionControl = h(SessionPicker, {
        entries,
        selectedId,
        onSelect: setPickedId,
        listAvailable: props.sessions !== null && props.sessions !== undefined,
        phase: sessionList !== null && sessionList !== undefined ? sessionList.phase : 'ready',
        listError: sessionList !== null && sessionList !== undefined ? sessionList.error : null,
        refresh: inspectLoading,
        onRefresh: refresh,
      })
      const title = h(
        'header',
        { className: 'dsh-bc-head', key: 'head' },
        h('div', { className: 'dsh-bc-headMain' },
          h('h2', { className: 'dsh-bc-title' }, '上下文压缩'),
          h(ActiveConfigPill, { activeConfig, requiresReload, dirty })),
        h('div', { className: 'dsh-bc-headTools' }, sessionControl),
        requiresReload === true ? h('p', { className: 'dsh-bc-runtimeHint' }, '保存后需重启 DSH 或重载配置档。') : null,
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
        h(ModeCards, {
          value: draft === null ? '' : draft.mode,
          disabled,
          onChange: (mode) => updateDraft({ mode }),
        }),
        h('div', { className: 'dsh-bc-workbench' },
          h('div', { className: 'dsh-bc-main' },
            h(BudgetSection, {
              projection,
              draft: draft ?? draftFromValue({}),
              disabled,
              fieldError,
              onDraft: updateDraft,
            }),
            h(RetentionSection, {
              draft: draft ?? draftFromValue({}),
              disabled,
              fieldError,
              onDraft: updateDraft,
              onRetentionMode: (retainMode) => updateDraft({ retainMode }),
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
            h(AdvancedSection, { draft: draft ?? draftFromValue({}), disabled, fieldError, onDraft: updateDraft })),
          h(RuntimeRail, {
            budget,
            projection,
            engine,
            engineApplies,
            inspectError,
            inspectLoading,
            sessionId: selectedId,
          })),
        h(CompressionPreview, {
          budget,
          preview,
          engineApplies,
          inspectError,
          inspectLoading,
          sessionId: selectedId,
          reasons: budgetReasons,
        }),
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

    const STYLE = `.dsh-bc-page{--bc-accent:#3388BB;--bc-accent-ink:color-mix(in srgb,var(--bc-accent) 72%,var(--dsw-alias-label-primary));--bc-accent-soft:color-mix(in srgb,var(--bc-accent) 10%,transparent);--bc-on-accent:#fff;display:flex;flex-direction:column;gap:20px;min-width:0;max-width:1040px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;container-type:inline-size;container-name:better-compact;overflow-wrap:anywhere;color-scheme:inherit}
.dsh-bc-page *{box-sizing:border-box}
.dsh-bc-mono{font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Consolas,monospace);font-variant-numeric:tabular-nums}
.dsh-bc-page-head,.dsh-bc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;min-width:0}
.dsh-bc-headMain{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0}
.dsh-bc-headTools{display:flex;align-items:center;gap:8px;min-width:0;max-width:100%}
.dsh-bc-title{margin:0;font-size:20px;line-height:28px;font-weight:600;letter-spacing:-.01em}
.dsh-bc-section{display:flex;flex-direction:column;gap:12px;min-width:0}
.dsh-bc-pill{display:inline-flex;align-items:center;gap:6px;min-height:22px;padding-block:2px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px;white-space:nowrap}
.dsh-bc-pillDot{display:block;width:5px;height:5px;flex:none;border-radius:50%;background:var(--dsw-alias-label-tertiary)}
.dsh-bc-pill[data-tone=live] .dsh-bc-pillDot{background:var(--bc-accent)}
.dsh-bc-pill[data-tone=warn] .dsh-bc-pillDot{background:var(--dsw-alias-state-warn-primary,var(--dsw-alias-label-primary))}
.dsh-bc-pillMode{padding-left:6px;border-left:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.dsh-bc-pillMeta{padding-left:6px;border-left:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font-size:10px}
.dsh-bc-runtimeHint{flex-basis:100%;margin:2px 0 0;color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-label-secondary));font-size:12px;line-height:18px}
.dsh-bc-iconBtn{display:inline-flex;align-items:center;justify-content:center;flex:none;width:32px;height:32px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background-color 100ms ease,border-color 100ms ease}
.dsh-bc-iconBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary)}
.dsh-bc-page :is(button,input,select,summary,[role=radio]):focus{outline:none}
.dsh-bc-page :is(button,input,select,summary,[role=radio]):focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--bc-accent));outline-offset:2px}
.dsh-bc-page :disabled{opacity:.4;cursor:not-allowed}
.dsh-bc-strategies{display:flex;flex-direction:column;gap:10px;min-width:0}
.dsh-bc-modeDetails{min-width:0;font-size:12px}
.dsh-bc-modeDetails>summary{display:flex;align-items:center;gap:4px;width:fit-content;cursor:pointer;color:var(--dsw-alias-label-tertiary);padding:2px 0;list-style:none}.dsh-bc-modeDetails>summary:before{content:'›';display:inline-block;font-size:13px;line-height:1;transition:transform 120ms ease}.dsh-bc-modeDetails[open]>summary:before{transform:rotate(90deg)}.dsh-bc-modeDetails>summary::-webkit-details-marker{display:none}.dsh-bc-modeDetails[open]>summary{color:var(--dsw-alias-label-primary)}
.dsh-bc-modeDetails>summary:hover{color:var(--dsw-alias-label-primary)}
.dsh-bc-modeDetails>p{margin:4px 0 0}
.dsh-bc-modes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;min-width:0}
.dsh-bc-mode{display:flex;flex-direction:column;gap:8px;min-width:0;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2);cursor:pointer;transition:background-color 120ms ease,border-color 120ms ease}
.dsh-bc-mode:hover:not([aria-disabled=true]){border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-bc-mode:active:not([aria-disabled=true]){background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-interactive-bg-hover))}
.dsh-bc-mode[aria-checked=true]{border-color:color-mix(in srgb,var(--bc-accent) 62%,var(--dsw-alias-border-l3));background:var(--bc-accent-soft)}
.dsh-bc-mode[aria-checked=true]:hover:not([aria-disabled=true]){background:color-mix(in srgb,var(--bc-accent) 14%,transparent)}
.dsh-bc-mode-head{display:flex;align-items:center;gap:8px;min-width:0}
.dsh-bc-mode-title{font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary)}
.dsh-bc-mode-indicator{display:block;width:12px;height:12px;flex:none;border:1px solid var(--dsw-alias-border-l4);border-radius:50%;background:transparent}
.dsh-bc-mode[aria-checked=true] .dsh-bc-mode-indicator{border-color:var(--bc-accent);background:radial-gradient(circle,var(--bc-accent) 0 3px,transparent 3.5px)}
.dsh-bc-mode-description{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;min-height:36px}
.dsh-bc-diagram-wrap{min-width:0;margin-top:auto;padding-top:4px}
.dsh-bc-diagram{display:block;width:100%;max-width:168px;height:auto;margin:0 auto;color:var(--dsw-alias-label-secondary)}
.dsh-bc-diagram text{fill:currentColor;font-family:inherit;font-size:11px}
.dsh-bc-node{fill:var(--dsw-alias-bg-layer-1);stroke:var(--dsw-alias-border-l3);stroke-width:1}
.dsh-bc-node-strong{fill:var(--dsw-alias-bg-layer-3);stroke:var(--dsw-alias-border-l4)}
.dsh-bc-node-accent{fill:var(--bc-accent-soft);stroke:color-mix(in srgb,var(--bc-accent) 65%,var(--dsw-alias-border-l3))}
.dsh-bc-node-dashed{stroke-dasharray:3 2}
.dsh-bc-edge{stroke:currentColor;stroke-width:1;fill:none}
.dsh-bc-workbench{display:grid;grid-template-columns:minmax(0,1fr) 304px;gap:20px;align-items:start;min-width:0}
.dsh-bc-main{display:flex;flex-direction:column;gap:12px;min-width:0}
.dsh-bc-rail{display:flex;flex-direction:column;gap:12px;min-width:0;position:sticky;top:0}
.dsh-bc-card,.dsh-bc-panel{min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}
.dsh-bc-card{display:flex;flex-direction:column;gap:14px;padding:16px;position:relative}
.dsh-bc-panel{display:flex;flex-direction:column;gap:10px;padding:12px}
.dsh-bc-cardHead,.dsh-bc-panelHead{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;min-width:0}
.dsh-bc-cardHead .dsh-bc-toggle{margin-left:auto}
.dsh-bc-h3,.dsh-bc-h4{margin:0;font-weight:500}
.dsh-bc-h3{font-size:14px;line-height:20px}
.dsh-bc-titleRow{display:flex;align-items:center;gap:6px;min-width:0}
.dsh-bc-h4{font-size:13px;line-height:20px}
.dsh-bc-caption,.dsh-bc-helpText{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsh-bc-note{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsh-bc-error{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}
.dsh-bc-statusLine{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-label-secondary))}
.dsh-bc-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.dsh-bc-fieldRow{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;min-width:0}
.dsh-bc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px;min-width:0}
.dsh-bc-label{font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.dsh-bc-input,.dsh-bc-select select{width:100%;min-width:0;height:32px;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;transition:border-color 100ms ease,background-color 100ms ease}
.dsh-bc-input{padding:0 10px}.dsh-bc-page input[type=number]{appearance:textfield;-moz-appearance:textfield}.dsh-bc-page input[type=number]::-webkit-outer-spin-button,.dsh-bc-page input[type=number]::-webkit-inner-spin-button{appearance:none;margin:0}
.dsh-bc-input::placeholder{color:var(--dsw-alias-label-dimmed)}
.dsh-bc-input:hover:not(:disabled),.dsh-bc-select select:hover:not(:disabled){border-color:var(--dsw-alias-border-l4)}
.dsh-bc-input:focus-visible,.dsh-bc-select select:focus-visible{border-color:var(--bc-accent)}
.dsh-bc-input[aria-invalid=true],.dsh-bc-select select[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary)}
.dsh-bc-select{position:relative;min-width:0}
.dsh-bc-select select{appearance:none;-webkit-appearance:none;padding:0 30px 0 10px;cursor:pointer}
.dsh-bc-chevron{position:absolute;right:10px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--dsw-alias-label-tertiary)}
.dsh-bc-number{position:relative;min-width:0}
.dsh-bc-number .dsh-bc-input{padding-right:56px}
.dsh-bc-number-inline{flex:none;width:88px}
.dsh-bc-number-inline .dsh-bc-input{height:28px;padding:0 22px 0 8px;text-align:right;font-size:12px}
.dsh-bc-unit{position:absolute;right:10px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px}
.dsh-bc-ratio{display:flex;flex-direction:column;gap:8px;min-width:0}
.dsh-bc-ratioHead{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
.dsh-bc-range{appearance:none;-webkit-appearance:none;display:block;width:100%;height:6px;margin:2px 0 0;border-radius:999px;background:linear-gradient(to right,var(--bc-accent) var(--bc-range-progress,50%),var(--dsw-alias-border-l3) var(--bc-range-progress,50%));cursor:pointer}
.dsh-bc-range::-webkit-slider-thumb{appearance:none;width:16px;height:16px;border:2px solid var(--bc-accent);border-radius:50%;background:var(--dsw-alias-bg-layer-1);transition:background-color 100ms ease}
.dsh-bc-range::-moz-range-thumb{width:12px;height:12px;border:2px solid var(--bc-accent);border-radius:50%;background:var(--dsw-alias-bg-layer-1)}
.dsh-bc-range:hover:not(:disabled)::-webkit-slider-thumb{background:var(--bc-accent-soft)}
.dsh-bc-range:active:not(:disabled)::-webkit-slider-thumb{background:var(--bc-accent)}
.dsh-bc-scale{display:flex;justify-content:space-between;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}
.dsh-bc-retainChoice{display:flex;flex-direction:column;gap:6px;min-width:0;padding:0;margin:0;border:0}
.dsh-bc-segmented{display:flex;gap:2px;min-height:32px;padding:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-interactive-bg-hover)}
.dsh-bc-segment{position:relative;display:flex;align-items:center;justify-content:center;flex:1;min-width:0;min-height:26px;padding:2px 8px;border-radius:6px;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;transition:background-color 100ms ease,color 100ms ease}
.dsh-bc-segment input{position:absolute;width:1px;height:1px;margin:0;opacity:0}
.dsh-bc-segment:hover:not([data-disabled=true]){color:var(--dsw-alias-label-primary)}
.dsh-bc-segment[data-checked=true]{background:var(--dsw-alias-bg-layer-1);color:var(--bc-accent-ink);font-weight:500;outline:.5px solid var(--dsw-alias-border-l3);outline-offset:-.5px}
.dsh-bc-segment:has(input:disabled){opacity:.4;cursor:not-allowed}
.dsh-bc-segment:has(input:focus-visible){outline:2px solid var(--bc-accent);outline-offset:2px}
.dsh-bc-toggle{display:flex;flex-direction:column;gap:4px;min-width:0}
.dsh-bc-switch{position:relative;display:inline-flex;align-items:center;gap:8px;min-height:32px;cursor:pointer;user-select:none}
.dsh-bc-switch input{position:absolute;width:1px;height:1px;margin:0;opacity:0;pointer-events:none}
.dsh-bc-switchTrack{display:block;width:32px;height:18px;flex:none;padding:2px;border:1px solid var(--dsw-alias-border-l3);border-radius:999px;background:var(--dsw-alias-bg-layer-3);transition:background-color 120ms ease,border-color 120ms ease}
.dsh-bc-switchThumb{display:block;width:12px;height:12px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:transform 120ms ease,background-color 120ms ease}
.dsh-bc-switch input:checked + .dsh-bc-switchTrack{background:var(--bc-accent);border-color:var(--bc-accent)}
.dsh-bc-switch input:checked + .dsh-bc-switchTrack .dsh-bc-switchThumb{transform:translateX(14px);background:var(--bc-on-accent)}
.dsh-bc-switch input:focus-visible + .dsh-bc-switchTrack{outline:2px solid var(--bc-accent);outline-offset:2px}
.dsh-bc-switch:has(input:disabled){opacity:.4;cursor:not-allowed}
.dsh-bc-switchLabel{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsh-bc-help{position:relative;flex:none;font-size:12px}
.dsh-bc-help>summary{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;color:var(--dsw-alias-label-tertiary);cursor:pointer;list-style:none}
.dsh-bc-help>summary::-webkit-details-marker{display:none}
.dsh-bc-help>summary:hover,.dsh-bc-help[open]>summary{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-bc-helpBody{position:absolute;right:0;top:26px;z-index:20;width:300px;max-width:min(300px,70vw);padding:10px 12px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dsh-bc-helpBody p{margin:0 0 6px}
.dsh-bc-helpBody p:last-child{margin-bottom:0}
.dsh-bc-chip{display:inline-flex;align-items:center;height:20px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px;white-space:nowrap}
.dsh-bc-chip-quiet{border-color:transparent;background:transparent;color:var(--dsw-alias-label-tertiary)}
.dsh-bc-session{display:flex;align-items:center;gap:6px;min-width:0;max-width:360px;flex:0 1 auto}
.dsh-bc-session .dsh-bc-select{flex:1;min-width:0}
.dsh-bc-session .dsh-bc-select select{height:30px;font-size:12px}
.dsh-bc-srOnly,.dsh-bc-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
.dsh-bc-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;min-width:0}
.dsh-bc-metric{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-bc-metric .dsh-bc-caption{font-size:11px;line-height:16px}
.dsh-bc-metric-value{min-width:0;font-size:14px;line-height:20px;font-weight:500;font-variant-numeric:tabular-nums}
.dsh-bc-metric-primary .dsh-bc-metric-value{color:var(--dsw-alias-label-primary)}
.dsh-bc-metrics-rail{grid-template-columns:minmax(0,1fr);gap:3px}
.dsh-bc-metrics-rail .dsh-bc-metric{flex-direction:row;align-items:baseline;justify-content:space-between;gap:12px}
.dsh-bc-metrics-rail .dsh-bc-metric .dsh-bc-caption{flex:none}
.dsh-bc-metrics-rail .dsh-bc-metric-value{font-size:12px;line-height:18px;overflow-wrap:anywhere;text-align:right}
.dsh-bc-bar-wrap{display:flex;flex-direction:column;gap:6px;min-width:0}
.dsh-bc-bar{position:relative;min-width:0;height:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;overflow:hidden;background:var(--dsw-alias-interactive-bg-hover)}
.dsh-bc-bar-track{display:flex;width:100%;height:100%}
.dsh-bc-bar-seg{flex:none;height:100%;border-right:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 60%,transparent)}
.dsh-bc-seg-fixed,.dsh-bc-swatch-fixed{background:color-mix(in srgb,var(--dsw-alias-label-tertiary) 55%,transparent)}
.dsh-bc-seg-history,.dsh-bc-swatch-history{background:color-mix(in srgb,var(--bc-accent) 32%,transparent)}
.dsh-bc-seg-tail,.dsh-bc-swatch-tail{background:var(--bc-accent)}
.dsh-bc-seg-summary,.dsh-bc-swatch-summary{background:repeating-linear-gradient(135deg,var(--bc-accent) 0 2px,transparent 2px 5px)}
.dsh-bc-seg-headroom,.dsh-bc-swatch-headroom{background:repeating-linear-gradient(135deg,var(--dsw-alias-label-tertiary) 0 1px,transparent 1px 4px);opacity:.5}
.dsh-bc-seg-free{background:transparent}
.dsh-bc-trigger,.dsh-bc-current-line{position:absolute;top:0;bottom:0;pointer-events:none;max-width:100%;transform:translateX(-1px);border-left:2px solid var(--dsw-alias-label-primary)}
.dsh-bc-current-line{border-left:1px dashed var(--dsw-alias-label-primary)}
.dsh-bc-markerLegend{display:flex;flex-wrap:wrap;gap:12px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}
.dsh-bc-markerLegend span{display:flex;align-items:center;gap:6px}
.dsh-bc-key-trigger,.dsh-bc-key-current{display:inline-block;height:10px;border-left:2px solid var(--dsw-alias-label-primary)}
.dsh-bc-key-current{border-left:1px dashed var(--dsw-alias-label-primary)}
.dsh-bc-legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin:0;padding:0;list-style:none;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px}
.dsh-bc-legend li{display:flex;align-items:center;gap:6px;min-width:0}
.dsh-bc-swatch{display:block;width:10px;height:10px;flex:none;border:1px solid var(--dsw-alias-border-l2);border-radius:2px}
.dsh-bc-previewTitle{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.dsh-bc-previewBody{display:flex;flex-direction:column;gap:10px;min-width:0}
.dsh-bc-previewRow{display:flex;flex-direction:column;gap:6px;min-width:0}
.dsh-bc-previewLabel{display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsh-bc-previewLabel .dsh-bc-mono{color:var(--dsw-alias-label-primary);font-size:12px}
.dsh-bc-previewArrow{display:flex;align-items:center;justify-content:center;height:14px;color:var(--dsw-alias-label-tertiary);margin:-3px 0}
.dsh-bc-railFoot{display:flex;justify-content:flex-end;min-height:20px}
.dsh-bc-footer{position:sticky;bottom:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 92%,transparent);backdrop-filter:blur(8px)}
.dsh-bc-footer-copy{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1}
.dsh-bc-actions{display:flex;justify-content:flex-end;gap:8px;margin-left:auto}
.dsh-bc-btn{display:inline-flex;align-items:center;justify-content:center;height:32px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;font-weight:500;white-space:nowrap;cursor:pointer;transition:background-color 100ms ease,border-color 100ms ease}
.dsh-bc-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l3)}
.dsh-bc-btn-primary{background:color-mix(in srgb,var(--bc-accent) 85%,black);border-color:transparent;color:var(--bc-on-accent)}
.dsh-bc-btn-primary:hover:not(:disabled){background:color-mix(in srgb,var(--bc-accent) 72%,black);border-color:transparent}
.dsh-bc-btn-remove:hover:not(:disabled){color:var(--dsw-alias-state-error-primary)}
.dsh-bc-details{min-width:0;border-top:1px solid var(--dsw-alias-border-l2);padding-top:2px}
.dsh-bc-details>summary{display:flex;align-items:center;gap:8px;cursor:pointer;padding:10px 0;font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-secondary);list-style:none}
.dsh-bc-details>summary::-webkit-details-marker{display:none}
.dsh-bc-details>summary:hover{color:var(--dsw-alias-label-primary)}
.dsh-bc-details-body,.dsh-bc-policy-body{display:flex;flex-direction:column;gap:14px;padding:4px 0 12px;min-width:0}
.dsh-bc-policy{min-width:0;border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-bc-policy>summary{padding:8px 0;cursor:pointer;font-size:12px;overflow-wrap:anywhere}
.dsh-bc-policy-body{padding:4px 0 12px}
.dsh-bc-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-bc-row-label{min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px}
.dsh-bc-row-value{min-width:0;text-align:right;font-size:12px;overflow-wrap:anywhere}
.dsh-bc-status-record{display:flex;flex-direction:column;gap:12px}
.dsh-bc-status-line{margin:0;font-size:13px;line-height:20px;font-weight:500}
.dsh-bc-status-failed,.dsh-bc-status-persistence-error{color:var(--dsw-alias-state-error-primary)}
.dsh-bc-status-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 20px}
.dsh-bc-continuation{display:flex;flex-direction:column;gap:8px}
.dsh-bc-reasons,.dsh-bc-bullets{margin:0;padding-left:16px;display:flex;flex-direction:column;gap:6px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dsh-bc-reason p{margin:2px 0 0}
.dsh-bc-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dsh-bc-customRoute{min-width:0;border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px}
.dsh-bc-customRoute>summary{cursor:pointer;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);padding:4px 0}
.dsh-bc-customRoute[open]>summary{margin-bottom:8px}
.dsh-bc-banner{display:none}
@container better-compact (max-width:860px){.dsh-bc-workbench{grid-template-columns:minmax(0,1fr)}.dsh-bc-rail{position:static}.dsh-bc-metrics-rail .dsh-bc-metric-value{font-size:13px}}
@container better-compact (max-width:640px){.dsh-bc-modes{grid-template-columns:1fr}.dsh-bc-mode{display:grid;grid-template-columns:minmax(0,1fr) 150px;align-items:center;gap:4px 12px;padding:10px 12px}.dsh-bc-mode-head,.dsh-bc-mode-description{grid-column:1}.dsh-bc-mode-description{min-height:0}.dsh-bc-diagram-wrap{grid-column:2;grid-row:1 / span 2;margin:0;padding:0}.dsh-bc-fieldRow,.dsh-bc-grid,.dsh-bc-status-grid{grid-template-columns:minmax(0,1fr)}.dsh-bc-headTools{width:100%}.dsh-bc-session{max-width:none;flex:1}.dsh-bc-metrics{grid-template-columns:1fr;gap:6px}.dsh-bc-metric{flex-direction:row;align-items:baseline;justify-content:space-between;gap:12px}.dsh-bc-footer-copy{flex-basis:100%}.dsh-bc-actions{margin-left:auto}.dsh-bc-helpBody{position:static;width:auto;max-width:none;margin-top:6px}.dsh-bc-title{font-size:18px;line-height:26px}.dsh-bc-session .dsh-bc-select select{height:32px}}
@container better-compact (max-width:380px){.dsh-bc-mode{grid-template-columns:minmax(0,1fr)}.dsh-bc-diagram-wrap{display:none}.dsh-bc-actions{width:100%}.dsh-bc-actions .dsh-bc-btn{flex:1}.dsh-bc-ratioHead{flex-wrap:wrap}}
@container better-compact (max-width:560px){.dsh-bc-helpBody{position:static;width:auto;max-width:none;margin-top:6px}.dsh-bc-metrics{gap:6px}.dsh-bc-session{max-width:none}.dsh-bc-ratioHead{gap:8px}}
@media (prefers-reduced-motion:reduce){.dsh-bc-page *{transition:none!important;animation:none!important}}
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
