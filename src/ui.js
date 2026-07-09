import { DISPLAY_NAME, PANEL_TABS } from './constants.js';

export function renderPanelHtml(state, debugEntries = []) {
  const safeState = normalizeState(state);
  const safeDebugEntries = records(debugEntries);
  const tabButtons = safeState.tabs.map((tab) => {
    const active = tab.id === safeState.panel.activeTab ? ' aria-selected="true"' : ' aria-selected="false"';
    return `<button class="ttap-tab" data-tab="${escapeHtml(tab.id)}" type="button"${active}>${escapeHtml(tab.label)}</button>`;
  }).join('');
  const hiddenAttr = safeState.panel.open ? '' : ' hidden';

  return [
    `<div class="ttap-backdrop" data-ttap-close${hiddenAttr}></div>`,
    `<aside class="ttap-panel" data-open="${safeState.panel.open ? 'true' : 'false'}" aria-label="${escapeHtml(DISPLAY_NAME)}">`,
    '<header class="ttap-header">',
    `<strong>${escapeHtml(DISPLAY_NAME)}</strong>`,
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
    bound = bindOne(root, '[data-export-debug]', () => {
      safeInvoke(onExportDebug, debug);
    }, debug) && bound;

    return bound;
  }

  render();
  return { root, render };
}

function renderActiveTab(state, debugEntries) {
  if (state.panel.activeTab === 'tasks') return renderTasks(state.tasks);
  if (state.panel.activeTab === 'rules') return renderRules(state.settings.rules);
  if (state.panel.activeTab === 'cache') return renderCache(state.cacheEntries);
  if (state.panel.activeTab === 'debug') return renderDebug(debugEntries);
  if (state.panel.activeTab === 'settings') return renderSettings(state.settings);
  return renderOverview(state);
}

function renderOverview(state) {
  return [
    '<div class="ttap-metrics">',
    metric('队列', state.tasks.filter((task) => task.state === 'queued').length),
    metric('运行中', state.tasks.filter((task) => task.state === 'running').length),
    metric('待确认', state.tasks.filter((task) => task.state === 'awaiting_approval').length),
    metric('缓存', state.cacheEntries.length),
    '</div>',
    '<div class="ttap-status-line">世界书资料作为子 AI 加工原料，最终生成仍走原生流式路径。</div>'
  ].join('');
}

function renderTasks(tasks) {
  const safeTasks = records(tasks);
  if (!safeTasks.length) return '<p class="ttap-empty">当前没有 worker 任务。</p>';
  return safeTasks.map((task) => [
    '<article class="ttap-card">',
    `<strong>${escapeHtml(task.id)}</strong>`,
    `<span class="ttap-pill">${escapeHtml(task.state)}</span>`,
    task.state === 'awaiting_approval'
      ? `<button type="button" data-approve-task="${escapeHtml(task.id)}">批准</button><button type="button" data-cancel-task="${escapeHtml(task.id)}">取消</button>`
      : '',
    task.error ? `<p class="ttap-error">${escapeHtml(task.error)}</p>` : '',
    '</article>'
  ].join('')).join('');
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
    settings: {
      ...settings,
      rules: records(settings.rules)
    }
  };
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
