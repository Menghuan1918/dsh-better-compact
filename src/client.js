/**
 * dsh-better-compact — zero-build browser half.
 *
 * The stable S2 deliverable is the config-slot surface: the same entry is
 * registered under the canonical row key and both Apollo alias keys, so the
 * Plugins page resolves this plugin's row configuration in standalone and
 * Apollo assemblies. The visual mode/budget page is S3; this module keeps the
 * registration, exports, and copy stable until then and never duplicates the
 * backend algorithm on the client.
 *
 * Only React is required. No Apollo import, no remote namespace, no HTTP write
 * route, and no settings mutation are owned here: the form object comes from
 * the Host's native settings/configForms pipeline.
 */

window.__ModuleLoader__.load({
  id: 'dsh-better-compact',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')
    const { createElement: h } = React

    /** Must stay in sync with src/config.js. */
    const ROW_KEYS = Object.freeze([
      'dsh-better-compact#dsh-better-compact',
      '@menghuan1918/dsh-apollo#dsh-better-compact',
      'dsh-apollo#dsh-better-compact',
    ])
    /** Slot namespace name. */
    const SLOT = 'plugins.row.config'
    /** Local copy; the visual configuration page lands in S3. */
    const SUMMARY =
      'Native, goal-aware, or file-handoff compaction checkpoints with a read-only inspect API.'
    const NOTE =
      'The visual compaction editor (mode cards, budget diagram, live inspect status) is not part of this build. Until it ships, edit the dsh-better-compact row in the profile\u2019s cordis.patch.yml and restart the DSH profile; this Plugins page is read-only and saving a setting does not reconfigure the running engine.'

    /** One stable row-config entry shared by every assembly key. */
    function BetterCompactConfigEntry(props) {
      if (props.view === 'summary') {
        return h('span', { 'data-better-compact': 'summary' }, SUMMARY)
      }
      const state = props.form?.state
      const value = state?.status === 'ready' ? state.value : null
      const lines = []
      if (value !== null && typeof value === 'object') {
        if (typeof value.mode === 'string') lines.push(`mode: ${value.mode}`)
        if (typeof value.auto === 'boolean') lines.push(`auto: ${String(value.auto)}`)
        if (typeof value.thresholdRatio === 'number') lines.push(`thresholdRatio: ${value.thresholdRatio}`)
        if (typeof value.headroomTokens === 'number') lines.push(`headroomTokens: ${value.headroomTokens}`)
        if (value.retainTokens !== undefined && value.retainTokens !== null) {
          lines.push(`retainTokens: ${value.retainTokens}`)
        } else if (typeof value.retainRatio === 'number') {
          lines.push(`retainRatio: ${value.retainRatio}`)
        }
        if (value.mode === 'native') {
          lines.push('reasoningEffort: not applicable in native mode (the native summarizer decides)')
          lines.push('cachePriority: not applicable in native mode (the native summarizer decides)')
        } else {
          if (typeof value.reasoningEffort === 'string' && value.reasoningEffort.length > 0) {
            lines.push(`reasoningEffort: ${value.reasoningEffort}`)
          }
          lines.push(`cachePriority: ${String(value.cachePriority)}`)
        }
      }
      return h(
        'div',
        {
          'data-better-compact': 'page',
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            fontSize: '13px',
            lineHeight: '20px',
          },
        },
        h('p', { style: { margin: 0 } }, SUMMARY),
        h(
          'p',
          {
            style: {
              margin: 0,
              padding: '8px 10px',
              borderRadius: '6px',
              background: 'var(--dsw-alias-bg-layer-3, transparent)',
              color: 'var(--dsw-alias-label-secondary, inherit)',
            },
          },
          NOTE,
        ),
        state === undefined
          ? h('p', { style: { margin: 0 }, role: 'status' }, 'Waiting for the Host configuration form\u2026')
          : state.status === 'loading'
            ? h('p', { style: { margin: 0 }, role: 'status' }, 'Reading configuration\u2026')
            : lines.length === 0
              ? h('p', { style: { margin: 0 }, role: 'status' }, 'No saved configuration is available.')
              : h(
                  'pre',
                  {
                    style: {
                      margin: 0,
                      padding: '8px 10px',
                      borderRadius: '6px',
                      overflow: 'auto',
                      fontVariantNumeric: 'tabular-nums',
                      background: 'var(--dsw-alias-bg-layer-3, transparent)',
                    },
                  },
                  lines.join('\n'),
                ),
      )
    }

    /** Services this client half consumes. */
    const inject = ['slots']

    /** Register the stable row configuration entry in every assembly. */
    function apply(ctx) {
      ctx.effect(
        () =>
          ctx.slots.inject(SLOT, () => {
            const disposers = ROW_KEYS.map((key) =>
              ctx.slots.register({ name: SLOT, key }, BetterCompactConfigEntry),
            )
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
    return module.exports
  },
})
