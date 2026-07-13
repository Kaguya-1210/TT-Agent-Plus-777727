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
    `<aside class="ttap-panel" data-open="${safeState.panel.open ? 'true' : 'false'}" data-ttap-theme="${escapeHtml(theme)}" aria-label="${escapeHtml(DISPLAY_NAME)}">`,
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
  if (!isRecord(documentRef) || typeof documentRef.getElementById !== 'function') {
    return emptyMount();
  }

  let root;
  try {
    root = documentRef.getElementById(rootId);
  } catch (error) {
    warnDebug(debug, 'Unable to find panel root', error);
    return emptyMount();
  }

  if (!root) {
    if (typeof documentRef.createElement !== 'function' || !isRecord(documentRef.body)) {
      return emptyMount();
    }

    try {
      root = documentRef.createElement('div');
      root.id = rootId;
      if (typeof documentRef.body.append === 'function') {
        documentRef.body.append(root);
      } else if (typeof documentRef.body.appendChild === 'function') {
        documentRef.body.appendChild(root);
      } else {
        return emptyMount();
      }
    } catch (error) {
      warnDebug(debug, 'Unable to create panel root', error);
      return emptyMount();
    }
  }

  const inputBindings = new WeakMap();

  function render() {
    const focusSnapshot = capturePanelFocus(documentRef, root);
    try {
      root.innerHTML = renderPanelHtml(safeGet(getState, undefined, debug), safeGet(getDebugEntries, [], debug));
    } catch (error) {
      warnDebug(debug, 'Unable to render panel', error);
      return false;
    }

    if (typeof root.querySelectorAll !== 'function' || typeof root.querySelector !== 'function') {
      return false;
    }
    restorePanelFocus(root, focusSnapshot, debug);

    let bound = true;
    bound = bindEach(root, '[data-tab]', (button) => () => {
      safeInvoke(onTab, debug, safeDataset(button).tab);
    }, debug) && bound;
    bound = bindEach(root, '[data-ttap-close]', () => () => {
      safeInvoke(onClose, debug);
    }, debug) && bound;
    bound = bindEach(root, '[data-approve-task]', (button) => () => {
      safeInvoke(onApprove, debug, safeDataset(button).approveTask);
    }, debug) && bound;
    bound = bindEach(root, '[data-cancel-task]', (button) => () => {
      safeInvoke(onCancel, debug, safeDataset(button).cancelTask);
    }, debug) && bound;
    bound = bindEach(root, '[data-dispatch-manual]', () => () => {
      safeInvoke(onManualDispatch, debug, readManualDispatchPayload(root));
    }, debug) && bound;
    bound = bindEach(root, '[data-dispatch-captured]', () => () => {
      safeInvoke(onCapturedDispatch, debug, readCapturedDispatchPayload(root));
    }, debug) && bound;
    bound = bindOne(root, '[data-export-debug]', () => {
      safeInvoke(onExportDebug, debug);
    }, debug) && bound;
    bound = bindEach(root, '[data-rule-view]', (button) => () => {
      safeInvoke(onRuleView, debug, safeDataset(button).ruleView);
    }, debug) && bound;
    bound = bindEach(root, '[data-new-world-info-rule]', () => () => {
      safeInvoke(onNewWorldInfoRule, debug);
    }, debug) && bound;
    bound = bindEach(root, '[data-edit-world-info-rule]', (button) => () => {
      safeInvoke(onEditWorldInfoRule, debug, safeDataset(button).editWorldInfoRule);
    }, debug) && bound;
    bound = bindEach(root, '[data-delete-world-info-rule]', (button) => () => {
      safeInvoke(onDeleteWorldInfoRule, debug, safeDataset(button).deleteWorldInfoRule);
    }, debug) && bound;
    bound = bindEach(root, '[data-world-info-select-all]', () => () => {
      safeInvoke(onWorldInfoRuleSelectAll, debug);
    }, debug) && bound;
    bound = bindEach(root, '[data-world-info-invert]', () => () => {
      safeInvoke(onWorldInfoRuleInvert, debug);
    }, debug) && bound;
    bound = bindEach(root, '[data-save-world-info-rule]', () => () => {
      safeInvoke(onSaveWorldInfoRule, debug);
    }, debug) && bound;
    bound = bindEach(root, '[data-cancel-world-info-rule]', () => () => {
      safeInvoke(onCancelWorldInfoRule, debug);
    }, debug) && bound;
    bound = bindInputEach(root, '[data-world-info-search]', 'input', (input) => () => {
      safeInvoke(onWorldInfoRuleSearch, debug, readNodeValue(input));
    }, inputBindings, debug) && bound;
    bound = bindInputEach(root, '[data-world-info-entry]', 'change', (input) => () => {
      safeInvoke(onWorldInfoRuleToggleEntry, debug, safeDataset(input).worldInfoEntry, input?.checked === true);
    }, inputBindings, debug) && bound;
    bound = bindInputEach(root, '[data-world-info-rule-name]', 'input', (input) => () => {
      safeInvoke(onWorldInfoRuleDraft, debug, { name: readNodeValue(input) });
    }, inputBindings, debug) && bound;
    bound = bindEach(root, '[data-world-info-rule-mode]', (button) => () => {
      safeInvoke(onWorldInfoRuleDraft, debug, { mode: safeDataset(button).worldInfoRuleMode });
    }, debug) && bound;

    return bound;
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
    `<div class="ttap-rule-list">${rows}</div>`,
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
    `<div class="ttap-entry-list">${entryRows}</div>`,
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
    `<details data-world-info-preview><summary>正文预览</summary><p>${escapeHtml(preview || '无正文')}</p></details>`,
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
    `<ol class="ttap-debug-list">${rows}</ol>`
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

function records(value, fallback = []) {
  const items = Array.isArray(value) ? value.filter(isRecord) : [];
  if (items.length) return items;
  return Array.isArray(fallback) ? fallback.filter(isRecord).map((item) => ({ ...item })) : [];
}

function bindEach(root, selector, listenerFor, debug) {
  let nodes;
  try {
    nodes = Array.from(root.querySelectorAll(selector) || []);
  } catch (error) {
    warnDebug(debug, `Unable to bind ${selector}`, error);
    return false;
  }

  for (const node of nodes) {
    if (node && typeof node.addEventListener === 'function') {
      node.addEventListener('click', listenerFor(node));
    }
  }
  return true;
}

function bindOne(root, selector, listener, debug) {
  let node;
  try {
    node = root.querySelector(selector);
  } catch (error) {
    warnDebug(debug, `Unable to bind ${selector}`, error);
    return false;
  }

  if (node && typeof node.addEventListener === 'function') {
    node.addEventListener('click', listener);
  }
  return true;
}

function bindInputEach(root, selector, eventName, listenerFor, bindings, debug) {
  let nodes;
  try {
    nodes = Array.from(root.querySelectorAll(selector) || []);
  } catch (error) {
    warnDebug(debug, `Unable to bind ${selector}`, error);
    return false;
  }

  for (const node of nodes) {
    if (node && typeof node.addEventListener === 'function') {
      const bindingKey = `${selector}:${eventName}`;
      const nodeBindings = bindings.get(node) ?? new Set();
      if (nodeBindings.has(bindingKey)) continue;
      node.addEventListener(eventName, listenerFor(node));
      nodeBindings.add(bindingKey);
      bindings.set(node, nodeBindings);
    }
  }
  return true;
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
    const control = root.querySelector(snapshot.selector);
    if (!control || typeof control.focus !== 'function') return false;
    control.focus();
    if (snapshot.start !== null && snapshot.end !== null && typeof control.setSelectionRange === 'function') {
      control.setSelectionRange(snapshot.start, snapshot.end, snapshot.direction);
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
  try {
    const node = root?.querySelector?.(selector);
    return typeof node?.value === 'string' ? node.value : '';
  } catch {
    return '';
  }
}

function readNodeValue(node) {
  return typeof node?.value === 'string' ? node.value : '';
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
  return isRecord(node?.dataset) ? node.dataset : {};
}

function safeProperty(value, key) {
  try {
    return value?.[key];
  } catch {
    return undefined;
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
