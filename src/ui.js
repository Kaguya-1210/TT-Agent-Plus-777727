import { DISPLAY_NAME } from './constants.js';
import { filterCatalogEntries } from './worldInfoRuleEditor.js';

const CANONICAL_TABS = Object.freeze([
  Object.freeze({ id: 'overview', label: '总览', icon: 'fa-gauge-high' }),
  Object.freeze({ id: 'tasks', label: '任务', icon: 'fa-list-check' }),
  Object.freeze({ id: 'rules', label: '规则', icon: 'fa-wand-magic-sparkles' }),
  Object.freeze({ id: 'cache', label: '缓存', icon: 'fa-box-archive' }),
  Object.freeze({ id: 'debug', label: '调试', icon: 'fa-bug' }),
  Object.freeze({ id: 'settings', label: '设置', icon: 'fa-gear' })
]);
const DEFAULT_TAB = CANONICAL_TABS.find((tab) => tab.id === 'overview') ?? CANONICAL_TABS[0];
const PATCH_SUCCESS = Symbol('patch success');
const PATCH_INVALID_SHELL = Symbol('patch invalid shell');
const PATCH_FAILED_ROLLED_BACK = Symbol('patch failed and rolled back');

export function renderPanelHtml(state, debugEntries = []) {
  const safeState = normalizeState(state);
  const safeDebugEntries = records(debugEntries);
  const tabButtons = CANONICAL_TABS.map((tab) => {
    const active = tab.id === safeState.panel.activeTab ? ' aria-selected="true"' : ' aria-selected="false"';
    return `<button class="ttap-tab" data-tab="${escapeHtml(tab.id)}" type="button" role="tab"${active}><i class="ttap-tab-icon fa-solid ${tab.icon}" aria-hidden="true"></i><span>${escapeHtml(tab.label)}</span></button>`;
  }).join('');
  const hiddenAttr = safeState.panel.open ? '' : ' hidden';
  const theme = normalizeTheme(safeState.settings.theme);

  return [
    `<div class="ttap-backdrop" data-ttap-close${hiddenAttr}></div>`,
    `<aside class="ttap-panel" data-ttap-shell="v1" data-open="${safeState.panel.open ? 'true' : 'false'}" data-ttap-theme="${escapeHtml(theme)}" aria-label="${escapeHtml(DISPLAY_NAME)}">`,
    '<header class="ttap-header">',
    renderProductIdentity(),
    '<button class="ttap-icon-button ttap-mobile-close" type="button" data-ttap-close aria-label="关闭"><i class="fa-solid fa-xmark"></i></button>',
    '</header>',
    `<nav class="ttap-tabs" role="tablist" aria-label="主导航">${tabButtons}</nav>`,
    '<footer class="ttap-sidebar-footer">',
    `<span class="ttap-theme-state">${escapeHtml(themeLabel(theme))}</span>`,
    '<button class="ttap-icon-button ttap-desktop-close" type="button" data-ttap-close aria-label="关闭"><i class="fa-solid fa-xmark"></i></button>',
    '</footer>',
    '<header class="ttap-workspace-header">',
    `<span class="ttap-section-label">工作区</span><h1 data-workspace-title>${escapeHtml(activeTabLabel(safeState.panel.activeTab))}</h1>`,
    '</header>',
    `<section class="ttap-body" data-workspace-body>${renderActiveTab(safeState, safeDebugEntries)}</section>`,
    '</aside>'
  ].join('');
}

function activeTabLabel(activeTab) {
  return CANONICAL_TABS.find((tab) => tab.id === activeTab)?.label ?? DEFAULT_TAB.label;
}

function themeLabel(theme) {
  if (theme === 'light') return '浅色';
  if (theme === 'dark') return '深色';
  return '跟随系统';
}

function renderProductIdentity() {
  return [
    '<div class="ttap-product">',
    '<span class="ttap-product-kicker">TT Agent</span>',
    `<strong class="ttap-product-title">${escapeHtml(DISPLAY_NAME)}</strong>`,
    '</div>'
  ].join('');
}

export function mountPanel(options = {}) {
  const config = isRecord(options) ? options : {};
  const {
    documentRef,
    rootId = 'tt-agent-plus-727-root',
    getState,
    getDebugEntries,
    onTab,
    onClose,
    onApprove,
    onCancel,
    onManualDispatch,
    onCapturedDispatch,
    onExportDebug,
    onRuleView,
    onNewWorldInfoRule,
    onEditWorldInfoRule,
    onDeleteWorldInfoRule,
    onWorldInfoRuleSearch,
    onWorldInfoRuleSelectAll,
    onWorldInfoRuleInvert,
    onWorldInfoRuleToggleEntry,
    onWorldInfoRuleDraft,
    onSaveWorldInfoRule,
    onCancelWorldInfoRule,
    debug
  } = config;

  const emptyMount = () => ({ root: null, render: () => false });
  if (!isRecord(documentRef)) {
    return emptyMount();
  }
  const getElementById = safeProperty(documentRef, 'getElementById');
  if (typeof getElementById !== 'function') {
    return emptyMount();
  }

  let root;
  try {
    root = getElementById.call(documentRef, rootId);
  } catch (error) {
    warnDebug(debug, 'Unable to find panel root', error);
    return emptyMount();
  }

  if (!root) {
    const propertyAccessFailed = Symbol('property access failed');
    try {
      const createElement = safeProperty(documentRef, 'createElement', propertyAccessFailed);
      const body = safeProperty(documentRef, 'body', propertyAccessFailed);
      if (createElement === propertyAccessFailed || body === propertyAccessFailed
        || typeof createElement !== 'function' || !isRecord(body)) {
        return emptyMount();
      }

      root = createElement.call(documentRef, 'div');
      if (!isRecord(root)) return emptyMount();
      root.id = rootId;
      const append = safeProperty(body, 'append', propertyAccessFailed);
      if (append === propertyAccessFailed) return emptyMount();
      if (typeof append === 'function') {
        append.call(body, root);
      } else {
        const appendChild = safeProperty(body, 'appendChild', propertyAccessFailed);
        if (appendChild === propertyAccessFailed || typeof appendChild !== 'function') {
          return emptyMount();
        }
        appendChild.call(body, root);
      }
    } catch (error) {
      warnDebug(debug, 'Unable to create panel root', error);
      return emptyMount();
    }
  }

  const eventBindings = new WeakMap();
  let hasRendered = false;
  let ownedShell = null;
  let renderedActiveTab = null;

  function patchPanelShell(root, state, debugEntries) {
    const currentShell = captureOwnedPanelShell(root, debug);
    if (!ownedShell || !currentShell || !sameOwnedPanelShell(ownedShell, currentShell)) {
      return PATCH_INVALID_SHELL;
    }
    const { panel, backdrop, title, body, tabs } = currentShell;

    const themeState = safeQuery(root, '.ttap-theme-state', debug);

    let next;
    try {
      const theme = normalizeTheme(state.settings.theme);
      next = {
        open: state.panel.open ? 'true' : 'false',
        theme,
        activeTab: state.panel.activeTab,
        backdropHidden: !state.panel.open,
        title: activeTabLabel(state.panel.activeTab),
        themeLabel: themeLabel(theme),
        bodyHtml: renderActiveTab(state, debugEntries),
        tabs: tabs.map((tab, index) => ({
          node: tab,
          selected: String(CANONICAL_TABS[index].id === state.panel.activeTab)
        }))
      };
    } catch (error) {
      warnDebug(debug, 'Unable to calculate panel patch', error);
      return PATCH_FAILED_ROLLED_BACK;
    }

    const previous = capturePanelPatchState({ panel, backdrop, title, themeState, body, tabs }, debug);
    if (!previous) return PATCH_FAILED_ROLLED_BACK;
    const focusSnapshot = capturePanelFocus(documentRef, root);
    const scrollSnapshot = capturePanelScroll(body, debug);
    const bodyPatch = preparePanelBodyPatch(body, next.bodyHtml, previous.body, debug);
    if (!bodyPatch) return PATCH_FAILED_ROLLED_BACK;
    const panelDataset = safeDataset(panel);
    const previousActiveTab = renderedActiveTab ?? toText(safeProperty(panelDataset, 'activeTab'));
    const sameActiveTab = previousActiveTab === state.panel.activeTab;

    const rollbacks = [];
    const write = (writer, rollback) => applyPanelWrite(rollbacks, writer, rollback, debug);
    const failedPatch = () => {
      restorePanelFocus(root, focusSnapshot, debug);
      restorePanelScroll(body, scrollSnapshot, true, debug);
      return PATCH_FAILED_ROLLED_BACK;
    };
    if (!write(
      () => safeSetData(panel, 'open', 'data-open', next.open, debug),
      () => restoreDatasetState(previous.open, debug)
    )) return failedPatch();
    if (!write(
      () => safeSetData(panel, 'ttapTheme', 'data-ttap-theme', next.theme, debug),
      () => restoreDatasetState(previous.theme, debug)
    )) return failedPatch();
    if (!write(
      () => safeSetData(panel, 'activeTab', 'data-active-tab', next.activeTab, debug),
      () => restoreDatasetState(previous.activeTab, debug)
    )) return failedPatch();
    if (!write(
      () => safeSetProperty(backdrop, 'hidden', next.backdropHidden, debug),
      () => restorePropertyState(previous.backdrop, debug)
    )) return failedPatch();
    if (!write(
      () => safeSetProperty(title, 'textContent', next.title, debug),
      () => restorePropertyState(previous.title, debug)
    )) return failedPatch();
    if (themeState && !write(
      () => safeSetProperty(themeState, 'textContent', next.themeLabel, debug),
      () => restorePropertyState(previous.themeLabel, debug)
    )) return failedPatch();
    if (!write(
      bodyPatch.commit,
      bodyPatch.rollback
    )) return failedPatch();

    let activeTab = null;
    for (let index = 0; index < next.tabs.length; index += 1) {
      const tab = next.tabs[index];
      if (!write(
        () => safeSetAttribute(tab.node, 'aria-selected', tab.selected, debug),
        () => restoreAttributeState(previous.tabs[index], debug)
      )) {
        return failedPatch();
      }
      if (tab.selected === 'true') activeTab = tab.node;
    }

    restorePanelFocus(root, focusSnapshot, debug);
    safeScrollIntoView(activeTab, debug);
    restorePanelScroll(body, scrollSnapshot, sameActiveTab, debug);
    renderedActiveTab = state.panel.activeTab;
    return PATCH_SUCCESS;
  }

  function render() {
    const focusSnapshot = capturePanelFocus(documentRef, root);
    const state = safeNormalizeState(safeGet(getState, undefined, debug), debug);
    let debugEntries;
    try {
      debugEntries = records(safeGet(getDebugEntries, [], debug));
    } catch (error) {
      warnDebug(debug, 'Unable to normalize panel debug entries', error);
      return false;
    }
    let patchResult = PATCH_INVALID_SHELL;
    if (hasRendered) {
      try {
        patchResult = patchPanelShell(root, state, debugEntries);
      } catch (error) {
        warnDebug(debug, 'Unable to patch panel shell', error);
        patchResult = PATCH_FAILED_ROLLED_BACK;
      }
    }

    const patchFailed = hasRendered && patchResult === PATCH_FAILED_ROLLED_BACK;
    if (!hasRendered || patchResult === PATCH_INVALID_SHELL) {
      try {
        root.innerHTML = renderPanelHtml(state, debugEntries);
        hasRendered = true;
        ownedShell = captureOwnedPanelShell(root, debug);
        renderedActiveTab = state.panel.activeTab;
      } catch (error) {
        warnDebug(debug, 'Unable to render panel', error);
        return false;
      }
      restorePanelFocus(root, focusSnapshot, debug);
    }

    if (typeof safeProperty(root, 'querySelectorAll') !== 'function'
      || typeof safeProperty(root, 'querySelector') !== 'function') {
      warnDebug(debug, 'Panel root query APIs unavailable', new Error('querySelector APIs unavailable'));
      return false;
    }

    let bound = true;
    bound = bindEach(root, '[data-tab]', (button) => () => {
      safeInvoke(onTab, debug, safeDatasetValue(button, 'tab'));
    }, eventBindings, debug) && bound;
    bound = bindEach(root, '[data-ttap-close]', () => () => {
      safeInvoke(onClose, debug);
    }, eventBindings, debug) && bound;
    bound = bindEach(root, '[data-approve-task]', (button) => () => {
      safeInvoke(onApprove, debug, safeDatasetValue(button, 'approveTask'));
    }, eventBindings, debug) && bound;
    bound = bindEach(root, '[data-cancel-task]', (button) => () => {
      safeInvoke(onCancel, debug, safeDatasetValue(button, 'cancelTask'));
    }, eventBindings, debug) && bound;
    bound = bindEach(root, '[data-dispatch-manual]', () => () => {
      safeInvoke(onManualDispatch, debug, readManualDispatchPayload(root));
    }, eventBindings, debug) && bound;
    bound = bindEach(root, '[data-dispatch-captured]', () => () => {
      safeInvoke(onCapturedDispatch, debug, readCapturedDispatchPayload(root));
    }, eventBindings, debug) && bound;
    bound = bindOne(root, '[data-export-debug]', () => {
      safeInvoke(onExportDebug, debug);
    }, eventBindings, debug) && bound;
    bound = bindEach(root, '[data-rule-view]', (button) => () => {
      safeInvoke(onRuleView, debug, safeDatasetValue(button, 'ruleView'));
    }, eventBindings, debug) && bound;
    bound = bindEach(root, '[data-new-world-info-rule]', () => () => {
      safeInvoke(onNewWorldInfoRule, debug);
    }, eventBindings, debug) && bound;
    bound = bindEach(root, '[data-edit-world-info-rule]', (button) => () => {
      safeInvoke(onEditWorldInfoRule, debug, safeDatasetValue(button, 'editWorldInfoRule'));
    }, eventBindings, debug) && bound;
    bound = bindEach(root, '[data-delete-world-info-rule]', (button) => () => {
      safeInvoke(onDeleteWorldInfoRule, debug, safeDatasetValue(button, 'deleteWorldInfoRule'));
    }, eventBindings, debug) && bound;
    bound = bindEach(root, '[data-world-info-select-all]', () => () => {
      safeInvoke(onWorldInfoRuleSelectAll, debug);
    }, eventBindings, debug) && bound;
    bound = bindEach(root, '[data-world-info-invert]', () => () => {
      safeInvoke(onWorldInfoRuleInvert, debug);
    }, eventBindings, debug) && bound;
    bound = bindEach(root, '[data-save-world-info-rule]', () => () => {
      safeInvoke(onSaveWorldInfoRule, debug);
    }, eventBindings, debug) && bound;
    bound = bindEach(root, '[data-cancel-world-info-rule]', () => () => {
      safeInvoke(onCancelWorldInfoRule, debug);
    }, eventBindings, debug) && bound;
    bound = bindInputEach(root, '[data-world-info-search]', 'input', (input) => () => {
      safeInvoke(onWorldInfoRuleSearch, debug, readNodeValue(input));
    }, eventBindings, debug) && bound;
    bound = bindInputEach(root, '[data-world-info-entry]', 'change', (input) => () => {
      safeInvoke(onWorldInfoRuleToggleEntry, debug,
        safeDatasetValue(input, 'worldInfoEntry'), safeProperty(input, 'checked') === true);
    }, eventBindings, debug) && bound;
    bound = bindInputEach(root, '[data-world-info-rule-name]', 'input', (input) => () => {
      safeInvoke(onWorldInfoRuleDraft, debug, { name: readNodeValue(input) });
    }, eventBindings, debug) && bound;
    bound = bindEach(root, '[data-world-info-rule-mode]', (button) => () => {
      safeInvoke(onWorldInfoRuleDraft, debug, { mode: safeDatasetValue(button, 'worldInfoRuleMode') });
    }, eventBindings, debug) && bound;

    return patchFailed ? false : bound;
  }

  render();
  return { root, render };
}

function renderActiveTab(state, debugEntries) {
  if (state.panel.activeTab === 'tasks') {
    return renderTasks(state.tasks, state.settings, state.worldInfoCapture);
  }
  if (state.panel.activeTab === 'rules') return renderRules(state);
  if (state.panel.activeTab === 'cache') return renderCache(state.cacheEntries);
  if (state.panel.activeTab === 'debug') return renderDebug(debugEntries);
  if (state.panel.activeTab === 'settings') return renderSettings(state.settings);
  return renderOverview(state, debugEntries);
}

function renderOverview(state, debugEntries) {
  const queued = state.tasks.filter((task) => task.state === 'queued').length;
  const running = state.tasks.filter((task) => task.state === 'running').length;
  const awaiting = state.tasks.filter((task) => task.state === 'awaiting_approval').length;
  const completed = state.tasks.filter((task) => task.state === 'completed').length;
  const failed = state.tasks.filter((task) => task.state === 'failed').length;
  const lastInjection = isRecord(state.lastInjection) ? state.lastInjection : {};
  const injectionText = lastInjection.length > 0
    ? `已注入 ${toText(lastInjection.count)} 条`
    : '待注入';

  return [
    '<div class="ttap-overview-hero">',
    '<div>',
    '<span class="ttap-section-label">控制台</span>',
    '<h2>运行状态</h2>',
    '</div>',
    `<span class="ttap-live-pill">${running > 0 ? '处理中' : '待命'}</span>`,
    '</div>',
    '<div class="ttap-metrics">',
    metric('队列', queued),
    metric('运行中', running),
    metric('待确认', awaiting),
    metric('缓存', state.cacheEntries.length),
    '</div>',
    '<div class="ttap-overview-flow" aria-label="运行链路">',
    flowStep('采集', queued + running + completed + failed > 0),
    flowStep('加工', running > 0 || completed > 0),
    flowStep('缓存', state.cacheEntries.length > 0),
    flowStep('注入', lastInjection.length > 0),
    '</div>',
    '<div class="ttap-status-grid">',
    statusItem('审核', awaiting > 0 ? `${awaiting} 条待确认` : '无待确认'),
    statusItem('注入', injectionText),
    statusItem('完成', completed),
    statusItem('异常', failed),
    '</div>',
    renderRecentEvents(debugEntries)
  ].join('');
}

function flowStep(label, active) {
  return `<span class="ttap-flow-step${active ? ' is-active' : ''}">${escapeHtml(label)}</span>`;
}

function statusItem(label, value) {
  return `<div class="ttap-status-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function renderRecentEvents(entries) {
  const recent = records(entries).slice(-3).reverse();
  const rows = recent.length
    ? recent.map((entry) => `<li><span>${escapeHtml(entry.channel)}</span><strong>${escapeHtml(entry.message)}</strong></li>`).join('')
    : '<li><span>system</span><strong>暂无事件</strong></li>';

  return [
    '<div class="ttap-recent">',
    '<div class="ttap-recent-title">最近事件</div>',
    `<ol>${rows}</ol>`,
    '</div>'
  ].join('');
}

function renderTasks(tasks, settings, worldInfoCapture) {
  const safeTasks = records(tasks);
  const taskList = safeTasks.length
    ? safeTasks.map((task) => [
    '<article class="ttap-card">',
    `<strong>${escapeHtml(task.id)}</strong>`,
    `<span class="ttap-pill">${escapeHtml(task.state)}</span>`,
    task.state === 'awaiting_approval'
      ? `<button type="button" data-approve-task="${escapeHtml(task.id)}">批准</button><button type="button" data-cancel-task="${escapeHtml(task.id)}">取消</button>`
      : '',
    task.error ? `<p class="ttap-error">${escapeHtml(task.error)}</p>` : '',
    '</article>'
  ].join('')).join('')
    : '<p class="ttap-empty">当前没有 worker 任务。</p>';

  return [
    renderCapturedDispatch(worldInfoCapture, settings),
    renderManualDispatchForm(settings),
    taskList
  ].join('');
}

function renderManualDispatchForm(settings) {
  const options = renderRuleOptions(settings);

  return [
    '<section class="ttap-card ttap-manual-dispatch" aria-label="手动派发">',
    '<div class="ttap-card-heading">',
    '<strong>手动派发</strong>',
    '<span>粘贴世界书/角色资料，先加工进缓存，再注入提示词。</span>',
    '</div>',
    '<label class="ttap-field"><span>资料名称</span><input data-manual-title type="text" value="手动资料" placeholder="例如：角色A"></label>',
    `<label class="ttap-field"><span>规则</span><select data-manual-rule>${options}</select></label>`,
    '<label class="ttap-field"><span>资料内容</span><textarea data-manual-content rows="5" placeholder="把世界书条目、角色设定或场景资料贴到这里"></textarea></label>',
    '<button class="ttap-primary-button" type="button" data-dispatch-manual>派发加工</button>',
    '</section>'
  ].join('');
}

function renderCapturedDispatch(capture, settings) {
  const entries = records(capture?.entries);
  if (!entries.length) return '';

  const names = entries.map((entry) => (
    `<li title="${escapeHtml(entry.displayName)}">${escapeHtml(entry.displayName || '未命名条目')}</li>`
  )).join('');

  return [
    '<section class="ttap-card ttap-captured-dispatch" aria-label="本轮世界书">',
    '<div class="ttap-card-heading ttap-captured-heading">',
    '<strong>本轮世界书</strong>',
    `<span>${entries.length} 条命中 · ${formatCount(capture?.totalTokens)} tk</span>`,
    '</div>',
    `<ul class="ttap-captured-list">${names}</ul>`,
    `<label class="ttap-field"><span>加工规则</span><select data-captured-rule>${renderRuleOptions(settings)}</select></label>`,
    '<button class="ttap-primary-button" type="button" data-dispatch-captured>加工本轮命中</button>',
    '</section>'
  ].join('');
}

function renderRuleOptions(settings) {
  return records(settings?.rules).map((rule) => (
    `<option value="${escapeHtml(rule.id)}">${escapeHtml(rule.name)}</option>`
  )).join('');
}

function renderRules(state) {
  const ruleView = state.ruleView === 'world-info' ? 'world-info' : 'ai';
  const catalogStatus = isRecord(state.worldInfoCatalogStatus) ? state.worldInfoCatalogStatus : {};
  const segmented = [
    '<div class="ttap-segmented" role="tablist" aria-label="规则类型">',
    `<button type="button" data-rule-view="ai" aria-selected="${ruleView === 'ai'}">子 AI 预设</button>`,
    `<button type="button" data-rule-view="world-info" aria-selected="${ruleView === 'world-info'}">世界书处理规则</button>`,
    '</div>'
  ].join('');
  const status = ruleView === 'ai' && catalogStatus.error
    ? `<p class="ttap-error ttap-world-info-status">${escapeHtml(catalogStatus.error)}</p>`
    : '';

  return segmented + status + (ruleView === 'world-info'
    ? renderWorldInfoRules(state)
    : renderAiRules(state.settings.rules));
}

function renderAiRules(rules) {
  const safeRules = records(rules);
  if (!safeRules.length) return '<p class="ttap-empty">还没有规则。</p>';
  return safeRules.map((rule) => [
    '<article class="ttap-card">',
    `<strong>${escapeHtml(rule.name)}</strong>`,
    `<p>${escapeHtml(rule.description)}</p>`,
    `<span class="ttap-pill">上限 ${escapeHtml(rule.maxInputTokens)} tk</span>`,
    '</article>'
  ].join('')).join('');
}

function renderWorldInfoRules(state) {
  const catalog = isRecord(state.worldInfoCatalog) ? state.worldInfoCatalog : {};
  const editor = isRecord(state.worldInfoRuleEditor) ? state.worldInfoRuleEditor : {};
  const hasWorld = Boolean(toText(catalog.worldRef).trim() && toText(catalog.worldName).trim());
  const status = isRecord(state.worldInfoCatalogStatus) ? state.worldInfoCatalogStatus : {};
  const statusHtml = status.error
    ? `<p class="ttap-error ttap-world-info-status">${escapeHtml(status.error)}</p>`
    : (status.loading ? '<p class="ttap-status-line ttap-world-info-status">正在读取当前角色世界书...</p>' : '');

  const rules = records(state.settings?.worldInfoRules);
  const editing = editor.view === 'edit' && isRecord(editor.draft) && hasWorld;
  const rows = rules.length
    ? rules.map((rule) => renderWorldInfoRuleCard(rule, catalog, editing ? editor.editingId : null)).join('')
    : '<p class="ttap-empty">还没有世界书处理规则。</p>';
  const empty = hasWorld ? '' : '<p class="ttap-empty ttap-world-info-empty">当前角色未绑定世界书</p>';

  return [
    '<section class="ttap-world-info-rules">',
    '<div class="ttap-world-info-heading">',
    '<div><strong>世界书处理规则</strong>',
    hasWorld ? `<span>${escapeHtml(catalog.worldName)}</span>` : '',
    '</div>',
    `<button class="ttap-primary-button" type="button" data-new-world-info-rule${hasWorld ? '' : ' disabled'}>新建规则</button>`,
    '</div>',
    statusHtml,
    empty,
    `<div class="ttap-world-info-workspace" data-editing="${editing}">`,
    `<div class="ttap-rule-list" data-scroll-key="world-info-rules">${rows}</div>`,
    editing ? renderWorldInfoRuleEditor(editor, catalog) : '',
    '</div>',
    '</section>'
  ].join('');
}

function renderWorldInfoRuleCard(rule, catalog, editingId) {
  const id = escapeHtml(rule.id);
  const selected = recordsAsValues(rule.entryUids).length;
  const mode = rule.mode === 'include' ? '包含' : '排除';
  const worldName = rule.worldRef && rule.worldRef === catalog.worldRef
    ? catalog.worldName
    : (rule.worldRef || '全部世界书');
  const actions = [
    `<button class="ttap-icon-button" type="button" data-edit-world-info-rule="${id}" aria-label="编辑 ${escapeHtml(rule.name)}"><i class="fa-solid fa-pen"></i></button>`,
    rule.builtin === true
      ? '<span class="ttap-status-line">内置</span>'
      : `<button class="ttap-icon-button ttap-danger-button" type="button" data-delete-world-info-rule="${id}" aria-label="删除 ${escapeHtml(rule.name)}"><i class="fa-solid fa-trash"></i></button>`
  ].join('');

  return [
    `<article class="ttap-card ttap-world-info-rule-card${rule.id === editingId ? ' is-active' : ''}">`,
    '<div class="ttap-rule-summary">',
    `<strong>${escapeHtml(rule.name)}</strong>`,
    `<span>${escapeHtml(worldName)}</span>`,
    '</div>',
    '<div class="ttap-rule-meta">',
    `<span class="ttap-pill">${mode}</span>`,
    `<span class="ttap-pill">已选 ${selected}</span>`,
    '</div>',
    `<div class="ttap-rule-actions">${actions}</div>`,
    '</article>'
  ].join('');
}

function renderWorldInfoRuleEditor(editor, catalog) {
  const draft = editor.draft;
  const entries = records(catalog.entries);
  const visibleEntries = filterCatalogEntries(entries, editor.search);
  const selectedUids = recordsAsValues(draft.entryUids);
  const catalogUids = new Set(entries.map((entry) => normalizeUid(entry.uid)).filter(Boolean));
  const validSelectedUids = selectedUids.filter((uid) => catalogUids.has(uid));
  const invalidSelectedCount = selectedUids.length - validSelectedUids.length;
  const selected = new Set(validSelectedUids);
  const visibleSelected = visibleEntries.reduce((count, entry) => (
    selected.has(normalizeUid(entry.uid)) ? count + 1 : count
  ), 0);
  const finalAllowed = draft.mode === 'include'
    ? validSelectedUids.length
    : Math.max(0, entries.length - validSelectedUids.length);
  const disabledActions = visibleEntries.length ? '' : ' disabled';
  const entryRows = visibleEntries.length
    ? visibleEntries.map((entry) => renderWorldInfoEntry(entry, selected)).join('')
    : '<p class="ttap-empty">当前搜索没有匹配条目。</p>';

  return [
    '<section class="ttap-world-info-editor">',
    '<div class="ttap-world-info-context">',
    `<span>当前角色<strong>${escapeHtml(catalog.characterName || '未命名角色')}</strong></span>`,
    `<span>绑定世界书<strong>${escapeHtml(catalog.worldName)}</strong></span>`,
    '</div>',
    '<div class="ttap-world-info-editor-fields">',
    `<label class="ttap-field"><span>规则名称</span><input type="text" data-world-info-rule-name value="${escapeHtml(draft.name)}"></label>`,
    '<div class="ttap-field"><span>处理模式</span><div class="ttap-segmented ttap-mode-segmented" role="group" aria-label="处理模式">',
    `<button type="button" data-world-info-rule-mode="include" aria-selected="${draft.mode === 'include'}">包含</button>`,
    `<button type="button" data-world-info-rule-mode="exclude" aria-selected="${draft.mode !== 'include'}">排除</button>`,
    '</div></div>',
    '</div>',
    '<div class="ttap-entry-toolbar">',
    `<input type="search" data-world-info-search value="${escapeHtml(editor.search)}" placeholder="搜索名称、UID 或正文">`,
    `<button type="button" data-world-info-select-all${disabledActions}>全选当前结果</button>`,
    `<button type="button" data-world-info-invert${disabledActions}>反选当前结果</button>`,
    '</div>',
    '<div class="ttap-world-info-stats">',
    `<span>当前结果已选 ${visibleSelected}</span>`,
    `<span>全局已选 ${validSelectedUids.length}</span>`,
    `<span class="${invalidSelectedCount ? 'ttap-warning' : 'ttap-status-line'}">失效选择 ${invalidSelectedCount}</span>`,
    `<strong>最终允许读取 ${finalAllowed}</strong>`,
    '</div>',
    `<div class="ttap-entry-list" data-scroll-key="world-info-entries">${entryRows}</div>`,
    '<div class="ttap-editor-actions">',
    '<button type="button" data-cancel-world-info-rule>取消</button>',
    '<button class="ttap-primary-button" type="button" data-save-world-info-rule>保存规则</button>',
    '</div>',
    '</section>'
  ].join('');
}

function renderWorldInfoEntry(entry, selected) {
  const uid = normalizeUid(entry.uid);
  const checked = selected.has(uid) ? ' checked' : '';
  const status = entry.disabled === true ? '已禁用' : '已启用';
  const content = toText(entry.content);
  const preview = content.length > 600 ? `${content.slice(0, 600)}...` : content;
  return [
    `<div class="ttap-entry-row" data-entry-disabled="${entry.disabled === true}">`,
    '<label class="ttap-entry-select">',
    `<input type="checkbox" data-world-info-entry="${escapeHtml(uid)}"${checked}>`,
    `<span class="ttap-entry-copy"><strong>${escapeHtml(entry.displayName || '未命名条目')}</strong><small>UID ${escapeHtml(uid)}</small></span>`,
    '</label>',
    `<span class="ttap-entry-state">${status}</span>`,
    `<details data-world-info-preview><summary>正文预览</summary><p data-scroll-key="world-info-preview-${escapeHtml(uid)}">${escapeHtml(preview || '无正文')}</p></details>`,
    '</div>'
  ].join('');
}

function renderCache(entries) {
  const safeEntries = records(entries);
  if (!safeEntries.length) return '<p class="ttap-empty">还没有处理后的缓存。</p>';
  return safeEntries.map((entry) => [
    '<article class="ttap-card">',
    `<strong>${escapeHtml(entry.key)}</strong>`,
    `<p>${escapeHtml(toText(entry.processedText).slice(0, 120))}</p>`,
    `<span class="ttap-pill">${entry.stale ? '已失效' : '可用'}</span>`,
    '</article>'
  ].join('')).join('');
}

function renderDebug(entries) {
  const rows = records(entries)
    .map((entry) => `<li>[${escapeHtml(entry.level)}] ${escapeHtml(entry.channel)}：${escapeHtml(entry.message)}</li>`)
    .join('');
  return [
    '<button type="button" data-export-debug>导出 JSON</button>',
    `<ol class="ttap-debug-list" data-scroll-key="debug-events">${rows}</ol>`
  ].join('');
}

function renderSettings(settings) {
  const safeSettings = isRecord(settings) ? settings : {};
  return [
    '<div class="ttap-settings-grid">',
    metric('全局并发', safeSettings.globalConcurrency),
    metric('确认阈值', safeSettings.dispatchConfirmThreshold),
    metric('Worker 上限', `${toText(safeSettings.maxWorkerInputTokens)} tk`),
    metric('主题', safeSettings.theme),
    '</div>'
  ].join('');
}

function metric(label, value) {
  return `<div class="ttap-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function normalizeState(state) {
  const source = isRecord(state) ? state : {};
  const panel = isRecord(source.panel) ? source.panel : {};
  const settings = isRecord(source.settings) ? source.settings : {};
  const requestedActiveTab = safeProperty(panel, 'activeTab');

  return {
    panel: {
      open: panel.open === true,
      activeTab: CANONICAL_TABS.some((tab) => tab.id === requestedActiveTab)
        ? requestedActiveTab
        : DEFAULT_TAB.id
    },
    tasks: records(source.tasks),
    cacheEntries: records(source.cacheEntries),
    worldInfoCapture: isRecord(source.worldInfoCapture) ? source.worldInfoCapture : null,
    worldInfoCatalog: isRecord(source.worldInfoCatalog) ? source.worldInfoCatalog : {},
    worldInfoCatalogStatus: isRecord(source.worldInfoCatalogStatus) ? source.worldInfoCatalogStatus : {},
    ruleView: source.ruleView === 'world-info' ? 'world-info' : 'ai',
    worldInfoRuleEditor: isRecord(source.worldInfoRuleEditor) ? source.worldInfoRuleEditor : {},
    lastInjection: isRecord(source.lastInjection) ? source.lastInjection : null,
    settings: {
      ...settings,
      rules: records(settings.rules),
      worldInfoRules: records(settings.worldInfoRules)
    }
  };
}

function normalizeTheme(theme) {
  return ['system', 'light', 'dark'].includes(theme) ? theme : 'system';
}

function safeNormalizeState(state, debug) {
  try {
    return normalizeState(state);
  } catch (error) {
    warnDebug(debug, 'Unable to normalize panel state', error);
    return normalizeState(undefined);
  }
}

function records(value, fallback = []) {
  const items = Array.isArray(value) ? value.filter(isRecord) : [];
  if (items.length) return items;
  return Array.isArray(fallback) ? fallback.filter(isRecord).map((item) => ({ ...item })) : [];
}

function captureOwnedPanelShell(root, debug) {
  const panel = safeQuery(root, '.ttap-panel', debug);
  const backdrop = safeQuery(root, '.ttap-backdrop', debug);
  const title = safeQuery(root, '[data-workspace-title]', debug);
  const body = safeQuery(root, '[data-workspace-body]', debug);
  const tabsNode = safeQuery(root, '.ttap-tabs', debug);
  const tabs = safeQueryAll(root, '[data-tab]', debug);
  const closeNodes = safeQueryAll(root, '[data-ttap-close]', debug);
  if (!panel || !backdrop || !title || !body || !tabsNode || tabs === null
    || closeNodes === null
    || new Set([panel, backdrop, title, body, tabsNode]).size !== 5
    || safeDatasetValue(panel, 'ttapShell') !== 'v1'
    || tabs.length !== CANONICAL_TABS.length
    || tabs.some((tab, index) => safeDatasetValue(tab, 'tab') !== CANONICAL_TABS[index].id)) {
    return null;
  }

  const panelCloseNodes = safeQueryAll(panel, '[data-ttap-close]', debug);
  const mobileClose = safeQuery(panel, '.ttap-mobile-close', debug);
  const desktopClose = safeQuery(panel, '.ttap-desktop-close', debug);
  if (!mobileClose || !desktopClose || panelCloseNodes === null
    || closeNodes.length !== 3 || new Set(closeNodes).size !== 3
    || panelCloseNodes.length !== 2 || new Set(panelCloseNodes).size !== 2
    || closeNodes[0] !== backdrop || closeNodes[1] !== mobileClose || closeNodes[2] !== desktopClose
    || panelCloseNodes[0] !== mobileClose || panelCloseNodes[1] !== desktopClose) {
    return null;
  }
  return {
    panel,
    backdrop,
    title,
    body,
    tabsNode,
    tabs,
    closeNodes,
    mobileClose,
    desktopClose
  };
}

function sameOwnedPanelShell(owned, current) {
  return owned.panel === current.panel
    && owned.backdrop === current.backdrop
    && owned.title === current.title
    && owned.body === current.body
    && owned.tabsNode === current.tabsNode
    && owned.mobileClose === current.mobileClose
    && owned.desktopClose === current.desktopClose
    && owned.tabs.every((tab, index) => tab === current.tabs[index])
    && owned.closeNodes.every((node, index) => node === current.closeNodes[index]);
}

function capturePanelPatchState(nodes, debug) {
  const state = {
    open: captureDatasetState(nodes.panel, 'open'),
    theme: captureDatasetState(nodes.panel, 'ttapTheme'),
    activeTab: captureDatasetState(nodes.panel, 'activeTab'),
    backdrop: capturePropertyState(nodes.backdrop, 'hidden'),
    title: capturePropertyState(nodes.title, 'textContent'),
    themeLabel: nodes.themeState ? capturePropertyState(nodes.themeState, 'textContent') : null,
    body: capturePropertyState(nodes.body, 'innerHTML'),
    tabs: nodes.tabs.map((tab) => captureAttributeState(tab, 'aria-selected'))
  };
  if (!state.open || !state.theme || !state.activeTab || !state.backdrop || !state.title || !state.body
    || (nodes.themeState && !state.themeLabel) || state.tabs.some((tab) => !tab)) {
    warnDebug(debug, 'Unable to capture panel state for patch rollback', new Error('panel snapshot failed'));
    return null;
  }
  return state;
}

function preparePanelBodyPatch(body, nextHtml, previousBody, debug) {
  const failed = Symbol('body patch property read failed');
  const childNodes = safeProperty(body, 'childNodes', failed);
  const replaceChildren = safeProperty(body, 'replaceChildren', failed);
  if (childNodes === failed || replaceChildren === failed) {
    warnDebug(debug, 'Unable to inspect panel body nodes', new Error('body node APIs unavailable'));
    return null;
  }

  if (childNodes === undefined || childNodes === null || typeof replaceChildren !== 'function') {
    return {
      commit: () => safeSetProperty(body, 'innerHTML', nextHtml, debug),
      rollback: () => restorePropertyState(previousBody, debug)
    };
  }

  let previousNodes;
  try {
    previousNodes = Array.from(childNodes);
  } catch (error) {
    warnDebug(debug, 'Unable to capture panel body nodes', error);
    return null;
  }

  const nextNodes = stagePanelBodyNodes(body, nextHtml, debug);
  if (!nextNodes) return null;
  return {
    commit: () => replacePanelBodyChildren(body, replaceChildren, nextNodes, debug),
    rollback: () => restorePanelBodyChildren(body, replaceChildren, previousNodes, debug)
  };
}

function stagePanelBodyNodes(body, nextHtml, debug) {
  const failed = Symbol('body staging property read failed');
  const ownerDocument = safeProperty(body, 'ownerDocument', failed);
  if (ownerDocument === failed || !isRecord(ownerDocument)) {
    warnDebug(debug, 'Unable to stage panel body', new Error('ownerDocument unavailable'));
    return null;
  }
  const createElement = safeProperty(ownerDocument, 'createElement', failed);
  if (createElement === failed || typeof createElement !== 'function') {
    warnDebug(debug, 'Unable to stage panel body', new Error('createElement unavailable'));
    return null;
  }

  try {
    const template = createElement.call(ownerDocument, 'template');
    if (!isRecord(template)) throw new Error('template unavailable');
    const content = safeProperty(template, 'content', failed);
    if (content === failed) throw new Error('template content unavailable');
    if (isRecord(content)) {
      template.innerHTML = nextHtml;
      const nodes = safeProperty(content, 'childNodes', failed);
      if (nodes === failed || nodes === undefined || nodes === null) {
        throw new Error('template child nodes unavailable');
      }
      return Array.from(nodes);
    }

    const container = createElement.call(ownerDocument, 'div');
    if (!isRecord(container)) throw new Error('staging container unavailable');
    container.innerHTML = nextHtml;
    const nodes = safeProperty(container, 'childNodes', failed);
    if (nodes === failed || nodes === undefined || nodes === null) {
      throw new Error('staged child nodes unavailable');
    }
    return Array.from(nodes);
  } catch (error) {
    warnDebug(debug, 'Unable to stage panel body', error);
    return null;
  }
}

function replacePanelBodyChildren(body, replaceChildren, nodes, debug) {
  try {
    replaceChildren.call(body, ...nodes);
    return true;
  } catch (error) {
    warnDebug(debug, 'Unable to replace panel body nodes', error);
    return false;
  }
}

function restorePanelBodyChildren(body, replaceChildren, nodes, debug) {
  try {
    replaceChildren.call(body, ...nodes);
    return true;
  } catch (error) {
    warnDebug(debug, 'Unable to restore panel body nodes', error);
    return false;
  }
}

function captureDatasetState(node, key) {
  const failed = Symbol('dataset read failed');
  const dataset = safeProperty(node, 'dataset', failed);
  if (!isRecord(dataset)) return null;
  try {
    const hasValue = Object.hasOwn(dataset, key);
    const value = safeProperty(dataset, key, failed);
    return value === failed ? null : { dataset, key, hasValue, value };
  } catch {
    return null;
  }
}

function capturePropertyState(node, key) {
  const failed = Symbol('property read failed');
  const value = safeProperty(node, key, failed);
  return value === failed ? null : { node, key, value };
}

function captureAttributeState(node, name) {
  const getAttribute = safeProperty(node, 'getAttribute');
  if (typeof getAttribute !== 'function') return null;
  try {
    return { node, name, value: getAttribute.call(node, name) };
  } catch {
    return null;
  }
}

function applyPanelWrite(rollbacks, writer, rollback, debug) {
  rollbacks.push(rollback);
  let succeeded = false;
  try {
    succeeded = writer() === true;
  } catch (error) {
    warnDebug(debug, 'Unable to write panel patch', error);
  }
  if (succeeded) return true;
  for (let index = rollbacks.length - 1; index >= 0; index -= 1) {
    try {
      rollbacks[index]();
    } catch (error) {
      warnDebug(debug, 'Unable to roll back panel patch', error);
    }
  }
  return false;
}

function restoreDatasetState(snapshot, debug) {
  try {
    if (snapshot.hasValue) snapshot.dataset[snapshot.key] = snapshot.value;
    else delete snapshot.dataset[snapshot.key];
    return true;
  } catch (error) {
    warnDebug(debug, `Unable to restore data-${snapshot.key}`, error);
    return false;
  }
}

function restorePropertyState(snapshot, debug) {
  return safeSetProperty(snapshot.node, snapshot.key, snapshot.value, debug);
}

function restoreAttributeState(snapshot, debug) {
  if (snapshot.value !== null) {
    return safeSetAttribute(snapshot.node, snapshot.name, snapshot.value, debug);
  }
  const removeAttribute = safeProperty(snapshot.node, 'removeAttribute');
  if (typeof removeAttribute !== 'function') return false;
  try {
    removeAttribute.call(snapshot.node, snapshot.name);
    return true;
  } catch (error) {
    warnDebug(debug, `Unable to restore ${snapshot.name}`, error);
    return false;
  }
}

function capturePanelScroll(body, debug) {
  const keyed = new Map();
  for (const { node, key } of indexedScrollNodes(body, debug)) {
    const scrollTop = finiteScrollTop(node);
    if (scrollTop !== null) keyed.set(key, scrollTop);
  }
  return { workspace: finiteScrollTop(body), keyed };
}

function restorePanelScroll(body, snapshot, sameActiveTab, debug) {
  if (!sameActiveTab) {
    safeSetProperty(body, 'scrollTop', 0, debug);
    return;
  }

  if (snapshot.workspace !== null) {
    safeSetProperty(body, 'scrollTop', snapshot.workspace, debug);
  }
  for (const { node, key } of indexedScrollNodes(body, debug)) {
    if (snapshot.keyed.has(key)) {
      safeSetProperty(node, 'scrollTop', snapshot.keyed.get(key), debug);
    }
  }
}

function indexedScrollNodes(body, debug) {
  const occurrences = new Map();
  const indexed = [];
  for (const node of safeQueryAll(body, '[data-scroll-key]', debug) ?? []) {
    const baseKey = toText(safeProperty(safeDataset(node), 'scrollKey')).trim();
    if (!baseKey) continue;
    const occurrence = occurrences.get(baseKey) ?? 0;
    occurrences.set(baseKey, occurrence + 1);
    indexed.push({ node, key: `${baseKey}#${occurrence}` });
  }
  return indexed;
}

function finiteScrollTop(node) {
  const value = safeProperty(node, 'scrollTop');
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function safeScrollIntoView(node, debug) {
  const scrollIntoView = safeProperty(node, 'scrollIntoView');
  if (typeof scrollIntoView !== 'function') return false;
  try {
    scrollIntoView.call(node, { block: 'nearest', inline: 'nearest' });
    return true;
  } catch (error) {
    warnDebug(debug, 'Unable to reveal active panel tab', error);
    return false;
  }
}

function bindEach(root, selector, listenerFor, bindings, debug) {
  const nodes = safeQueryAll(root, selector, debug);
  if (nodes === null) return false;

  let bound = true;
  for (const node of nodes) {
    bound = bindNodeEvent(node, 'click', () => listenerFor(node), bindings, selector, debug) && bound;
  }
  return bound;
}

function bindOne(root, selector, listener, bindings, debug) {
  const node = safeQuery(root, selector, debug);
  if (!node) return true;
  return bindNodeEvent(node, 'click', () => listener, bindings, selector, debug);
}

function bindInputEach(root, selector, eventName, listenerFor, bindings, debug) {
  const nodes = safeQueryAll(root, selector, debug);
  if (nodes === null) return false;

  let bound = true;
  for (const node of nodes) {
    bound = bindNodeEvent(node, eventName, () => listenerFor(node), bindings, selector, debug) && bound;
  }
  return bound;
}

function bindNodeEvent(node, eventName, createListener, bindings, selector, debug) {
  const addEventListener = safeProperty(node, 'addEventListener');
  if (typeof addEventListener !== 'function') return false;

  let nodeBindings;
  try {
    nodeBindings = bindings.get(node) ?? new Set();
    if (nodeBindings.has(eventName)) return true;
    addEventListener.call(node, eventName, createListener());
    nodeBindings.add(eventName);
    bindings.set(node, nodeBindings);
    return true;
  } catch (error) {
    warnDebug(debug, `Unable to bind ${selector}`, error);
    return false;
  }
}

function capturePanelFocus(documentRef, root) {
  try {
    const active = documentRef?.activeElement;
    if (!active || (typeof root?.contains === 'function' && !root.contains(active))) return null;
    const dataset = safeDataset(active);
    const selector = Object.hasOwn(dataset, 'worldInfoSearch')
      ? '[data-world-info-search]'
      : (Object.hasOwn(dataset, 'worldInfoRuleName') ? '[data-world-info-rule-name]' : '');
    if (!selector) return null;
    return {
      selector,
      start: Number.isInteger(active.selectionStart) ? active.selectionStart : null,
      end: Number.isInteger(active.selectionEnd) ? active.selectionEnd : null,
      direction: typeof active.selectionDirection === 'string' ? active.selectionDirection : 'none'
    };
  } catch {
    return null;
  }
}

function restorePanelFocus(root, snapshot, debug) {
  if (!snapshot) return false;
  try {
    const control = safeQuery(root, snapshot.selector, debug);
    const focus = safeProperty(control, 'focus');
    if (!control || typeof focus !== 'function') return false;
    try {
      focus.call(control, { preventScroll: true });
    } catch {
      focus.call(control);
    }
    const setSelectionRange = safeProperty(control, 'setSelectionRange');
    if (snapshot.start !== null && snapshot.end !== null && typeof setSelectionRange === 'function') {
      setSelectionRange.call(control, snapshot.start, snapshot.end, snapshot.direction);
    }
    return true;
  } catch (error) {
    warnDebug(debug, 'Unable to restore panel input focus', error);
    return false;
  }
}

function readManualDispatchPayload(root) {
  return {
    displayName: readControlValue(root, '[data-manual-title]') || '手动资料',
    content: readControlValue(root, '[data-manual-content]'),
    ruleTemplateId: readControlValue(root, '[data-manual-rule]')
  };
}

function readCapturedDispatchPayload(root) {
  return {
    ruleTemplateId: readControlValue(root, '[data-captured-rule]')
  };
}

function formatCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return '0';
  return Math.trunc(count).toLocaleString('zh-CN');
}

function readControlValue(root, selector) {
  const node = safeQuery(root, selector);
  return readNodeValue(node);
}

function readNodeValue(node) {
  const value = safeProperty(node, 'value');
  return typeof value === 'string' ? value : '';
}

function recordsAsValues(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const normalized = normalizeUid(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeUid(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' ? value.trim() : '';
}

function safeDataset(node) {
  const dataset = safeProperty(node, 'dataset');
  return isRecord(dataset) ? dataset : {};
}

function safeDatasetValue(node, key) {
  return safeProperty(safeDataset(node), key);
}

function safeProperty(value, key, fallback) {
  try {
    return value?.[key];
  } catch {
    return fallback;
  }
}

function safeQuery(root, selector, debug) {
  const querySelector = safeProperty(root, 'querySelector');
  if (typeof querySelector !== 'function') return null;
  try {
    return querySelector.call(root, selector) ?? null;
  } catch (error) {
    warnDebug(debug, `Unable to query ${selector}`, error);
    return null;
  }
}

function safeQueryAll(root, selector, debug) {
  const querySelectorAll = safeProperty(root, 'querySelectorAll');
  if (typeof querySelectorAll !== 'function') return null;
  try {
    return Array.from(querySelectorAll.call(root, selector) || []);
  } catch (error) {
    warnDebug(debug, `Unable to query ${selector}`, error);
    return null;
  }
}

function safeSetData(node, key, attribute, value, debug) {
  const dataset = safeProperty(node, 'dataset');
  if (isRecord(dataset)) {
    try {
      dataset[key] = value;
      return true;
    } catch (error) {
      warnDebug(debug, `Unable to update ${attribute}`, error);
    }
  }
  return safeSetAttribute(node, attribute, value, debug);
}

function safeSetAttribute(node, name, value, debug) {
  const setAttribute = safeProperty(node, 'setAttribute');
  if (typeof setAttribute !== 'function') return false;
  try {
    setAttribute.call(node, name, value);
    return true;
  } catch (error) {
    warnDebug(debug, `Unable to update ${name}`, error);
    return false;
  }
}

function safeSetProperty(node, key, value, debug) {
  try {
    node[key] = value;
    return true;
  } catch (error) {
    warnDebug(debug, `Unable to update ${key}`, error);
    return false;
  }
}

function safeGet(getter, fallback, debug) {
  if (typeof getter !== 'function') return fallback;
  try {
    return getter();
  } catch (error) {
    warnDebug(debug, 'Panel getter failed', error);
    return fallback;
  }
}

function safeInvoke(callback, debug, ...args) {
  if (typeof callback !== 'function') return false;
  try {
    callback(...args);
    return true;
  } catch (error) {
    warnDebug(debug, 'Panel handler failed', error);
    return false;
  }
}

function warnDebug(debug, message, error) {
  try {
    if (typeof debug === 'function') {
      debug({ level: 'warn', channel: 'ui', message, error: toText(error?.message ?? error) });
    } else if (debug && typeof debug.warn === 'function') {
      debug.warn('ui', message, { error: toText(error?.message ?? error) });
    }
  } catch {
    // Debug hooks must never break panel rendering.
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toText(value) {
  if (value === null || value === undefined) return '';
  try {
    return String(value);
  } catch {
    return '';
  }
}

function escapeHtml(value) {
  return toText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
