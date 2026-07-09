import { DISPLAY_NAME } from './constants.js';

export function renderPanelHtml(state, debugEntries = []) {
  const tabButtons = state.tabs.map((tab) => {
    const active = tab.id === state.panel.activeTab ? ' aria-selected="true"' : ' aria-selected="false"';
    return `<button class="ttap-tab" data-tab="${escapeHtml(tab.id)}" type="button"${active}>${escapeHtml(tab.label)}</button>`;
  }).join('');

  return [
    `<div class="ttap-backdrop" data-ttap-close ${state.panel.open ? '' : 'hidden'}></div>`,
    `<aside class="ttap-panel" data-open="${state.panel.open ? 'true' : 'false'}" aria-label="${DISPLAY_NAME}">`,
    '<header class="ttap-header">',
    `<strong>${DISPLAY_NAME}</strong>`,
    '<button class="ttap-icon-button" type="button" data-ttap-close aria-label="关闭"><i class="fa-solid fa-xmark"></i></button>',
    '</header>',
    `<nav class="ttap-tabs" role="tablist">${tabButtons}</nav>`,
    `<section class="ttap-body">${renderActiveTab(state, debugEntries)}</section>`,
    '</aside>'
  ].join('');
}

export function mountPanel({ documentRef, rootId = 'tt-agent-plus-727-root', getState, getDebugEntries, onTab, onClose, onApprove, onCancel, onExportDebug }) {
  let root = documentRef.getElementById(rootId);
  if (!root) {
    root = documentRef.createElement('div');
    root.id = rootId;
    documentRef.body.append(root);
  }

  function render() {
    root.innerHTML = renderPanelHtml(getState(), getDebugEntries());
    root.querySelectorAll('[data-tab]').forEach((button) => {
      button.addEventListener('click', () => onTab(button.dataset.tab));
    });
    root.querySelectorAll('[data-ttap-close]').forEach((button) => {
      button.addEventListener('click', onClose);
    });
    root.querySelectorAll('[data-approve-task]').forEach((button) => {
      button.addEventListener('click', () => onApprove(button.dataset.approveTask));
    });
    root.querySelectorAll('[data-cancel-task]').forEach((button) => {
      button.addEventListener('click', () => onCancel(button.dataset.cancelTask));
    });
    root.querySelector('[data-export-debug]')?.addEventListener('click', onExportDebug);
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
  if (!tasks.length) return '<p class="ttap-empty">当前没有 worker 任务。</p>';
  return tasks.map((task) => [
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
  return rules.map((rule) => [
    '<article class="ttap-card">',
    `<strong>${escapeHtml(rule.name)}</strong>`,
    `<p>${escapeHtml(rule.description)}</p>`,
    `<span class="ttap-pill">上限 ${rule.maxInputTokens} tk</span>`,
    '</article>'
  ].join('')).join('');
}

function renderCache(entries) {
  if (!entries.length) return '<p class="ttap-empty">还没有处理后的缓存。</p>';
  return entries.map((entry) => [
    '<article class="ttap-card">',
    `<strong>${escapeHtml(entry.key)}</strong>`,
    `<p>${escapeHtml(entry.processedText.slice(0, 120))}</p>`,
    `<span class="ttap-pill">${entry.stale ? '已失效' : '可用'}</span>`,
    '</article>'
  ].join('')).join('');
}

function renderDebug(entries) {
  const rows = entries.map((entry) => `<li>[${escapeHtml(entry.level)}] ${escapeHtml(entry.channel)}：${escapeHtml(entry.message)}</li>`).join('');
  return [
    '<button type="button" data-export-debug>导出 JSON</button>',
    `<ol class="ttap-debug-list">${rows}</ol>`
  ].join('');
}

function renderSettings(settings) {
  return [
    '<div class="ttap-settings-grid">',
    metric('全局并发', settings.globalConcurrency),
    metric('确认阈值', settings.dispatchConfirmThreshold),
    metric('Worker 上限', `${settings.maxWorkerInputTokens} tk`),
    metric('主题', settings.theme),
    '</div>'
  ].join('');
}

function metric(label, value) {
  return `<div class="ttap-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
