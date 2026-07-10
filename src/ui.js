import { DISPLAY_NAME, PANEL_TABS } from './constants.js';

export function renderPanelHtml(state, debugEntries = []) {
  const safeState = normalizeState(state);
  const safeDebugEntries = records(debugEntries);
  const tabButtons = safeState.tabs.map((tab) => {
    const active = tab.id === safeState.panel.activeTab ? ' aria-selected="true"' : ' aria-selected="false"';
    return `<button class="ttap-tab" data-tab="${escapeHtml(tab.id)}" type="button"${active}>${escapeHtml(tab.label)}</button>`;
  }).join('');
  const hiddenAttr = safeState.panel.open ? '' : ' hidden';
  const theme = normalizeTheme(safeState.settings.theme);

  return [
    `<div class="ttap-backdrop" data-ttap-close${hiddenAttr}></div>`,
    `<aside class="ttap-panel" data-open="${safeState.panel.open ? 'true' : 'false'}" data-ttap-theme="${escapeHtml(theme)}" aria-label="${escapeHtml(DISPLAY_NAME)}">`,
    '<header class="ttap-header">',
    '<div class="ttap-product">',
    '<span class="ttap-product-kicker">TT Agent</span>',
    `<strong class="ttap-product-title">${escapeHtml(DISPLAY_NAME)}</strong>`,
    '</div>',
    '<button class="ttap-icon-button" type="button" data-ttap-close aria-label="关闭"><i class="fa-solid fa-xmark"></i></button>',
    '</header>',
    `<nav class="ttap-tabs" role="tablist">${tabButtons}</nav>`,
    `<section class="ttap-body">${renderActiveTab(safeState, safeDebugEntries)}</section>`,
    '</aside>'
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
    onExportDebug,
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

  function render() {
    try {
      root.innerHTML = renderPanelHtml(safeGet(getState, undefined, debug), safeGet(getDebugEntries, [], debug));
    } catch (error) {
      warnDebug(debug, 'Unable to render panel', error);
      return false;
    }

    if (typeof root.querySelectorAll !== 'function' || typeof root.querySelector !== 'function') {
      return false;
    }

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
    bound = bindOne(root, '[data-export-debug]', () => {
      safeInvoke(onExportDebug, debug);
    }, debug) && bound;

    return bound;
  }

  render();
  return { root, render };
}

function renderActiveTab(state, debugEntries) {
  if (state.panel.activeTab === 'tasks') return renderTasks(state.tasks, state.settings);
  if (state.panel.activeTab === 'rules') return renderRules(state.settings.rules);
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

function renderTasks(tasks, settings) {
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
    renderManualDispatchForm(settings),
    taskList
  ].join('');
}

function renderManualDispatchForm(settings) {
  const rules = records(settings?.rules);
  const options = rules.map((rule) => (
    `<option value="${escapeHtml(rule.id)}">${escapeHtml(rule.name)}</option>`
  )).join('');

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

function renderRules(rules) {
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
  const tabs = records(source.tabs, PANEL_TABS);

  return {
    panel: {
      open: panel.open === true,
      activeTab: typeof panel.activeTab === 'string' ? panel.activeTab : 'overview'
    },
    tabs,
    tasks: records(source.tasks),
    cacheEntries: records(source.cacheEntries),
    lastInjection: isRecord(source.lastInjection) ? source.lastInjection : null,
    settings: {
      ...settings,
      rules: records(settings.rules)
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

function readManualDispatchPayload(root) {
  return {
    displayName: readControlValue(root, '[data-manual-title]') || '手动资料',
    content: readControlValue(root, '[data-manual-content]'),
    ruleTemplateId: readControlValue(root, '[data-manual-rule]')
  };
}

function readControlValue(root, selector) {
  try {
    const node = root?.querySelector?.(selector);
    return typeof node?.value === 'string' ? node.value : '';
  } catch {
    return '';
  }
}

function safeDataset(node) {
  return isRecord(node?.dataset) ? node.dataset : {};
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
