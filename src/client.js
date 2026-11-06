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
      'dsh-better-dsh#dsh-better-compact',
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
      native: Object.freeze({ labelKey: 'modeNative', effectKey: 'modeNativeEffect', captionKey: 'modeNativeCaption' }),
      goal: Object.freeze({ labelKey: 'modeGoal', effectKey: 'modeGoalEffect', captionKey: 'modeGoalCaption' }),
      handoff: Object.freeze({ labelKey: 'modeHandoff', effectKey: 'modeHandoffEffect', captionKey: 'modeHandoffCaption' }),
    })
    /** Empty session-list snapshot (stable identity for useSyncExternalStore). */
    const EMPTY_SESSION_LIST = Object.freeze({
      ids: Object.freeze([]),
      byId: Object.freeze({}),
      phase: 'ready',
      projectionsBySession: Object.freeze({}),
    })
    /** Host locale namespace and dictionaries. Chinese is the fallback. */
    const NS = 'better-compact'
    const zh = Object.freeze({
      summary: '压缩策略、上下文预算与会话诊断',
      title: '上下文压缩',
      unknown: '未知',
      unset: '未设置',
      selectOption: '选择选项',
      loadingConfig: '正在读取配置…',
      waitingForm: '等待宿主配置表单…',
      formUnavailable: '宿主未提供可编辑表单，不填造默认值。',
      readOnly: '只读',
      readOnlyConfig: '只读配置',
      reloadRequired: '需重载',
      savedReload: '已保存，重载 DSH 后生效。',
      activeDiffers: '已保存配置与运行配置不同',
      viewActiveConfig: '查看运行配置',
      runtimeMode: '运行策略',
      runtimeSummaryModel: '运行摘要模型',
      runtimeThreshold: '运行触发比例',
      runtimeRetain: '运行保留预算',
      followSession: '跟随会话',
      modeGroup: '压缩模式',
      modeNative: '原生',
      modeGoal: '目标增强',
      modeHandoff: '文件交接',
      modeNativeEffect: '历史摘要与近期原文',
      modeGoalEffect: '结合目标与任务生成摘要',
      modeHandoffEffect: '保存交接文件，在本会话继续',
      modeNativeCaption: '摘要请求由原生引擎处理。',
      modeGoalCaption: '目标与任务作为摘要输入。',
      modeHandoffCaption: '交接正文同时写入会话记录。',
      modeDetails: '模式说明',
      budgetSection: '自动压缩与保留',
      autoCompression: '自动压缩',
      threshold: '触发比例',
      retainRecent: '近期原文保留',
      byRatio: '按比例',
      fixedTokens: '固定 tokens',
      retainRatio: '保留比例',
      retainTokens: '保留量',
      retainRatioHelp: '留空使用 16%',
      cachePriority: '优先复用提示缓存',
      modelSection: '摘要生成',
      summaryModel: '摘要模型',
      followSessionModel: '跟随会话模型',
      reasoningEffort: '思考强度',
      modelDefault: '模型默认',
      modelDefaultWith: '模型默认 · {effort}',
      unsupportedEffortOption: '{effort} · 未声明支持',
      effortUnknownPlaceholder: '模型默认；能力未知',
      customSummaryModel: '自定义摘要模型',
      provider: '服务商',
      model: '模型',
      modelsLoading: '读取模型列表…',
      modelsFailed: '模型列表读取失败，可填写自定义模型。',
      advanced: '高级设置',
      advancedCount: '{count} 项',
      headroom: '额外余量',
      summaryOutputCap: '摘要输出上限',
      pressureRetry: '压力残留重试',
      overflowRecovery: '超限恢复次数',
      followHeadroom: '跟随余量：{value}',
      policies: '按模型覆盖',
      addRule: '添加规则',
      allModelsGlobal: '所有模型使用全局设置。',
      newRule: '新规则',
      sessionProvider: '会话服务商',
      sessionModel: '会话模型',
      retainMode: '近期原文保留',
      inheritWith: '继承 · {value}',
      byMessageBudgetRatio: '按消息预算比例',
      fixedTokenCount: '固定 token 数',
      policySummaryMode: '摘要模型',
      policySummaryInherit: '继承 · {value}',
      policySummarySession: '跟随会话模型',
      policySummaryCustom: '指定摘要模型',
      summaryProvider: '摘要服务商',
      deleteRule: '删除规则 {index}',
      deleteRuleShort: '删除规则',
      timesUnit: '次',
      statusSection: '会话诊断',
      statusReadOnly: '只读',
      statusEmpty: '选择会话查看用量与压缩记录。',
      diagnosticsFailed: '诊断读取失败：{message}',
      readingDiagnostics: '读取诊断…',
      engineUnknown: '尚未确认压缩引擎。',
      engineForeign: '此会话使用其他压缩引擎（{owner}），仅显示实际压缩记录。',
      engineOwnerUnknown: '引擎归属未确认；预算与预览按本插件运行配置计算。',
      engineOwner: '压缩引擎：{owner}',
      lastCompaction: '最近一次压缩',
      noCompaction: '此会话暂无压缩记录。',
      handoffContinuation: '文件交接续作',
      continuationScheduled: '已安排一次同会话续作。',
      continuationSkipped: '本次续作已跳过。',
      diagnosticsDetails: '诊断详情（{count}）',
      session: '会话',
      selectSessionTitle: '选择用于预算与诊断的会话',
      loadingSessions: '加载会话…',
      noSessions: '还没有会话',
      selectSession: '选择会话',
      runningSuffix: ' · 运行中',
      refreshDiagnostics: '刷新会话诊断',
      reading: '读取中…',
      refresh: '刷新',
      sessionListFailed: '会话列表读取失败',
      draftBudget: '草稿预算',
      messageBudget: '消息预算',
      effectiveTrigger: '有效触发点',
      retainBudget: '近期原文预算',
      budgetIncomplete: '修正配置后可查看预算。',
      budgetForeignEngine: '该会话使用其他压缩引擎。',
      budgetLoading: '读取模型窗口…',
      budgetError: '诊断恢复后可计算预算。',
      budgetNoSession: '选择诊断会话后可查看具体 token 预算。',
      budgetUnknown: '模型窗口或输出预留未知，暂无法计算草稿预算。',
      triggerBefore: '触发前',
      ratioSlack: '比例留白',
      extraHeadroom: '额外余量',
      sessionOutput: '会话输出',
      compositionBefore: '压缩前',
      compositionAfter: '压缩后上界',
      safeCut: '选区 {start}–{end} · 压缩后预算上界 ≤ {upper}',
      noSafeCut: '当前无安全压缩选区。',
      fixedPrefix: '固定前缀',
      compressibleMessages: '可压缩消息',
      actualRetained: '实际保留原文',
      summaryBudgetFraming: '摘要预算与封装',
      runtimePreview: '压缩预览',
      runtimeWindow: '模型窗口',
      currentContext: '当前上下文',
      runtimeTrigger: '运行触发点',
      measured: '用量已校准',
      estimated: '估算',
      measurementUnknown: '用量未知',
      conclusionAutoOff: '自动压缩已关闭',
      conclusionNoUsage: '尚无上下文用量',
      conclusionRemaining: '距离自动压缩还有 {remaining}',
      conclusionReached: '已到达自动触发点',
      statusRunning: '进行中',
      statusCompleted: '已完成',
      statusFailed: '生成失败',
      statusCancelled: '已取消',
      statusPersistenceError: '持久化失败',
      triggerManual: '手动',
      triggerAutomatic: '自动',
      triggerUnknown: '触发原因未知',
      strategyLabel: '压缩策略',
      duration: '耗时',
      replacedMessages: '已替换消息',
      summaryEstimate: '摘要消息估算',
      cacheRead: '缓存读取',
      cacheWrite: '缓存写入',
      persistenceFailed: '摘要可能已写入，但会话保存失败。',
      saveChanges: '{count} 项更改待保存',
      save: '保存设置',
      saving: '保存中…',
      discard: '放弃更改',
      discardAgain: '再次点击放弃',
      reload: '重新读取',
      fixErrors: '需修正 {count} 项',
      saveFailed: '保存失败：{message}。草稿已保留。',
      saveRejected: '宿主拒绝保存，草稿已保留。请重新读取并核对配置。',
      saveConflict: '配置已被其他页面更新，请重新读取后编辑。',
      saved: '已保存，重载 DSH 后生效。',
      validationMode: '请选择压缩策略。',
      validationThreshold: '触发比例须大于 0% 且小于 100%。',
      validationHeadroom: '额外余量须为非负安全整数。',
      validationRetainTokens: '保留量须为非负安全整数。',
      validationRetainRatio: '保留比例须大于 0，且低于触发比例；留空使用 16%。',
      validationSummaryPair: '服务商与摘要模型须成对填写。',
      validationEffortSpaces: '思考强度不能仅包含空格。',
      validationMaxTokens: '摘要输出上限须为正安全整数；额外余量为 0 时须单独设置。',
      validationRetries: '重试次数须为非负安全整数。',
      validationPolicyModel: '请填写完整的服务商与模型。',
      validationDuplicatePolicy: '该模型已有覆盖规则。',
      validationSuffixRatio: '须大于 0% 且小于 100%。',
      validationSuffixPositive: '须为正安全整数。',
      validationSuffixNonNegative: '须为非负安全整数。',
      validationPolicyRetainTokens: '保留量须为非负安全整数。',
      validationPolicyRetainRatio: '有效保留比例须大于 0，且低于该规则的触发比例。',
      validationPolicySummaryPair: '请填写完整的摘要服务商与模型。',
      validationPolicyMaxTokens: '余量为 0 时须设置摘要输出上限。',
      validationGlobalSummaryModel: '全局摘要模型',
      validationRule: '规则 {provider}/{model}',
      validationFollowedSummaryModel: '跟随会话的摘要模型',
      validationEffortUnsupported: '{label} {provider}/{model} 未声明支持强度「{effort}」，请调整全局思考强度或摘要模型。',
      routeWarning: '自定义模型 {provider}/{model} 未列于宿主候选中，请确认会话可用。',
      reasonNoCapacity: '模型容量不足',
      reasonNoCapacityHint: '请降低主会话的输出预留，或选择更大窗口的会话模型。',
      reasonReserveFull: '额外预留与输出预留占满窗口',
      reasonReserveFullHint: '请降低额外余量或主会话的输出预留，或选择更大窗口的会话模型。',
      reasonRetainConflict: '保留预算与触发线冲突',
      reasonRetainConflictHint: '请降低保留预算或提高阈值比例。',
      reasonNoSafeRangeWithPrefix: '固定前缀 / 近期保留未留出安全区间',
      reasonNoSafeRange: '无安全可压缩区间',
      reasonNoSafeRangeHint: '请降低保留预算 / 阈值，或等待更多可压缩历史。',
      reasonNoRoute: '尚无模型路由请求',
      reasonNoRouteHint: '请先在会话中发送一次模型请求。',
      reasonCapacityUnknown: '模型容量未知',
      reasonCapacityUnknownHint: '请检查该路由模型的适配器元数据。',
      reasonBelowTrigger: '尚未到达自动触发线（提示）',
      reasonAutoOff: '自动压缩已关闭（提示）',
      reasonAutoOffHint: '可在上下文预算中开启自动压缩。',
      budgetNoMessageRoom: '会话输出预留已占满窗口，请调整会话模型的输出上限。',
      budgetHeadroomTooLarge: '额外余量须小于消息预算 {message}。',
      budgetRetainTooLarge: '有效保留量 {retain} 须小于触发点 {threshold}。',
      draftWindowAria: '草稿窗口分配：触发点 {trigger}，额外余量 {headroom}，会话输出预留 {reserved}。',
      runtimeWindowAria: '当前上下文 {current}；运行触发点 {trigger}；窗口 {window}。',
      beforeBarAria: '{fixed}、{history}、{tail}。',
      afterBarAria: '{fixed}、{summary}、{tail}。',
      currentBarAria: '当前上下文 {current}。',
      diagramNativeLabel: 'DSH 原生：较早历史经原生压缩生成原生摘要，近期原文保留，组成原生 checkpoint；固定提示与工具前缀独立。',
      diagramGoalLabel: 'Goal 增强：较早历史与只读权威 Goal / Todo 合流，生成目标、约束、进展、下一步摘要；近期原文保留，不修改目标或轮次。',
      diagramHandoffLabel: '文件 Handoff：对话与状态生成本次临时交接文件，正文写入原生事件，再在同会话继续；近期原文保留。文件不是唯一恢复来源。',
      diagramFixedPrefix: '固定提示 / 工具前缀',
      diagramEarlierHistory: '较早历史',
      diagramRecentOriginal: '近期原文',
      diagramNativeCompaction: '原生压缩',
      diagramNativeSummary: '原生摘要',
      diagramRetainedOriginal: '原文保留',
      diagramSummaryRecord: '摘要记录',
      diagramGoalsTasks: '目标与任务',
      diagramAuthority: '权威状态',
      diagramRecentMessages: '近期消息',
      diagramGoalConstraints: '目标·约束',
      diagramProgressNext: '进展·下一步',
      diagramWriteSummary: '写入会话摘要记录',
      diagramConversation: '对话',
      diagramAndState: '与状态',
      diagramTempFile: '临时文件',
      diagramThisHandoff: '本次交接',
      diagramSessionRecord: '会话记录',
      diagramSaveHandoff: '保存交接正文',
      diagramContinue: '同会话继续',
    })
    const en = Object.freeze({
      summary: 'Compaction strategy, context budget and session diagnostics',
      title: 'Compaction',
      unknown: 'Unknown',
      unset: 'Not set',
      selectOption: 'Select an option',
      loadingConfig: 'Loading configuration…',
      waitingForm: 'Waiting for the host configuration form…',
      formUnavailable: 'The host exposes no editable form; defaults are not invented.',
      readOnly: 'Read-only',
      readOnlyConfig: 'Read-only config',
      reloadRequired: 'Reload required',
      savedReload: 'Saved. Reload DSH to apply.',
      activeDiffers: 'Saved configuration differs from runtime',
      viewActiveConfig: 'View runtime configuration',
      runtimeMode: 'Runtime strategy',
      runtimeSummaryModel: 'Runtime summary model',
      runtimeThreshold: 'Runtime trigger',
      runtimeRetain: 'Runtime retention',
      followSession: 'Session',
      modeGroup: 'Compaction mode',
      modeNative: 'Native',
      modeGoal: 'Goal aware',
      modeHandoff: 'File handoff',
      modeNativeEffect: 'History summary and recent messages',
      modeGoalEffect: 'Summarize with goals and tasks',
      modeHandoffEffect: 'Save a handoff file and continue',
      modeNativeCaption: 'The native engine writes the summary.',
      modeGoalCaption: 'Goals and tasks feed the summary.',
      modeHandoffCaption: 'The handoff body is also written to the session record.',
      modeDetails: 'Mode details',
      budgetSection: 'Auto compression and retention',
      autoCompression: 'Auto compression',
      threshold: 'Threshold',
      retainRecent: 'Retain recent messages',
      byRatio: 'By ratio',
      fixedTokens: 'Fixed tokens',
      retainRatio: 'Retain ratio',
      retainTokens: 'Retain tokens',
      retainRatioHelp: 'Blank uses 16%',
      cachePriority: 'Reuse prompt cache first',
      modelSection: 'Summary generation',
      summaryModel: 'Summary model',
      followSessionModel: 'Follow session model',
      reasoningEffort: 'Reasoning effort',
      modelDefault: 'Model default',
      modelDefaultWith: 'Model default · {effort}',
      unsupportedEffortOption: '{effort} · not declared',
      effortUnknownPlaceholder: 'Model default; capability unknown',
      customSummaryModel: 'Custom summary model',
      provider: 'Provider',
      model: 'Model',
      modelsLoading: 'Loading model list…',
      modelsFailed: 'Model list unavailable; enter a custom model.',
      advanced: 'Advanced settings',
      advancedCount: '{count} items',
      headroom: 'Headroom',
      summaryOutputCap: 'Summary output cap',
      pressureRetry: 'Pressure retries',
      overflowRecovery: 'Overflow recovery',
      followHeadroom: 'Follow headroom: {value}',
      policies: 'Model overrides',
      addRule: 'Add rule',
      allModelsGlobal: 'All models use the global settings.',
      newRule: 'New rule',
      sessionProvider: 'Session provider',
      sessionModel: 'Session model',
      retainMode: 'Retain recent messages',
      inheritWith: 'Inherit · {value}',
      byMessageBudgetRatio: 'By message budget ratio',
      fixedTokenCount: 'Fixed token count',
      policySummaryMode: 'Summary model',
      policySummaryInherit: 'Inherit · {value}',
      policySummarySession: 'Follow session model',
      policySummaryCustom: 'Specify summary model',
      summaryProvider: 'Summary provider',
      deleteRule: 'Delete rule {index}',
      deleteRuleShort: 'Delete rule',
      timesUnit: 'times',
      statusSection: 'Session diagnostics',
      statusReadOnly: 'Read-only',
      statusEmpty: 'Select a session to inspect usage and compaction records.',
      diagnosticsFailed: 'Diagnostics failed: {message}',
      readingDiagnostics: 'Reading diagnostics…',
      engineUnknown: 'Compaction engine not confirmed.',
      engineForeign: 'Another compaction engine ({owner}) owns this session; only real records are shown.',
      engineOwnerUnknown: 'Engine ownership unknown; budget and preview use this plugin runtime config.',
      engineOwner: 'Compaction engine: {owner}',
      lastCompaction: 'Last compaction',
      noCompaction: 'No compaction records in this session.',
      handoffContinuation: 'Handoff continuation',
      continuationScheduled: 'A same-session continuation is scheduled.',
      continuationSkipped: 'This continuation was skipped.',
      diagnosticsDetails: 'Diagnostic details ({count})',
      session: 'Session',
      selectSessionTitle: 'Select the session used for budget and diagnostics',
      loadingSessions: 'Loading sessions…',
      noSessions: 'No sessions yet',
      selectSession: 'Select a session',
      runningSuffix: ' · running',
      refreshDiagnostics: 'Refresh session diagnostics',
      reading: 'Reading…',
      refresh: 'Refresh',
      sessionListFailed: 'Session list unavailable',
      draftBudget: 'Draft budget',
      messageBudget: 'Message budget',
      effectiveTrigger: 'Effective trigger',
      retainBudget: 'Recent retention',
      budgetIncomplete: 'Fix the configuration to see the budget.',
      budgetForeignEngine: 'Another compaction engine owns this session.',
      budgetLoading: 'Reading model window…',
      budgetError: 'Restore diagnostics to calculate the budget.',
      budgetNoSession: 'Select a diagnostic session to see token budgets.',
      budgetUnknown: 'Window unknown; draft budget unavailable.',
      triggerBefore: 'Before trigger',
      ratioSlack: 'Ratio slack',
      extraHeadroom: 'Headroom',
      sessionOutput: 'Session output',
      compositionBefore: 'Before',
      compositionAfter: 'After upper bound',
      safeCut: 'Range {start}–{end} · upper bound ≤ {upper}',
      noSafeCut: 'No safe compaction range.',
      fixedPrefix: 'Fixed prefix',
      compressibleMessages: 'Compressible messages',
      actualRetained: 'Retained original',
      summaryBudgetFraming: 'Summary budget and framing',
      runtimePreview: 'Compaction preview',
      runtimeWindow: 'Model window',
      currentContext: 'Current context',
      runtimeTrigger: 'Runtime trigger',
      measured: 'Usage measured',
      estimated: 'Estimated',
      measurementUnknown: 'Usage unknown',
      conclusionAutoOff: 'Auto compression is off',
      conclusionNoUsage: 'No context usage yet',
      conclusionRemaining: '{remaining} until auto compression',
      conclusionReached: 'Automatic trigger reached',
      statusRunning: 'Running',
      statusCompleted: 'Completed',
      statusFailed: 'Failed',
      statusCancelled: 'Cancelled',
      statusPersistenceError: 'Persistence failed',
      triggerManual: 'Manual',
      triggerAutomatic: 'Automatic',
      triggerUnknown: 'Trigger unknown',
      strategyLabel: 'Strategy',
      duration: 'Duration',
      replacedMessages: 'Replaced messages',
      summaryEstimate: 'Summary estimate',
      cacheRead: 'Cache read',
      cacheWrite: 'Cache write',
      persistenceFailed: 'The summary may be written, but the session save failed.',
      saveChanges: '{count} unsaved changes',
      save: 'Save settings',
      saving: 'Saving…',
      discard: 'Discard',
      discardAgain: 'Click again to discard',
      reload: 'Reload',
      fixErrors: 'Fix {count} items',
      saveFailed: 'Save failed: {message}. Draft kept.',
      saveRejected: 'The host rejected the save; draft kept. Reload and check the configuration.',
      saveConflict: 'Configuration changed elsewhere; reload before editing.',
      saved: 'Saved. Reload DSH to apply.',
      validationMode: 'Choose a compaction strategy.',
      validationThreshold: 'Threshold must be greater than 0% and less than 100%.',
      validationHeadroom: 'Headroom must be a non-negative safe integer.',
      validationRetainTokens: 'Retain tokens must be a non-negative safe integer.',
      validationRetainRatio: 'Retain ratio must be greater than 0 and below the threshold; blank uses 16%.',
      validationSummaryPair: 'Provider and summary model must be filled together.',
      validationEffortSpaces: 'Reasoning effort cannot contain only spaces.',
      validationMaxTokens: 'Summary output cap must be a positive safe integer; set it when headroom is 0.',
      validationRetries: 'Retry count must be a non-negative safe integer.',
      validationPolicyModel: 'Fill in both provider and model.',
      validationDuplicatePolicy: 'This model already has an override.',
      validationSuffixRatio: ' must be greater than 0% and less than 100%.',
      validationSuffixPositive: ' must be a positive safe integer.',
      validationSuffixNonNegative: ' must be a non-negative safe integer.',
      validationPolicyRetainTokens: 'Retain tokens must be a non-negative safe integer.',
      validationPolicyRetainRatio: 'Effective retain ratio must be greater than 0 and below the rule threshold.',
      validationPolicySummaryPair: 'Fill in both summary provider and model.',
      validationPolicyMaxTokens: 'Set a summary output cap when headroom is 0.',
      validationGlobalSummaryModel: 'Global summary model',
      validationRule: 'Rule {provider}/{model}',
      validationFollowedSummaryModel: 'Followed session summary model',
      validationEffortUnsupported: '{label} {provider}/{model} does not declare effort "{effort}". Adjust the global effort or summary model.',
      routeWarning: 'Custom model {provider}/{model} is not in the host catalog; confirm it is available.',
      reasonNoCapacity: 'Insufficient model capacity',
      reasonNoCapacityHint: 'Reduce the session output reserve or choose a larger session model.',
      reasonReserveFull: 'Headroom and output reserve fill the window',
      reasonReserveFullHint: 'Reduce headroom or the session output reserve, or choose a larger session model.',
      reasonRetainConflict: 'Retention conflicts with the trigger',
      reasonRetainConflictHint: 'Reduce retention or raise the threshold.',
      reasonNoSafeRangeWithPrefix: 'No safe range after prefix and retention',
      reasonNoSafeRange: 'No safe compactable range',
      reasonNoSafeRangeHint: 'Reduce retention or threshold, or wait for more history.',
      reasonNoRoute: 'No model request yet',
      reasonNoRouteHint: 'Send one model request in the session first.',
      reasonCapacityUnknown: 'Model capacity unknown',
      reasonCapacityUnknownHint: 'Check the adapter metadata for this route.',
      reasonBelowTrigger: 'Below the automatic trigger',
      reasonAutoOff: 'Auto compression is off',
      reasonAutoOffHint: 'Enable auto compression in the context budget.',
      budgetNoMessageRoom: 'The session output reserve fills the window; adjust the session model output cap.',
      budgetHeadroomTooLarge: 'Headroom must be less than the message budget {message}.',
      budgetRetainTooLarge: 'Effective retention {retain} must be below the trigger {threshold}.',
      draftWindowAria: 'Draft window: trigger {trigger}, headroom {headroom}, session output reserve {reserved}.',
      runtimeWindowAria: 'Current context {current}; runtime trigger {trigger}; window {window}.',
      beforeBarAria: '{fixed}, {history}, {tail}.',
      afterBarAria: '{fixed}, {summary}, {tail}.',
      currentBarAria: 'Current context {current}.',
      diagramNativeLabel: 'DSH native: earlier history becomes a native summary, recent messages are kept, and the fixed prompt and tools stay separate.',
      diagramGoalLabel: 'Goal aware: earlier history merges with the read-only Goal / Todo state to summarize goals, constraints, progress and next steps; recent messages stay unchanged.',
      diagramHandoffLabel: 'File handoff: the conversation and state create this temporary handoff file, write its body as a native event, then continue in the same session; recent messages stay.',
      diagramFixedPrefix: 'Fixed prefix',
      diagramEarlierHistory: 'History',
      diagramRecentOriginal: 'Recent',
      diagramNativeCompaction: 'Native',
      diagramNativeSummary: 'Native summary',
      diagramRetainedOriginal: 'Retained',
      diagramSummaryRecord: 'Record',
      diagramGoalsTasks: 'Goals & tasks',
      diagramAuthority: 'Authority',
      diagramRecentMessages: 'Recent',
      diagramGoalConstraints: 'Goals',
      diagramProgressNext: 'Next steps',
      diagramWriteSummary: 'Write summary',
      diagramConversation: 'Conversation',
      diagramAndState: 'State',
      diagramTempFile: 'Temp file',
      diagramThisHandoff: 'Handoff',
      diagramSessionRecord: 'Session',
      diagramSaveHandoff: 'Handoff body',
      diagramContinue: 'Continue',
    })
    function interpolate(text, params) {
      if (params === undefined || params === null) return text
      return String(text).replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match))
    }
    let t = (key, params) => interpolate(zh[key] ?? key, params)
    function bindLocale(ctx) {
      if (ctx.locale === undefined || ctx.locale === null) return
      try {
        const dispose = ctx.locale.register(NS, { zh, en })
        if (typeof dispose === 'function' && typeof ctx.effect === 'function') {
          ctx.effect(() => dispose, 'dsh-better-compact: locale dictionaries')
        }
      } catch {
        // Keep the Chinese fallback when the namespace is unavailable.
      }
      try {
        if (typeof ctx.locale.bind === 'function') t = ctx.locale.bind(NS)
      } catch {
        // Keep the Chinese fallback when binding is unavailable.
      }
    }

    // ── formatting helpers ────────────────────────────────────────────────

    /** Group an integer with commas without depending on the runtime locale. */
    function groupDigits(value) {
      return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    }

    /** Human token value; `null`/undefined is unknown, never 0. */
    function tokensText(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return t('unknown')
      const rounded = Math.round(value)
      return `${groupDigits(rounded)} tokens`
    }

    /** Ratio text as a percentage; unknown stays unknown. */
    function ratioText(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return t('unknown')
      return `${Math.round(value * 10000) / 100}%`
    }

    /** Duration text; unknown stays unknown. */
    function durationText(value) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return t('unknown')
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
      ['thresholdRatio', 'threshold', true], ['headroomTokens', 'headroom'],
      ['maxTokens', 'summaryOutputCap'], ['compactionRetries', 'pressureRetry'], ['maxOverflowRetries', 'overflowRecovery'],
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
        if (key === 'retainTokens' && left.retainMode !== 'tokens' || key === 'retainRatio' && left.retainMode !== 'ratio') continue
        if (key === 'policies' ? JSON.stringify(left[key].map(policyValue)) !== JSON.stringify(right[key].map(policyValue)) : left[key] !== right[key]) return false
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
      if (!MODES.includes(draft.mode)) add('mode', t('validationMode'))
      const validRatio = (value) => value !== '' && Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) < 1
      const validInt = (value, min = 0) => value !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= min
      if (!validRatio(draft.thresholdRatio)) add('thresholdRatio', t('validationThreshold'))
      if (!validInt(draft.headroomTokens)) add('headroomTokens', t('validationHeadroom'))
      const retainRatio = draft.retainRatio === '' ? DEFAULT_RETAIN_RATIO : Number(draft.retainRatio)
      if (draft.retainMode === 'tokens') {
        if (!validInt(draft.retainTokens)) add('retainTokens', t('validationRetainTokens'))
      } else if (!validRatio(String(retainRatio)) || retainRatio >= Number(draft.thresholdRatio)) {
        add('retainRatio', t('validationRetainRatio'))
      }
      if ((draft.provider === '') !== (draft.model === '')) add('summarizationModel', t('validationSummaryPair'))
      if (draft.effort !== '' && draft.effort.trim() === '') add('reasoningEffort', t('validationEffortSpaces'))
      if (draft.maxTokens !== '' ? !validInt(draft.maxTokens, 1) : Number(draft.headroomTokens) === 0) {
        add('maxTokens', t('validationMaxTokens'))
      }
      for (const key of ['compactionRetries', 'maxOverflowRetries']) {
        if (!validInt(draft[key])) add(key, t('validationRetries'))
      }
      const seen = new Set()
      draft.policies.forEach((policy, index) => {
        const prefix = 'policies.' + index + '.'
        const identity = JSON.stringify([policy.provider, policy.model])
        if (!policy.provider || !policy.model) add(prefix + 'model', t('validationPolicyModel'))
        else if (seen.has(identity)) add(prefix + 'model', t('validationDuplicatePolicy'))
        seen.add(identity)
        for (const [key, labelKey, ratio] of POLICY_NUMBERS) {
          if (policy[key] !== '' && !(ratio ? validRatio(policy[key]) : validInt(policy[key], key === 'maxTokens' ? 1 : 0))) {
            add(prefix + key, t(labelKey) + t(ratio ? 'validationSuffixRatio' : key === 'maxTokens' ? 'validationSuffixPositive' : 'validationSuffixNonNegative'))
          }
        }
        const threshold = Number(policy.thresholdRatio || draft.thresholdRatio)
        const ratio = policy.retainMode === 'ratio' ? Number(policy.retainRatio) : retainRatio
        if (policy.retainMode === 'tokens') {
          if (!validInt(policy.retainTokens)) add(prefix + 'retainTokens', t('validationPolicyRetainTokens'))
        } else if (policy.retainMode === 'ratio' || draft.retainMode === 'ratio') {
          if (!(ratio > 0 && ratio < threshold)) add(prefix + 'retainRatio', t('validationPolicyRetainRatio'))
        }
        if (policy.summaryMode === 'custom' && (!policy.summarizationProvider || !policy.summarizationModel)) {
          add(prefix + 'summarizationModel', t('validationPolicySummaryPair'))
        }
        if (policy.maxTokens === '' && draft.maxTokens === '' && Number(policy.headroomTokens || draft.headroomTokens) === 0) {
          add(prefix + 'maxTokens', t('validationPolicyMaxTokens'))
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
      if (draft.provider && draft.model) candidates.push({ provider: draft.provider, model: draft.model, field: 'reasoningEffort', label: t('validationGlobalSummaryModel') })
      draft.policies.forEach((policy, index) => {
        const provider = policy.summaryMode === 'custom' ? policy.summarizationProvider : policy.summaryMode === 'session' || !draft.provider ? policy.provider : draft.provider
        const model = policy.summaryMode === 'custom' ? policy.summarizationModel : policy.summaryMode === 'session' || !draft.model ? policy.model : draft.model
        candidates.push({ provider, model, field: 'policies.' + index + '.summarizationModel', label: t('validationRule', { provider: policy.provider, model: policy.model }) })
      })
      if (!draft.provider && target && !draft.policies.some((policy) => policy.provider === target.provider && policy.model === target.model)) {
        candidates.push({ ...target, field: 'reasoningEffort', label: t('validationFollowedSummaryModel') })
      }
      return candidates.flatMap((candidate) => {
        const route = routes.find((entry) => entry.provider === candidate.provider && entry.model === candidate.model)
        return route && !route.efforts.includes(draft.effort) ? [{ field: candidate.field,
          message: t('validationEffortUnsupported', { label: candidate.label, provider: candidate.provider, model: candidate.model, effort: draft.effort }) }] : []
      })
    }

    /** Non-blocking marker for a saved route outside the candidate metadata. */
    function routeCandidateWarning(draft, routes, routesKnown) {
      if (draft.provider === '' || draft.model === '' || !routesKnown) return null
      if (routes.some((entry) => entry.provider === draft.provider && entry.model === draft.model)) return null
      return t('routeWarning', { provider: draft.provider, model: draft.model })
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
      if (JSON.stringify(draft.policies.map(policyValue)) !== JSON.stringify(draftFromValue(current).policies.map(policyValue))) {
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
        h(DiagramNode, { id: 'fixed', x: 2, y: 2, width: 176, height: 22, lines: [t('diagramFixedPrefix')], tone: 'dsh-bc-node-dashed' }),
        props.children,
      )
    }

    function NativeDiagram() {
      const marker = 'bc-native-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
      return h(StrategySvg, { mode: 'native', marker,
        label: t('diagramNativeLabel') },
        h(DiagramNode, { id: 'history', x: 2, y: 38, width: 96, height: 28, lines: [t('diagramEarlierHistory')] }),
        h(DiagramNode, { id: 'recent', x: 108, y: 38, width: 70, height: 28, lines: [t('diagramRecentOriginal')] }),
        h(DiagramEdge, { from: 'history', to: 'summary', d: 'M50 66 L50 96', marker }),
        h(DiagramEdge, { from: 'recent', to: 'tail', d: 'M143 66 L143 96', marker }),
        h('text', { x: 6, y: 85 }, t('diagramNativeCompaction')),
        h(DiagramNode, { id: 'summary', x: 2, y: 96, width: 96, height: 28, lines: [t('diagramNativeSummary')], tone: 'dsh-bc-node-accent' }),
        h(DiagramNode, { id: 'tail', x: 108, y: 96, width: 70, height: 28, lines: [t('diagramRetainedOriginal')], tone: 'dsh-bc-node-strong' }),
        h(DiagramEdge, { from: 'summary', to: 'checkpoint', d: 'M50 124 L50 144', marker }),
        h(DiagramEdge, { from: 'tail', to: 'checkpoint', d: 'M143 124 L143 144', marker }),
        h(DiagramNode, { id: 'checkpoint', x: 2, y: 144, width: 176, height: 24, lines: [t('diagramSummaryRecord')] }),
      )
    }

    function GoalDiagram() {
      const marker = 'bc-goal-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
      return h(StrategySvg, { mode: 'goal', marker,
        label: t('diagramGoalLabel') },
        h(DiagramNode, { id: 'history', x: 2, y: 38, width: 76, height: 36, lines: [t('diagramEarlierHistory')] }),
        h(DiagramNode, { id: 'authority', x: 88, y: 38, width: 90, height: 36, lines: [t('diagramGoalsTasks'), t('diagramAuthority')], tone: 'dsh-bc-node-dashed' }),
        h(DiagramEdge, { from: 'history', to: 'summary', d: 'M40 74 L40 88 L54 88 L54 112', marker }),
        h(DiagramEdge, { from: 'authority', to: 'summary', d: 'M133 74 L133 78 L54 78 L54 112', marker }),
        h(DiagramNode, { id: 'recent', x: 116, y: 82, width: 62, height: 20, lines: [t('diagramRecentMessages')] }),
        h(DiagramEdge, { from: 'recent', to: 'tail', d: 'M147 102 L147 112', marker }),
        h(DiagramNode, { id: 'summary', x: 2, y: 112, width: 104, height: 30, lines: [t('diagramGoalConstraints'), t('diagramProgressNext')], tone: 'dsh-bc-node-accent' }),
        h(DiagramNode, { id: 'tail', x: 116, y: 112, width: 62, height: 30, lines: [t('diagramRetainedOriginal')], tone: 'dsh-bc-node-strong' }),
        h('text', { x: 90, y: 164, textAnchor: 'middle' }, t('diagramWriteSummary')),
      )
    }

    function HandoffDiagram() {
      const marker = 'bc-handoff-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
      return h(StrategySvg, { mode: 'handoff', marker,
        label: t('diagramHandoffLabel') },
        h(DiagramNode, { id: 'history', x: 2, y: 38, width: 64, height: 36, lines: [t('diagramConversation'), t('diagramAndState')] }),
        h(DiagramNode, { id: 'file', x: 88, y: 38, width: 90, height: 36, lines: [t('diagramTempFile'), t('diagramThisHandoff')], tone: 'dsh-bc-node-dashed' }),
        h(DiagramEdge, { from: 'history', to: 'file', d: 'M66 56 L88 56', marker }),
        h(DiagramEdge, { from: 'file', to: 'summary', d: 'M133 74 L133 86 L54 86 L54 100', marker }),
        h(DiagramNode, { id: 'recent', x: 116, y: 86, width: 62, height: 20, lines: [t('diagramRecentMessages')] }),
        h(DiagramEdge, { from: 'recent', to: 'tail', d: 'M147 106 L147 116', marker }),
        h(DiagramNode, { id: 'summary', x: 2, y: 100, width: 104, height: 36, lines: [t('diagramSessionRecord'), t('diagramSaveHandoff')], tone: 'dsh-bc-node-accent' }),
        h(DiagramNode, { id: 'tail', x: 116, y: 116, width: 62, height: 20, lines: [t('diagramRetainedOriginal')], tone: 'dsh-bc-node-strong' }),
        h(DiagramEdge, { from: 'summary', to: 'continuation', d: 'M54 136 L54 146', marker }),
        h(DiagramEdge, { from: 'tail', to: 'continuation', d: 'M147 136 L147 146', marker }),
        h(DiagramNode, { id: 'continuation', x: 2, y: 146, width: 176, height: 22, lines: [t('diagramContinue')] }),
      )
    }

    const DIAGRAMS = Object.freeze({ native: NativeDiagram, goal: GoalDiagram, handoff: HandoffDiagram })

    // ── generic UI primitives ─────────────────────────────────────────────

    /** A labelled field; children is a render function receiving the input id. */
    function Field(props) {
      const id = 'dsh-bc-' + props.name + '-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
      const described = props.error ? id + '-error' : props.hint !== undefined || props.help !== undefined ? id + '-help' : undefined
      return h('div', { className: 'dsh-bc-field' },
        h('label', { id: id + '-label', htmlFor: id, className: 'dsh-bc-label' }, props.label),
        props.children(id, { 'aria-labelledby': id + '-label', 'aria-invalid': props.error ? true : undefined, 'aria-describedby': described }),
        props.hint !== undefined
          ? h('p', { id: id + '-help', className: 'dsh-bc-hint' }, props.hint)
          : props.help !== undefined ? h('p', { id: id + '-help', className: 'dsh-bc-help dsh-bc-sr-only' }, props.help) : null,
        props.error ? h('p', { id: id + '-error', className: 'dsh-bc-error', role: 'alert', 'data-bc-error': props.name }, props.error) : null)
    }

    /** The trigger keeps focus while the listbox previews an uncommitted option. */
    function Select(props) {
      const fallbackId = 'dsh-bc-select-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
      const id = props.id ?? fallbackId
      const options = React.Children.toArray(props.children).map((option) => option.props)
      const selected = options.findIndex((option) => option.value === props.value)
      const [open, setOpen] = useState(false)
      const [active, setActive] = useState(selected < 0 ? 0 : selected)
      const [placement, setPlacement] = useState({ above: false, height: 240 })
      const root = useRef(null)
      const trigger = useRef(null)
      const search = useRef({ text: '', at: 0 })
      const expanded = open && !props.disabled
      useEffect(() => {
        if (!expanded || typeof document === 'undefined') return
        const dismiss = (event) => { if (!root.current?.contains(event.target)) setOpen(false) }
        document.addEventListener('pointerdown', dismiss)
        document.addEventListener('focusin', dismiss)
        return () => {
          document.removeEventListener('pointerdown', dismiss)
          document.removeEventListener('focusin', dismiss)
        }
      }, [expanded])
      useEffect(() => {
        if (expanded) root.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
      }, [expanded, active])
      const show = (index = selected < 0 ? 0 : selected) => {
        if (props.disabled) return
        const rect = trigger.current?.getBoundingClientRect()
        if (rect && typeof window.innerHeight === 'number') {
          const below = window.innerHeight - rect.bottom - 8
          const above = rect.top - 8
          const preferred = Math.min(240, options.length * 32 + 8)
          const placeAbove = below < preferred && above > below
          setPlacement({ above: placeAbove, height: Math.min(240, Math.max(32, placeAbove ? above : below)) })
        }
        setActive(index); setOpen(true)
      }
      const choose = (index) => {
        if (props.disabled || !options[index]) return
        props.onChange({ target: { value: options[index].value } })
        setOpen(false)
        trigger.current?.focus()
      }
      const onKeyDown = (event) => {
        if (props.disabled || event.defaultPrevented) return
        if (event.key === 'Tab') { setOpen(false); return }
        if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); setOpen(false); return }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const step = event.key === 'ArrowDown' ? 1 : -1
          show(expanded ? (active + step + options.length) % options.length : selected < 0 ? 0 : selected)
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault(); show(event.key === 'Home' ? 0 : options.length - 1)
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); if (expanded) choose(active); else show()
        } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          const now = Date.now()
          const previous = now - search.current.at < 600 ? search.current.text : ''
          const query = previous === event.key.toLocaleLowerCase() ? previous : previous + event.key.toLocaleLowerCase()
          search.current = { text: query, at: now }
          for (let step = 1; step <= options.length; step++) {
            const index = ((expanded ? active : selected) + step + options.length) % options.length
            if (String(options[index].children).toLocaleLowerCase().startsWith(query)) { event.preventDefault(); show(index); break }
          }
        }
      }
      return h('div', { className: 'dsh-bc-select', ref: root },
        h('button', { id, ref: trigger, name: props.name, value: props.value, type: 'button', role: 'combobox',
          className: 'dsh-bc-input dsh-bc-select-trigger', disabled: props.disabled, title: props.title,
          'aria-label': props['aria-label'], 'aria-labelledby': props['aria-labelledby'],
          'aria-describedby': props['aria-describedby'], 'aria-invalid': props['aria-invalid'],
          'aria-haspopup': 'listbox', 'aria-expanded': expanded, 'aria-controls': expanded ? id + '-list' : undefined,
          'aria-activedescendant': expanded ? id + '-option-' + active : undefined,
          onClick: () => expanded ? setOpen(false) : show(), onKeyDown },
          h('span', { className: 'dsh-bc-select-value' }, options[selected]?.children ?? t('selectOption')),
          h('span', { className: 'dsh-bc-chevron', 'aria-hidden': true })),
        expanded ? h('div', { id: id + '-list', role: 'listbox', className: 'dsh-bc-select-menu',
          'data-side': placement.above ? 'above' : 'below', style: { maxHeight: placement.height },
          'aria-labelledby': props['aria-labelledby'] ?? id },
          options.map((option, index) => h('div', { key: option.value, id: id + '-option-' + index, role: 'option',
            className: 'dsh-bc-select-option', 'aria-selected': index === selected, 'data-active': index === active,
            'data-value': option.value, onPointerMove: () => setActive(index), onPointerDown: (event) => event.preventDefault(), onClick: () => choose(index) },
            h('span', null, option.children), h('span', { className: 'dsh-bc-option-check', 'aria-hidden': true }, index === selected ? '✓' : '')))) : null)
    }

    function NumberField(props) {
      const ratio = props.ratio === true
      const display = ratio && props.value !== '' ? String(Number((Number(props.value) * 100).toFixed(8))) : props.value
      return h(Field, { ...props, children: (id, aria) => h('div', { className: 'dsh-bc-number' },
        h('input', { ...aria, id, name: props.name, className: 'dsh-bc-input', type: 'number',
          inputMode: ratio ? 'decimal' : 'numeric', min: props.min ?? 0, max: ratio ? 100 : undefined,
          step: ratio ? 'any' : 1, value: display, disabled: props.disabled, placeholder: props.placeholder,
          onChange: (event) => props.onChange(event.target.value === '' ? '' : ratio ? String(Number(event.target.value) / 100) : event.target.value) }),
        h('span', { className: 'dsh-bc-unit', 'aria-hidden': true }, ratio ? '%' : props.unit ?? 'tokens')) })
    }

    function collapseDetails(event) {
      if (event.key !== 'Escape' || event.defaultPrevented || !event.currentTarget.open) return
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.open = false
      event.currentTarget.querySelector('summary')?.focus()
    }

    function Explain(props) {
      return h('details', { className: 'dsh-bc-explanation', open: props.open, onKeyDown: collapseDetails, 'data-bc': props.name },
        h('summary', null, props.title), h('div', { className: 'dsh-bc-explanation-body' }, props.children))
    }

    function Metric(props) {
      return h('div', { className: 'dsh-bc-metric' }, h('span', { className: 'dsh-bc-caption' }, props.label),
        h('span', { className: 'dsh-bc-metric-value', 'data-bc': props.name }, props.value))
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
        h('span', { className: props.mono === true ? 'dsh-bc-row-value dsh-bc-mono' : 'dsh-bc-row-value' }, props.value),
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
          h('span', { className: 'dsh-bc-mode-title' }, t(meta.labelKey)),

        ),
        h('p', { className: 'dsh-bc-mode-description' }, t(meta.effectKey)),
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
        null,
        h(
          'div',
          { className: 'dsh-bc-modes', role: 'radiogroup', 'aria-label': t('modeGroup'), 'data-bc': 'mode-cards' },
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
        h('div', { className: 'dsh-bc-strategy-foot' },

          h('details', { className: 'dsh-bc-explanation', onKeyDown: collapseDetails, 'data-bc': 'mode-details' }, h('summary', null, t('modeDetails')),
            MODES.map((mode) => h('p', { key: mode, className: 'dsh-bc-caption' }, t(MODE_META[mode].labelKey) + '：' + t(MODE_META[mode].captionKey)))),
        ),
      )
    }

    /** A setting row with a label on the left and a switch control on the right. */
    function Toggle(props) {
      const rawId = useId()
      const id = `dsh-bc-toggle-${props.name}-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
      return h(
        'div',
        { className: 'dsh-bc-setting-row', 'data-bc-setting': props.name },
        h(
          'div',
          { className: 'dsh-bc-setting-main' },
          h('label', { className: 'dsh-bc-setting-label', htmlFor: id }, props.label),
          props.help === undefined || props.help === null ? null : h('span', { className: 'dsh-bc-setting-desc' }, props.help),
        ),
        h(
          'div',
          { className: 'dsh-bc-setting-control' },
          h('input', {
            id,
            name: props.name,
            className: 'dsh-bc-switch',
            type: 'checkbox',
            checked: props.checked === true,
            disabled: props.disabled === true,
            onChange: (event) => props.onChange(event.target.checked),
            role: 'switch',
            'aria-checked': props.checked === true,
          }),
        ),
      )
    }

    /** Classify an inspect budget/diagnostic reason and point at the controls. */
    function classifyReason(text) {
      if (typeof text !== 'string' || text.length === 0) return null
      if (/leaving no message budget/i.test(text)) {
        return { label: t('reasonNoCapacity'), hint: t('reasonNoCapacityHint') }
      }
      if (/leaving no pressure budget/i.test(text)) {
        return { label: t('reasonReserveFull'), hint: t('reasonReserveFullHint') }
      }
      if (/must be less than threshold tokens/i.test(text)) {
        return { label: t('reasonRetainConflict'), hint: t('reasonRetainConflictHint') }
      }
      if (/no safe compactable range/i.test(text)) {
        return {
          label: /system prompt|retained tail|tool-call/i.test(text) ? t('reasonNoSafeRangeWithPrefix') : t('reasonNoSafeRange'),
          hint: t('reasonNoSafeRangeHint'),
        }
      }
      if (/no routed request/i.test(text)) {
        return { label: t('reasonNoRoute'), hint: t('reasonNoRouteHint') }
      }
      if (/no context capacity/i.test(text) || /model metadata is unavailable/i.test(text)) {
        return { label: t('reasonCapacityUnknown'), hint: t('reasonCapacityUnknownHint') }
      }
      if (/below the automatic trigger/i.test(text)) {
        return { label: t('reasonBelowTrigger'), hint: null }
      }
      if (/automatic compaction is disabled/i.test(text)) {
        return { label: t('reasonAutoOff'), hint: t('reasonAutoOffHint') }
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
            h('span', null, item.classified?.label ?? item.raw),
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
      return h('div', { className: 'dsh-bc-bar', role: 'img', 'aria-label': props.ariaLabel, 'data-bc': props.name },
        h('div', { className: 'dsh-bc-bar-track' }, (props.segments ?? []).filter((segment) => segment.tokens > 0).map((segment) =>
          h('div', { key: segment.key, className: 'dsh-bc-bar-seg dsh-bc-seg-' + (segment.tone ?? 'free'),
            title: segment.label + ' · ' + tokensText(segment.tokens), style: { width: percentOf(segment.tokens, props.scale) + '%' } }))),
        markers.map(([name, value]) => typeof value === 'number' && Number.isFinite(value) ? h('div', {
          key: name, className: name === 'trigger' ? 'dsh-bc-trigger' : 'dsh-bc-current-line',
          style: { left: percentOf(value, props.scale) + '%' }, 'aria-hidden': true }) : null))
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
                : `${item.label}: ${t('unknown')}`,
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
      if (message <= 0) error = t('budgetNoMessageRoom')
      else if (pressure <= 0) error = t('budgetHeadroomTooLarge', { message: tokensText(message) })
      else if (retain >= threshold) error = t('budgetRetainTooLarge', { retain: tokensText(retain), threshold: tokensText(threshold) })
      return { window, reserved, message, headroom, pressure, ratio, threshold, retain, summary, policy, error }
    }

    function RatioControl(props) {
      const rawId = useId()
      const id = 'dsh-bc-ratio-' + rawId.replace(/[^a-zA-Z0-9_-]/g, '')
      const value = props.value === '' ? '' : String(Number((Number(props.value) * 100).toFixed(8)))
      const ratio = Math.max(0.01, Math.min(0.99, Number(props.value) || 0.01))
      return h(
        'div',
        { className: 'dsh-bc-field dsh-bc-threshold' },
        h(
          'div',
          { className: 'dsh-bc-thresholdHead' },
          h('label', { className: 'dsh-bc-label', htmlFor: id }, props.label),
          h(
            'div',
            { className: 'dsh-bc-number dsh-bc-number-inline' },
            h('input', {
              id,
              name: props.name,
              className: 'dsh-bc-input',
              type: 'number',
              inputMode: 'decimal',
              min: 0,
              max: 100,
              step: 'any',
              value,
              disabled: props.disabled,
              'aria-label': props.label,
              'aria-invalid': props.error ? true : undefined,
              'aria-describedby': props.error ? id + '-error' : undefined,
              onChange: (event) => props.onChange(event.target.value === '' ? '' : String(Number(event.target.value) / 100)),
            }),
            h('span', { className: 'dsh-bc-unit', 'aria-hidden': true }, '%'),
          ),
        ),
        h('div', { className: 'dsh-bc-range-wrap' },
          h('span', { className: 'dsh-bc-range-fill', 'aria-hidden': true, style: { width: percentOf(ratio - 0.01, 0.98) + '%' } }),
          h('input', {
            name: props.sliderName,
            type: 'range',
            className: 'dsh-bc-range',
            min: 0.01,
            max: 0.99,
            step: 0.01,
            'aria-label': props.label,
            'aria-valuetext': value === '' ? t('unset') : value + '%',
            value: ratio,
            disabled: props.disabled,
            onChange: (event) => props.onChange(event.target.value),
          }),
        ),
        h('div', { className: 'dsh-bc-scale', 'aria-hidden': true }, h('span', null, '1%'), h('span', null, '50%'), h('span', null, '99%')),
        props.error ? h('p', { id: id + '-error', className: 'dsh-bc-error', role: 'alert' }, props.error) : null,
      )
    }
    function BudgetSection(props) {
      const { draft, disabled } = props
      return h(Section, { name: 'budget', title: t('budgetSection') },
        h(Toggle, { name: 'auto', label: t('autoCompression'), checked: draft.auto, disabled, onChange: (auto) => props.onDraft({ auto }) }),
        draft.auto ? h(RatioControl, { name: 'thresholdRatio', sliderName: 'thresholdRatioSlider', label: t('threshold'), value: draft.thresholdRatio,
          disabled, error: props.fieldError('thresholdRatio'), onChange: (thresholdRatio) => props.onDraft({ thresholdRatio }) }) : null,
        draft.auto ? h('div', { className: 'dsh-bc-retention' },
          h('fieldset', { className: 'dsh-bc-retain-choice' }, h('legend', { className: 'dsh-bc-label' }, t('retainRecent')),
            h('div', { className: 'dsh-bc-segmented' }, [['ratio', t('byRatio')], ['tokens', t('fixedTokens')]].map(([value, label]) =>
              h('label', { key: value, className: 'dsh-bc-segment', 'data-checked': draft.retainMode === value },
                h('input', { type: 'radio', name: 'retainMode', value, checked: draft.retainMode === value, disabled,
                  onChange: () => props.onRetentionMode(value) }), h('span', null, label))))),
          draft.retainMode === 'ratio'
            ? h(NumberField, { name: 'retainRatio', label: t('retainRatio'), ratio: true, value: draft.retainRatio, placeholder: '16', disabled,
              error: props.fieldError('retainRatio'), hint: t('retainRatioHelp'), onChange: (retainRatio) => props.onDraft({ retainRatio }) })
            : h(NumberField, { name: 'retainTokens', label: t('retainTokens'), value: draft.retainTokens, disabled,
              error: props.fieldError('retainTokens'), onChange: (retainTokens) => props.onDraft({ retainTokens }) })) : null,
        draft.mode !== 'native' ? h(Toggle, { name: 'cachePriority', label: t('cachePriority'), checked: draft.cachePriority, disabled,
          onChange: (cachePriority) => props.onDraft({ cachePriority }) }) : null)
    }

    /** A persistent draft allocation beside the controls, using inspected capacity. */
    function DraftBudget(props) {
      const { projection: projected } = props
      const before = props.budget?.currentTokens
      const after = props.preview?.afterUpperBoundTokens
      const previewLine = Number.isFinite(before) && Number.isFinite(after)
        ? h('div', { className: 'dsh-bc-preview-line', 'data-bc': 'draft-preview-line' },
          h('span', null, t('compositionBefore') + ' ' + tokensText(before)),
          h('span', { className: 'dsh-bc-preview-arrow', 'aria-hidden': true }, '→'),
          h('span', null, '≤ ' + tokensText(after)))
        : null
      const route = props.budget.target.provider + '/' + props.budget.target.model
      return h('div', { className: 'dsh-bc-budget-view', 'data-bc': 'draft-budget' },
        h('div', { className: 'dsh-bc-subhead' }, h('h4', { className: 'dsh-bc-h4' }, t('draftBudget')),
          h('span', { className: 'dsh-bc-caption dsh-bc-mono', title: route }, route)),
        h('div', { className: 'dsh-bc-metrics' },
          h(Metric, { label: t('messageBudget'), value: tokensText(projected.message), name: 'draft-message-budget' }),
          h(Metric, { label: t('effectiveTrigger'), value: tokensText(projected.threshold), name: 'draft-trigger' }),
          h(Metric, { label: t('retainBudget'), value: tokensText(projected.retain), name: 'draft-retain' })),
        projected.error ? h('p', { className: 'dsh-bc-error', role: 'alert', 'data-bc': 'budget-constraint' }, projected.error)
          : h(TokenBar, { name: 'draft-window-bar', scale: projected.window, triggerTokens: projected.threshold,
            ariaLabel: t('draftWindowAria', { trigger: tokensText(projected.threshold), headroom: tokensText(projected.headroom), reserved: tokensText(projected.reserved) }),
            segments: [
              { key: 'trigger', label: t('triggerBefore'), tokens: projected.threshold, tone: 'history' },
              { key: 'slack', label: t('ratioSlack'), tokens: projected.pressure - projected.threshold, tone: 'free' },
              { key: 'headroom', label: t('extraHeadroom'), tokens: projected.headroom, tone: 'headroom' },
              { key: 'output', label: t('sessionOutput'), tokens: projected.reserved, tone: 'fixed' },
            ] }),
        projected.error ? null : h(TokenLegend, { items: [
          { key: 'trigger', label: t('triggerBefore'), tokens: projected.threshold, tone: 'history' },
          ...(projected.pressure > projected.threshold ? [{ key: 'slack', label: t('ratioSlack'), tokens: projected.pressure - projected.threshold, tone: 'free' }] : []),
          { key: 'headroom', label: t('extraHeadroom'), tokens: projected.headroom, tone: 'headroom' },
          { key: 'output', label: t('sessionOutput'), tokens: projected.reserved, tone: 'fixed' },
        ] }),
        previewLine,
      )
    }

    /** Observed usage and native candidate ranges never share the draft editor. */
    function RuntimeBudget(props) {
      const { budget, preview } = props
      if (props.engineApplies === false) return null
      const hasCut = typeof preview?.rangeStart === 'number' && typeof preview?.rangeEnd === 'number'
      const hasParts = hasCut && [budget?.fixedTokens, preview?.replacedTokens, preview?.retainedTokens, preview?.checkpointFramingTokens, budget?.summaryMaxTokens].every(Number.isFinite)
      const scale = hasParts ? Math.max(budget.contextWindow ?? 0, budget.currentTokens, preview.afterUpperBoundTokens, 1) : null
      const remaining = Number.isFinite(budget?.thresholdTokens) && Number.isFinite(budget?.currentTokens) ? budget.thresholdTokens - budget.currentTokens : null
      const conclusion = props.activeConfig?.auto === false ? t('conclusionAutoOff')
        : remaining === null ? t('conclusionNoUsage')
        : remaining > 0 ? t('conclusionRemaining', { remaining: tokensText(remaining) }) : t('conclusionReached')
      const measurement = budget?.measurement === 'measured' ? t('measured')
        : budget?.measurement === 'estimated' ? t('estimated') : t('measurementUnknown')
      return h('div', { className: 'dsh-bc-runtime', 'data-bc': 'runtime-budget' },
        h('div', { className: 'dsh-bc-subhead' }, h('h4', { className: 'dsh-bc-h4' }, conclusion),
          h('span', { className: 'dsh-bc-chip', 'data-bc': 'measurement' }, measurement)),
        h('div', { className: 'dsh-bc-metrics' },
          h(Metric, { label: t('runtimeWindow'), value: tokensText(budget?.contextWindow) }),
          h(Metric, { label: t('currentContext'), value: tokensText(budget?.currentTokens), name: 'current-tokens' }),
          h(Metric, { label: t('runtimeTrigger'), value: tokensText(budget?.thresholdTokens), name: 'runtime-trigger' })),
        Number.isFinite(budget?.currentTokens) && budget?.contextWindow > 0 ? h(TokenBar, {
          name: 'budget-window-bar', scale: Math.max(budget.contextWindow, budget.currentTokens),
          triggerTokens: budget.thresholdTokens, currentTokens: budget.currentTokens,
          ariaLabel: t('runtimeWindowAria', { current: tokensText(budget.currentTokens), trigger: tokensText(budget.thresholdTokens), window: tokensText(budget.contextWindow) }),
          segments: [{ key: 'used', label: t('currentContext'), tokens: budget.currentTokens, tone: 'history' }] }) : null,
        h('div', { className: 'dsh-bc-preview', 'data-bc': 'runtime-preview' },
          h('h4', { className: 'dsh-bc-h4' }, t('runtimePreview')),
          hasCut ? h('p', { className: 'dsh-bc-note', 'data-bc': 'safe-cut' }, t('safeCut', { start: preview.rangeStart, end: preview.rangeEnd, upper: tokensText(preview.afterUpperBoundTokens) }))
            : h('p', { className: 'dsh-bc-note', 'data-bc': 'no-safe-cut' }, t('noSafeCut')),
          hasParts ? h('div', { className: 'dsh-bc-composition' },
            h('div', { className: 'dsh-bc-subhead' }, h('span', null, t('compositionBefore')), h('span', null, tokensText(budget.currentTokens))),
            h(TokenBar, { name: 'before-bar', scale, ariaLabel: t('beforeBarAria', { fixed: t('fixedPrefix'), history: t('compressibleMessages'), tail: t('actualRetained') }), segments: [
              { key: 'fixed', label: t('fixedPrefix'), tokens: budget.fixedTokens, tone: 'fixed' },
              { key: 'history', label: t('compressibleMessages'), tokens: preview.replacedTokens, tone: 'history' },
              { key: 'tail', label: t('actualRetained'), tokens: preview.retainedTokens, tone: 'tail' }] }),
            h('div', { className: 'dsh-bc-preview-arrow', 'aria-hidden': true }, '↓'),
            h('div', { className: 'dsh-bc-subhead' }, h('span', null, t('compositionAfter')), h('span', null, '≤ ' + tokensText(preview.afterUpperBoundTokens))),
            h(TokenBar, { name: 'after-bar', scale, ariaLabel: t('afterBarAria', { fixed: t('fixedPrefix'), summary: t('summaryBudgetFraming'), tail: t('actualRetained') }), segments: [
              { key: 'fixed', label: t('fixedPrefix'), tokens: budget.fixedTokens, tone: 'fixed' },
              { key: 'summary', label: t('summaryBudgetFraming'), tokens: budget.summaryMaxTokens + preview.checkpointFramingTokens, tone: 'summary' },
              { key: 'tail', label: t('actualRetained'), tokens: preview.retainedTokens, tone: 'tail' }] }),
            h(TokenLegend, { items: [
              { key: 'fixed', label: t('fixedPrefix'), tokens: budget.fixedTokens, tone: 'fixed' },
              { key: 'summary', label: t('summaryBudgetFraming'), tokens: budget.summaryMaxTokens + preview.checkpointFramingTokens, tone: 'summary' },
              { key: 'tail', label: t('actualRetained'), tokens: preview.retainedTokens, tone: 'tail' }] })) : null,
          h(ReasonList, { reasons: props.reasons })))
    }


    // ── model / effort section ────────────────────────────────────────────

    function ModelSection(props) {
      const { draft, routes, route, disabled } = props
      const native = draft.mode === 'native'
      const custom = draft.provider !== '' && !routes.some((entry) => entry.provider === draft.provider && entry.model === draft.model)
      const textField = (name, label, value, onChange) => h(Field, { name, label, error: props.fieldError(name), children: (id, aria) =>
        h('input', { ...aria, id, name, className: 'dsh-bc-input', value, disabled, onChange: (event) => onChange(event.target.value) }) })
      return h(Section, { name: 'model', title: t('modelSection') },
        h('div', { className: 'dsh-bc-grid' },
          h(Field, { name: 'summaryRoute', label: t('summaryModel'), error: props.fieldError('summarizationModel'), children: (id, aria) =>
            h(Select, { ...aria, id, name: 'summaryRoute',
              value: custom ? 'custom' : draft.provider === '' ? '' : JSON.stringify([draft.provider, draft.model]), disabled,
              onChange: (event) => { if (event.target.value === 'custom') return; const [provider, model] = event.target.value === '' ? ['', ''] : JSON.parse(event.target.value); props.onDraft({ provider, model }) } },
              h('option', { value: '' }, t('followSessionModel') + (props.target ? ' · ' + props.target.provider + '/' + props.target.model : '')),
              routes.map((entry) => h('option', { key: JSON.stringify([entry.provider, entry.model]), value: JSON.stringify([entry.provider, entry.model]) }, entry.provider + '/' + entry.model)),
              custom ? h('option', { value: 'custom' }, draft.provider + '/' + draft.model) : null) }),
          !native ? h(Field, { name: 'reasoningEffort', label: t('reasoningEffort'), error: props.fieldError('reasoningEffort'), children: (id, aria) =>
            route ? h(Select, { ...aria, id, name: 'reasoningEffort', value: draft.effort, disabled,
              onChange: (event) => props.onDraft({ effort: event.target.value }) },
              h('option', { value: '' }, route.defaultEffort ? t('modelDefaultWith', { effort: route.defaultEffort }) : t('modelDefault')),
              route.efforts.map((effort) => h('option', { key: effort, value: effort }, effort)),
              draft.effort !== '' && !route.efforts.includes(draft.effort) ? h('option', { value: draft.effort }, t('unsupportedEffortOption', { effort: draft.effort })) : null)
              : h('input', { ...aria, id, name: 'reasoningEffort', className: 'dsh-bc-input', value: draft.effort, disabled,
                placeholder: t('effortUnknownPlaceholder'), onChange: (event) => props.onDraft({ effort: event.target.value }) }) }) : null),
        h(Explain, { title: t('customSummaryModel'), open: custom || undefined },
          h('div', { className: 'dsh-bc-grid' },
            textField('summarizationProvider', t('provider'), draft.provider, props.onProvider),
            textField('summarizationModel', t('model'), draft.model, props.onModel))),
        props.routeWarning ? h('p', { className: 'dsh-bc-note', 'data-bc': 'route-warning' }, props.routeWarning) : null,
        props.modelsStatus === 'loading' || props.modelsStatus === 'refreshing' ? h('p', { className: 'dsh-bc-caption', role: 'status' }, t('modelsLoading'))
          : props.modelsStatus === 'error' ? h('p', { className: 'dsh-bc-note' }, t('modelsFailed')) : null)
    }

    // ── advanced section ──────────────────────────────────────────────────

    function AdvancedSection(props) {
      const { draft, disabled } = props
      const defaults = { headroomTokens: '65536', maxTokens: '', compactionRetries: '1', maxOverflowRetries: '1' }
      const names = { headroomTokens: t('headroom'), maxTokens: t('summaryOutputCap'), compactionRetries: t('pressureRetry'), maxOverflowRetries: t('overflowRecovery') }
      const customized = Object.keys(defaults).filter((key) => draft[key] !== defaults[key]).map((key) => names[key])
      if (draft.policies.length) customized.push(draft.policies.length + ' × ' + t('policies'))
      const updatePolicy = (index, patch) => props.onDraft({ policies: draft.policies.map((entry, i) => i === index ? { ...entry, ...patch } : entry) })
      const policyField = (index, key, label, ratio, inherited) => h(NumberField, {
        name: 'policies.' + index + '.' + key, label, ratio, value: draft.policies[index][key], disabled,
        help: draft.policies[index][key] === '' && inherited !== undefined ? t('inheritWith', { value: ratio ? ratioText(Number(inherited)) : key.includes('Retries') ? inherited + ' ' + t('timesUnit') : tokensText(Number(inherited)) }) : undefined,
        error: props.fieldError('policies.' + index + '.' + key), onChange: (value) => updatePolicy(index, { [key]: value }) })
      const policyText = (index, key, label) => h(Field, { name: 'policies.' + index + '.' + key, label,
        error: props.fieldError('policies.' + index + '.' + key), children: (id, aria) => h('input', {
          ...aria, id, name: 'policies.' + index + '.' + key, className: 'dsh-bc-input', value: draft.policies[index][key], disabled,
          onChange: (event) => updatePolicy(index, { [key]: event.target.value }) }) })
      return h('details', { className: 'dsh-bc-details', onKeyDown: collapseDetails, 'data-bc': 'advanced' },
        h('summary', null, h('span', null, t('advanced')), customized.length ? h('span', { className: 'dsh-bc-caption', 'data-bc': 'advanced-summary' }, t('advancedCount', { count: customized.length }) + ' · ' + customized.join(' · ')) : null),
        h('div', { className: 'dsh-bc-details-body' },
          h('div', { className: 'dsh-bc-grid' },
            h(NumberField, { name: 'headroomTokens', label: t('headroom'), value: draft.headroomTokens, disabled,
              error: props.fieldError('headroomTokens'), onChange: (headroomTokens) => props.onDraft({ headroomTokens }) }),
            h(NumberField, { name: 'maxTokens', label: t('summaryOutputCap'), value: draft.maxTokens, min: 1, disabled,
              help: draft.maxTokens === '' ? t('followHeadroom', { value: tokensText(Number(draft.headroomTokens)) }) : undefined,
              error: props.fieldError('maxTokens'), onChange: (maxTokens) => props.onDraft({ maxTokens }) }),
            draft.auto ? h(React.Fragment, null,
              h(NumberField, { name: 'compactionRetries', label: t('pressureRetry'), unit: t('timesUnit'), value: draft.compactionRetries, disabled,
                error: props.fieldError('compactionRetries'), onChange: (compactionRetries) => props.onDraft({ compactionRetries }) }),
              h(NumberField, { name: 'maxOverflowRetries', label: t('overflowRecovery'), unit: t('timesUnit'), value: draft.maxOverflowRetries, disabled,
                error: props.fieldError('maxOverflowRetries'), onChange: (maxOverflowRetries) => props.onDraft({ maxOverflowRetries }) })) : null),
          h('div', { className: 'dsh-bc-subhead' }, h('h4', { className: 'dsh-bc-h4' }, t('policies')),
            h('button', { type: 'button', className: 'dsh-bc-btn', disabled, 'data-bc': 'add-policy',
              onClick: () => props.onDraft({ policies: [...draft.policies, policyDraft()] }) }, t('addRule'))),
          draft.policies.length === 0 ? h('p', { className: 'dsh-bc-caption' }, t('allModelsGlobal')) : null,
          draft.policies.map((policy, index) => h('details', { key: index, className: 'dsh-bc-policy', onKeyDown: collapseDetails, open: !policy.provider || !policy.model ? true : undefined, 'data-bc-policy': index },
            h('summary', { className: 'dsh-bc-mono' }, policy.provider && policy.model ? policy.provider + '/' + policy.model : t('newRule')),
            h('div', { className: 'dsh-bc-policy-body' },
              h('div', { className: 'dsh-bc-grid' }, policyText(index, 'provider', t('sessionProvider')), policyText(index, 'model', t('sessionModel')),
                POLICY_NUMBERS.filter(([key]) => draft.auto || !['thresholdRatio', 'compactionRetries', 'maxOverflowRetries'].includes(key)).map(([key, labelKey, ratio]) => h(React.Fragment, { key },
                  policyField(index, key, t(labelKey), ratio, key === 'maxTokens' ? draft.maxTokens || policy.headroomTokens || draft.headroomTokens : draft[key]))),
                draft.auto ? h(React.Fragment, null,
                  h(Field, { name: 'policies.' + index + '.retainMode', label: t('retainRecent'), children: (id, aria) => h(Select, {
                    ...aria, id, name: 'policies.' + index + '.retainMode', value: policy.retainMode, disabled,
                    onChange: (event) => updatePolicy(index, { retainMode: event.target.value }) },
                    h('option', { value: 'inherit' }, t('inheritWith', { value: draft.retainMode === 'tokens' ? tokensText(Number(draft.retainTokens)) : ratioText(draft.retainRatio === '' ? DEFAULT_RETAIN_RATIO : Number(draft.retainRatio)) })),
                    h('option', { value: 'ratio' }, t('byMessageBudgetRatio')), h('option', { value: 'tokens' }, t('fixedTokenCount'))) }),
                  policy.retainMode !== 'inherit' ? policyField(index, policy.retainMode === 'ratio' ? 'retainRatio' : 'retainTokens',
                    policy.retainMode === 'ratio' ? t('retainRatio') : t('retainTokens'), policy.retainMode === 'ratio', policy.retainMode === 'ratio' ? draft.retainRatio || DEFAULT_RETAIN_RATIO : undefined)
                    : props.fieldError('policies.' + index + '.retainRatio') ? h('p', { className: 'dsh-bc-error', role: 'alert' }, props.fieldError('policies.' + index + '.retainRatio')) : null) : null,
                h(Field, { name: 'policies.' + index + '.summaryMode', label: t('policySummaryMode'), children: (id, aria) => h(Select, {
                  ...aria, id, name: 'policies.' + index + '.summaryMode', value: policy.summaryMode, disabled,
                  onChange: (event) => updatePolicy(index, { summaryMode: event.target.value }) },
                  h('option', { value: 'inherit' }, t('policySummaryInherit', { value: draft.provider ? draft.provider + '/' + draft.model : t('followSessionModel') })),
                  h('option', { value: 'session' }, t('policySummarySession')), h('option', { value: 'custom' }, t('policySummaryCustom'))) }),
                policy.summaryMode === 'custom' ? h(React.Fragment, null,
                  policyText(index, 'summarizationProvider', t('summaryProvider')), policyText(index, 'summarizationModel', t('summaryModel'))) : null),
              h('button', { type: 'button', className: 'dsh-bc-btn dsh-bc-btn-remove', disabled, 'aria-label': t('deleteRule', { index: index + 1 }),
                onClick: () => props.onDraft({ policies: draft.policies.filter((_, i) => i !== index) }) }, t('deleteRuleShort')))))
        )
      )
    }

    // ── status section ────────────────────────────────────────────────────

    const STATUS_KEYS = Object.freeze({
      running: 'statusRunning',
      completed: 'statusCompleted',
      failed: 'statusFailed',
      cancelled: 'statusCancelled',
      'persistence-error': 'statusPersistenceError',
    })

    /** One-line engine ownership statement. */
    function engineNote(engine) {
      if (engine === null || engine === undefined) return t('engineUnknown')
      if (engine.inspectApplies === false) return t('engineForeign', { owner: engine.owner })
      if (engine.owner === 'unknown') return t('engineOwnerUnknown')
      return t('engineOwner', { owner: engine.owner })
    }

    /** The status of the last real native compaction bracket. */
    function LastCompaction(props) {
      const record = props.record
      if (!record) return h('p', { className: 'dsh-bc-caption', 'data-bc': props.emptyName ?? 'last-compaction-empty' }, props.emptyText)
      const trigger = record.trigger === 'manual' ? t('triggerManual') : record.trigger === 'automatic' ? t('triggerAutomatic') : t('triggerUnknown')
      return h('div', { className: 'dsh-bc-status-record', 'data-bc': 'last-compaction', 'data-status': record.status },
        h('p', { className: 'dsh-bc-status-line dsh-bc-status-' + record.status }, t(STATUS_KEYS[record.status] ?? 'unknown') + ' · ' + trigger),
        h('div', { className: 'dsh-bc-status-grid' },
          h(Row, { label: t('strategyLabel'), value: MODE_META[record.mode] ? t(MODE_META[record.mode].labelKey) : t('unknown') }),
          h(Row, { label: t('duration'), value: durationText(record.durationMs) }),
          h(Row, { label: t('replacedMessages'), value: tokensText(record.beforeTokens) }),
          h(Row, { label: t('summaryEstimate'), value: tokensText(record.afterTokens) }),
          h(Row, { label: t('cacheRead'), value: tokensText(record.cacheReadTokens) }),
          h(Row, { label: t('cacheWrite'), value: tokensText(record.cacheWriteTokens) })),
        record.status === 'persistence-error' ? h('p', { className: 'dsh-bc-error', role: 'alert', 'data-bc': 'persistence-error' }, t('persistenceFailed')) : null,
        record.error ? h('p', { className: 'dsh-bc-error', role: 'alert' }, record.error) : null)
    }

    function StatusSection(props) {
      const reasons = [...new Set((props.diagnostics ?? []).filter((entry) => typeof entry === 'string' && entry !== ''))]
      return h(Section, { name: 'status', title: t('statusSection'), aside: h('span', { className: 'dsh-bc-chip' }, t('statusReadOnly')) },
        props.sessionControl,
        props.inspectError ? h('p', { className: 'dsh-bc-error', role: 'alert' }, t('diagnosticsFailed', { message: props.inspectError }))
          : props.inspectLoading ? h('p', { className: 'dsh-bc-note', role: 'status', 'aria-busy': true }, t('readingDiagnostics'))
          : props.sessionId === '' ? h('p', { className: 'dsh-bc-caption', 'data-bc': 'status-empty' }, t('statusEmpty'))
          : h(React.Fragment, null,
            h('p', { className: 'dsh-bc-caption', 'data-bc': 'engine-note' }, engineNote(props.engine)),
            h(RuntimeBudget, props),
            h('div', { className: 'dsh-bc-budget-view' }, h('h4', { className: 'dsh-bc-h4' }, t('lastCompaction')),
              h(LastCompaction, { record: props.record, emptyText: t('noCompaction') })),
            props.continuation ? h('div', { className: 'dsh-bc-continuation', 'data-bc': 'handoff-continuation' },
              h('h4', { className: 'dsh-bc-h4' }, t('handoffContinuation')),
              h('p', { className: 'dsh-bc-note' }, props.continuation.status === 'scheduled' ? t('continuationScheduled') : t('continuationSkipped')),
              props.continuation.blockers?.length ? h('ul', { className: 'dsh-bc-bullets' }, props.continuation.blockers.map((item, index) => h('li', { key: index }, item))) : null) : null,
            reasons.length ? h(Explain, { title: t('diagnosticsDetails', { count: reasons.length }) }, h(ReasonList, { reasons })) : null))
    }

    function SessionPicker(props) {
      const id = 'dsh-bc-session-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
      return h('div', { className: 'dsh-bc-session', 'data-bc': 'session-picker' },
        h('label', { id: id + '-label', htmlFor: id, className: 'dsh-bc-label' }, t('session')),
        h(Select, { id, name: 'inspectSession', 'aria-labelledby': id + '-label', value: props.selectedId,
          disabled: props.phase === 'pending' || props.entries.length === 0,
          onChange: (event) => props.onSelect(event.target.value), title: t('selectSessionTitle') },
          h('option', { value: '' }, props.phase === 'pending' ? t('loadingSessions') : props.entries.length === 0 ? t('noSessions') : t('selectSession')),
          props.entries.map((entry) => h('option', { key: entry.id, value: entry.id }, entry.title + (entry.running ? t('runningSuffix') : '')))),
        h('button', { type: 'button', className: 'dsh-bc-btn', onClick: props.onRefresh, disabled: props.refresh, 'aria-busy': props.refresh, 'aria-label': t('refreshDiagnostics') }, props.refresh ? t('reading') : t('refresh')),
        props.listError ? h('span', { className: 'dsh-bc-error' }, t('sessionListFailed')) : null)
    }

    function ActiveConfigBanner(props) {
      const active = props.activeConfig
      if (props.requiresReload !== true) return null
      return h('div', { className: 'dsh-bc-banner', 'data-bc': 'active-config', 'data-requires-reload': String(props.requiresReload) },
        h('span', { className: 'dsh-bc-chip', 'data-tone': 'accent' }, t('activeDiffers')),
        h(Explain, { title: t('viewActiveConfig') },
          active ? h('div', { className: 'dsh-bc-status-grid' },
            h(Row, { label: t('runtimeMode'), value: MODE_META[active.mode] ? t(MODE_META[active.mode].labelKey) : active.mode }),
            h(Row, { label: t('runtimeSummaryModel'), value: active.summarizationProvider ? active.summarizationProvider + '/' + active.summarizationModel : t('followSession'), mono: true }),
            h(Row, { label: t('runtimeThreshold'), value: ratioText(active.thresholdRatio) }),
            h(Row, { label: t('runtimeRetain'), value: active.retainTokens != null ? tokensText(active.retainTokens) : ratioText(active.retainRatio) })) : null))
    }

    function SaveFooter(props) {
      const [discardTarget, setDiscardTarget] = useState(null)
      const discardArmed = discardTarget === props.draft
      const saving = props.saving || props.saveState.kind === 'saving'
      const disabled = props.disabled || saving || props.conflict || !props.writable || !props.dirty || props.errors.length > 0
      const failure = props.saveState.kind === 'transport' ? t('saveFailed', { message: props.saveState.message })
        : props.saveState.kind === 'rejected' ? t('saveRejected')
        : props.conflict ? t('saveConflict') : null
      if (!props.dirty && !props.conflict) return null
      return h('footer', { className: 'dsh-bc-footer', 'data-bc': 'save-footer', 'aria-busy': saving },
        h('div', { className: 'dsh-bc-footer-copy' },
          failure ? h('p', { className: 'dsh-bc-error', role: 'alert', 'data-bc': props.conflict ? 'revision-conflict' : props.saveState.kind === 'rejected' ? 'save-rejected' : 'save-transport' }, failure)
            : h('p', { className: 'dsh-bc-note', role: 'status', 'data-bc': !props.writable ? 'read-only' : props.saveState.kind === 'saved' ? 'save-saved' : 'save-status' },
              !props.writable ? t('readOnlyConfig') : t('saveChanges', { count: props.changeCount })),
          props.errors.length ? h(Explain, { title: t('fixErrors', { count: props.errors.length }), open: true },
            h('ul', { className: 'dsh-bc-reasons' }, props.errors.map((message, index) => h('li', { key: index }, message)))) : null),
        h('div', { className: 'dsh-bc-actions' },
          h('button', { type: 'button', className: 'dsh-bc-btn', onClick: () => { if (props.changeCount > 3 && !discardArmed) setDiscardTarget(props.draft); else props.onReload() }, disabled: saving || (!props.dirty && !props.conflict) }, discardArmed ? t('discardAgain') : props.conflict ? t('reload') : t('discard')),
          h('button', { type: 'button', className: 'dsh-bc-btn dsh-bc-btn-primary', onClick: props.onSave, disabled, 'data-bc': 'save-button', 'aria-busy': saving }, saving ? t('saving') : t('save'))))
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
      const draftRoute = draft === null ? undefined : routeForDraft(draft, routes) ?? (draft.provider === '' && budget?.target ? routes.find((entry) => entry.provider === budget.target.provider && entry.model === budget.target.model) : undefined)
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

      useEffect(() => {
        if (saveState.kind !== 'saved' || typeof setTimeout !== 'function') return
        const timer = setTimeout(() => setSaveState({ kind: 'idle' }), 4000)
        return () => clearTimeout(timer)
      }, [saveState.kind])

      const refresh = () => setRefreshToken((token) => token + 1)
      const sessionControl = h(SessionPicker, { entries, selectedId, onSelect: setPickedId,
        phase: sessionList?.phase ?? 'ready', listError: sessionList?.error, refresh: inspectLoading, onRefresh: refresh })
      const statusProps = { sessionId: selectedId, engine, engineApplies, activeConfig, budget, preview,
        record: lastCompaction, continuation: handoffContinuation, diagnostics, inspectError, inspectLoading, sessionControl,
        reasons: preview?.reason && !diagnostics.includes(preview.reason) ? [preview.reason] : [] }

      const pageStyle = h('style', { key: 'dsh-bc-style' }, STYLE)
      const title = h(
        'div',
        { className: 'dsh-bc-page-head', key: 'head' },
        h('h2', { className: 'dsh-bc-title' }, t('title')),
        h('div', { className: 'dsh-bc-page-chips' },
          formStatus === 'ready' && !writable ? h('span', { className: 'dsh-bc-chip', 'data-bc': 'read-only-chip' }, t('readOnly')) : null),
      )

      if (formStatus === 'missing' || formStatus === 'loading') {
        return h(
          'div',
          { className: 'dsh-bc-page', 'data-better-compact': 'page', 'data-settings-dirty': dirty, 'data-settings-busy': savingNow },
          pageStyle,
          title,
          h('div', { className: 'dsh-bc-section' }, h('p', { className: 'dsh-bc-note', role: 'status' }, formStatus === 'loading' ? t('loadingConfig') : t('waitingForm'))),
        )
      }

      if (formStatus !== 'ready' || state === null || state === undefined) {
        return h(
          'div',
          { className: 'dsh-bc-page', 'data-better-compact': 'page', 'data-settings-dirty': dirty, 'data-settings-busy': savingNow },
          pageStyle,
          title,
          h(
            'div',
            { className: 'dsh-bc-section' },
            h('p', { className: 'dsh-bc-note', 'data-bc': 'form-unavailable' }, t('formUnavailable')),
            h(ActiveConfigBanner, { activeConfig, requiresReload, dirty }),
          ),
          h(StatusSection, statusProps),
        )
      }

      const disabled = !writable || savingNow || formStatus !== 'ready'

      return h(
        'div',
        { className: 'dsh-bc-page', 'data-better-compact': 'page', 'data-settings-dirty': dirty, 'data-settings-busy': savingNow },
        pageStyle,
        title,
        h(ActiveConfigBanner, { activeConfig, requiresReload, dirty }),
        h(ModeCards, {
          value: draft === null ? '' : draft.mode,
          disabled,
          onChange: (mode) => updateDraft({ mode }),
        }),
        h('div', { className: 'dsh-bc-workbench', 'data-has-preview': Boolean(draft?.auto) },
          h('div', { className: 'dsh-bc-main' },
        h(BudgetSection, { draft: draft ?? draftFromValue({}), disabled, fieldError, onDraft: updateDraft,
          onRetentionMode: (retainMode) => updateDraft({ retainMode }) }),
        h(ModelSection, {
          draft: draft ?? draftFromValue({}),
          routes,
          modelsStatus: modelsInspect.status,
          modelsEnabled,
          modelsError,
          route: draftRoute,
          target: budget?.target,
          routeWarning,
          disabled,
          fieldError,
          onDraft: updateDraft,
          onProvider: (value) => updateDraft(value === '' ? { provider: '', model: '' } : { provider: value }),
          onModel: (value) => updateDraft(value === '' ? { provider: '', model: '' } : { model: value }),
        }),
        h(AdvancedSection, { draft: draft ?? draftFromValue({}), disabled, fieldError, onDraft: updateDraft })),
          draft?.auto ? h('aside', { className: 'dsh-bc-rail', 'aria-label': t('draftBudget') },
            projection ? h(DraftBudget, { projection, budget, preview })
              : h('div', { className: 'dsh-bc-budget-view' }, h('h4', { className: 'dsh-bc-h4' }, t('draftBudget')),
                h('p', { className: 'dsh-bc-caption', 'data-bc': 'budget-incomplete' },
                  draftErrors.length ? t('budgetIncomplete') : engineApplies === false ? t('budgetForeignEngine')
                    : inspectLoading ? t('budgetLoading') : inspectError ? t('budgetError') : selectedId === '' ? t('budgetNoSession')
                      : t('budgetUnknown')))) : null),
        h(StatusSection, statusProps),
        saveState.kind === 'saved' ? h('p', { className: 'dsh-bc-save-feedback', role: 'status', 'data-bc': 'save-saved' }, t('saved')) : null,
        h(SaveFooter, {
          draft,
          changeCount: draft === null ? 0 : Object.keys(draft).filter((key) => JSON.stringify(draft[key]) !== JSON.stringify(currentDraft[key])).length,
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
        return h('span', { 'data-better-compact': 'summary' }, t('summary'))
      }
      return h(BetterCompactPage, { form: props.form, sessions: props.sessions ?? null })
    }

    /** Bind the Host sessions service once, for the registered page component. */
    function createConfigEntry(sessions) {
      return function BoundBetterCompactConfigEntry(props) {
        if (props.view === 'summary') {
          return h('span', { 'data-better-compact': 'summary' }, t('summary'))
        }
        return h(BetterCompactPage, { form: props.form, sessions })
      }
    }

    // ── host theme styles ─────────────────────────────────────────────────

    const STYLE = `

/* Flat settings surface; all borders are 1px solid, no gradients or shadows outside overlays. */
.dsh-bc-page{--cfg-text:var(--dsw-alias-label-primary);--cfg-muted:var(--dsw-alias-label-secondary);--cfg-subtle:color-mix(in srgb,var(--dsw-alias-label-tertiary) 80%,var(--dsw-alias-label-primary));--cfg-canvas:var(--dsw-alias-bg-layer-1);--cfg-raised:var(--dsw-alias-bg-layer-2);--cfg-overlay:var(--dsw-alias-bg-layer-3);--cfg-sunken:color-mix(in srgb,var(--cfg-text) 4%,var(--cfg-canvas));--cfg-line:var(--dsw-alias-border-l1);--cfg-line-2:var(--dsw-alias-border-l2);--cfg-line-3:var(--dsw-alias-border-l3);--cfg-accent:#3388bb;--cfg-accent-text:#14587f;--cfg-accent-soft:color-mix(in srgb,var(--cfg-accent) 10%,transparent);--cfg-solid:#20709e;--cfg-on-accent:#fff;--cfg-danger:var(--dsw-alias-state-error-primary);--cfg-warn:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 60%,var(--dsw-alias-label-primary));--cfg-hover:var(--dsw-alias-interactive-bg-hover);--cfg-r-sm:6px;--cfg-r-md:8px;--cfg-r-lg:10px;--cfg-r-xl:12px;--cfg-control:32px;--cfg-control-sm:28px;--cfg-dur:140ms;display:flex;flex-direction:column;gap:24px;width:100%;max-width:920px;margin:0 auto;min-width:0;color:var(--cfg-text);font-size:13px;line-height:20px;font-variant-numeric:tabular-nums;container-type:inline-size;container-name:better-compact;overflow-wrap:anywhere;color-scheme:inherit}
.dsh-bc-page *{box-sizing:border-box}
.dsh-bc-page :is(button,input){appearance:none}
[data-ds-dark-theme] .dsh-bc-page{--cfg-accent:#4eb0e8;--cfg-solid:#4eb0e8;--cfg-accent-text:#6fc0ee;--cfg-on-accent:#0e1014;--cfg-accent-soft:color-mix(in srgb,var(--cfg-accent) 14%,transparent)}
.dsh-bc-page-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
.dsh-bc-page-chips{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}
.dsh-bc-title{margin:0;font-size:20px;line-height:28px;font-weight:500;letter-spacing:-.01em}
.dsh-bc-chip{display:inline-flex;align-items:center;min-height:20px;padding:0 8px;border:1px solid var(--cfg-line-2);border-radius:999px;background:var(--cfg-raised);color:var(--cfg-muted);font-size:11px;line-height:18px;white-space:nowrap}
.dsh-bc-chip[data-tone=accent]{border-color:color-mix(in srgb,var(--cfg-accent) 35%,var(--cfg-line-2));background:var(--cfg-accent-soft);color:var(--cfg-accent-text)}
.dsh-bc-section{display:flex;flex-direction:column;gap:4px;min-width:0;padding-top:12px;border-top:1px solid var(--cfg-line-2)}
.dsh-bc-section-head,.dsh-bc-subhead{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;min-width:0}
.dsh-bc-section-head{padding-bottom:8px;border-bottom:1px solid var(--cfg-line);margin-bottom:2px}
.dsh-bc-h3,.dsh-bc-h4{margin:0;font-size:12px;line-height:18px;font-weight:500;color:var(--cfg-subtle);letter-spacing:.02em}
.dsh-bc-h4{font-size:13px;color:var(--cfg-text)}
.dsh-bc-caption,.dsh-bc-help{margin:0;font-size:12px;line-height:18px;color:var(--cfg-subtle)}
.dsh-bc-note{margin:0;font-size:12px;line-height:18px;color:var(--cfg-muted)}
.dsh-bc-hint{margin:0;font-size:12px;line-height:18px;color:var(--cfg-subtle)}
.dsh-bc-error{margin:0;font-size:12px;line-height:18px;color:var(--cfg-danger);overflow-wrap:anywhere}
.dsh-bc-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
.dsh-bc-strong{font-weight:500}
.dsh-bc-mono{font-variant-numeric:tabular-nums;font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace)}
.dsh-bc-modes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.dsh-bc-mode{display:flex;flex-direction:column;gap:8px;min-width:0;padding:12px;border:1px solid var(--cfg-line-2);border-radius:var(--cfg-r-lg);background:var(--cfg-raised);color:var(--cfg-text);cursor:pointer;transition:background-color var(--cfg-dur) ease,border-color var(--cfg-dur) ease}
.dsh-bc-mode:hover:not([aria-disabled=true]){background:color-mix(in srgb,var(--cfg-text) 3%,var(--cfg-raised))}
.dsh-bc-mode[aria-checked=true]{border-color:var(--cfg-accent);background:var(--cfg-accent-soft)}
.dsh-bc-mode[aria-disabled=true],.dsh-bc-page :disabled{opacity:.4;cursor:not-allowed}
.dsh-bc-mode-head{display:flex;align-items:center;gap:8px;min-width:0}
.dsh-bc-mode-title{font-size:13px;line-height:20px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-bc-radio-dot{display:block;position:relative;flex:none;width:14px;height:14px;border:1px solid var(--cfg-line-3);border-radius:50%}
.dsh-bc-mode[aria-checked=true] .dsh-bc-radio-dot{border-color:var(--cfg-accent)}
.dsh-bc-mode[aria-checked=true] .dsh-bc-radio-dot:after{content:"";position:absolute;inset:3px;border-radius:50%;background:var(--cfg-accent)}
.dsh-bc-mode-description{margin:0;color:var(--cfg-muted);font-size:12px;line-height:18px;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}
.dsh-bc-diagram-wrap{min-width:0;margin-top:auto}
.dsh-bc-diagram{display:block;width:100%;max-width:180px;height:auto;margin:8px auto 0;color:var(--cfg-subtle)}
.dsh-bc-diagram text{fill:currentColor;font-family:inherit;font-size:11px}
.dsh-bc-mode[aria-checked=true] .dsh-bc-diagram{color:var(--cfg-accent-text)}
.dsh-bc-node{fill:var(--cfg-sunken);stroke:var(--cfg-line-2);stroke-width:1}
.dsh-bc-node-strong{fill:var(--cfg-raised);stroke:var(--cfg-line-3)}
.dsh-bc-node-accent{fill:var(--cfg-accent-soft);stroke:var(--cfg-accent)}
.dsh-bc-node-dashed{stroke:var(--cfg-line-3)}
.dsh-bc-edge{stroke:currentColor;stroke-width:1;fill:none}
.dsh-bc-strategy-foot{margin-top:2px}
.dsh-bc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px}
.dsh-bc-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.dsh-bc-setting-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:10px 0;border-bottom:1px solid var(--cfg-line)}
.dsh-bc-setting-row:last-child{border-bottom:0}
.dsh-bc-setting-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.dsh-bc-setting-label{font-size:13px;line-height:20px;font-weight:500;color:var(--cfg-text)}
.dsh-bc-setting-desc{font-size:12px;line-height:18px;color:var(--cfg-subtle)}
.dsh-bc-setting-control{display:flex;align-items:center;gap:8px;flex:none}
.dsh-bc-threshold{display:flex;flex-direction:column;gap:4px}
.dsh-bc-thresholdHead{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
.dsh-bc-number{position:relative;min-width:0}
.dsh-bc-number .dsh-bc-input{padding-right:24px;appearance:textfield}
.dsh-bc-number input::-webkit-inner-spin-button,.dsh-bc-number input::-webkit-outer-spin-button{appearance:none;margin:0}
.dsh-bc-number-inline{flex:none;width:76px}
.dsh-bc-number-inline .dsh-bc-input{height:28px;text-align:right}
.dsh-bc-unit{position:absolute;right:8px;top:5px;pointer-events:none;color:var(--cfg-subtle);font-size:11px;line-height:18px}
.dsh-bc-switch{appearance:none;position:relative;flex:none;width:34px;height:20px;margin:0;padding:0;border:1px solid var(--cfg-line-3);border-radius:999px;background:var(--cfg-sunken);cursor:pointer;transition:background-color var(--cfg-dur) ease,border-color var(--cfg-dur) ease}
.dsh-bc-switch:before{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--cfg-muted);transition:transform var(--cfg-dur) ease,background-color var(--cfg-dur) ease}
.dsh-bc-switch:checked{border-color:var(--cfg-solid);background:var(--cfg-solid)}
.dsh-bc-switch:checked:before{background:var(--cfg-on-accent);transform:translateX(14px)}
.dsh-bc-range-wrap{position:relative;display:flex;align-items:center;height:28px;min-width:0}
.dsh-bc-range-wrap:before{content:"";position:absolute;left:0;right:0;top:12px;height:4px;border-radius:2px;background:var(--cfg-line)}
.dsh-bc-range-fill{position:absolute;left:0;top:12px;height:4px;border-radius:2px;background:var(--cfg-accent)}
.dsh-bc-range{appearance:none;position:relative;z-index:1;display:block;width:100%;height:28px;margin:0;background:transparent;cursor:pointer}
.dsh-bc-range::-webkit-slider-runnable-track{height:4px;background:transparent}
.dsh-bc-range::-moz-range-track{height:4px;background:transparent}
.dsh-bc-range::-webkit-slider-thumb{appearance:none;width:14px;height:14px;margin-top:-5px;border:2px solid var(--cfg-accent);border-radius:50%;background:var(--cfg-raised)}
.dsh-bc-range::-moz-range-thumb{width:10px;height:10px;border:2px solid var(--cfg-accent);border-radius:50%;background:var(--cfg-raised)}
.dsh-bc-scale{display:flex;justify-content:space-between;font-size:11px;line-height:16px;color:var(--cfg-subtle)}
.dsh-bc-label{font-size:12px;font-weight:500;line-height:18px;color:var(--cfg-muted)}
.dsh-bc-input,.dsh-bc-btn{height:var(--cfg-control);min-width:0;border:1px solid var(--cfg-line-2);border-radius:var(--cfg-r-md);background:var(--cfg-raised);color:var(--cfg-text);font:inherit;line-height:20px}
.dsh-bc-input{width:100%;padding:0 9px;transition:border-color var(--cfg-dur) ease}
.dsh-bc-input:hover:not(:disabled){border-color:var(--cfg-line-3)}
.dsh-bc-input:focus-visible{border-color:var(--cfg-accent);outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--cfg-accent));outline-offset:1px}
.dsh-bc-input[aria-invalid=true]{border-color:var(--cfg-danger)}
.dsh-bc-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:0 12px;white-space:nowrap;cursor:pointer;font-weight:500;transition:background-color var(--cfg-dur) ease,border-color var(--cfg-dur) ease}
.dsh-bc-btn:hover:not(:disabled){background:var(--cfg-hover)}
.dsh-bc-btn:active:not(:disabled){background:color-mix(in srgb,var(--cfg-text) 6%,var(--cfg-raised))}
.dsh-bc-btn-primary{border-color:transparent;background:var(--cfg-solid);color:var(--cfg-on-accent)}
.dsh-bc-btn-primary:hover:not(:disabled){background:color-mix(in srgb,var(--cfg-solid) 88%,var(--cfg-text))}
.dsh-bc-btn-remove:hover:not(:disabled){color:var(--cfg-danger)}
.dsh-bc-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;min-width:0;padding:6px 0;border-bottom:1px solid var(--cfg-line)}
.dsh-bc-row:last-child{border-bottom:0}
.dsh-bc-row-label{min-width:0;color:var(--cfg-muted);font-size:12px}
.dsh-bc-row-value{min-width:0;text-align:right;font-size:12px;overflow-wrap:anywhere}
.dsh-bc-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;min-width:0}
.dsh-bc-metric{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-bc-metric-value{font-size:13px;line-height:20px;font-weight:500;overflow-wrap:anywhere}
.dsh-bc-budget-view{display:flex;flex-direction:column;gap:10px;min-width:0}
.dsh-bc-retention{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:12px 16px;align-items:start;min-width:0}
.dsh-bc-composition{display:flex;flex-direction:column;gap:8px;min-width:0}
.dsh-bc-bar{position:relative;min-width:0;height:20px;border:1px solid var(--cfg-line-2);border-radius:4px;overflow:hidden;background:var(--cfg-sunken)}
.dsh-bc-bar-track{display:flex;width:100%;height:100%}
.dsh-bc-bar-seg{flex:none;height:100%;border-right:1px solid var(--cfg-line)}
.dsh-bc-seg-fixed,.dsh-bc-swatch-fixed{background:var(--cfg-subtle);opacity:.45}
.dsh-bc-seg-history,.dsh-bc-swatch-history{background:var(--cfg-accent);opacity:.3}
.dsh-bc-seg-tail,.dsh-bc-swatch-tail{background:var(--cfg-accent)}
.dsh-bc-seg-summary,.dsh-bc-swatch-summary{background:var(--cfg-accent);opacity:.6}
.dsh-bc-seg-headroom,.dsh-bc-swatch-headroom{background:var(--cfg-line-3);opacity:.8}
.dsh-bc-seg-free{background:transparent}
.dsh-bc-trigger,.dsh-bc-current-line{position:absolute;top:0;bottom:0;pointer-events:none;max-width:100%;transform:translateX(-1px);border-left:2px solid var(--cfg-text)}
.dsh-bc-current-line{border-left:1px solid var(--cfg-text)}
.dsh-bc-legend{display:flex;flex-wrap:wrap;gap:4px 12px;margin:0;padding:0;list-style:none;color:var(--cfg-subtle);font-size:11px;line-height:18px}
.dsh-bc-legend li{display:flex;align-items:center;gap:6px;min-width:0}
.dsh-bc-swatch{display:block;flex:none;width:10px;height:10px;border:1px solid var(--cfg-line-2);border-radius:2px}
.dsh-bc-retain-choice{display:flex;flex-direction:column;gap:6px;min-width:0;margin:0;padding:0;border:0}
.dsh-bc-retain-choice legend{margin:0 0 6px;padding:0}
.dsh-bc-segmented{display:flex;gap:2px;height:32px;padding:2px;border:1px solid var(--cfg-line-2);border-radius:var(--cfg-r-md);background:var(--cfg-sunken)}
.dsh-bc-segment{position:relative;display:flex;align-items:center;justify-content:center;flex:1;min-width:0;padding:0 8px;border-radius:var(--cfg-r-sm);color:var(--cfg-muted);font-size:12px;line-height:20px;cursor:pointer;white-space:nowrap}
.dsh-bc-segment input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:inherit}
.dsh-bc-segment:hover{background:var(--cfg-hover)}
.dsh-bc-segment[data-checked=true]{background:var(--cfg-raised);box-shadow:inset 0 0 0 1px var(--cfg-line-2);color:var(--cfg-accent-text);font-weight:500}
.dsh-bc-segment:has(input:focus-visible){outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--cfg-accent));outline-offset:2px}
.dsh-bc-segment:has(input:disabled){opacity:.4;cursor:not-allowed}
.dsh-bc-explanation{min-width:0;font-size:12px;line-height:18px}
.dsh-bc-explanation>summary{display:flex;align-items:center;gap:8px;min-height:28px;width:fit-content;padding:0;color:var(--cfg-muted);cursor:pointer;list-style:none}
.dsh-bc-explanation>summary::-webkit-details-marker{display:none}
.dsh-bc-explanation>summary:before{content:"";flex:none;width:5px;height:5px;border-right:1px solid currentColor;border-bottom:1px solid currentColor;transform:rotate(-45deg)}
.dsh-bc-explanation[open]>summary:before{transform:translateY(-2px) rotate(45deg)}
.dsh-bc-explanation-body{display:flex;flex-direction:column;gap:8px;padding-top:8px;min-width:0}
.dsh-bc-details{min-width:0;border-top:1px solid var(--cfg-line-2);padding-top:12px}
.dsh-bc-details>summary{display:flex;align-items:center;gap:8px;min-height:28px;padding:0;font-size:12px;line-height:18px;font-weight:500;color:var(--cfg-subtle);cursor:pointer;list-style:none}
.dsh-bc-details>summary::-webkit-details-marker{display:none}
.dsh-bc-details>summary:before{content:"";flex:none;width:5px;height:5px;border-right:1px solid currentColor;border-bottom:1px solid currentColor;transform:rotate(-45deg)}
.dsh-bc-details[open]>summary:before{transform:translateY(-2px) rotate(45deg)}
.dsh-bc-details-body,.dsh-bc-policy-body{display:flex;flex-direction:column;gap:16px;min-width:0;padding-top:12px}
.dsh-bc-policy{min-width:0;border-top:1px solid var(--cfg-line)}
.dsh-bc-policy>summary{padding:10px 0;font-size:12px;overflow-wrap:anywhere;cursor:pointer}
.dsh-bc-policy-body{padding-top:4px;padding-bottom:12px}
.dsh-bc-status-record{display:flex;flex-direction:column;gap:8px;min-width:0}
.dsh-bc-status-line{margin:0;font-size:12px;font-weight:500;line-height:18px}
.dsh-bc-status-failed,.dsh-bc-status-persistence-error{color:var(--cfg-danger)}
.dsh-bc-status-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 16px}
.dsh-bc-continuation{display:flex;flex-direction:column;gap:6px;min-width:0}
.dsh-bc-reasons,.dsh-bc-bullets{display:flex;flex-direction:column;gap:4px;margin:0;padding-left:18px;color:var(--cfg-muted);font-size:12px;line-height:18px}
.dsh-bc-reasons li{min-width:0;overflow-wrap:anywhere}
.dsh-bc-session{display:flex;align-items:center;gap:8px;min-width:0;width:100%}
.dsh-bc-session .dsh-bc-label{flex:none}
.dsh-bc-session .dsh-bc-select{flex:1;min-width:0}
.dsh-bc-banner{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;min-width:0;padding:8px 0;border-top:1px solid var(--cfg-line-2)}
.dsh-bc-banner .dsh-bc-chip{white-space:normal;max-width:100%;height:auto;min-height:20px;padding:2px 8px;border-radius:var(--cfg-r-sm);line-height:16px}
.dsh-bc-banner-title{font-size:12px;line-height:18px;color:var(--cfg-muted)}
.dsh-bc-runtime{display:flex;flex-direction:column;gap:12px;min-width:0}
.dsh-bc-preview{display:flex;flex-direction:column;gap:8px;padding-top:12px;border-top:1px solid var(--cfg-line);min-width:0}
.dsh-bc-preview-arrow{height:16px;line-height:16px;text-align:center;color:var(--cfg-subtle)}
.dsh-bc-preview-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;padding-top:8px;border-top:1px solid var(--cfg-line);font-size:12px;line-height:18px;color:var(--cfg-muted)}
.dsh-bc-preview-line .dsh-bc-preview-arrow{height:auto;line-height:18px;color:var(--cfg-subtle)}
.dsh-bc-workbench{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;align-items:start;min-width:0}
.dsh-bc-workbench[data-has-preview=true]{grid-template-columns:minmax(0,1fr) 280px}
.dsh-bc-main{display:flex;flex-direction:column;gap:12px;min-width:0}
.dsh-bc-rail{position:sticky;top:0;min-width:0}
.dsh-bc-rail .dsh-bc-budget-view{padding:12px;border:1px solid var(--cfg-line-2);border-radius:var(--cfg-r-lg);background:var(--cfg-raised)}
.dsh-bc-rail .dsh-bc-metrics{grid-template-columns:1fr;gap:6px}
.dsh-bc-rail .dsh-bc-metric{flex-direction:row;align-items:baseline;justify-content:space-between;gap:8px}
.dsh-bc-rail .dsh-bc-legend{gap:4px 12px}
.dsh-bc-footer{position:sticky;bottom:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--cfg-line-2);background:var(--cfg-canvas);margin-top:auto}
.dsh-bc-footer-copy{display:flex;flex:1;flex-direction:column;gap:6px;min-width:0}
.dsh-bc-actions{display:flex;gap:8px;margin-left:auto}
.dsh-bc-save-feedback{position:sticky;bottom:8px;align-self:flex-end;margin:0;padding:6px 10px;border:1px solid var(--cfg-line-2);border-radius:var(--cfg-r-sm);background:var(--cfg-raised);color:var(--cfg-muted);font-size:12px;line-height:18px}
.dsh-bc-select{position:relative;width:100%;min-width:0;font:inherit}
.dsh-bc-select-trigger{display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;cursor:pointer}
.dsh-bc-select-trigger[aria-expanded=true]{border-color:var(--cfg-accent)}
.dsh-bc-select-value{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-bc-chevron{flex:none;width:6px;height:6px;margin-right:2px;border-right:1px solid currentColor;border-bottom:1px solid currentColor;color:var(--cfg-muted);transform:translateY(-2px) rotate(45deg);transition:transform var(--cfg-dur) ease}
.dsh-bc-select-trigger[aria-expanded=true] .dsh-bc-chevron{transform:translateY(2px) rotate(225deg)}
.dsh-bc-select-menu{position:absolute;z-index:40;top:calc(100% + 4px);left:0;right:0;min-width:0;overflow:auto;overscroll-behavior:contain;padding:4px;border:1px solid var(--cfg-line-3);border-radius:var(--cfg-r-lg);background:var(--cfg-overlay);font:inherit;box-shadow:0 18px 44px -18px rgb(0 0 0 / .32)}
.dsh-bc-select-menu[data-side=above]{top:auto;bottom:calc(100% + 4px)}
.dsh-bc-select-option{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:30px;padding:4px 8px;border-radius:var(--cfg-r-sm);cursor:pointer;overflow-wrap:anywhere}
.dsh-bc-select-option[data-active=true]{background:var(--cfg-hover)}
.dsh-bc-select-option[aria-selected=true]{background:var(--cfg-accent-soft);color:var(--cfg-accent-text)}
.dsh-bc-option-check{flex:none;width:12px;color:var(--cfg-accent-text)}
.dsh-bc-page :is(button,input,summary,[role=combobox],[role=radio]):focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--cfg-accent));outline-offset:2px}
@container better-compact (max-width:860px){.dsh-bc-workbench[data-has-preview=true]{grid-template-columns:minmax(0,1fr)}.dsh-bc-rail{position:static;max-height:none;overflow:visible}}
@container better-compact (max-width:640px){.dsh-bc-modes{grid-template-columns:1fr}.dsh-bc-setting-row{align-items:stretch;flex-direction:column;gap:8px}.dsh-bc-setting-control{width:100%}.dsh-bc-grid,.dsh-bc-status-grid,.dsh-bc-retention{grid-template-columns:1fr}.dsh-bc-metrics{grid-template-columns:1fr;gap:6px}.dsh-bc-metric{flex-direction:row;align-items:baseline;justify-content:space-between;gap:12px}.dsh-bc-session{flex-wrap:wrap}.dsh-bc-session .dsh-bc-label{flex-basis:100%}.dsh-bc-footer-copy{flex-basis:100%}.dsh-bc-actions{margin-left:auto}}
@container better-compact (max-width:560px){.dsh-bc-title{font-size:18px;line-height:26px}.dsh-bc-modes{grid-template-columns:1fr}.dsh-bc-mode{display:flex;flex-direction:column}.dsh-bc-diagram-wrap{display:none}.dsh-bc-grid,.dsh-bc-status-grid,.dsh-bc-retention{grid-template-columns:1fr}.dsh-bc-metrics{grid-template-columns:1fr;gap:6px}.dsh-bc-metric{flex-direction:row;align-items:baseline;justify-content:space-between;gap:12px}.dsh-bc-section{padding-top:10px}.dsh-bc-setting-row{align-items:stretch;flex-direction:column;gap:8px}.dsh-bc-setting-control{width:100%}.dsh-bc-session{flex-wrap:wrap}.dsh-bc-session .dsh-bc-label{flex-basis:100%}.dsh-bc-footer-copy{flex-basis:100%}.dsh-bc-actions{margin-left:auto}.dsh-bc-details-body,.dsh-bc-policy-body{padding-top:10px}}
@media (prefers-reduced-motion:reduce){.dsh-bc-page *{transition:none!important;animation:none!important}}

`

    /** Services this client half consumes. */
    const inject = ['slots', 'sessions', 'locale']

    /** Register the same row page under every assembly key. */
    function apply(ctx) {
      bindLocale(ctx)
      const sessions = ctx.sessions ?? null
      const Entry = createConfigEntry(sessions)
      ctx.effect(
        () =>
          ctx.slots.inject(SLOT, () => {
            const disposers = ROW_KEYS.map((key) => ctx.slots.register({ name: SLOT, key, locale: NS }, Entry))
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
